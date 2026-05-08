"""
Replacement POS: lookup sold lines by barcode / short code / sold_barcode_value snapshot,
and create replacement-return invoices (`Invoice.is_replacement_return`).

Endpoints mounted at `pos/replacement-pos/lookup/` and `pos/replacement-pos/create/` (see urls).
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import uuid

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.catalog.barcode_cache import invalidate_barcode_cache
from backend.catalog.barcode_resolution import single_barcode_for_untracked_product
from backend.core.utils import create_audit_log
from backend.inventory.models import Stock
from backend.locations.models import Store
from backend.parties.internal_ledger_utils import create_internal_ledger_entry_if_mtshop
from backend.parties.models import Customer, LedgerEntry

from .models import Invoice, InvoiceItem, Payment
from .serializers import InvoiceSerializer
from .views import resolve_invoice_item_barcode, update_invoice_totals, validate_barcode_for_replacement


RETURN_TAGS = frozenset({'returned', 'unknown', 'defective'})
ELIGIBLE_ORIGINAL_INV_STATUSES = frozenset({'paid', 'partial', 'credit'})
AMBI_MATCH_CAP = 25


def _norm_scan(value):
    if value is None:
        return ''
    return str(value).strip().upper()


def _effective_sold_unit(inv_item):
    mu = inv_item.manual_unit_price
    if mu is not None and mu > 0:
        return mu
    return inv_item.unit_price or Decimal('0.00')


def _serialize_lookup_line(inv_item):
    invoice = inv_item.invoice
    barcode_obj = resolve_invoice_item_barcode(inv_item, scanned_override=None, relink=False)
    eff = _effective_sold_unit(inv_item)
    product = inv_item.product
    return {
        'original_invoice_item_id': inv_item.id,
        'original_invoice_id': invoice.id,
        'original_invoice_number': invoice.invoice_number,
        'store_id': invoice.store_id,
        'store_name': invoice.store.name if invoice.store_id else None,
        'customer_id': invoice.customer_id,
        'customer_name': invoice.customer.name if invoice.customer_id else None,
        'product_id': product.id if product else None,
        'product_name': product.name if product else None,
        'product_sku': product.sku if product else None,
        'sold_barcode_value': inv_item.sold_barcode_value or '',
        'barcode_short': barcode_obj.short_code if barcode_obj else None,
        'barcode_full': barcode_obj.barcode if barcode_obj else None,
        'sold_unit_price': str(eff.quantize(Decimal('0.01'))),
        'quantity': str(inv_item.quantity),
        'barcode_tag': barcode_obj.tag if barcode_obj else None,
    }


def _validate_lookup_eligibility(inv_item):
    """Return (ok bool, message_or_none)."""
    product = inv_item.product
    if not product:
        return False, 'Line has no product'

    barcode_obj = resolve_invoice_item_barcode(inv_item, scanned_override=None, relink=False)

    if product.track_inventory:
        if not barcode_obj:
            return False, (
                'This line has no resolvable catalog barcode. Restore it on the original invoice line first.'
            )
        ok, msg = validate_barcode_for_replacement(barcode_obj)
        return (True, None) if ok else (False, msg or 'Barcode not eligible for return')

    pb = single_barcode_for_untracked_product(product)
    if pb:
        ok, msg = validate_barcode_for_replacement(pb)
        return (True, None) if ok else (False, msg or 'Product barcode not eligible for return')
    return True, None


def _generate_invoice_number():
    num = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    while Invoice.objects.filter(invoice_number=num).exists():
        num = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    return num


def _parse_decimal(val, label):
    if val in (None, ''):
        raise ValueError(f'{label} is required')
    try:
        return Decimal(str(val)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise ValueError(f'{label} is not a valid number')


def _apply_barcode_stock_for_return(invoice_item_new, tag, physical_store):
    """Update catalog barcode tags and stock for one replacement-return line (instant mode)."""
    orig = invoice_item_new.original_invoice_item
    product = invoice_item_new.product
    if not orig or not product:
        return
    qty = invoice_item_new.quantity

    barcode_obj = resolve_invoice_item_barcode(orig, scanned_override=None, relink=False)
    if product.track_inventory:
        if not barcode_obj:
            return
        if tag == 'defective':
            barcode_obj.tag = 'defective'
            barcode_obj.save(update_fields=['tag'])
            invalidate_barcode_cache(barcode_obj)
            return
        barcode_obj.tag = tag if tag in RETURN_TAGS else 'returned'
        barcode_obj.save(update_fields=['tag'])
        invalidate_barcode_cache(barcode_obj)
        variant = invoice_item_new.variant
        stock, _ = Stock.objects.get_or_create(
            product=product,
            variant=variant,
            store=physical_store,
            defaults={'quantity': Decimal('0.000')},
        )
        stock.quantity += qty
        stock.save()
        return

    pb = single_barcode_for_untracked_product(product)
    if not pb:
        return
    if tag == 'defective':
        pb.tag = 'defective'
        pb.save(update_fields=['tag'])
        invalidate_barcode_cache(pb)
        return
    pb.tag = tag if tag in RETURN_TAGS else 'returned'
    pb.save(update_fields=['tag'])
    invalidate_barcode_cache(pb)
    variant = invoice_item_new.variant
    stock, _ = Stock.objects.get_or_create(
        product=product,
        variant=variant,
        store=physical_store,
        defaults={'quantity': Decimal('0.000')},
    )
    stock.quantity += qty
    stock.save()


def _apply_replacement_pos_checkout(invoice, request, settlement_invoice_type, cash_amount=None, upi_amount=None):
    if not invoice.customer:
        raise ValueError('Customer is required for instant replacement settlement.')

    invoice.refresh_from_db()
    Payment.objects.filter(invoice=invoice).delete()

    total = (invoice.total or Decimal('0')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    if total <= 0:
        raise ValueError('Invoice total must be greater than zero before checkout.')

    st = (settlement_invoice_type or 'cash').strip().lower()
    if st == 'mixed':
        ca = _parse_decimal(cash_amount, 'cash_amount')
        ua = _parse_decimal(upi_amount, 'upi_amount')
        if ca + ua != total:
            raise ValueError('Cash and UPI amounts must equal the invoice total.')
        entry = LedgerEntry.objects.create(
            customer=invoice.customer,
            invoice=invoice,
            entry_type='credit',
            payment_mode='mixed',
            cash_amount=ca,
            upi_amount=ua,
            amount=total,
            description=f'Replacement POS return {invoice.invoice_number} (MIXED)',
            created_by=request.user,
            created_at=timezone.now(),
        )
    elif st == 'cash':
        entry = LedgerEntry.objects.create(
            customer=invoice.customer,
            invoice=invoice,
            entry_type='credit',
            payment_mode='cash',
            cash_amount=total,
            upi_amount=None,
            amount=total,
            description=f'Replacement POS return {invoice.invoice_number} (CASH)',
            created_by=request.user,
            created_at=timezone.now(),
        )
    elif st == 'upi':
        entry = LedgerEntry.objects.create(
            customer=invoice.customer,
            invoice=invoice,
            entry_type='credit',
            payment_mode='upi',
            cash_amount=None,
            upi_amount=total,
            amount=total,
            description=f'Replacement POS return {invoice.invoice_number} (UPI)',
            created_by=request.user,
            created_at=timezone.now(),
        )
    elif st == 'credit':
        entry = LedgerEntry.objects.create(
            customer=invoice.customer,
            invoice=invoice,
            entry_type='credit',
            payment_mode='other',
            cash_amount=None,
            upi_amount=None,
            amount=total,
            description=f'Replacement POS return {invoice.invoice_number} (CREDIT)',
            created_by=request.user,
            created_at=timezone.now(),
        )
    else:
        raise ValueError('settlement_invoice_type must be cash, upi, mixed, or credit.')

    create_internal_ledger_entry_if_mtshop(
        invoice.customer,
        'credit',
        total,
        entry.description,
        request.user,
        timezone.now(),
    )
    invoice.customer.credit_balance += total
    invoice.customer.save(update_fields=['credit_balance'])

    physical_store = invoice.store
    for item in invoice.items.select_related(
        'product', 'variant', 'original_invoice_item', 'original_invoice_item__invoice'
    ).all():
        tag = (item.replacement_return_tag or '').strip().lower()
        if tag not in RETURN_TAGS:
            raise ValueError('Invalid replacement_return_tag on line.')
        barcode_obj = None
        if item.original_invoice_item:
            barcode_obj = resolve_invoice_item_barcode(item.original_invoice_item, scanned_override=None, relink=False)
        if barcode_obj:
            ok, msg = validate_barcode_for_replacement(barcode_obj)
            if not ok:
                raise ValueError(msg or 'Barcode became ineligible.')

        product = item.product
        if product and product.track_inventory and not barcode_obj:
            pname = product.name if product else 'item'
            raise ValueError(f'Cannot finalize: barcode missing on original line ({pname}).')

        _apply_barcode_stock_for_return(item, tag, physical_store)

    if st == 'mixed':
        invoice.invoice_type = 'mixed'
    elif st == 'credit':
        invoice.invoice_type = 'credit'
    else:
        invoice.invoice_type = st

    invoice.status = 'paid'
    invoice.paid_amount = total
    invoice.due_amount = Decimal('0.00')
    invoice.save(update_fields=['invoice_type', 'status', 'paid_amount', 'due_amount'])


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_pos_lookup(request):
    raw = request.data.get('barcode') or request.data.get('scanned')
    norm = _norm_scan(raw)
    if not norm:
        return Response(
            {'error': 'barcode is required', 'message': 'Provide barcode or scanned.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    qs = (
        InvoiceItem.objects.filter(
            quantity__gt=0,
            invoice__status__in=ELIGIBLE_ORIGINAL_INV_STATUSES,
        )
        .filter(
            Q(barcode__barcode=norm)
            | Q(barcode__short_code=norm)
            | Q(sold_barcode_value__iexact=norm)
        )
        .select_related('invoice', 'invoice__store', 'invoice__customer', 'product', 'barcode', 'variant')
        .order_by('-invoice__created_at', '-id')[:250]
    )
    candidates = list(qs)
    if not candidates:
        return Response(
            {'error': 'No sold line found', 'message': 'No eligible sold line matches this barcode.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    valid_lines = []
    first_err = None
    for inv_item in candidates:
        ok, msg = _validate_lookup_eligibility(inv_item)
        if ok:
            valid_lines.append(inv_item)
        elif first_err is None:
            first_err = msg

    if not valid_lines:
        return Response(
            {
                'error': 'Barcode not eligible',
                'message': first_err or 'No eligible returnable lines for this scan.',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(valid_lines) == 1:
        return Response({'ambiguous': False, 'line': _serialize_lookup_line(valid_lines[0])})

    trimmed = [_serialize_lookup_line(li) for li in valid_lines[:AMBI_MATCH_CAP]]
    return Response({'ambiguous': True, 'matches': trimmed})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic
def replacement_pos_create(request):
    try:
        return _replacement_pos_create_body(request)
    except ValueError as e:
        return Response({'error': str(e), 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)


def _replacement_pos_create_body(request):
    mode = str(request.data.get('mode') or '').strip().lower()
    if mode not in ('instant', 'pending'):
        raise ValueError('mode must be instant or pending.')

    raw_lines = request.data.get('lines')
    if not isinstance(raw_lines, list) or len(raw_lines) == 0:
        raise ValueError('lines must be a non-empty list.')

    settlement_type = str(request.data.get('settlement_invoice_type') or 'cash').strip().lower()
    if settlement_type not in ('cash', 'upi', 'mixed', 'credit'):
        raise ValueError('settlement_invoice_type must be cash, upi, mixed, or credit.')

    line_ids_requested = []
    parsed_lines = []
    seen_ids = set()
    for row in raw_lines:
        if not isinstance(row, dict):
            raise ValueError('Each line must be an object.')
        oid = row.get('original_invoice_item_id')
        if oid in (None, ''):
            raise ValueError('Each line requires original_invoice_item_id.')
        try:
            oid_int = int(oid)
        except (TypeError, ValueError):
            raise ValueError('original_invoice_item_id must be an integer.')

        tag = row.get('return_tag') or row.get('replacement_return_tag')
        tag = str(tag or '').strip().lower()
        if tag not in RETURN_TAGS:
            raise ValueError('return_tag must be returned, unknown, or defective.')

        acc = row.get('accepted_return_price')
        acc_dec = _parse_decimal(acc, 'accepted_return_price')
        if acc_dec <= Decimal('0'):
            raise ValueError('accepted_return_price must be greater than zero.')

        if oid_int in seen_ids:
            raise ValueError('Duplicate original_invoice_item_id in request.')
        seen_ids.add(oid_int)

        parsed_lines.append(
            {'original_invoice_item_id': oid_int, 'return_tag': tag, 'accepted_return_price': acc_dec}
        )
        line_ids_requested.append(oid_int)

    dup_returns = InvoiceItem.objects.filter(
        original_invoice_item_id__in=line_ids_requested,
        invoice__is_replacement_return=True,
    ).exclude(invoice__status='void')

    dup_ids_set = set(dup_returns.values_list('original_invoice_item_id', flat=True))
    if dup_ids_set:
        raise ValueError('One or more lines were already processed on another replacement-return invoice.')

    originals = InvoiceItem.objects.filter(pk__in=line_ids_requested).select_related(
        'invoice',
        'invoice__store',
        'invoice__customer',
        'product',
        'variant',
        'barcode',
    )
    by_pk = {o.id: o for o in originals}
    if len(by_pk) != len(line_ids_requested):
        missing = sorted(set(line_ids_requested) - set(by_pk.keys()))
        raise ValueError(f'Original line(s) not found: {missing}')

    store_ids = set()
    source_summaries = []
    customer_ids_seen = set()
    for oid in line_ids_requested:
        o_item = by_pk[oid]
        inv = o_item.invoice
        if inv.status not in ELIGIBLE_ORIGINAL_INV_STATUSES:
            raise ValueError(f'Original invoice line {oid} is not on a finalized sale.')
        store_ids.add(inv.store_id)
        if inv.customer_id:
            customer_ids_seen.add(inv.customer_id)
        source_summaries.append(
            {
                'original_invoice_number': inv.invoice_number,
                'original_invoice_id': inv.id,
                'customer_id': inv.customer_id,
                'customer_name': inv.customer.name if inv.customer_id else None,
            }
        )

    uniq_sources = []
    seen_pairs = set()
    for row in source_summaries:
        key = (row['original_invoice_id'], row.get('customer_id'))
        if key not in seen_pairs:
            seen_pairs.add(key)
            uniq_sources.append(row)

    if len(store_ids) > 1:
        raise ValueError('Original sales span multiple stores.')

    inferred_store_id = next(iter(store_ids))
    store_obj = Store.objects.filter(pk=inferred_store_id).first()
    if not store_obj:
        raise ValueError('Original store missing.')

    store_param = request.data.get('store')
    if store_param not in (None, ''):
        try:
            if int(store_param) != inferred_store_id:
                raise ValueError('store must match the store of all original sale lines.')
        except (TypeError, ValueError):
            raise ValueError('store must be an integer.')

    cust_warning = len(customer_ids_seen) > 1
    customer_override = request.data.get('customer')
    if cust_warning:
        if customer_override in (None, ''):
            raise ValueError(
                'Multiple customers on originals — choose a customer for this return invoice.',
            )

    invoice_customer_id = customer_override if customer_override not in (None, '') else None
    if invoice_customer_id is not None:
        try:
            invoice_customer_id = int(invoice_customer_id)
        except (TypeError, ValueError):
            raise ValueError('customer must be an integer.')

    if invoice_customer_id is None and len(customer_ids_seen) == 1:
        invoice_customer_id = next(iter(customer_ids_seen))

    customer_obj = None
    if invoice_customer_id:
        customer_obj = get_object_or_404(Customer, pk=invoice_customer_id)

    if mode == 'instant' and not customer_obj:
        raise ValueError('Customer is required for instant settlement.')

    num = _generate_invoice_number()

    invoice = Invoice.objects.create(
        invoice_number=num,
        cart=None,
        store=store_obj,
        customer=customer_obj,
        status='draft',
        invoice_type='pending' if mode == 'pending' else 'cash',
        is_replacement_return=True,
        replacement_mode=mode,
        replacement_customer_warning=cust_warning,
        replacement_source_customers=uniq_sources,
        created_by=request.user,
        created_at=timezone.now(),
    )

    cash_amt_req = None
    upi_amt_req = None
    if mode == 'instant':
        settle = settlement_type if settlement_type in ('cash', 'upi', 'mixed', 'credit') else 'cash'
        if settle == 'mixed':
            cash_amt_req = request.data.get('cash_amount')
            upi_amt_req = request.data.get('upi_amount')

    for pd in parsed_lines:
        oid = pd['original_invoice_item_id']
        orig = by_pk[oid]
        qty = orig.quantity

        ceil_u = _effective_sold_unit(orig)
        ceil_u_q = ceil_u.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        accepted = pd['accepted_return_price']
        accepted_q = accepted.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        if accepted_q > ceil_u_q:
            raise ValueError(
                'Accepted price cannot exceed original sold unit price for each line.'
            )

        tag = pd['return_tag']
        cust_name_snap = ''
        if orig.invoice and orig.invoice.customer:
            cust_name_snap = orig.invoice.customer.name or ''

        line_total = (qty * accepted).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        InvoiceItem.objects.create(
            invoice=invoice,
            product=orig.product,
            variant=orig.variant,
            barcode_id=orig.barcode_id,
            sold_barcode_value=orig.sold_barcode_value or '',
            quantity=qty,
            unit_price=ceil_u_q,
            manual_unit_price=accepted_q,
            discount_amount=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            line_total=line_total,
            purchase_price=orig.purchase_price,
            replaced_quantity=Decimal('0.000'),
            original_invoice=orig.invoice,
            original_invoice_item=orig,
            replacement_return_tag=tag,
            accepted_return_price=accepted_q,
            original_sold_unit_price=ceil_u_q,
            original_sold_line_total=orig.line_total,
            original_invoice_number=(orig.invoice.invoice_number if orig.invoice else ''),
            original_customer_name=cust_name_snap[:200],
        )
    invoice.refresh_from_db()
    update_invoice_totals(invoice)
    invoice.refresh_from_db()

    if mode == 'instant':
        st_use = settlement_type if settlement_type in ('cash', 'upi', 'mixed', 'credit') else 'cash'
        _apply_replacement_pos_checkout(
            invoice, request, st_use,
            cash_amount=cash_amt_req,
            upi_amount=upi_amt_req,
        )

    create_audit_log(
        request=request,
        action='invoice_create',
        model_name='Invoice',
        object_id=str(invoice.id),
        object_name=f"Replacement POS {invoice.invoice_number}",
        object_reference=invoice.invoice_number,
        barcode=None,
        changes={
            'replacement_pos': True,
            'replacement_mode': mode,
            'settlement_invoice_type': settlement_type if mode == 'instant' else None,
            'line_ids': line_ids_requested,
        },
    )

    invoice.refresh_from_db()
    return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic
def replacement_pos_finalize(request, pk):
    """
    Finalize a pending replacement-return invoice created via Replacement POS.
    Applies stock/barcode updates + ledger credit, marks invoice paid.
    """
    invoice = get_object_or_404(Invoice, pk=pk)

    if not invoice.is_replacement_return:
        return Response(
            {'error': 'This invoice is not a replacement-return invoice.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Idempotent finalize: if already finalized, return success payload instead of error.
    if invoice.status != 'draft':
        invoice.refresh_from_db()
        data = InvoiceSerializer(invoice).data
        data['already_finalized'] = True
        data['message'] = f'Invoice already finalized as {invoice.status}.'
        return Response(data, status=status.HTTP_200_OK)
    if invoice.replacement_mode != 'pending':
        return Response(
            {'error': 'Only pending replacement invoices can be finalized here.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    settlement_type = str(request.data.get('settlement_invoice_type') or 'cash').strip().lower()
    if settlement_type not in ('cash', 'upi', 'mixed', 'credit'):
        return Response(
            {'error': 'settlement_invoice_type must be cash, upi, mixed, or credit.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    cash_amount = request.data.get('cash_amount')
    upi_amount = request.data.get('upi_amount')

    try:
        _apply_replacement_pos_checkout(
            invoice, request, settlement_type,
            cash_amount=cash_amount,
            upi_amount=upi_amount,
        )
    except ValueError as e:
        return Response({'error': str(e), 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    invoice.refresh_from_db()
    return Response(InvoiceSerializer(invoice).data, status=status.HTTP_200_OK)
