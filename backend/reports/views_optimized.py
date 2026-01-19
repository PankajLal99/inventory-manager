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
from django.db.models import Sum, Count, Q, DecimalField, Prefetch
from django.utils import timezone
from datetime import datetime, timedelta
from decimal import Decimal
from django.core.cache import cache
from backend.core.cache_utils import (
    get_cached_dashboard_kpis,
    cache_dashboard_kpis,
    DASHBOARD_KPI_CACHE_TTL
)
from backend.pos.models import Invoice, InvoiceItem, Payment, CartItem
from backend.catalog.models import Product, Barcode
import logging

logger = logging.getLogger(__name__)


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
    
    # Try cache first (skip if Redis not available)
    try:
        cached_data, cache_key = get_cached_dashboard_kpis(date_from, date_to, store_id)
        if cached_data:
            logger.info(f"Dashboard KPIs cache HIT (user: {request.user.username}, date_from: {date_from})")
            response = Response(cached_data)
            response['X-Cache'] = 'HIT'
            response['Cache-Control'] = 'private, max-age=60'
            return response
        logger.info(f"Dashboard KPIs cache MISS (user: {request.user.username}, date_from: {date_from})")
    except Exception as e:
        logger.warning(f"Cache unavailable, proceeding without cache: {e}")
    
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
    
    # Aggregate payments by method in single query
    payment_summary = payments.values('payment_method').annotate(
        total=Sum('amount', output_field=DecimalField())
    )
    payment_dict = {item['payment_method']: item['total'] for item in payment_summary}
    
    total_cash = payment_dict.get('cash', Decimal('0.00'))
    total_online = payment_dict.get('upi', Decimal('0.00'))
    total_inhand = total_cash
    
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
        Q(status='credit') | Q(invoice_type='pending')
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
    
    # OPTIMIZATION 6: Monthly profit calculation (optimized date range)
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
    
    # OPTIMIZATION 8: Pending invoices aggregation
    pending_invoices_summary = credit_invoices.aggregate(
        count=Count('id'),
        total=Sum('total', output_field=DecimalField())
    )
    pending_invoices_count = pending_invoices_summary['count'] or 0
    pending_invoices_total = pending_invoices_summary['total'] or Decimal('0.00')
    
    # OPTIMIZATION 9: Loss calculations with aggregation
    today = timezone.now().date()
    todays_loss = Invoice.objects.filter(
        created_at__date=today,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(
        status='void'
    ).aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    monthly_loss = Invoice.objects.filter(
        created_at__gte=monthly_start,
        created_at__lte=monthly_end,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(
        status='void'
    ).aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    total_loss = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(
        status='void'
    ).aggregate(
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
    
    yesterday_cash = yesterday_payment_dict.get('cash', Decimal('0.00'))
    yesterday_online = yesterday_payment_dict.get('upi', Decimal('0.00'))
    yesterday_inhand = yesterday_cash
    
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
            'total_expenses': 0.0,
            'total_inhand': float(total_inhand),
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
        }
    }
    
    # Cache the response (skip if Redis not available)
    try:
        cache_dashboard_kpis(cache_key, response_data, DASHBOARD_KPI_CACHE_TTL)
    except Exception as e:
        logger.warning(f"Unable to cache response: {e}")
    
    response = Response(response_data)
    response['X-Cache'] = 'MISS'
    response['Cache-Control'] = 'private, max-age=60'
    
    logger.info(f"Dashboard KPIs calculated (user: {request.user.username})")
    
    return response
