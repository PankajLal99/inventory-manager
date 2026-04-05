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
        v = request.data.get('delivery_date')
        if v is None or v == '':
            repair.delivery_date = None
        else:
            try:
                from datetime import datetime as dt

                repair.delivery_date = dt.strptime(str(v).strip()[:10], '%Y-%m-%d').date()
            except (ValueError, TypeError):
                pass
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
