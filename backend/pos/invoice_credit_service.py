"""
Move-to-ledger (credit) finalization for offline/bulk tooling (e.g. bulk_unpriced_pending_to_credit).

The HTTP endpoint invoice_mark_credit keeps its own implementation in views.py; this module is not
imported from views to avoid coupling production API code to bulk helpers.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from backend.core.utils import create_audit_log
from backend.parties.internal_ledger_utils import (
    create_internal_ledger_entry_if_mtshop,
    reverse_internal_ledger_entries_for_ledger_entries,
)
from backend.parties.models import LedgerEntry
from backend.pos.models import Invoice, InvoiceItem, Repair

logger = logging.getLogger(__name__)


def mark_invoice_barcodes_sold_for_checkout(invoice: Invoice) -> None:
    """
    Same barcode tagging as invoice_checkout when finalizing as cash/upi/mixed/credit.
    Does not deduct stock again (already done when lines were added).
    """
    for item in invoice.items.select_related('product', 'barcode').all():
        if item.barcode:
            item.barcode.tag = 'sold'
            item.barcode.save(update_fields=['tag'])
        elif not item.product.track_inventory:
            from backend.catalog.barcode_resolution import single_barcode_for_untracked_product

            product_barcode = single_barcode_for_untracked_product(item.product)
            if product_barcode and product_barcode.tag == 'new':
                product_barcode.tag = 'sold'
                product_barcode.save(update_fields=['tag'])


def resolve_item_purchase_unit_cost(item: InvoiceItem) -> Decimal | None:
    """
    Purchase cost per unit for pricing (aligned with checkout / pending display logic).
    Returns None if cost cannot be resolved.
    """
    product = item.product
    name = (product.name or '') if product else ''
    if name.startswith('Other -'):
        if item.purchase_price is not None and item.purchase_price > 0:
            return item.purchase_price
        return None
    if item.barcode:
        try:
            pp = item.barcode.get_purchase_price()
        except Exception:
            pp = None
        if pp is not None and pp > 0:
            return pp
        return None
    if product and not product.track_inventory:
        from backend.catalog.barcode_resolution import single_barcode_for_untracked_product

        product_barcode = single_barcode_for_untracked_product(product)
        if product_barcode:
            try:
                pp = product_barcode.get_purchase_price()
            except Exception:
                pp = None
            if pp is not None and pp > 0:
                return pp
    return None


def item_effective_sell_unit_price(item: InvoiceItem) -> Decimal:
    m = item.manual_unit_price
    u = item.unit_price
    if m is not None and m > 0:
        return m
    if u is not None and u > 0:
        return u
    return Decimal('0.00')


def invoice_has_only_unpriced_positive_lines(invoice: Invoice) -> bool:
    """Draft-pending bulk: every line qty > 0 and sell unit is 0."""
    items = list(invoice.items.select_related('product', 'barcode').all())
    if not items:
        return False
    for it in items:
        if it.quantity is None or it.quantity <= 0:
            return False
        if item_effective_sell_unit_price(it) != Decimal('0.00'):
            return False
    return True


def all_lines_have_resolvable_purchase_cost(invoice: Invoice) -> bool:
    for it in invoice.items.select_related('product', 'barcode').all():
        if it.quantity is None or it.quantity <= 0:
            continue
        c = resolve_item_purchase_unit_cost(it)
        if c is None or c <= 0:
            return False
    return True


def _apply_repair_side_effects_on_mark_credit(invoice: Invoice, request) -> None:
    try:
        repair = invoice.repair
    except Repair.DoesNotExist:
        return
    if request is not None and hasattr(request, 'data') and 'delivery_date' in request.data:
        old_delivery_date = repair.delivery_date
        v = request.data.get('delivery_date')
        if v is None or v == '':
            repair.delivery_date = None
        else:
            try:
                from datetime import datetime as dt

                repair.delivery_date = dt.strptime(str(v).strip()[:10], '%Y-%m-%d').date()
            except (ValueError, TypeError):
                pass
        if old_delivery_date != repair.delivery_date:
            # Keep history consistent when delivery_date changes via mark-credit path
            create_audit_log(
                request=request,
                action='repair_delivery_date_update',
                model_name='Repair',
                object_id=str(repair.id),
                object_name=f"Repair {repair.barcode}",
                object_reference=repair.barcode,
                barcode=repair.barcode,
                changes={'delivery_date': {'old': str(old_delivery_date) if old_delivery_date else None, 'new': str(repair.delivery_date) if repair.delivery_date else None}},
            )
    if invoice.items.exists() and repair.status == 'received':
        repair.status = 'work_in_progress'
    repair.save()


def finalize_invoice_mark_credit_core(
    invoice: Invoice,
    user,
    *,
    pre_mark_invoice_type: str,
    pre_mark_status: str,
    request=None,
    mark_barcodes_sold: bool = False,
) -> Invoice:
    """
    After line items are fully priced: set credit, ledger, pending_cleared_at, audit.
    Mirrors invoice_mark_credit (Move to Ledger) behavior.

    Args:
        mark_barcodes_sold: If True, also run checkout-style barcode tagging (for bulk tools
            that should match invoice_checkout credit as well as mark-credit ledger).
    """
    from backend.pos.views import update_invoice_totals

    if not invoice.customer_id:
        raise ValueError('Invoice must have a customer assigned to mark as credit')

    if mark_barcodes_sold:
        mark_invoice_barcodes_sold_for_checkout(invoice)

    _apply_repair_side_effects_on_mark_credit(invoice, request)

    old_status = invoice.status
    invoice.status = 'credit'
    invoice.invoice_type = 'credit'
    invoice.save()

    update_invoice_totals(invoice)
    invoice.refresh_from_db()

    if invoice.status != 'credit':
        invoice.status = 'credit'
        invoice.save()
        invoice.refresh_from_db()

    if invoice.total <= 0:
        invoice.status = old_status
        invoice.invoice_type = pre_mark_invoice_type
        invoice.save()
        raise ValueError('Invoice total must be greater than 0 to mark as credit')

    invoice.paid_amount = invoice.payments.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
    invoice.due_amount = invoice.total - invoice.paid_amount
    invoice.status = 'credit'
    invoice.save()
    invoice.refresh_from_db()

    if invoice.status != 'credit':
        logger.error(
            'Invoice %s status is %s after mark_credit, expected credit',
            invoice.invoice_number,
            invoice.status,
        )
        invoice.status = 'credit'
        invoice.save()
        invoice.refresh_from_db()

    existing_entries = LedgerEntry.objects.filter(invoice=invoice)
    net_balance_to_reverse = Decimal('0.00')
    for entry in existing_entries:
        if entry.entry_type == 'debit':
            net_balance_to_reverse += entry.amount
        else:
            net_balance_to_reverse -= entry.amount

    reverse_internal_ledger_entries_for_ledger_entries(
        existing_entries, user, 'Mark as credit (replace entries)'
    )
    existing_entries.delete()
    invoice.customer.credit_balance += net_balance_to_reverse

    entry = LedgerEntry.objects.create(
        customer=invoice.customer,
        invoice=invoice,
        entry_type='debit',
        amount=invoice.total,
        description=f'Credit Invoice {invoice.invoice_number}',
        created_by=user,
        created_at=invoice.created_at or timezone.now(),
    )
    create_internal_ledger_entry_if_mtshop(
        invoice.customer,
        'debit',
        invoice.total,
        f'Credit Invoice {invoice.invoice_number}',
        user,
        invoice.created_at or timezone.now(),
        source_ledger_entry_id=entry.id,
    )
    invoice.customer.credit_balance -= entry.amount
    invoice.customer.save()

    invoice.refresh_from_db()
    if invoice.status != 'credit':
        logger.warning(
            'Invoice %s status is %s after creating ledger entry, forcing to credit',
            invoice.invoice_number,
            invoice.status,
        )
        invoice.status = 'credit'
        invoice.save()

    verify_entry = LedgerEntry.objects.filter(invoice=invoice, entry_type='debit').first()
    if not verify_entry:
        raise RuntimeError(f'Ledger entry not found for invoice {invoice.invoice_number} after creation')

    invoice.refresh_from_db()
    if invoice.status != 'credit':
        logger.error(
            'Invoice %s status is %s before audit, forcing to credit',
            invoice.invoice_number,
            invoice.status,
        )
        invoice.status = 'credit'
        invoice.save()
        invoice.refresh_from_db()

    if pre_mark_invoice_type == 'pending' and pre_mark_status == 'draft':
        Invoice.objects.filter(pk=invoice.pk, pending_cleared_at__isnull=True).update(
            pending_cleared_at=timezone.now()
        )
        invoice.refresh_from_db(fields=['pending_cleared_at'])

    create_audit_log(
        request=request,
        action='invoice_mark_credit',
        model_name='Invoice',
        object_id=str(invoice.id),
        object_name=f'Invoice {invoice.invoice_number}',
        object_reference=invoice.invoice_number,
        barcode=None,
        user=user,
        changes={
            'invoice_number': invoice.invoice_number,
            'status': {'old': 'draft', 'new': 'credit'},
            'invoice_type': invoice.invoice_type,
            'total': str(invoice.total),
            'due_amount': str(invoice.due_amount),
            'customer': invoice.customer.name if invoice.customer else None,
        },
    )
    return invoice


def reconcile_ledger_after_credit_invoice_total_change(
    invoice: Invoice,
    user,
    *,
    note: str = '',
) -> None:
    """
    After line totals / invoice.total change on an invoice already in credit + ledger:
    remove existing invoice-linked ledger rows (and restore customer balance), then post one
    new debit for the current invoice.total. Mirrors the ledger tail of finalize_invoice_mark_credit_core.

    Caller must have saved line items and run update_invoice_totals (or equivalent) first.
    """
    from backend.pos.views import update_invoice_totals

    invoice.refresh_from_db()
    if not invoice.customer_id:
        raise ValueError('Invoice has no customer')
    if invoice.status != 'credit' or invoice.invoice_type != 'credit':
        raise ValueError(
            f'Expected status=credit and invoice_type=credit, got {invoice.status!r} / {invoice.invoice_type!r}'
        )

    update_invoice_totals(invoice)
    invoice.refresh_from_db()

    invoice.paid_amount = invoice.payments.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
    invoice.due_amount = invoice.total - invoice.paid_amount
    invoice.save(update_fields=['paid_amount', 'due_amount', 'subtotal', 'total'])

    if invoice.total <= 0:
        raise ValueError('Invoice total must be greater than 0 after adjustment')

    existing_entries = LedgerEntry.objects.filter(invoice=invoice)
    net_balance_to_reverse = Decimal('0.00')
    for entry in existing_entries:
        if entry.entry_type == 'debit':
            net_balance_to_reverse += entry.amount
        else:
            net_balance_to_reverse -= entry.amount

    reverse_internal_ledger_entries_for_ledger_entries(
        existing_entries,
        user,
        note or 'Credit invoice total adjustment (reconcile ledger)',
    )
    existing_entries.delete()
    invoice.customer.credit_balance += net_balance_to_reverse

    entry = LedgerEntry.objects.create(
        customer=invoice.customer,
        invoice=invoice,
        entry_type='debit',
        amount=invoice.total,
        description=f'Credit Invoice {invoice.invoice_number}',
        created_by=user,
        created_at=invoice.created_at or timezone.now(),
    )
    create_internal_ledger_entry_if_mtshop(
        invoice.customer,
        'debit',
        invoice.total,
        f'Credit Invoice {invoice.invoice_number}',
        user,
        invoice.created_at or timezone.now(),
        source_ledger_entry_id=entry.id,
    )
    invoice.customer.credit_balance -= entry.amount
    invoice.customer.save()


def remove_invoice_ledger_entries_and_restore_customer(
    invoice: Invoice,
    user,
    *,
    note: str,
) -> Decimal:
    """
    Delete all main LedgerEntry rows for this invoice and bump customer.credit_balance by the net
    effect of removing those rows (same net formula as finalize_invoice_mark_credit_core).
    Returns the net debit amount that was reversed (typically the former invoice total).
    """
    qs = LedgerEntry.objects.filter(invoice=invoice).select_related('customer')
    entries = list(qs)
    net_balance_to_reverse = Decimal('0.00')
    for entry in entries:
        if entry.entry_type == 'debit':
            net_balance_to_reverse += entry.amount
        else:
            net_balance_to_reverse -= entry.amount
    if not entries:
        return Decimal('0.00')
    reverse_internal_ledger_entries_for_ledger_entries(qs, user, note)
    qs.delete()
    if invoice.customer_id:
        invoice.customer.credit_balance += net_balance_to_reverse
        invoice.customer.save(update_fields=['credit_balance'])
    return net_balance_to_reverse


def revert_credit_invoice_to_draft_pending(
    invoice: Invoice,
    user,
    *,
    skip_barcode_restore: bool = False,
) -> Invoice:
    """
    Undo a mark-credit / bulk_unpriced_pending_to_credit-style finalization for an invoice that
    still has no real payments: remove ledger rows, restore customer balance, set credit -> draft
    pending, clear pending_cleared_at, zero line sell prices, set barcodes back to new when sold.

    Refuses if any non-refund payment sum is non-zero.
    """
    from backend.catalog.barcode_cache import invalidate_barcode_cache
    from backend.catalog.barcode_resolution import single_barcode_for_untracked_product
    from backend.pos.views import update_invoice_totals

    inv = invoice
    inv.refresh_from_db()
    if inv.status != 'credit' or inv.invoice_type != 'credit':
        raise ValueError(
            f'Expected status=credit and invoice_type=credit, got {inv.status!r} / {inv.invoice_type!r}'
        )
    if not inv.customer_id:
        raise ValueError('Invoice has no customer')

    paid_non_refund = (
        inv.payments.exclude(payment_method='refund').aggregate(t=Sum('amount'))['t'] or Decimal('0.00')
    )
    if paid_non_refund != Decimal('0.00'):
        raise ValueError(
            f'Refuse revert: non-refund payments total ₹{paid_non_refund}. '
            'Adjust payments first or handle this invoice manually.'
        )

    remove_invoice_ledger_entries_and_restore_customer(
        inv,
        user,
        note='Revert bulk credit (restore draft pending)',
    )

    if not skip_barcode_restore:
        for it in inv.items.select_related('product', 'barcode').all():
            if it.barcode_id and it.barcode and it.barcode.tag == 'sold':
                b = it.barcode
                old_tag = b.tag
                b.tag = 'new'
                b.save(update_fields=['tag'])
                invalidate_barcode_cache(b)
                create_audit_log(
                    request=None,
                    action='barcode_tag_change',
                    model_name='Barcode',
                    object_id=str(b.id),
                    object_name=it.product.name if it.product else '',
                    object_reference=inv.invoice_number,
                    barcode=b.barcode,
                    user=user,
                    changes={
                        'tag': {'old': old_tag, 'new': 'new'},
                        'context': 'revert_bulk_credit_to_draft_pending',
                        'invoice_id': inv.id,
                    },
                )
            elif it.product_id and it.product and not it.product.track_inventory:
                pb = single_barcode_for_untracked_product(it.product)
                if pb and pb.tag == 'sold':
                    old_tag = pb.tag
                    pb.tag = 'new'
                    pb.save(update_fields=['tag'])
                    invalidate_barcode_cache(pb)
                    create_audit_log(
                        request=None,
                        action='barcode_tag_change',
                        model_name='Barcode',
                        object_id=str(pb.id),
                        object_name=it.product.name,
                        object_reference=inv.invoice_number,
                        barcode=pb.barcode,
                        user=user,
                        changes={
                            'tag': {'old': old_tag, 'new': 'new'},
                            'context': 'revert_bulk_credit_to_draft_pending_untracked',
                            'invoice_id': inv.id,
                        },
                    )

    for it in inv.items.all():
        it.manual_unit_price = None
        it.unit_price = Decimal('0.00')
        it.line_total = (
            Decimal('0') * it.quantity - it.discount_amount + it.tax_amount
        ).quantize(Decimal('0.01'))
        it.save(
            update_fields=[
                'manual_unit_price',
                'unit_price',
                'line_total',
            ]
        )

    try:
        repair = inv.repair
        if repair and repair.status == 'work_in_progress':
            repair.status = 'received'
            repair.save(update_fields=['status'])
    except Repair.DoesNotExist:
        pass

    inv.status = 'draft'
    inv.invoice_type = 'pending'
    inv.pending_cleared_at = None
    inv.paid_amount = Decimal('0.00')
    inv.save(
        update_fields=[
            'status',
            'invoice_type',
            'pending_cleared_at',
            'paid_amount',
        ]
    )

    update_invoice_totals(inv)
    inv.refresh_from_db()
    inv.due_amount = inv.total - inv.paid_amount
    inv.save(update_fields=['due_amount'])

    create_audit_log(
        request=None,
        action='invoice_update',
        model_name='Invoice',
        object_id=str(inv.id),
        object_name=f'Invoice {inv.invoice_number}',
        object_reference=inv.invoice_number,
        barcode=None,
        user=user,
        changes={
            'tool': 'revert_credit_invoice_to_draft_pending',
            'status': {'old': 'credit', 'new': 'draft'},
            'invoice_type': {'old': 'credit', 'new': 'pending'},
            'pending_cleared_at': 'cleared',
        },
    )
    return inv
