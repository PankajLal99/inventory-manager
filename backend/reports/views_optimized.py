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
from django.utils import timezone
from datetime import datetime, timedelta
from decimal import Decimal
from django.core.cache import cache
from backend.pos.models import Invoice, InvoiceItem, Payment, CartItem, Expenses
from backend.parties.models import LedgerEntry
from backend.catalog.models import Product, Barcode
import logging

logger = logging.getLogger(__name__)


def _decimal_or_zero(value):
    return value if value is not None else Decimal('0.00')


def _build_payment_contribution_rows(payments_queryset, payment_method):
    rows = []
    payment_rows = payments_queryset.filter(
        payment_method=payment_method
    ).values(
        'id',
        'amount',
        'created_at',
        'invoice__id',
        'invoice__invoice_number',
        'invoice__customer__name',
        'invoice__store__name',
    ).order_by('-created_at', '-id')

    for row in payment_rows:
        customer_name = row.get('invoice__customer__name') or 'Walk-in Customer'
        rows.append({
            'source': 'invoice_payment',
            'id': row.get('id'),
            'invoice_id': row.get('invoice__id'),
            'invoice_number': row.get('invoice__invoice_number'),
            'party_name': customer_name,
            'customer_name': customer_name,
            'store': row.get('invoice__store__name') or 'Unknown Store',
            'amount': float(row.get('amount') or Decimal('0.00')),
            'payment_date': row.get('created_at').isoformat() if row.get('created_at') else None,
        })
    return rows


def _build_manual_contribution_rows(ledger_queryset, payment_mode):
    rows = []
    ledger_rows = ledger_queryset.filter(
        payment_mode=payment_mode
    ).values(
        'id',
        'amount',
        'created_at',
        'customer__name',
        'description',
    ).order_by('-created_at', '-id')

    for row in ledger_rows:
        customer_name = row.get('customer__name') or 'Walk-in Customer'
        rows.append({
            'source': 'manual_payment',
            'id': row.get('id'),
            'invoice_id': None,
            'invoice_number': None,
            'party_name': customer_name,
            'customer_name': customer_name,
            'store': 'Unmapped',
            'amount': float(row.get('amount') or Decimal('0.00')),
            'payment_date': row.get('created_at').isoformat() if row.get('created_at') else None,
            'description': row.get('description') or '',
        })
    return rows


def _build_manual_mixed_contribution_rows(ledger_queryset, split_method):
    rows = []
    mixed_rows = ledger_queryset.filter(
        payment_mode='mixed'
    ).values(
        'id',
        'amount',
        'cash_amount',
        'upi_amount',
        'created_at',
        'customer__name',
        'description',
    ).order_by('-created_at', '-id')

    for row in mixed_rows:
        cash_amount = _decimal_or_zero(row.get('cash_amount'))
        upi_amount = _decimal_or_zero(row.get('upi_amount'))
        split_amount = cash_amount if split_method == 'cash' else upi_amount
        if split_amount <= Decimal('0.00'):
            continue

        customer_name = row.get('customer__name') or 'Walk-in Customer'
        rows.append({
            'source': 'manual_mixed_payment',
            'id': row.get('id'),
            'invoice_id': None,
            'invoice_number': None,
            'party_name': customer_name,
            'customer_name': customer_name,
            'store': 'Unmapped',
            'amount': float(split_amount),
            'payment_date': row.get('created_at').isoformat() if row.get('created_at') else None,
            'description': row.get('description') or '',
        })
    return rows


def _build_invoice_rows(invoice_queryset):
    rows = []
    invoice_rows = invoice_queryset.values(
        'id',
        'invoice_number',
        'total',
        'created_at',
        'customer__name',
        'store__name',
        'status',
        'invoice_type',
    ).order_by('-created_at', '-id')
    for row in invoice_rows:
        customer_name = row.get('customer__name') or 'Walk-in Customer'
        rows.append({
            'id': row.get('id'),
            'ref': row.get('invoice_number'),
            'party': customer_name,
            'store': row.get('store__name') or 'Unknown Store',
            'value': float(_decimal_or_zero(row.get('total'))),
            'date': row.get('created_at').isoformat() if row.get('created_at') else None,
            'source': 'invoice',
            'note': f"status={row.get('status')}, type={row.get('invoice_type')}",
        })
    return rows


def _build_store_grouping(kpi_debug_rows):
    grouping = {}
    for kpi_key, block in (kpi_debug_rows or {}).items():
        rows = block.get('rows') or []
        per_store = {}
        for row in rows:
            store_name = row.get('store') or 'Unmapped'
            per_store[store_name] = per_store.get(store_name, Decimal('0.00')) + Decimal(str(row.get('value') or 0))
        store_rows = [
            {'store': store_name, 'value': float(amount)}
            for store_name, amount in per_store.items()
        ]
        store_rows.sort(key=lambda item: abs(item['value']), reverse=True)
        grouping[kpi_key] = {
            'label': block.get('label') or kpi_key,
            'formula': block.get('formula') or '',
            'total': float(block.get('total') or 0),
            'stores': store_rows,
        }
    return grouping


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def optimized_dashboard_kpis(request):
    """
    Optimized dashboard KPIs with heavy caching
    
    Optimizations:
    1. Redis caching with 5-minute TTL
    2. Batch queries with select_related/prefetch_related
    3. Pre-calculated aggregates
    4. Early filtering
    """
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    store_id = request.query_params.get('store', None)
    include_total_stock_rows = str(request.query_params.get('include_total_stock_rows', '0')).lower() in ('1', 'true', 'yes')
    include_total_stock_value_rows = str(request.query_params.get('include_total_stock_value_rows', '0')).lower() in ('1', 'true', 'yes')
    include_monthly_profit_rows = str(request.query_params.get('include_monthly_profit_rows', '0')).lower() in ('1', 'true', 'yes')
    
    # Default to today if no dates provided
    if not date_from:
        date_from = timezone.now().date()
    else:
        date_from = datetime.strptime(date_from, '%Y-%m-%d').date()
    
    if not date_to:
        date_to = timezone.now().date()
    else:
        date_to = datetime.strptime(date_to, '%Y-%m-%d').date()

    latest_invoices_qs = Invoice.objects.exclude(
        status='void'
    ).exclude(
        customer__name__iexact='Manish Traders Loss'
    )
    if store_id:
        latest_invoices_qs = latest_invoices_qs.filter(store_id=store_id)
    latest_invoice_date = latest_invoices_qs.aggregate(
        latest=Max('created_at__date')
    ).get('latest')
    
    logger.info(f"Dashboard KPIs cache DISABLED (user: {request.user.username}, date_from: {date_from})")
    
    # OPTIMIZATION 1: Base invoice queryset with single query
    invoices = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to
    ).exclude(
        status='void'
    ).exclude(
        customer__name__iexact='Manish Traders Loss'
    )
    
    if store_id:
        invoices = invoices.filter(store_id=store_id)
    
    # OPTIMIZATION 2: Get all payments in one query with aggregation
    payments = Payment.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to
    ).exclude(
        invoice__status='void'
    ).exclude(
        invoice__customer__name__iexact='Manish Traders Loss'
    )
    
    if store_id:
        payments = payments.filter(invoice__store_id=store_id)
    
    # Aggregate POS payments by method in single query
    payment_summary = payments.values('payment_method').annotate(
        total=Sum('amount', output_field=DecimalField())
    )
    payment_dict = {item['payment_method']: item['total'] for item in payment_summary}

    # Ledger has two kinds of credits:
    # - Invoice-linked: created when paying an invoice (POS); same money is in Payment. We use Payment for amounts/method.
    # - Manual (invoice__isnull=True): created from Ledger/Payments page with no invoice; have payment_mode (cash/upi/mixed).
    # For KPIs we use Payment for invoice payment totals and only ledger credits with invoice__isnull=True for "manual".
    ledger_credits = LedgerEntry.objects.filter(
        entry_type='credit',
        invoice__isnull=True,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    )
    ledger_summary = ledger_credits.values('payment_mode').annotate(
        total=Sum('amount', output_field=DecimalField())
    )
    ledger_dict = {item['payment_mode']: item['total'] for item in ledger_summary}
    ledger_mixed_split = ledger_credits.filter(payment_mode='mixed').aggregate(
        cash_total=Sum('cash_amount', output_field=DecimalField()),
        upi_total=Sum('upi_amount', output_field=DecimalField()),
    )

    # Split invoice vs manual cash so KPIs can treat them differently.
    invoice_cash_total = _decimal_or_zero(payment_dict.get('cash'))
    manual_cash_total = _decimal_or_zero(ledger_dict.get('cash')) + _decimal_or_zero(ledger_mixed_split.get('cash_total'))

    # Total Cash: ONLY invoice cash payments (no manual cash).
    total_cash = invoice_cash_total

    # Total Online: ONLY invoice UPI/online payments.
    # Manual UPI/online (including mixed UPI split) is deliberately excluded from this KPI.
    total_online = _decimal_or_zero(payment_dict.get('upi'))

    cash_invoice_rows = _build_payment_contribution_rows(payments, 'cash')
    upi_invoice_rows = _build_payment_contribution_rows(payments, 'upi')
    cash_manual_rows = _build_manual_contribution_rows(ledger_credits, 'cash') + _build_manual_mixed_contribution_rows(ledger_credits, 'cash')
    upi_manual_rows = _build_manual_contribution_rows(ledger_credits, 'upi') + _build_manual_mixed_contribution_rows(ledger_credits, 'upi')
    cash_manual_rows = sorted(
        cash_manual_rows,
        key=lambda row: ((row.get('payment_date') or ''), (row.get('id') or 0)),
        reverse=True,
    )
    upi_manual_rows = sorted(
        upi_manual_rows,
        key=lambda row: ((row.get('payment_date') or ''), (row.get('id') or 0)),
        reverse=True,
    )

    # Repair KPIs: only invoices whose repair status is 'done' or 'delivered' (from Repair model).
    REPAIR_DONE_STATUSES = ('done', 'delivered')
    repair_invoices = invoices.filter(
        repair__isnull=False,
        repair__status__in=REPAIR_DONE_STATUSES,
    )
    repair_invoice_cash_total = _decimal_or_zero(
        repair_invoices.filter(invoice_type='cash').aggregate(
            total=Sum('total', output_field=DecimalField())
        )['total']
    )
    repair_invoice_upi_total = _decimal_or_zero(
        repair_invoices.filter(invoice_type='upi').aggregate(
            total=Sum('total', output_field=DecimalField())
        )['total']
    )
    repair_invoice_mixed_total = _decimal_or_zero(
        repair_invoices.filter(invoice_type='mixed').aggregate(
            total=Sum('total', output_field=DecimalField())
        )['total']
    )
    repair_invoice_cash_count = repair_invoices.filter(invoice_type='cash').count()
    repair_invoice_upi_count = repair_invoices.filter(invoice_type='upi').count()
    repair_invoice_mixed_count = repair_invoices.filter(invoice_type='mixed').count()
    repair_invoice_cash_rows = _build_invoice_rows(repair_invoices.filter(invoice_type='cash'))
    repair_invoice_upi_rows = _build_invoice_rows(repair_invoices.filter(invoice_type='upi'))
    repair_invoice_mixed_rows = _build_invoice_rows(repair_invoices.filter(invoice_type='mixed'))

    repair_payments = payments.filter(
        invoice__repair__isnull=False,
        invoice__repair__status__in=REPAIR_DONE_STATUSES,
    )
    repair_payment_summary = repair_payments.values('payment_method').annotate(
        total=Sum('amount', output_field=DecimalField()),
        count=Count('id')
    )
    repair_payment_dict = {item['payment_method']: item for item in repair_payment_summary}
    repair_payment_cash_total = _decimal_or_zero(
        (repair_payment_dict.get('cash') or {}).get('total')
    )
    repair_payment_upi_total = _decimal_or_zero(
        (repair_payment_dict.get('upi') or {}).get('total')
    )
    repair_payment_mixed_total = _decimal_or_zero(
        (repair_payment_dict.get('mixed') or {}).get('total')
    )
    repair_payment_cash_count = int((repair_payment_dict.get('cash') or {}).get('count') or 0)
    repair_payment_upi_count = int((repair_payment_dict.get('upi') or {}).get('count') or 0)
    repair_payment_mixed_count = int((repair_payment_dict.get('mixed') or {}).get('count') or 0)

    repair_cash_payment_rows = _build_payment_contribution_rows(repair_payments, 'cash')
    repair_upi_payment_rows = _build_payment_contribution_rows(repair_payments, 'upi')
    repair_mixed_payment_rows = _build_payment_contribution_rows(repair_payments, 'mixed')
    
    # OPTIMIZATION 3: Profit calculations from invoice item aggregates
    paid_invoices = invoices.filter(status='paid')
    # Repairing profit: same set as repair (cash + UPI + mixed) — all delivered repair invoices
    # paid with cash, UPI, or mix (includes partial so we don't miss any of these invoices).
    repair_paid_invoices = repair_invoices.filter(
        invoice_type__in=('cash', 'upi', 'mixed'),
    )

    # Shared item-level margin expressions:
    # sold = quantity * (manual_unit_price > 0 ? manual_unit_price : unit_price)
    # cost = quantity * (invoice_item.purchase_price > 0 ? purchase_price : barcode.purchase_item.unit_price)
    sold_rate_expr = Case(
        When(manual_unit_price__gt=0, then=F('manual_unit_price')),
        default=F('unit_price'),
        output_field=DecimalField(max_digits=12, decimal_places=2),
    )
    sold_component_expr = ExpressionWrapper(
        F('quantity') * sold_rate_expr,
        output_field=DecimalField(max_digits=18, decimal_places=2),
    )
    cost_rate_expr = Case(
        When(purchase_price__gt=0, then=F('purchase_price')),
        When(barcode__purchase_item__unit_price__isnull=False, then=F('barcode__purchase_item__unit_price')),
        default=Value(Decimal('0.00')),
        output_field=DecimalField(max_digits=12, decimal_places=2),
    )
    cost_component_expr = ExpressionWrapper(
        F('quantity') * cost_rate_expr,
        output_field=DecimalField(max_digits=18, decimal_places=2),
    )

    # Repairing profit via aggregate query (sold - cost), grouped by invoice for debug rows.
    repair_grouped_rows = InvoiceItem.objects.filter(
        invoice__in=repair_paid_invoices
    ).values(
        'invoice_id',
        'invoice__invoice_number',
        'invoice__customer__name',
        'invoice__store__name',
        'invoice__created_at',
    ).annotate(
        sold_total=Sum(sold_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)),
        cost_total=Sum(cost_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)),
    )

    repairing_profit = Decimal('0.00')
    repairing_profit_map = {}
    for row in repair_grouped_rows:
        sold_total = _decimal_or_zero(row.get('sold_total'))
        cost_total = _decimal_or_zero(row.get('cost_total'))
        invoice_profit = sold_total - cost_total
        repairing_profit += invoice_profit
        invoice_id = row.get('invoice_id')
        repairing_profit_map[invoice_id] = {
            'id': invoice_id,
            'ref': row.get('invoice__invoice_number'),
            'party': row.get('invoice__customer__name') or 'Walk-in Customer',
            'store': row.get('invoice__store__name') or 'Unknown Store',
            'value': float(invoice_profit),
            'date': row.get('invoice__created_at').isoformat() if row.get('invoice__created_at') else None,
            'source': 'repair_item_margin',
            'note': 'Repair invoice item margin: (sold - cost)',
        }

    retail_paid_invoices = paid_invoices.filter(store__shop_type='retail')

    counter_profit = Decimal('0.00')
    counter_profit_map = {}

    # Counter profit uses retail invoice item margin (sold - cost), grouped per invoice.
    retail_grouped_rows = InvoiceItem.objects.filter(
        invoice__in=retail_paid_invoices
    ).values(
        'invoice_id',
        'invoice__invoice_number',
        'invoice__customer__name',
        'invoice__store__name',
        'invoice__created_at',
    ).annotate(
        sold_total=Sum(sold_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)),
        cost_total=Sum(cost_component_expr, output_field=DecimalField(max_digits=18, decimal_places=2)),
    )
    for row in retail_grouped_rows:
        sold_total = _decimal_or_zero(row.get('sold_total'))
        cost_total = _decimal_or_zero(row.get('cost_total'))
        invoice_profit = sold_total - cost_total
        invoice_id = row.get('invoice_id')
        counter_profit += invoice_profit
        counter_profit_map[invoice_id] = {
            'id': invoice_id,
            'ref': row.get('invoice__invoice_number'),
            'party': row.get('invoice__customer__name') or 'Walk-in Customer',
            'store': row.get('invoice__store__name') or 'Unknown Store',
            'value': float(invoice_profit),
            'date': row.get('invoice__created_at').isoformat() if row.get('invoice__created_at') else None,
            'source': 'retail_item_margin',
            'note': 'Retail invoice item margin: (sold - cost)',
        }
    
    overall_profit = counter_profit + repairing_profit
    repairing_profit_rows = sorted(
        repairing_profit_map.values(),
        key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)),
        reverse=True,
    )
    counter_profit_rows = sorted(
        counter_profit_map.values(),
        key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)),
        reverse=True,
    )
    overall_profit_rows = sorted(
        repairing_profit_rows + counter_profit_rows,
        key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)),
        reverse=True,
    )
    
    # OPTIMIZATION 5: Calculate pending profit with batch query
    credit_invoices = Invoice.objects.filter(
        Q(status='credit') | Q(invoice_type='pending'),
        created_at__date__gte=date_from,
        created_at__date__lte=date_to
    ).exclude(
        status='void'
    ).exclude(
        customer__name__iexact='Manish Traders Loss'
    )
    
    if store_id:
        credit_invoices = credit_invoices.filter(store_id=store_id)
    
    credit_items = InvoiceItem.objects.filter(
        invoice__in=credit_invoices
    ).select_related(
        'barcode',
        'product'
    ).prefetch_related(
        Prefetch(
            'barcode',
            queryset=Barcode.objects.select_related('purchase', 'purchase_item')
        )
    )
    
    pending_profit = Decimal('0.00')
    pending_profit_map = {}
    for item in credit_items:
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            cache_key_product = f"product_purchase_price:{item.product.id}"
            purchase_price = cache.get(cache_key_product)
            if purchase_price is None:
                first_barcode = Barcode.objects.filter(
                    product=item.product,
                    tag__in=['new', 'returned']
                ).exclude(purchase__status='draft').first()
                if first_barcode:
                    purchase_price = first_barcode.get_purchase_price()
                else:
                    purchase_price = Decimal('0.00')
                cache.set(cache_key_product, purchase_price, 300)
        
        profit = (sale_price - purchase_price) * item.quantity
        pending_profit += profit
        invoice_id = item.invoice.id
        invoice_number = item.invoice.invoice_number
        customer_name = item.invoice.customer.name if item.invoice.customer else 'Walk-in Customer'
        store_name = item.invoice.store.name if item.invoice.store else 'Unknown Store'
        created_at = item.invoice.created_at.isoformat() if item.invoice.created_at else None
        entry = pending_profit_map.setdefault(
            invoice_id,
            {
                'id': invoice_id,
                'ref': invoice_number,
                'party': customer_name,
                'store': store_name,
                'value': 0.0,
                'date': created_at,
                'source': 'pending_profit',
                'note': 'Credit/pending invoice item margin',
            }
        )
        entry['value'] += float(profit)
    pending_profit_rows = sorted(
        pending_profit_map.values(),
        key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)),
        reverse=True,
    )

    # Expenses for the selected dashboard date range
    expenses_queryset = Expenses.objects.filter(
        expense_date__gte=date_from,
        expense_date__lte=date_to
    )
    expenses_rows = []
    for expense in expenses_queryset.order_by('-expense_date', '-id'):
        expenses_rows.append({
            'id': expense.id,
            'ref': f"EXP-{expense.id}",
            'party': expense.lender_name or '',
            'store': 'Unmapped',
            'value': float(_decimal_or_zero(expense.expense_amount)),
            'date': expense.expense_date.isoformat() if expense.expense_date else None,
            'source': 'expense',
            'note': f"type={expense.expense_type}, mode={expense.payment_choices_type}",
        })
    total_expenses = expenses_queryset.aggregate(
        total=Sum('expense_amount', output_field=DecimalField(max_digits=18, decimal_places=2))
    )['total'] or Decimal('0.00')

    # In-hand is ALL cash in period (invoice cash + manual cash) minus expenses in the same period.
    total_inhand_cash_component = invoice_cash_total + manual_cash_total
    total_inhand = total_inhand_cash_component - total_expenses
    total_inhand_rows = []
    for row in cash_invoice_rows + cash_manual_rows:
        total_inhand_rows.append({
            **row,
            'ref': row.get('invoice_number') or f"PAY-{row.get('id')}",
            'party': row.get('party_name') or row.get('customer_name') or '',
            'store': row.get('store') or 'Unknown Store',
            'value': float(row.get('amount') or 0.0),
            'date': row.get('payment_date'),
            'note': f"{row.get('source')}: added to cash",
        })
    for row in expenses_rows:
        total_inhand_rows.append({
            **row,
            'value': -float(row.get('value') or 0.0),
            'note': f"{row.get('source')}: reduced from in-hand",
        })
    total_inhand_rows = sorted(
        total_inhand_rows,
        key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)),
        reverse=True,
    )
    
    # OPTIMIZATION 6: Monthly profit calculation (10th to 10th)
    now = timezone.now()
    current_day = now.day

    if current_day < 10:
        if now.month == 1:
            monthly_start = now.replace(month=12, day=10, year=now.year-1, hour=0, minute=0, second=0, microsecond=0)
        else:
            monthly_start = now.replace(month=now.month-1, day=10, hour=0, minute=0, second=0, microsecond=0)
        monthly_end = now.replace(day=10, hour=23, minute=59, second=59, microsecond=999999)
    else:
        monthly_start = now.replace(day=10, hour=0, minute=0, second=0, microsecond=0)
        if now.month == 12:
            monthly_end = now.replace(month=1, day=10, year=now.year+1, hour=23, minute=59, second=59, microsecond=999999)
        else:
            monthly_end = now.replace(month=now.month+1, day=10, hour=23, minute=59, second=59, microsecond=999999)

    monthly_invoices = Invoice.objects.filter(
        created_at__gte=monthly_start,
        created_at__lte=monthly_end,
        status='paid'
    ).exclude(status='void').exclude(customer__name__iexact='Manish Traders Loss')
    if store_id:
        monthly_invoices = monthly_invoices.filter(store_id=store_id)

    monthly_items = InvoiceItem.objects.filter(
        invoice__in=monthly_invoices
    ).select_related('barcode', 'product')
    
    monthly_profit = Decimal('0.00')
    monthly_profit_map = {} if include_monthly_profit_rows else None
    for item in monthly_items:
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            cache_key_product = f"product_purchase_price:{item.product.id}"
            purchase_price = cache.get(cache_key_product)
            if purchase_price is None:
                first_barcode = Barcode.objects.filter(
                    product=item.product,
                    tag__in=['new', 'returned']
                ).exclude(purchase__status='draft').first()
                if first_barcode:
                    purchase_price = first_barcode.get_purchase_price()
                else:
                    purchase_price = Decimal('0.00')
                cache.set(cache_key_product, purchase_price, 300)
        
        profit = (sale_price - purchase_price) * item.quantity
        monthly_profit += profit
        invoice_id = item.invoice.id
        invoice_number = item.invoice.invoice_number
        customer_name = item.invoice.customer.name if item.invoice.customer else 'Walk-in Customer'
        store_name = item.invoice.store.name if item.invoice.store else 'Unknown Store'
        created_at = item.invoice.created_at.isoformat() if item.invoice.created_at else None
        if include_monthly_profit_rows and monthly_profit_map is not None:
            entry = monthly_profit_map.setdefault(
                invoice_id,
                {
                    'id': invoice_id,
                    'ref': invoice_number,
                    'party': customer_name,
                    'store': store_name,
                    'value': 0.0,
                    'date': created_at,
                    'source': 'monthly_profit',
                    'note': 'Monthly window invoice item margin',
                }
            )
            entry['value'] += float(profit)
    monthly_profit_rows = (
        sorted(
            monthly_profit_map.values(),
            key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)),
            reverse=True,
        ) if include_monthly_profit_rows and monthly_profit_map is not None else []
    )
    
    # OPTIMIZATION 7: Stock calculations are intentionally disabled for dashboard performance.
    # Keep KPI fields in response for UI compatibility, but avoid heavy inventory queries.
    total_stock = 0
    total_stock_value = Decimal('0.00')
    total_stock_rows = []
    total_stock_value_rows = []
    
    # OPTIMIZATION 8: Pending invoices aggregation (same basis as invoices list KPI)
    pending_invoice_queryset = Invoice.objects.filter(
        invoice_type='pending',
        created_at__date__gte=date_from,
        created_at__date__lte=date_to
    ).exclude(
        status='void'
    ).exclude(
        customer__name__iexact='Manish Traders Loss'
    )

    if store_id:
        pending_invoice_queryset = pending_invoice_queryset.filter(store_id=store_id)

    pending_invoices_count = pending_invoice_queryset.count()

    # Match pending amount logic used by invoice serializer (display_total):
    # include only unpriced items and fallback to barcode purchase-item unit price.
    effective_pending_purchase_price = Case(
        When(purchase_price__gt=0, then=F('purchase_price')),
        When(barcode__purchase_item__unit_price__isnull=False, then=F('barcode__purchase_item__unit_price')),
        default=Value(Decimal('0.00')),
        output_field=DecimalField(max_digits=12, decimal_places=2),
    )
    pending_item_amount_expr = ExpressionWrapper(
        F('quantity') * effective_pending_purchase_price,
        output_field=DecimalField(max_digits=18, decimal_places=2),
    )
    pending_invoices_total = InvoiceItem.objects.filter(
        invoice__in=pending_invoice_queryset,
        quantity__gt=0
    ).filter(
        Q(manual_unit_price__isnull=True) | Q(manual_unit_price__lte=0),
        Q(unit_price__isnull=True) | Q(unit_price__lte=0),
    ).aggregate(
        total=Sum(pending_item_amount_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
    )['total'] or Decimal('0.00')
    pending_invoice_items = InvoiceItem.objects.filter(
        invoice__in=pending_invoice_queryset,
        quantity__gt=0
    ).filter(
        Q(manual_unit_price__isnull=True) | Q(manual_unit_price__lte=0),
        Q(unit_price__isnull=True) | Q(unit_price__lte=0),
    ).select_related('invoice__customer', 'barcode__purchase_item')
    pending_invoice_map = {}
    for item in pending_invoice_items:
        effective_price = item.purchase_price if (item.purchase_price and item.purchase_price > 0) else (
            item.barcode.purchase_item.unit_price if (item.barcode and item.barcode.purchase_item and item.barcode.purchase_item.unit_price is not None) else Decimal('0.00')
        )
        amount = (item.quantity or Decimal('0.00')) * _decimal_or_zero(effective_price)
        invoice_id = item.invoice.id
        entry = pending_invoice_map.setdefault(
            invoice_id,
            {
                'id': invoice_id,
                'ref': item.invoice.invoice_number,
                'party': item.invoice.customer.name if item.invoice.customer else 'Walk-in Customer',
                'store': item.invoice.store.name if item.invoice.store else 'Unknown Store',
                'value': 0.0,
                'date': item.invoice.created_at.isoformat() if item.invoice.created_at else None,
                'source': 'pending_invoice_amount',
                'note': 'Pending invoice unpriced-items amount',
            }
        )
        entry['value'] += float(amount)
    pending_invoice_rows = sorted(
        pending_invoice_map.values(),
        key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)),
        reverse=True,
    )
    
    # OPTIMIZATION 9: Loss calculations with selected-date responsiveness
    todays_loss_qs = Invoice.objects.filter(
        created_at__date=date_to,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(status='void')
    if store_id:
        todays_loss_qs = todays_loss_qs.filter(store_id=store_id)
    todays_loss = todays_loss_qs.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    todays_loss_rows = _build_invoice_rows(todays_loss_qs)

    monthly_loss_qs = Invoice.objects.filter(
        created_at__gte=monthly_start,
        created_at__lte=monthly_end,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(status='void')
    if store_id:
        monthly_loss_qs = monthly_loss_qs.filter(store_id=store_id)
    monthly_loss = monthly_loss_qs.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    monthly_loss_rows = _build_invoice_rows(monthly_loss_qs)

    total_loss_qs = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(status='void')
    if store_id:
        total_loss_qs = total_loss_qs.filter(store_id=store_id)
    total_loss = total_loss_qs.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    total_loss_rows = _build_invoice_rows(total_loss_qs)
    
    # OPTIMIZATION 10: Yesterday's metrics
    yesterday = date_from - timedelta(days=1)
    yesterday_payments = Payment.objects.filter(
        created_at__date=yesterday
    ).exclude(
        invoice__status='void'
    ).exclude(
        invoice__customer__name__iexact='Manish Traders Loss'
    )
    
    if store_id:
        yesterday_payments = yesterday_payments.filter(invoice__store_id=store_id)
    
    yesterday_payment_summary = yesterday_payments.values('payment_method').annotate(
        total=Sum('amount', output_field=DecimalField())
    )
    yesterday_payment_dict = {item['payment_method']: item['total'] for item in yesterday_payment_summary}

    yesterday_ledger_credits = LedgerEntry.objects.filter(
        entry_type='credit',
        invoice__isnull=True,
        created_at__date=yesterday,
    )
    yesterday_ledger_summary = yesterday_ledger_credits.values('payment_mode').annotate(
        total=Sum('amount', output_field=DecimalField())
    )
    yesterday_ledger_dict = {item['payment_mode']: item['total'] for item in yesterday_ledger_summary}
    yesterday_ledger_mixed_split = yesterday_ledger_credits.filter(payment_mode='mixed').aggregate(
        cash_total=Sum('cash_amount', output_field=DecimalField()),
        upi_total=Sum('upi_amount', output_field=DecimalField()),
    )

    yesterday_invoice_cash = _decimal_or_zero(yesterday_payment_dict.get('cash'))
    yesterday_manual_cash = _decimal_or_zero(yesterday_ledger_dict.get('cash')) + _decimal_or_zero(yesterday_ledger_mixed_split.get('cash_total'))

    # Yesterday Cash KPI: ONLY invoice cash (no manual).
    yesterday_cash = yesterday_invoice_cash

    # Yesterday Online: ONLY invoice UPI/online payments (exclude manual).
    yesterday_online = _decimal_or_zero(yesterday_payment_dict.get('upi'))
    yesterday_expenses = Expenses.objects.filter(
        expense_date=yesterday
    ).aggregate(
        total=Sum('expense_amount', output_field=DecimalField(max_digits=18, decimal_places=2))
    )['total'] or Decimal('0.00')
    # Yesterday In-hand: invoice cash + manual cash - expenses.
    yesterday_inhand = (yesterday_invoice_cash + yesterday_manual_cash) - yesterday_expenses
    
    # Yesterday profit (simplified, no loop)
    yesterday_invoices = Invoice.objects.filter(
        created_at__date=yesterday,
        status='paid'
    ).exclude(
        status='void'
    ).exclude(
        customer__name__iexact='Manish Traders Loss'
    )
    
    if store_id:
        yesterday_invoices = yesterday_invoices.filter(store_id=store_id)
    
    # Simplified yesterday profit calculation (could be cached separately if needed)
    yesterday_profit = Decimal('0.00')  # Placeholder for now
    
    # Build response
    response_data = {
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat(),
            'yesterday': yesterday.isoformat()
        },
        'latest_invoice_date': latest_invoice_date.isoformat() if latest_invoice_date else None,
        'kpis': {
            'total_cash': float(total_cash),
            'total_online': float(total_online),
            'total_expenses': float(total_expenses),
            'total_inhand': float(total_inhand),
            'repair_invoice_cash_total': float(repair_invoice_cash_total),
            'repair_invoice_upi_total': float(repair_invoice_upi_total),
            'repair_invoice_mixed_total': float(repair_invoice_mixed_total),
            'repair_invoice_cash_count': repair_invoice_cash_count,
            'repair_invoice_upi_count': repair_invoice_upi_count,
            'repair_invoice_mixed_count': repair_invoice_mixed_count,
            'repair_payment_cash_total': float(repair_payment_cash_total),
            'repair_payment_upi_total': float(repair_payment_upi_total),
            'repair_payment_mixed_total': float(repair_payment_mixed_total),
            'repair_payment_cash_count': repair_payment_cash_count,
            'repair_payment_upi_count': repair_payment_upi_count,
            'repair_payment_mixed_count': repair_payment_mixed_count,
            'repairing_profit': float(repairing_profit),
            'counter_profit': float(counter_profit),
            'pending_profit': float(pending_profit),
            'overall_profit': float(overall_profit),
            'monthly_profit': float(monthly_profit),
            'total_stock': total_stock,
            'total_stock_value': float(total_stock_value),
            'pending_invoices_count': pending_invoices_count,
            'pending_invoices_total': float(pending_invoices_total),
            'total_replacement': 0.0,
            'todays_loss': float(todays_loss),
            'monthly_loss': float(monthly_loss),
            'total_loss': float(total_loss),
        },
        'comparisons': {
            'yesterday': {
                'total_cash': float(yesterday_cash),
                'total_online': float(yesterday_online),
                'total_inhand': float(yesterday_inhand),
                'overall_profit': float(yesterday_profit),
            }
        },
        'cash_online_contributions': {
            'cash': {
                'invoice_payments': cash_invoice_rows,
                'manual_payments': cash_manual_rows,
            },
            'upi': {
                'invoice_payments': upi_invoice_rows,
                'manual_payments': upi_manual_rows,
            }
        },
        'repair_cash_upi_contributions': {
            'cash': {
                'invoice_payments': repair_cash_payment_rows,
            },
            'upi': {
                'invoice_payments': repair_upi_payment_rows,
            },
            'mixed': {
                'invoice_payments': repair_mixed_payment_rows,
            },
        },
        'kpi_debug_rows': {
            'total_cash': {
                'label': 'Total Cash',
                'total': float(total_cash),
                'rows': sorted([
                    {
                        'id': row.get('id'),
                        'ref': row.get('invoice_number') or f"PAY-{row.get('id')}",
                        'party': row.get('party_name') or row.get('customer_name') or '',
                        'store': row.get('store') or 'Unknown Store',
                        'value': float(row.get('amount') or 0.0),
                        'date': row.get('payment_date'),
                        'source': row.get('source') or 'payment',
                        'note': row.get('description') or '',
                    } for row in cash_invoice_rows
                ], key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)), reverse=True),
            },
            'total_online': {
                'label': 'Total Online',
                'total': float(total_online),
                'rows': sorted([
                    {
                        'id': row.get('id'),
                        'ref': row.get('invoice_number') or f"PAY-{row.get('id')}",
                        'party': row.get('party_name') or row.get('customer_name') or '',
                        'store': row.get('store') or 'Unknown Store',
                        'value': float(row.get('amount') or 0.0),
                        'date': row.get('payment_date'),
                        'source': row.get('source') or 'payment',
                        'note': row.get('description') or '',
                    } for row in upi_invoice_rows
                ], key=lambda row: ((row.get('date') or ''), (row.get('id') or 0)), reverse=True),
            },
            'total_expenses': {
                'label': 'Total Expenses',
                'total': float(total_expenses),
                'rows': expenses_rows,
            },
            'total_inhand': {
                'label': 'Total Inhand',
                'total': float(total_inhand),
                'rows': total_inhand_rows,
            },
            'repair_invoice_cash_total': {
                'label': 'Repair Invoices (Cash)',
                'total': float(repair_invoice_cash_total),
                'rows': repair_invoice_cash_rows,
            },
            'repair_invoice_upi_total': {
                'label': 'Repair Invoices (UPI)',
                'total': float(repair_invoice_upi_total),
                'rows': repair_invoice_upi_rows,
            },
            'repair_invoice_mixed_total': {
                'label': 'Repair Invoices (Mixed)',
                'total': float(repair_invoice_mixed_total),
                'rows': repair_invoice_mixed_rows,
            },
            'repair_payment_cash_total': {
                'label': 'Repair Payments (Cash)',
                'total': float(repair_payment_cash_total),
                'rows': [
                    {
                        'id': row.get('id'),
                        'ref': row.get('invoice_number') or f"PAY-{row.get('id')}",
                        'party': row.get('party_name') or row.get('customer_name') or '',
                        'store': row.get('store') or 'Unknown Store',
                        'value': float(row.get('amount') or 0.0),
                        'date': row.get('payment_date'),
                        'source': row.get('source') or 'invoice_payment',
                        'note': '',
                    } for row in repair_cash_payment_rows
                ],
            },
            'repair_payment_upi_total': {
                'label': 'Repair Payments (UPI)',
                'total': float(repair_payment_upi_total),
                'rows': [
                    {
                        'id': row.get('id'),
                        'ref': row.get('invoice_number') or f"PAY-{row.get('id')}",
                        'party': row.get('party_name') or row.get('customer_name') or '',
                        'store': row.get('store') or 'Unknown Store',
                        'value': float(row.get('amount') or 0.0),
                        'date': row.get('payment_date'),
                        'source': row.get('source') or 'invoice_payment',
                        'note': '',
                    } for row in repair_upi_payment_rows
                ],
            },
            'repair_payment_mixed_total': {
                'label': 'Repair Payments (Mixed)',
                'total': float(repair_payment_mixed_total),
                'rows': [
                    {
                        'id': row.get('id'),
                        'ref': row.get('invoice_number') or f"PAY-{row.get('id')}",
                        'party': row.get('party_name') or row.get('customer_name') or '',
                        'store': row.get('store') or 'Unknown Store',
                        'value': float(row.get('amount') or 0.0),
                        'date': row.get('payment_date'),
                        'source': row.get('source') or 'invoice_payment',
                        'note': '',
                    } for row in repair_mixed_payment_rows
                ],
            },
            'repairing_profit': {
                'label': 'Repairing Profit',
                'total': float(repairing_profit),
                'rows': repairing_profit_rows,
            },
            'counter_profit': {
                'label': 'Counter Profit',
                'total': float(counter_profit),
                'rows': counter_profit_rows,
            },
            'pending_profit': {
                'label': 'Pending Profit',
                'total': float(pending_profit),
                'rows': pending_profit_rows,
            },
            'overall_profit': {
                'label': 'Overall Profit',
                'total': float(overall_profit),
                'rows': overall_profit_rows,
            },
            'monthly_profit': {
                'label': 'Monthly Profit',
                'total': float(monthly_profit),
                'rows': monthly_profit_rows,
            },
            'total_stock': {
                'label': 'Total Stock',
                'total': float(total_stock),
                'rows': total_stock_rows,
            },
            'total_stock_value': {
                'label': 'Total Stock Value',
                'total': float(total_stock_value),
                'rows': total_stock_value_rows,
            },
            'pending_invoices_total': {
                'label': 'Pending Invoice Amount',
                'total': float(pending_invoices_total),
                'rows': pending_invoice_rows,
            },
            'total_replacement': {
                'label': 'Total Replacement',
                'total': 0.0,
                'rows': [],
            },
            'todays_loss': {
                'label': 'Selected Day Loss',
                'total': float(todays_loss),
                'rows': todays_loss_rows,
            },
            'monthly_loss': {
                'label': 'Monthly Loss',
                'total': float(monthly_loss),
                'rows': monthly_loss_rows,
            },
            'total_loss': {
                'label': 'Total Loss',
                'total': float(total_loss),
                'rows': total_loss_rows,
            },
        },
    }
    kpi_formulas = {
        'total_cash': "SUM(Payment.amount where method='cash')  # invoice cash payments only (no manual ledger cash)",
        'total_online': "SUM(Payment.amount where method='upi')  # invoice UPI/online payments only (no manual ledger UPI)",
        'total_expenses': "SUM(Expenses.expense_amount in selected date range)",
        'total_inhand': "(SUM(Payment.amount where method='cash') + SUM(LedgerEntry.amount where entry_type='credit' and payment_mode='cash' and invoice is null) + SUM(LedgerEntry.cash_amount where payment_mode='mixed')) - total_expenses",
        'repair_invoice_cash_total': "SUM(Invoice.total where repair.status in ('done','delivered') and invoice_type='cash')",
        'repair_invoice_upi_total': "SUM(Invoice.total where repair.status in ('done','delivered') and invoice_type='upi')",
        'repair_invoice_mixed_total': "SUM(Invoice.total where repair.status in ('done','delivered') and invoice_type='mixed')",
        'repair_payment_cash_total': "SUM(Payment.amount where repair.status in ('done','delivered') and method='cash')",
        'repair_payment_upi_total': "SUM(Payment.amount where repair.status in ('done','delivered') and method='upi')",
        'repair_payment_mixed_total': "SUM(Payment.amount where repair.status in ('done','delivered') and method='mixed')",
        'repairing_profit': "SUM((effective_sale_rate - effective_cost_rate) * quantity for items on paid repair invoices)",
        'counter_profit': "SUM((effective_sale_rate - effective_cost_rate) * quantity for items on paid retail invoices)",
        'pending_profit': "SUM((sale_price - purchase_price) * quantity for credit/pending invoice items in selected date range)",
        'overall_profit': "counter_profit + repairing_profit",
        'monthly_profit': "SUM((sale_price - purchase_price) * quantity for paid invoice items in 10th-to-10th monthly window)",
        'total_stock': "DISABLED in dashboard endpoint (returns 0 for performance)",
        'total_stock_value': "DISABLED in dashboard endpoint (returns 0 for performance)",
        'pending_invoices_total': "SUM(quantity * effective_purchase_price for pending invoices with unpriced items)",
        'total_replacement': "Currently fixed to 0.0 (placeholder)",
        'todays_loss': "SUM(Invoice.total where customer contains 'Manish Traders Loss' on selected day)",
        'monthly_loss': "SUM(Invoice.total where customer contains 'Manish Traders Loss' in monthly 10th-to-10th window)",
        'total_loss': "SUM(Invoice.total where customer contains 'Manish Traders Loss' in selected date range)",
    }
    for kpi_key, formula in kpi_formulas.items():
        if kpi_key in response_data.get('kpi_debug_rows', {}):
            response_data['kpi_debug_rows'][kpi_key]['formula'] = formula
    response_data['kpi_store_grouping'] = _build_store_grouping(response_data.get('kpi_debug_rows'))
    
    response = Response(response_data)
    response['X-Cache'] = 'DISABLED'
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    
    logger.info(f"Dashboard KPIs calculated (user: {request.user.username})")
    
    return response
