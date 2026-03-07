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
from django.db.models import Sum, Count, Q, DecimalField, Prefetch, F, Value, Case, When, ExpressionWrapper
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
            'amount': float(split_amount),
            'payment_date': row.get('created_at').isoformat() if row.get('created_at') else None,
            'description': row.get('description') or '',
        })
    return rows


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
    
    # Default to today if no dates provided
    if not date_from:
        date_from = timezone.now().date()
    else:
        date_from = datetime.strptime(date_from, '%Y-%m-%d').date()
    
    if not date_to:
        date_to = timezone.now().date()
    else:
        date_to = datetime.strptime(date_to, '%Y-%m-%d').date()
    
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

    # Include manual payment receipts recorded through ledger (Payments page).
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

    total_cash = _decimal_or_zero(payment_dict.get('cash')) + (
        _decimal_or_zero(ledger_dict.get('cash'))
    ) + (
        _decimal_or_zero(ledger_mixed_split.get('cash_total'))
    )
    total_online = _decimal_or_zero(payment_dict.get('upi')) + (
        _decimal_or_zero(ledger_dict.get('upi'))
    ) + (
        _decimal_or_zero(ledger_mixed_split.get('upi_total'))
    )

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

    # Repair-only clarity: split by invoice type and by received payment method.
    repair_invoices = invoices.filter(store__shop_type='repair')
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
    repair_invoice_cash_count = repair_invoices.filter(invoice_type='cash').count()
    repair_invoice_upi_count = repair_invoices.filter(invoice_type='upi').count()

    repair_payments = payments.filter(invoice__store__shop_type='repair')
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
    repair_payment_cash_count = int((repair_payment_dict.get('cash') or {}).get('count') or 0)
    repair_payment_upi_count = int((repair_payment_dict.get('upi') or {}).get('count') or 0)

    repair_cash_payment_rows = _build_payment_contribution_rows(repair_payments, 'cash')
    repair_upi_payment_rows = _build_payment_contribution_rows(repair_payments, 'upi')
    
    # OPTIMIZATION 3: Get invoice items with barcodes in bulk (prefetch related)
    paid_invoices = invoices.filter(status__in=['paid', 'partial'])
    
    invoice_items = InvoiceItem.objects.filter(
        invoice__in=paid_invoices
    ).select_related(
        'barcode',
        'product',
        'invoice',
        'invoice__store'
    ).prefetch_related(
        Prefetch(
            'barcode',
            queryset=Barcode.objects.select_related('purchase', 'purchase_item')
        )
    )
    
    # OPTIMIZATION 4: Calculate profits in single loop
    repairing_profit = Decimal('0.00')
    counter_profit = Decimal('0.00')
    
    for item in invoice_items:
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        # Get purchase price efficiently (already prefetched)
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            # Cache first barcode lookup per product
            cache_key_product = f"product_purchase_price:{item.product.id}"
            purchase_price = cache.get(cache_key_product)
            if purchase_price is None:
                first_barcode = Barcode.objects.filter(
                    product=item.product,
                    tag__in=['new', 'returned']
                ).exclude(
                    purchase__status='draft'
                ).select_related('purchase', 'purchase_item').first()
                
                if first_barcode:
                    purchase_price = first_barcode.get_purchase_price()
                else:
                    purchase_price = Decimal('0.00')
                
                # Cache for 5 minutes
                cache.set(cache_key_product, purchase_price, 300)
        
        profit = (sale_price - purchase_price) * item.quantity
        
        # Check store type
        if item.invoice.store and item.invoice.store.shop_type == 'repair':
            repairing_profit += profit
        elif item.invoice.store and item.invoice.store.shop_type == 'retail':
            counter_profit += profit
    
    overall_profit = counter_profit + repairing_profit
    
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

    # Expenses for the selected dashboard date range
    expenses_queryset = Expenses.objects.filter(
        expense_date__gte=date_from,
        expense_date__lte=date_to
    )
    total_expenses = expenses_queryset.aggregate(
        total=Sum('expense_amount', output_field=DecimalField(max_digits=18, decimal_places=2))
    )['total'] or Decimal('0.00')

    # In-hand is cash in period minus expenses in the same period.
    total_inhand = total_cash - total_expenses
    
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
        status__in=['paid', 'partial']
    ).exclude(status='void').exclude(customer__name__iexact='Manish Traders Loss')
    if store_id:
        monthly_invoices = monthly_invoices.filter(store_id=store_id)

    monthly_items = InvoiceItem.objects.filter(
        invoice__in=monthly_invoices
    ).select_related('barcode', 'product')
    
    monthly_profit = Decimal('0.00')
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
    
    # OPTIMIZATION 7: Stock calculations with batch queries
    stock_barcodes = Barcode.objects.filter(
        tag__in=['new', 'returned']
    ).exclude(
        purchase__status='draft'
    )
    
    if store_id:
        stock_barcodes = stock_barcodes.filter(purchase__store_id=store_id)
    
    # Get sold barcode IDs in one query
    sold_barcode_ids = set(
        InvoiceItem.objects.filter(
            barcode__in=stock_barcodes.values_list('id', flat=True)
        ).exclude(
            invoice__status='void'
        ).values_list('barcode_id', flat=True)
    )
    
    available_barcodes = stock_barcodes.exclude(id__in=sold_barcode_ids)
    total_stock = available_barcodes.count()
    
    # Calculate stock value (with caching per barcode)
    total_stock_value = Decimal('0.00')
    for barcode in available_barcodes.select_related('purchase', 'purchase_item'):
        total_stock_value += barcode.get_purchase_price()
    
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

    yesterday_cash = _decimal_or_zero(yesterday_payment_dict.get('cash')) + (
        _decimal_or_zero(yesterday_ledger_dict.get('cash'))
    ) + (
        _decimal_or_zero(yesterday_ledger_mixed_split.get('cash_total'))
    )
    yesterday_online = _decimal_or_zero(yesterday_payment_dict.get('upi')) + (
        _decimal_or_zero(yesterday_ledger_dict.get('upi'))
    ) + (
        _decimal_or_zero(yesterday_ledger_mixed_split.get('upi_total'))
    )
    yesterday_expenses = Expenses.objects.filter(
        expense_date=yesterday
    ).aggregate(
        total=Sum('expense_amount', output_field=DecimalField(max_digits=18, decimal_places=2))
    )['total'] or Decimal('0.00')
    yesterday_inhand = yesterday_cash - yesterday_expenses
    
    # Yesterday profit (simplified, no loop)
    yesterday_invoices = Invoice.objects.filter(
        created_at__date=yesterday,
        status__in=['paid', 'partial']
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
        'kpis': {
            'total_cash': float(total_cash),
            'total_online': float(total_online),
            'total_expenses': float(total_expenses),
            'total_inhand': float(total_inhand),
            'repair_invoice_cash_total': float(repair_invoice_cash_total),
            'repair_invoice_upi_total': float(repair_invoice_upi_total),
            'repair_invoice_cash_count': repair_invoice_cash_count,
            'repair_invoice_upi_count': repair_invoice_upi_count,
            'repair_payment_cash_total': float(repair_payment_cash_total),
            'repair_payment_upi_total': float(repair_payment_upi_total),
            'repair_payment_cash_count': repair_payment_cash_count,
            'repair_payment_upi_count': repair_payment_upi_count,
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
            }
        },
    }
    
    response = Response(response_data)
    response['X-Cache'] = 'DISABLED'
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    
    logger.info(f"Dashboard KPIs calculated (user: {request.user.username})")
    
    return response
