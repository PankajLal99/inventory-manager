import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, Count, Avg, DecimalField
from django.db.models.functions import TruncDate, TruncMonth
from django.utils import timezone
from datetime import datetime, timedelta
from decimal import Decimal

from backend.pos.models import Invoice, InvoiceItem, CartItem
from backend.catalog.models import Product, Barcode
from backend.parties.models import Customer

logger = logging.getLogger('backend.reports')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sales_summary(request):
    """Sales summary report"""
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    store_id = request.query_params.get('store', None)
    
    # Default to last 30 days if no dates provided
    if not date_from:
        date_from = (timezone.now() - timedelta(days=30)).date()
    else:
        date_from = datetime.strptime(date_from, '%Y-%m-%d').date()
    
    if not date_to:
        date_to = timezone.now().date()
    else:
        date_to = datetime.strptime(date_to, '%Y-%m-%d').date()
    
    # Base queryset
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    invoices = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        status__in=['paid', 'partial']
    ).exclude(customer__name__iexact='Manish Traders Loss')
    
    if store_id:
        invoices = invoices.filter(store_id=store_id)
    
    # Calculate metrics
    total_sales = invoices.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    total_invoices = invoices.count()
    
    total_items_sold = InvoiceItem.objects.filter(
        invoice__in=invoices
    ).aggregate(
        total=Sum('quantity', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    avg_order_value = invoices.aggregate(
        avg=Avg('total', output_field=DecimalField())
    )['avg'] or Decimal('0.00')
    
    # Daily breakdown
    daily_sales = invoices.annotate(
        date=TruncDate('created_at')
    ).values('date').annotate(
        total=Sum('total', output_field=DecimalField()),
        count=Count('id')
    ).order_by('date')
    
    return Response({
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat()
        },
        'summary': {
            'total_sales': float(total_sales),
            'total_invoices': total_invoices,
            'total_items_sold': float(total_items_sold),
            'avg_order_value': float(avg_order_value)
        },
        'daily_breakdown': list(daily_sales)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def top_products(request):
    """Top selling products report"""
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    limit = int(request.query_params.get('limit', 10))
    
    if not date_from:
        date_from = (timezone.now() - timedelta(days=30)).date()
    else:
        date_from = datetime.strptime(date_from, '%Y-%m-%d').date()
    
    if not date_to:
        date_to = timezone.now().date()
    else:
        date_to = datetime.strptime(date_to, '%Y-%m-%d').date()
    
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    invoices = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        status__in=['paid', 'partial']
    ).exclude(customer__name__iexact='Manish Traders Loss')
    
    top_products = InvoiceItem.objects.filter(
        invoice__in=invoices
    ).values(
        'product__id',
        'product__name',
        'product__sku'
    ).annotate(
        total_quantity=Sum('quantity', output_field=DecimalField()),
        total_revenue=Sum('line_total', output_field=DecimalField()),
        order_count=Count('invoice', distinct=True)
    ).order_by('-total_revenue')[:limit]
    
    return Response({
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat()
        },
        'products': list(top_products)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def inventory_summary(request):
    """Inventory summary report - uses barcode-based calculations"""
    try:
        store_id = request.query_params.get('store', None)
        warehouse_id = request.query_params.get('warehouse', None)
        
        logger.info(f"User {request.user.username} requested inventory summary (store={store_id}, warehouse={warehouse_id})")
        
        # Use barcode-based calculations - only count products that have been purchased
        # Get all products that have at least one barcode (have been purchased)
        products_with_barcodes = Product.objects.filter(
            barcodes__isnull=False
        ).distinct()
        
        # Filter by store if provided (through purchase relationship)
        if store_id:
            products_with_barcodes = products_with_barcodes.filter(
                barcodes__purchase__store_id=store_id
            ).distinct()
        
        # Calculate metrics - only for products that have been purchased
        total_products = products_with_barcodes.count()
        
        # Calculate total quantity from barcodes (new + returned tags, excluding draft purchases)
        total_quantity = Barcode.objects.filter(
            tag__in=['new', 'returned'],
            product__in=products_with_barcodes
        ).exclude(
            purchase__status='draft'
        )
        
        if store_id:
            total_quantity = total_quantity.filter(purchase__store_id=store_id)
        
        total_quantity_count = total_quantity.count()
        
        # Get barcodes in active carts (reserved)
        active_carts_barcodes = set()
        cart_items = CartItem.objects.filter(
            cart__status='active'
        ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
        
        for cart_item in cart_items:
            if cart_item.scanned_barcodes:
                active_carts_barcodes.update(cart_item.scanned_barcodes)
        
        # Calculate available quantity (excluding barcodes in active carts)
        available_barcodes = total_quantity.exclude(barcode__in=active_carts_barcodes)
        total_available = available_barcodes.count()
        total_reserved = len(active_carts_barcodes)
        
        # Low stock count and out of stock count - only for products that have been purchased
        low_stock_count = 0
        out_of_stock_count = 0
        
        # Calculate low stock and out of stock by checking each product's barcode count
        for product in products_with_barcodes.select_related():
            # Count available barcodes for this product (new + returned, not in carts, not sold, not from draft purchases)
            product_barcodes = Barcode.objects.filter(
                product=product,
                tag__in=['new', 'returned']
            ).exclude(
                purchase__status='draft'
            )
            
            # Exclude barcodes in active carts
            if active_carts_barcodes:
                product_barcodes = product_barcodes.exclude(barcode__in=active_carts_barcodes)
            
            # Exclude sold barcodes (assigned to non-void invoices)
            sold_barcode_ids = InvoiceItem.objects.filter(
                barcode__in=product_barcodes.values_list('id', flat=True)
            ).exclude(
                invoice__status='void'
            ).values_list('barcode_id', flat=True)
            
            available_count = product_barcodes.exclude(id__in=sold_barcode_ids).count()
            
            # Only count as out of stock if product has been purchased (has barcodes) and available_count is 0
            if available_count == 0:
                out_of_stock_count += 1
            elif product.low_stock_threshold and available_count > 0 and available_count <= product.low_stock_threshold:
                low_stock_count += 1
        
        logger.debug(f"Inventory summary: total_products={total_products}, total_quantity={total_quantity_count}, low_stock={low_stock_count}, out_of_stock={out_of_stock_count}")
        
        return Response({
            'summary': {
                'total_products': total_products,
                'total_quantity': float(total_quantity_count),
                'total_reserved': float(total_reserved),
                'total_available': float(total_available),
                'low_stock_count': low_stock_count,
                'out_of_stock_count': out_of_stock_count
            }
        })
    except Exception as e:
        logger.error(f"Error in inventory_summary: {str(e)}", exc_info=True)
        return Response(
            {'error': 'An error occurred while generating inventory summary'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def revenue_report(request):
    """Revenue report with monthly breakdown"""
    year = int(request.query_params.get('year', timezone.now().year))
    
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    invoices = Invoice.objects.filter(
        created_at__year=year,
        status__in=['paid', 'partial']
    ).exclude(customer__name__iexact='Manish Traders Loss')
    
    # Monthly breakdown
    monthly_revenue = invoices.annotate(
        month=TruncMonth('created_at')
    ).values('month').annotate(
        total_revenue=Sum('total', output_field=DecimalField()),
        invoice_count=Count('id'),
        avg_order_value=Avg('total', output_field=DecimalField())
    ).order_by('month')
    
    # Year total
    year_total = invoices.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    return Response({
        'year': year,
        'year_total': float(year_total),
        'monthly_breakdown': list(monthly_revenue)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def customer_summary(request):
    """Customer summary report"""
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    
    if not date_from:
        date_from = (timezone.now() - timedelta(days=30)).date()
    else:
        date_from = datetime.strptime(date_from, '%Y-%m-%d').date()
    
    if not date_to:
        date_to = timezone.now().date()
    else:
        date_to = datetime.strptime(date_to, '%Y-%m-%d').date()
    
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    invoices = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        status__in=['paid', 'partial'],
        customer__isnull=False
    ).exclude(customer__name__iexact='Manish Traders Loss')
    
    # Top customers
    top_customers = invoices.values(
        'customer__id',
        'customer__name',
        'customer__email',
        'customer__phone'
    ).annotate(
        total_spent=Sum('total', output_field=DecimalField()),
        order_count=Count('id'),
        avg_order_value=Avg('total', output_field=DecimalField())
    ).order_by('-total_spent')[:10]
    
    # Total customers
    total_customers = Customer.objects.count()
    active_customers = invoices.values('customer').distinct().count()
    
    return Response({
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat()
        },
        'summary': {
            'total_customers': total_customers,
            'active_customers': active_customers
        },
        'top_customers': list(top_customers)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_ordering_report(request):
    """
    Stock ordering report (barcode-based) with Redis caching.

    Query params:
      - store: optional store id
      - counts_only=1: ultra-light badge payload (cached ~90s)
      - refresh=1: bypass cache
    """
    from backend.reports.stock_alerts import get_stock_alert_counts, get_stock_alert_list

    store_id = request.query_params.get('store', None)
    counts_only = str(request.query_params.get('counts_only', '')).lower() in (
        '1', 'true', 'yes', 'y',
    )
    bypass_cache = str(request.query_params.get('refresh', '')).lower() in (
        '1', 'true', 'yes', 'y',
    )

    if counts_only:
        return Response(get_stock_alert_counts(store_id, bypass_cache=bypass_cache))

    return Response(get_stock_alert_list(store_id, bypass_cache=bypass_cache))
