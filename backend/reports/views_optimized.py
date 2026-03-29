"""
Reports: dashboard KPIs (invoice totals by payment type and store, expenses, inhand).
"""
from collections import defaultdict

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, DecimalField, Q, F, Value, Case, When, ExpressionWrapper
from django.db.models.functions import Coalesce
from django.utils import timezone
from datetime import datetime
from decimal import Decimal

from backend.catalog.models import Barcode, DefectiveProductMoveOut
from backend.locations.models import Store
from backend.pos.models import Invoice, Expenses, Payment, InvoiceItem
from backend.pos.views import annotate_invoice_list_profit, filter_repair_invoices_by_list_date


def _decimal_or_zero(value):
    return value if value is not None else Decimal('0.00')


def _sum_list_profit(annotated_qs, money_field):
    return _decimal_or_zero(
        annotated_qs.aggregate(t=Sum('_list_profit', output_field=money_field))['t']
    )


def _serialize_merged_rows(merged, pure_key, mixed_key):
    rows = []
    for sid, v in merged.items():
        pure = v[pure_key]
        mixed = v[mixed_key]
        total = pure + mixed
        if total == Decimal('0.00'):
            continue
        rows.append({
            'store_id': sid,
            'store_name': v['store_name'],
            'shop_type': v['shop_type'],
            'amount': float(total),
            pure_key: float(pure),
            mixed_key: float(mixed),
        })
    rows.sort(key=lambda x: (-x['amount'], x['store_name']))
    return rows


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def optimized_dashboard_kpis(request):
    """
    Dashboard KPIs (date range on invoice.created_at date, expense.expense_date).

    - total_cash: Σ Invoice.total (invoice_type=cash) + Σ Payment.amount (cash legs of mixed invoices).
    - total_upi: Σ Invoice.total (invoice_type=upi) + Σ Payment.amount (UPI legs of mixed invoices).
    - total_credit / credit_by_store: Σ Invoice.total where invoice_type=credit.
    - Per-store cash/upi rows include from_invoice_* and from_mixed_* bifurcation.
    - total_inhand: total_cash - total_expenses.
    - total_payments / payments_by_method: Σ pos.Payment.amount in range (Payment.created_at date),
      excluding invoices void/draft; grouped by payment_method.
    - pending_invoice_purchase_total / pending_purchase_by_store: for invoices pending in the period
      (status=pending OR invoice_type=pending; void/draft excluded), Σ (PurchaseItem.unit_price × qty) on lines
      with barcode→purchase_item; else Σ (InvoiceItem.purchase_price × qty) when purchase_price set.
    - counter_profit: Σ list-style profit (computed_paid − computed_total, annotate_invoice_list_profit) for
      retail/wholesale invoices with invoice_type in cash/upi/mixed/credit, no repair row — matches Invoices page
      (repair and defective excluded).
    - counter_profit_by_store / counter_profit_by_invoice_type: same counter invoice set, grouped by store or
      invoice_type (sums match counter_profit).
    - repair_profit: same profit metric with repair_list profile for repair-shop invoices with Repair status
      done or delivered; invoice_type=pending excluded; date window matches Repairs list
      (created_at / repair.updated_at / delivery_date).
    - stock_value: Σ Coalesce(PurchaseItem.unit_price, 0) per barcode with tag new or returned (available stock);
      excludes barcodes whose purchase_item.purchase is draft.
    - defective_product_count / defective_barcode_count / defective_purchase_value: same basis as Products → Defective tab
      (distinct products with defective barcodes, count of defective barcodes, Σ unit_price on those barcodes).
    - defective_move_out_net_loss: Σ (total_loss − total_adjustment) over all defective move-outs (matches Products tab
      “Total loss”).
    - defective_move_out_net_period: same net, filtered by move-out created_at date in the dashboard range (e.g. Delhi /
      move-outs in period).
    """
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')

    if not date_from:
        date_from = timezone.now().date()
    else:
        date_from = datetime.strptime(date_from, '%Y-%m-%d').date()

    if not date_to:
        date_to = timezone.now().date()
    else:
        date_to = datetime.strptime(date_to, '%Y-%m-%d').date()

    money = DecimalField(max_digits=18, decimal_places=2)

    inv_base = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).exclude(status__in=['void', 'draft'])

    cash_inv_qs = inv_base.filter(invoice_type='cash')
    upi_inv_qs = inv_base.filter(invoice_type='upi')
    mixed_inv_qs = inv_base.filter(invoice_type='mixed')
    credit_qs = inv_base.filter(invoice_type='credit')

    pure_cash_total = _decimal_or_zero(
        cash_inv_qs.aggregate(t=Sum('total', output_field=money))['t']
    )
    pure_upi_total = _decimal_or_zero(
        upi_inv_qs.aggregate(t=Sum('total', output_field=money))['t']
    )

    mixed_cash_pmts = Payment.objects.filter(
        invoice__in=mixed_inv_qs,
        payment_method='cash',
    )
    mixed_upi_pmts = Payment.objects.filter(
        invoice__in=mixed_inv_qs,
        payment_method='upi',
    )

    mixed_cash_total = _decimal_or_zero(
        mixed_cash_pmts.aggregate(t=Sum('amount', output_field=money))['t']
    )
    mixed_upi_total = _decimal_or_zero(
        mixed_upi_pmts.aggregate(t=Sum('amount', output_field=money))['t']
    )

    total_cash = pure_cash_total + mixed_cash_total
    total_upi = pure_upi_total + mixed_upi_total

    total_credit = _decimal_or_zero(
        credit_qs.aggregate(t=Sum('total', output_field=money))['t']
    )

    def _by_store_invoice_totals(qs):
        rows = qs.values('store_id', 'store__name', 'store__shop_type').annotate(
            total_sum=Sum('total', output_field=money)
        )
        return {
            r['store_id']: {
                'store_name': r['store__name'] or '',
                'shop_type': r['store__shop_type'] or '',
                'amount': _decimal_or_zero(r['total_sum']),
            }
            for r in rows
        }

    def _by_store_payment_totals(payment_qs):
        rows = payment_qs.values(
            'invoice__store_id',
            'invoice__store__name',
            'invoice__store__shop_type',
        ).annotate(total_sum=Sum('amount', output_field=money))
        return {
            r['invoice__store_id']: {
                'store_name': r['invoice__store__name'] or '',
                'shop_type': r['invoice__store__shop_type'] or '',
                'amount': _decimal_or_zero(r['total_sum']),
            }
            for r in rows
        }

    pure_cash_by_store = _by_store_invoice_totals(cash_inv_qs)
    pure_upi_by_store = _by_store_invoice_totals(upi_inv_qs)
    mixed_cash_by_store = _by_store_payment_totals(mixed_cash_pmts)
    mixed_upi_by_store = _by_store_payment_totals(mixed_upi_pmts)

    cash_merged = defaultdict(
        lambda: {
            'store_name': '',
            'shop_type': '',
            'from_invoice_cash': Decimal('0.00'),
            'from_mixed_cash': Decimal('0.00'),
        }
    )
    for sid, v in pure_cash_by_store.items():
        cash_merged[sid]['store_name'] = v['store_name']
        cash_merged[sid]['shop_type'] = v['shop_type']
        cash_merged[sid]['from_invoice_cash'] = v['amount']
    for sid, v in mixed_cash_by_store.items():
        cash_merged[sid]['store_name'] = v['store_name'] or cash_merged[sid]['store_name']
        cash_merged[sid]['shop_type'] = v['shop_type'] or cash_merged[sid]['shop_type']
        cash_merged[sid]['from_mixed_cash'] = v['amount']

    upi_merged = defaultdict(
        lambda: {
            'store_name': '',
            'shop_type': '',
            'from_invoice_upi': Decimal('0.00'),
            'from_mixed_upi': Decimal('0.00'),
        }
    )
    for sid, v in pure_upi_by_store.items():
        upi_merged[sid]['store_name'] = v['store_name']
        upi_merged[sid]['shop_type'] = v['shop_type']
        upi_merged[sid]['from_invoice_upi'] = v['amount']
    for sid, v in mixed_upi_by_store.items():
        upi_merged[sid]['store_name'] = v['store_name'] or upi_merged[sid]['store_name']
        upi_merged[sid]['shop_type'] = v['shop_type'] or upi_merged[sid]['shop_type']
        upi_merged[sid]['from_mixed_upi'] = v['amount']

    cash_by_store = _serialize_merged_rows(cash_merged, 'from_invoice_cash', 'from_mixed_cash')
    upi_by_store = _serialize_merged_rows(upi_merged, 'from_invoice_upi', 'from_mixed_upi')

    credit_by_store_rows = credit_qs.values('store_id', 'store__name', 'store__shop_type').annotate(
        total_sum=Sum('total', output_field=money)
    ).order_by('-total_sum', 'store__name')
    credit_by_store = [
        {
            'store_id': r['store_id'],
            'store_name': r['store__name'] or '',
            'shop_type': r['store__shop_type'] or '',
            'amount': float(_decimal_or_zero(r['total_sum'])),
        }
        for r in credit_by_store_rows
    ]

    total_expenses = _decimal_or_zero(
        Expenses.objects.filter(
            expense_date__gte=date_from,
            expense_date__lte=date_to,
        ).aggregate(t=Sum('expense_amount', output_field=money))['t']
    )

    total_inhand = total_cash - total_expenses

    payment_base = Payment.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).exclude(invoice__status__in=['void', 'draft'])

    total_payments = _decimal_or_zero(
        payment_base.aggregate(t=Sum('amount', output_field=money))['t']
    )

    method_rows = (
        payment_base.values('payment_method')
        .annotate(total_sum=Sum('amount', output_field=money))
        .order_by('-total_sum', 'payment_method')
    )
    payments_by_method = [
        {
            'payment_method': r['payment_method'] or 'other',
            'amount': float(_decimal_or_zero(r['total_sum'])),
        }
        for r in method_rows
    ]

    pending_line_cost = Case(
        When(
            barcode__purchase_item__unit_price__isnull=False,
            then=ExpressionWrapper(
                F('barcode__purchase_item__unit_price') * F('quantity'),
                output_field=money,
            ),
        ),
        When(
            purchase_price__isnull=False,
            then=ExpressionWrapper(
                F('purchase_price') * F('quantity'),
                output_field=money,
            ),
        ),
        default=Value(Decimal('0.00')),
        output_field=money,
    )

    pending_invoices = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).filter(Q(status='pending') | Q(invoice_type='pending')).exclude(status__in=['void', 'draft'])

    pending_items_qs = InvoiceItem.objects.filter(invoice__in=pending_invoices)

    pending_invoice_purchase_total = _decimal_or_zero(
        pending_items_qs.aggregate(t=Sum(pending_line_cost, output_field=money))['t']
    )

    pending_purchase_store_rows = (
        pending_items_qs.values(
            'invoice__store_id',
            'invoice__store__name',
            'invoice__store__shop_type',
        )
        .annotate(total_sum=Sum(pending_line_cost, output_field=money))
        .order_by('-total_sum', 'invoice__store__name')
    )
    pending_purchase_by_store = [
        {
            'store_id': r['invoice__store_id'],
            'store_name': r['invoice__store__name'] or '',
            'shop_type': r['invoice__store__shop_type'] or '',
            'amount': float(_decimal_or_zero(r['total_sum'])),
        }
        for r in pending_purchase_store_rows
    ]

    counter_inv = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        repair__isnull=True,
        store__shop_type__in=['retail', 'wholesale'],
        invoice_type__in=['cash', 'upi', 'mixed', 'credit'],
    ).exclude(invoice_type='defective').exclude(status__in=['void', 'draft'])
    counter_qs = annotate_invoice_list_profit(counter_inv, profile='invoice_list')
    counter_profit = _sum_list_profit(counter_qs, money)

    # _list_profit is built on per-invoice aggregates; Django cannot Sum() it in a second GROUP BY, so roll up in Python.
    by_store_acc = defaultdict(
        lambda: {'store_name': '', 'shop_type': '', 'amount': Decimal('0.00')}
    )
    by_type_acc = defaultdict(lambda: Decimal('0.00'))
    for inv in counter_qs.select_related('store'):
        p = _decimal_or_zero(getattr(inv, '_list_profit', None))
        sid = inv.store_id
        st = inv.store
        rec = by_store_acc[sid]
        if st is not None:
            rec['store_name'] = st.name or ''
            rec['shop_type'] = st.shop_type or ''
        rec['amount'] += p
        itype = inv.invoice_type or 'other'
        by_type_acc[itype] += p

    counter_profit_by_store = sorted(
        (
            {
                'store_id': sid,
                'store_name': v['store_name'],
                'shop_type': v['shop_type'],
                'amount': float(_decimal_or_zero(v['amount'])),
            }
            for sid, v in by_store_acc.items()
        ),
        key=lambda x: (-x['amount'], x['store_name']),
    )
    counter_profit_by_invoice_type = sorted(
        (
            {'invoice_type': k, 'profit': float(_decimal_or_zero(v))}
            for k, v in by_type_acc.items()
        ),
        key=lambda x: (-x['profit'], x['invoice_type']),
    )

    repair_stores = Store.objects.filter(shop_type='repair', is_active=True)
    repair_inv = Invoice.objects.filter(
        store__in=repair_stores,
        repair__isnull=False,
        repair__status__in=['done', 'delivered'],
    ).exclude(status__in=['void', 'draft']).exclude(invoice_type='pending')
    repair_inv = filter_repair_invoices_by_list_date(repair_inv, date_from, date_to)
    repair_qs = annotate_invoice_list_profit(repair_inv, profile='repair_list')
    repair_profit = _sum_list_profit(repair_qs, money)

    overall_profit = counter_profit + repair_profit

    stock_barcode_qs = Barcode.objects.filter(tag__in=['new', 'returned']).exclude(
        purchase_item__purchase__status='draft',
    )
    stock_value = _decimal_or_zero(
        stock_barcode_qs.aggregate(
            t=Sum(
                Coalesce(F('purchase_item__unit_price'), Value(Decimal('0.00'))),
                output_field=money,
            )
        )['t']
    )

    defective_barcode_qs = Barcode.objects.filter(tag='defective')
    defective_product_count = (
        defective_barcode_qs.filter(product__isnull=False)
        .values('product_id')
        .distinct()
        .count()
    )
    defective_barcode_count = defective_barcode_qs.count()
    defective_purchase_value = _decimal_or_zero(
        defective_barcode_qs.aggregate(
            t=Sum(
                Coalesce(F('purchase_item__unit_price'), Value(Decimal('0.00'))),
                output_field=money,
            )
        )['t']
    )

    move_net_expr = ExpressionWrapper(
        F('total_loss') - Coalesce(F('total_adjustment'), Value(Decimal('0.00'))),
        output_field=money,
    )
    defective_move_out_net_loss = _decimal_or_zero(
        DefectiveProductMoveOut.objects.aggregate(
            t=Sum(move_net_expr, output_field=money)
        )['t']
    )
    defective_move_out_net_period = _decimal_or_zero(
        DefectiveProductMoveOut.objects.filter(
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
        ).aggregate(t=Sum(move_net_expr, output_field=money))['t']
    )

    response = Response({
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat(),
        },
        'kpis': {
            'total_cash': float(total_cash),
            'total_upi': float(total_upi),
            'total_credit': float(total_credit),
            'cash_from_invoice_type_cash': float(pure_cash_total),
            'cash_from_mixed': float(mixed_cash_total),
            'upi_from_invoice_type_upi': float(pure_upi_total),
            'upi_from_mixed': float(mixed_upi_total),
            'total_expenses': float(total_expenses),
            'total_inhand': float(total_inhand),
            'total_payments': float(total_payments),
            'pending_invoice_purchase_total': float(pending_invoice_purchase_total),
            'counter_profit': float(counter_profit),
            'repair_profit': float(repair_profit),
            'overall_profit': float(overall_profit),
            'stock_value': float(stock_value),
            'defective_product_count': defective_product_count,
            'defective_barcode_count': defective_barcode_count,
            'defective_purchase_value': float(defective_purchase_value),
            'defective_move_out_net_loss': float(defective_move_out_net_loss),
            'defective_move_out_net_period': float(defective_move_out_net_period),
        },
        'cash_by_store': cash_by_store,
        'upi_by_store': upi_by_store,
        'credit_by_store': credit_by_store,
        'payments_by_method': payments_by_method,
        'pending_purchase_by_store': pending_purchase_by_store,
        'counter_profit_by_store': counter_profit_by_store,
        'counter_profit_by_invoice_type': counter_profit_by_invoice_type,
    })
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    return response
