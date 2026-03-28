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
from datetime import datetime, timedelta
from decimal import Decimal
from django.core.cache import cache
from backend.pos.models import Invoice, InvoiceItem, Expenses, CreditNote
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
    Dashboard KPIs with mutually exclusive trade buckets:
    - Retail (shop_type=retail) and wholesale (shop_type=wholesale) are separate; both require invoice.repair NULL.
    - Repair: shop_type repair + linked Repair row + completion in range.
    Credit profit split by shop_type. counter_profit = retail trade only; wholesale_profit = wholesale trade only.
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

    # Profit component:
    # line_total - COALESCE(purchase_item.unit_price * qty, invoice_item.purchase_price * qty, 0)
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

    # Retail only (not wholesale): no Repair row on invoice.
    retail_items = InvoiceItem.objects.filter(
        invoice__created_at__date__gte=date_from,
        invoice__created_at__date__lte=date_to,
        invoice__repair__isnull=True,
        invoice__store__shop_type='retail',
        invoice__status__in=['paid', 'credit'],
    ).exclude(
        invoice__invoice_type='pending'
    )
    retail_grouped = retail_items.values('invoice__invoice_type').annotate(
        gross_profit=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
    )
    retail_map = {
        row['invoice__invoice_type']: _decimal_or_zero(row['gross_profit'])
        for row in retail_grouped
    }

    # Wholesale: separate from retail; same no-repair rule.
    wholesale_items = InvoiceItem.objects.filter(
        invoice__created_at__date__gte=date_from,
        invoice__created_at__date__lte=date_to,
        invoice__repair__isnull=True,
        invoice__store__shop_type='wholesale',
        invoice__status__in=['paid', 'credit'],
    ).exclude(
        invoice__invoice_type='pending'
    )
    wholesale_grouped = wholesale_items.values('invoice__invoice_type').annotate(
        gross_profit=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
    )
    wholesale_map = {
        row['invoice__invoice_type']: _decimal_or_zero(row['gross_profit'])
        for row in wholesale_grouped
    }

    # Repair: Repair shop + linked Repair model + completion window on repair (not invoice store/date alone).
    # Same invoice lines never appear in retail_items because those require repair__isnull=True.
    repair_items = InvoiceItem.objects.filter(
        invoice__repair__created_at__date__gte=date_from,
        invoice__repair__created_at__date__lte=date_to,
        invoice__repair__status__in=['delivered', 'done'],
        invoice__repair__isnull=False,
        invoice__store__shop_type='repair',
        invoice__status__in=['paid', 'credit'],
    ).exclude(
        invoice__invoice_type='pending'
    )
    repair_grouped = repair_items.values('invoice__invoice_type').annotate(
        gross_profit=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
    )
    repair_map = {
        row['invoice__invoice_type']: _decimal_or_zero(row['gross_profit'])
        for row in repair_grouped
    }

    retail_cash = _decimal_or_zero(retail_map.get('cash'))
    retail_online = _decimal_or_zero(retail_map.get('upi'))
    retail_mixed = _decimal_or_zero(retail_map.get('mixed'))
    wholesale_cash = _decimal_or_zero(wholesale_map.get('cash'))
    wholesale_online = _decimal_or_zero(wholesale_map.get('upi'))
    wholesale_mixed = _decimal_or_zero(wholesale_map.get('mixed'))
    repair_cash = _decimal_or_zero(repair_map.get('cash'))
    repair_online = _decimal_or_zero(repair_map.get('upi'))
    repair_mixed = _decimal_or_zero(repair_map.get('mixed'))

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

    # Include manual payment in cash / online / mixed totals.
    total_cash = retail_cash + wholesale_cash + repair_cash + manual_cash
    total_online = retail_online + wholesale_online + repair_online + manual_upi
    total_mixed = retail_mixed + wholesale_mixed + repair_mixed + manual_mixed
    # Credit profit by shop type (retail / wholesale / repair) — no overlap with paid buckets above.
    credit_items = InvoiceItem.objects.filter(
        invoice__created_at__date__gte=date_from,
        invoice__created_at__date__lte=date_to,
        invoice__store__shop_type__in=['retail', 'wholesale', 'repair'],
    ).filter(
        Q(invoice__status='credit') | Q(invoice__invoice_type='credit')
    ).exclude(
        invoice__status='void'
    )
    credit_grouped = credit_items.values('invoice__store__shop_type').annotate(
        gross_profit=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
    )
    credit_by_shop = {row['invoice__store__shop_type']: _decimal_or_zero(row['gross_profit']) for row in credit_grouped}
    retail_credit = _decimal_or_zero(credit_by_shop.get('retail'))
    wholesale_credit = _decimal_or_zero(credit_by_shop.get('wholesale'))
    repair_credit = _decimal_or_zero(credit_by_shop.get('repair'))
    total_credit = retail_credit + wholesale_credit + repair_credit
    counter_profit = retail_cash + retail_online + retail_mixed + retail_credit
    wholesale_profit = wholesale_cash + wholesale_online + wholesale_mixed + wholesale_credit
    repairing_profit = repair_cash + repair_online + repair_mixed + repair_credit
    overall_profit = (
        (repair_cash + repair_online + repair_mixed) +
        (retail_cash + retail_online + retail_mixed) +
        (wholesale_cash + wholesale_online + wholesale_mixed) +
        total_credit
    )

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
    monthly_retail_items = InvoiceItem.objects.filter(
        invoice__created_at__gte=month_start,
        invoice__created_at__lte=month_end,
        invoice__repair__isnull=True,
        invoice__store__shop_type='retail',
        invoice__status__in=['paid', 'credit'],
    ).exclude(invoice__invoice_type='pending')
    monthly_wholesale_items = InvoiceItem.objects.filter(
        invoice__created_at__gte=month_start,
        invoice__created_at__lte=month_end,
        invoice__repair__isnull=True,
        invoice__store__shop_type='wholesale',
        invoice__status__in=['paid', 'credit'],
    ).exclude(invoice__invoice_type='pending')
    monthly_repair_items = InvoiceItem.objects.filter(
        invoice__repair__created_at__gte=month_start,
        invoice__repair__created_at__lte=month_end,
        invoice__repair__status__in=['delivered', 'done'],
        invoice__repair__isnull=False,
        invoice__store__shop_type='repair',
        invoice__status__in=['paid', 'credit'],
    ).exclude(invoice__invoice_type='pending')
    monthly_credit_items = InvoiceItem.objects.filter(
        invoice__created_at__gte=month_start,
        invoice__created_at__lte=month_end,
        invoice__store__shop_type__in=['retail', 'wholesale', 'repair'],
    ).filter(
        Q(invoice__status='credit') | Q(invoice__invoice_type='credit')
    ).exclude(invoice__status='void')
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

    monthly_retail_profit = _decimal_or_zero(
        monthly_retail_items.aggregate(total=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)))['total']
    )
    monthly_wholesale_profit = _decimal_or_zero(
        monthly_wholesale_items.aggregate(total=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)))['total']
    )
    monthly_repair_profit = _decimal_or_zero(
        monthly_repair_items.aggregate(total=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)))['total']
    )
    monthly_credit_profit = _decimal_or_zero(
        monthly_credit_items.aggregate(total=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)))['total']
    )
    monthly_pending_profit = _decimal_or_zero(
        monthly_pending_items.aggregate(total=Sum(profit_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)))['total']
    )
    monthly_overall_profit = (
        monthly_retail_profit + monthly_wholesale_profit + monthly_repair_profit + monthly_credit_profit
    )
    monthly_profit = monthly_overall_profit + monthly_pending_profit

    response = Response({
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat(),
        },
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
        }
    })
    response['X-Cache'] = 'DISABLED'
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    return response