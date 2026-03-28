"""
Optimized reports views with Redis caching

Key optimizations:
1. Redis caching for dashboard KPIs (5-minute TTL)
2. Batch queries instead of loops
3. Pre-calculated aggregates
4. Reduced database hits
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, Count, Max, Q, DecimalField, Prefetch, F, Value, Case, When, ExpressionWrapper
from django.db.models.functions import Coalesce
from django.utils import timezone
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from django.core.cache import cache
from backend.locations.models import Store
from backend.pos.models import Invoice, InvoiceItem, Expenses, CreditNote
from backend.pos.views import annotate_invoice_list_profit, filter_repair_invoices_by_list_date
from backend.parties.models import LedgerEntry
from backend.catalog.models import Barcode, DefectiveProductMoveOut
import logging

logger = logging.getLogger(__name__)


def _decimal_or_zero(value):
    return value if value is not None else Decimal('0.00')

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def optimized_dashboard_kpis_new(request):
    """
    Dashboard KPIs with mutually exclusive trade buckets.
    Profit (counter / wholesale / repairing / splits / credit card) uses the same rules as list pages:
    computed_paid − computed_total from annotate_invoice_list_profit (matches Invoices.tsx and Repairs.tsx footers).
    Repair invoice date window matches repair_invoices_list (created_at OR repair.updated_at OR delivery_date).
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

    # Line-level margin (pending / monthly pending only; main KPIs use invoice list profit above).
    cost_component_expr = Case(
        When(
            barcode__purchase_item__unit_price__isnull=False,
            then=ExpressionWrapper(
                F('barcode__purchase_item__unit_price') * F('quantity'),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            ),
        ),
        When(
            purchase_price__isnull=False,
            then=ExpressionWrapper(
                F('purchase_price') * F('quantity'),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            ),
        ),
        default=Value(Decimal('0.00')),
        output_field=DecimalField(max_digits=18, decimal_places=2),
    )
    profit_component_expr = ExpressionWrapper(
        F('line_total') - cost_component_expr,
        output_field=DecimalField(max_digits=18, decimal_places=2),
    )
    money_18_2 = DecimalField(max_digits=18, decimal_places=2)

    def _sum_list_profit(annotated_qs):
        return _decimal_or_zero(
            annotated_qs.aggregate(t=Sum('_list_profit', output_field=money_18_2))['t']
        )

    def _sum_invoice_total(qs):
        return _decimal_or_zero(
            qs.exclude(status__in=['void', 'draft']).aggregate(
                t=Sum('total', output_field=money_18_2)
            )['t']
        )

    def _get_month_window(now_dt):
        # Monthly window: 11th to next month 10th
        if now_dt.day < 11:
            if now_dt.month == 1:
                start = now_dt.replace(year=now_dt.year - 1, month=12, day=11, hour=0, minute=0, second=0, microsecond=0)
            else:
                start = now_dt.replace(month=now_dt.month - 1, day=11, hour=0, minute=0, second=0, microsecond=0)
            end = now_dt.replace(day=10, hour=23, minute=59, second=59, microsecond=999999)
        else:
            start = now_dt.replace(day=11, hour=0, minute=0, second=0, microsecond=0)
            if now_dt.month == 12:
                end = now_dt.replace(year=now_dt.year + 1, month=1, day=10, hour=23, minute=59, second=59, microsecond=999999)
            else:
                end = now_dt.replace(month=now_dt.month + 1, day=10, hour=23, minute=59, second=59, microsecond=999999)
        return start, end

    credit_invoice_q = Q(status='credit') | Q(invoice_type='credit')

    repair_stores = Store.objects.filter(shop_type='repair', is_active=True)
    repair_inv_base = Invoice.objects.filter(store__in=repair_stores, repair__isnull=False)
    repair_inv_base = filter_repair_invoices_by_list_date(repair_inv_base, date_from, date_to)
    repair_qs = annotate_invoice_list_profit(repair_inv_base, profile='repair_list')

    retail_inv_base = Invoice.objects.filter(
        repair__isnull=True,
        store__shop_type='retail',
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).exclude(invoice_type='defective')
    retail_qs = annotate_invoice_list_profit(retail_inv_base, profile='invoice_list')

    wholesale_inv_base = Invoice.objects.filter(
        repair__isnull=True,
        store__shop_type='wholesale',
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).exclude(invoice_type='defective')
    wholesale_qs = annotate_invoice_list_profit(wholesale_inv_base, profile='invoice_list')

    repairing_profit = _sum_list_profit(repair_qs)
    counter_profit = _sum_list_profit(retail_qs)
    wholesale_profit = _sum_list_profit(wholesale_qs)

    retail_cash = _sum_list_profit(retail_qs.filter(invoice_type='cash'))
    retail_online = _sum_list_profit(retail_qs.filter(invoice_type='upi'))
    retail_mixed = _sum_list_profit(retail_qs.filter(invoice_type='mixed'))
    wholesale_cash = _sum_list_profit(wholesale_qs.filter(invoice_type='cash'))
    wholesale_online = _sum_list_profit(wholesale_qs.filter(invoice_type='upi'))
    wholesale_mixed = _sum_list_profit(wholesale_qs.filter(invoice_type='mixed'))
    repair_cash = _sum_list_profit(repair_qs.filter(invoice_type='cash'))
    repair_online = _sum_list_profit(repair_qs.filter(invoice_type='upi'))
    repair_mixed = _sum_list_profit(repair_qs.filter(invoice_type='mixed'))

    retail_credit = _sum_list_profit(retail_qs.filter(credit_invoice_q))
    wholesale_credit = _sum_list_profit(wholesale_qs.filter(credit_invoice_q))
    repair_credit = _sum_list_profit(repair_qs.filter(credit_invoice_q))
    total_credit = retail_credit + wholesale_credit + repair_credit

    collected_retail_cash = _sum_invoice_total(retail_inv_base.filter(invoice_type='cash'))
    collected_retail_online = _sum_invoice_total(retail_inv_base.filter(invoice_type='upi'))
    collected_retail_mixed = _sum_invoice_total(retail_inv_base.filter(invoice_type='mixed'))
    collected_retail_credit = _sum_invoice_total(retail_inv_base.filter(credit_invoice_q))
    collected_wholesale_cash = _sum_invoice_total(wholesale_inv_base.filter(invoice_type='cash'))
    collected_wholesale_online = _sum_invoice_total(wholesale_inv_base.filter(invoice_type='upi'))
    collected_wholesale_mixed = _sum_invoice_total(wholesale_inv_base.filter(invoice_type='mixed'))
    collected_wholesale_credit = _sum_invoice_total(wholesale_inv_base.filter(credit_invoice_q))
    collected_repair_cash = _sum_invoice_total(repair_inv_base.filter(invoice_type='cash'))
    collected_repair_online = _sum_invoice_total(repair_inv_base.filter(invoice_type='upi'))
    collected_repair_mixed = _sum_invoice_total(repair_inv_base.filter(invoice_type='mixed'))
    collected_repair_credit = _sum_invoice_total(repair_inv_base.filter(credit_invoice_q))
    collected_total_credit = collected_retail_credit + collected_wholesale_credit + collected_repair_credit
    collected_retail_invoice_total = _sum_invoice_total(retail_inv_base)
    collected_wholesale_invoice_total = _sum_invoice_total(wholesale_inv_base)
    collected_repair_invoice_total = _sum_invoice_total(repair_inv_base)
    collected_invoice_grand = (
        collected_retail_invoice_total
        + collected_wholesale_invoice_total
        + collected_repair_invoice_total
    )

    # Incoming (Σ Invoice.total) by store — same invoice sets as collected_* invoice totals.
    rw_invoice_incoming_base = Invoice.objects.filter(
        repair__isnull=True,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        store__shop_type__in=['retail', 'wholesale'],
    ).exclude(invoice_type='defective')

    def _invoice_total_by_store_rows(qs):
        return list(
            qs.exclude(status__in=['void', 'draft'])
            .values('store_id', 'store__name', 'store__shop_type')
            .annotate(invoice_total=Sum('total', output_field=money_18_2))
        )

    incoming_by_store_acc = defaultdict(
        lambda: {'invoice_total': Decimal('0.00'), 'store_name': '', 'shop_type': ''}
    )
    for row in _invoice_total_by_store_rows(rw_invoice_incoming_base):
        sid = row['store_id']
        incoming_by_store_acc[sid]['store_name'] = row['store__name'] or ''
        incoming_by_store_acc[sid]['shop_type'] = row['store__shop_type'] or ''
        incoming_by_store_acc[sid]['invoice_total'] += _decimal_or_zero(row['invoice_total'])
    for row in _invoice_total_by_store_rows(repair_inv_base):
        sid = row['store_id']
        incoming_by_store_acc[sid]['store_name'] = row['store__name'] or ''
        incoming_by_store_acc[sid]['shop_type'] = row['store__shop_type'] or ''
        incoming_by_store_acc[sid]['invoice_total'] += _decimal_or_zero(row['invoice_total'])

    incoming_by_store_list = sorted(
        (
            {
                'store_id': sid,
                'store_name': v['store_name'],
                'shop_type': v['shop_type'],
                'invoice_total': float(v['invoice_total']),
            }
            for sid, v in incoming_by_store_acc.items()
        ),
        key=lambda x: (-x['invoice_total'], x['store_name']),
    )

    # Manual payments source aligned with Payments page:
    # LedgerEntry(entry_type='credit', invoice__isnull=True)
    manual_entries = LedgerEntry.objects.filter(
        entry_type='credit',
        invoice__isnull=True,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    )
    manual_cash = _decimal_or_zero(
        manual_entries.filter(payment_mode='cash').aggregate(
            total=Sum('amount', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )
    manual_upi = _decimal_or_zero(
        manual_entries.filter(payment_mode='upi').aggregate(
            total=Sum('amount', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )
    manual_mixed = _decimal_or_zero(
        manual_entries.filter(payment_mode='mixed').aggregate(
            total=Sum('amount', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )
    manual_payment_total = _decimal_or_zero(
        manual_entries.aggregate(
            total=Sum('amount', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )

    collected_total_cash = collected_retail_cash + collected_wholesale_cash + collected_repair_cash + manual_cash
    collected_total_online = collected_retail_online + collected_wholesale_online + collected_repair_online + manual_upi
    collected_total_mixed = collected_retail_mixed + collected_wholesale_mixed + collected_repair_mixed + manual_mixed

    # Include manual payment in cash / online / mixed totals.
    total_cash = retail_cash + wholesale_cash + repair_cash + manual_cash
    total_online = retail_online + wholesale_online + repair_online + manual_upi
    total_mixed = retail_mixed + wholesale_mixed + repair_mixed + manual_mixed
    overall_profit = counter_profit + wholesale_profit + repairing_profit

    total_expenses = Expenses.objects.filter(
        expense_date__gte=date_from,
        expense_date__lte=date_to,
    ).aggregate(
        total=Sum('expense_amount', output_field=DecimalField(max_digits=18, decimal_places=2))
    )['total'] or Decimal('0.00')

    # Stock Value: sum purchase value of barcodes with tags new/returned.
    stock_value_expr = Case(
        When(
            purchase_item__unit_price__isnull=False,
            then=F('purchase_item__unit_price'),
        ),
        default=Value(Decimal('0.00')),
        output_field=DecimalField(max_digits=18, decimal_places=2),
    )
    stock_value = _decimal_or_zero(
        Barcode.objects.filter(
            tag__in=['new', 'returned']
        ).exclude(
            purchase__status='draft'
        ).aggregate(
            total=Sum(stock_value_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )

    # Defective Value: sum purchase value of defective barcodes.
    defective_value = _decimal_or_zero(
        Barcode.objects.filter(
            tag='defective'
        ).exclude(
            purchase__status='draft'
        ).aggregate(
            total=Sum(stock_value_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )

    # Total Replacement:
    # use credit note amount (matches Credit Notes page source of truth).
    total_replacement = _decimal_or_zero(
        CreditNote.objects.filter(
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
        ).aggregate(
            total=Sum('amount', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )

    # Product Sent to Delhi:
    # Match /defective-move-outs card logic => net loss = total_loss - total_adjustment.
    defective_move_out_net = _decimal_or_zero(
        DefectiveProductMoveOut.objects.filter(
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
        ).aggregate(
            total=Sum(
                ExpressionWrapper(
                    F('total_loss') - Coalesce(F('total_adjustment'), Value(Decimal('0.00'))),
                    output_field=DecimalField(max_digits=18, decimal_places=2),
                ),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            )
        )['total']
    )

    # Bill Pending: all invoices where status='pending' OR invoice_type='pending'
    # for Retail (store 1), Wholesale (store 2), and Repair (store 4).
    pending_base = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).filter(
        Q(status='pending') | Q(invoice_type='pending')
    ).exclude(
        status='void'
    )
    retail_bill_pending = _decimal_or_zero(
        pending_base.filter(store__shop_type='retail').aggregate(
            total=Sum('total', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )
    wholesale_bill_pending = _decimal_or_zero(
        pending_base.filter(store__shop_type='wholesale').aggregate(
            total=Sum('total', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )
    repair_bill_pending = _decimal_or_zero(
        pending_base.filter(store__shop_type='repair').aggregate(
            total=Sum('total', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )
    bill_pending_total = retail_bill_pending + wholesale_bill_pending + repair_bill_pending

    # Pending profit: retail/wholesale without repair OR repair-shop with a Repair row (no double count).
    pending_profit = _decimal_or_zero(
        InvoiceItem.objects.filter(
            invoice__created_at__date__gte=date_from,
            invoice__created_at__date__lte=date_to,
        ).filter(
            Q(
                invoice__store__shop_type__in=['retail', 'wholesale'],
                invoice__repair__isnull=True,
            )
            | Q(
                invoice__store__shop_type='repair',
                invoice__repair__isnull=False,
            )
        ).filter(
            Q(invoice__status='pending') | Q(invoice__invoice_type='pending')
        ).exclude(
            invoice__status='void'
        ).aggregate(
            total=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )

    # Business formula requested:
    # Inhand total = Total Cash + Manual Payment - Expense
    inhand_total = total_cash + manual_payment_total - total_expenses

    # Monthly Profit = Overall Profit + Pending Profit in month-window (11th to next 10th),
    # anchored to the selected dashboard date range end.
    anchor_dt = timezone.now().replace(
        year=date_to.year,
        month=date_to.month,
        day=date_to.day,
        hour=12,
        minute=0,
        second=0,
        microsecond=0,
    )
    month_start, month_end = _get_month_window(anchor_dt)
    monthly_total_replacement = _decimal_or_zero(
        CreditNote.objects.filter(
            created_at__gte=month_start,
            created_at__lte=month_end,
        ).aggregate(
            total=Sum('amount', output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total']
    )
    monthly_retail_inv = Invoice.objects.filter(
        created_at__gte=month_start,
        created_at__lte=month_end,
        repair__isnull=True,
        store__shop_type='retail',
    ).exclude(invoice_type='defective')
    monthly_wholesale_inv = Invoice.objects.filter(
        created_at__gte=month_start,
        created_at__lte=month_end,
        repair__isnull=True,
        store__shop_type='wholesale',
    ).exclude(invoice_type='defective')
    monthly_repair_inv = filter_repair_invoices_by_list_date(
        Invoice.objects.filter(store__in=repair_stores, repair__isnull=False),
        month_start.date(),
        month_end.date(),
    )
    monthly_retail_qs = annotate_invoice_list_profit(monthly_retail_inv, profile='invoice_list')
    monthly_wholesale_qs = annotate_invoice_list_profit(monthly_wholesale_inv, profile='invoice_list')
    monthly_repair_qs = annotate_invoice_list_profit(monthly_repair_inv, profile='repair_list')
    monthly_pending_items = InvoiceItem.objects.filter(
        invoice__created_at__gte=month_start,
        invoice__created_at__lte=month_end,
    ).filter(
        Q(
            invoice__store__shop_type__in=['retail', 'wholesale'],
            invoice__repair__isnull=True,
        )
        | Q(
            invoice__store__shop_type='repair',
            invoice__repair__isnull=False,
        )
    ).filter(
        Q(invoice__status='pending') | Q(invoice__invoice_type='pending')
    ).exclude(invoice__status='void')

    monthly_retail_profit = _sum_list_profit(monthly_retail_qs)
    monthly_wholesale_profit = _sum_list_profit(monthly_wholesale_qs)
    monthly_repair_profit = _sum_list_profit(monthly_repair_qs)
    monthly_pending_profit = _decimal_or_zero(
        monthly_pending_items.aggregate(total=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)))['total']
    )
    monthly_overall_profit = monthly_retail_profit + monthly_wholesale_profit + monthly_repair_profit
    monthly_profit = monthly_overall_profit + monthly_pending_profit

    response = Response({
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat(),
        },
        'incoming_by_store': incoming_by_store_list,
        'kpis': {
            'total_cash': float(total_cash),
            'total_online': float(total_online),
            'total_mixed': float(total_mixed),
            'total_credit': float(total_credit),
            'credit_profit': float(total_credit),
            'total_expenses': float(total_expenses),
            'stock_value': float(stock_value),
            'total_replacement': float(total_replacement),
            'monthly_total_replacement': float(monthly_total_replacement),
            'defective_value': float(defective_value),
            'product_sent_to_delhi': float(defective_move_out_net),
            'manual_payment_total': float(manual_payment_total),
            'manual_cash': float(manual_cash),
            'manual_online': float(manual_upi),
            'manual_mixed': float(manual_mixed),
            'inhand_total': float(inhand_total),
            'counter_profit': float(counter_profit),
            'wholesale_profit': float(wholesale_profit),
            'repairing_profit': float(repairing_profit),
            'overall_profit': float(overall_profit),
            'bill_pending_total': float(bill_pending_total),
            'retail_bill_pending': float(retail_bill_pending),
            'wholesale_bill_pending': float(wholesale_bill_pending),
            'repair_bill_pending': float(repair_bill_pending),
            'pending_profit': float(pending_profit),
            'monthly_profit': float(monthly_profit),
            'monthly_pending_profit': float(monthly_pending_profit),
            'monthly_window_from': month_start.date().isoformat(),
            'monthly_window_to': month_end.date().isoformat(),
            'retail_cash': float(retail_cash),
            'wholesale_cash': float(wholesale_cash),
            'repair_cash': float(repair_cash),
            'retail_online': float(retail_online),
            'wholesale_online': float(wholesale_online),
            'repair_online': float(repair_online),
            'retail_mixed': float(retail_mixed),
            'wholesale_mixed': float(wholesale_mixed),
            'repair_mixed': float(repair_mixed),
            'retail_credit': float(retail_credit),
            'wholesale_credit': float(wholesale_credit),
            'repair_credit': float(repair_credit),
            'collected_retail_cash': float(collected_retail_cash),
            'collected_wholesale_cash': float(collected_wholesale_cash),
            'collected_repair_cash': float(collected_repair_cash),
            'collected_retail_online': float(collected_retail_online),
            'collected_wholesale_online': float(collected_wholesale_online),
            'collected_repair_online': float(collected_repair_online),
            'collected_retail_mixed': float(collected_retail_mixed),
            'collected_wholesale_mixed': float(collected_wholesale_mixed),
            'collected_repair_mixed': float(collected_repair_mixed),
            'collected_retail_credit': float(collected_retail_credit),
            'collected_wholesale_credit': float(collected_wholesale_credit),
            'collected_repair_credit': float(collected_repair_credit),
            'collected_total_cash': float(collected_total_cash),
            'collected_total_online': float(collected_total_online),
            'collected_total_mixed': float(collected_total_mixed),
            'collected_total_credit': float(collected_total_credit),
            'collected_invoice_grand': float(collected_invoice_grand),
            'collected_retail_invoice_total': float(collected_retail_invoice_total),
            'collected_wholesale_invoice_total': float(collected_wholesale_invoice_total),
            'collected_repair_invoice_total': float(collected_repair_invoice_total),
        }
    })
    response['X-Cache'] = 'DISABLED'
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    return response