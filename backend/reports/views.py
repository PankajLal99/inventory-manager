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
from backend.core.tenant_api import require_active_retailer, get_user_allowed_store_ids

logger = logging.getLogger('backend.reports')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sales_summary(request):
    """Sales summary report"""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    store_id = request.query_params.get('store', None)
    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)
    if not allowed_store_ids:
        return Response({'detail': 'No shop access for this retailer.'}, status=status.HTTP_403_FORBIDDEN)
    
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
        retailer_id=retailer.id,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        status__in=['paid', 'partial']
    ).exclude(customer__name__iexact='Manish Traders Loss')
    
    if store_id:
        try:
            sid = int(store_id)
        except (TypeError, ValueError):
            return Response({'detail': 'Invalid store filter.'}, status=status.HTTP_400_BAD_REQUEST)
        if sid not in allowed_store_ids:
            return Response({'detail': 'Store access denied.'}, status=status.HTTP_403_FORBIDDEN)
        invoices = invoices.filter(store_id=sid)
    elif not (request.user.is_superuser or request.user.is_staff):
        invoices = invoices.filter(store_id__in=allowed_store_ids)
    
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
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
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
        retailer_id=retailer.id,
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
        retailer, tenant_err = require_active_retailer(request)
        if tenant_err:
            return tenant_err
        store_id = request.query_params.get('store', None)
        warehouse_id = request.query_params.get('warehouse', None)
        allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)
        if not allowed_store_ids:
            return Response({'detail': 'No shop access for this retailer.'}, status=status.HTTP_403_FORBIDDEN)
        
        logger.info(f"User {request.user.username} requested inventory summary (store={store_id}, warehouse={warehouse_id})")
        
        # Use barcode-based calculations - only count products that have been purchased
        # Get all products that have at least one barcode (have been purchased)
        products_with_barcodes = Product.objects.filter(
            retailer_id=retailer.id,
            barcodes__isnull=False
        ).distinct()
        
        # Filter by store if provided (through purchase relationship)
        if store_id:
            try:
                sid = int(store_id)
            except (TypeError, ValueError):
                return Response({'detail': 'Invalid store filter.'}, status=status.HTTP_400_BAD_REQUEST)
            if sid not in allowed_store_ids:
                return Response({'detail': 'Store access denied.'}, status=status.HTTP_403_FORBIDDEN)
            products_with_barcodes = products_with_barcodes.filter(
                barcodes__purchase__store_id=sid
            ).distinct()
        elif not (request.user.is_superuser or request.user.is_staff):
            products_with_barcodes = products_with_barcodes.filter(
                barcodes__purchase__store_id__in=allowed_store_ids
            ).distinct()
        
        # Calculate metrics - only for products that have been purchased
        total_products = products_with_barcodes.count()
        
        # Calculate total quantity from barcodes (new + returned tags, excluding draft purchases)
        total_quantity = Barcode.objects.filter(
            retailer_id=retailer.id,
            tag__in=['new', 'returned'],
            product__in=products_with_barcodes
        ).exclude(
            purchase__status='draft'
        )
        
        if store_id:
            total_quantity = total_quantity.filter(purchase__store_id=sid)
        elif not (request.user.is_superuser or request.user.is_staff):
            total_quantity = total_quantity.filter(purchase__store_id__in=allowed_store_ids)
        
        total_quantity_count = total_quantity.count()
        
        # Get barcodes in active carts (reserved)
        active_carts_barcodes = set()
        cart_items = CartItem.objects.filter(
            cart__status='active',
            cart__retailer_id=retailer.id,
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
                retailer_id=retailer.id,
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
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    year = int(request.query_params.get('year', timezone.now().year))
    
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    invoices = Invoice.objects.filter(
        retailer_id=retailer.id,
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
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
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
        retailer_id=retailer.id,
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
    total_customers = Customer.objects.filter(retailer_id=retailer.id).count()
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
    """Stock ordering report - low stock and out of stock products (barcode-based)"""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    store_id = request.query_params.get('store', None)
    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)
    if not allowed_store_ids:
        return Response({'detail': 'No shop access for this retailer.'}, status=status.HTTP_403_FORBIDDEN)
    
    # Only include products that have been purchased (have barcodes)
    products_with_barcodes = Product.objects.filter(
        retailer_id=retailer.id,
        barcodes__isnull=False
    ).distinct()
    
    # Filter by store if provided (through purchase relationship)
    if store_id:
        try:
            sid = int(store_id)
        except (TypeError, ValueError):
            return Response({'detail': 'Invalid store filter.'}, status=status.HTTP_400_BAD_REQUEST)
        if sid not in allowed_store_ids:
            return Response({'detail': 'Store access denied.'}, status=status.HTTP_403_FORBIDDEN)
        products_with_barcodes = products_with_barcodes.filter(
            barcodes__purchase__store_id=sid
        ).distinct()
    elif not (request.user.is_superuser or request.user.is_staff):
        products_with_barcodes = products_with_barcodes.filter(
            barcodes__purchase__store_id__in=allowed_store_ids
        ).distinct()
    
    # Get barcodes in active carts (reserved)
    active_carts_barcodes = set()
    cart_items = CartItem.objects.filter(
        cart__status='active',
        cart__retailer_id=retailer.id,
    ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
    
    for cart_item in cart_items:
        if cart_item.scanned_barcodes:
            active_carts_barcodes.update(cart_item.scanned_barcodes)
    
    out_of_stock = []
    low_stock = []
    products_needing_order = []
    
    # Process each product that has been purchased
    for product in products_with_barcodes.select_related('category', 'brand'):
        # Get store name from first purchase if store_id is provided, otherwise use first store
        store_name = None
        if store_id:
            from backend.locations.models import Store
            try:
                store = Store.objects.get(id=sid, retailer_id=retailer.id)
                store_name = store.name
            except Store.DoesNotExist:
                pass
        
        # Count available barcodes for this product (new + returned, not in carts, not sold, not from draft purchases)
        product_barcodes = Barcode.objects.filter(
            retailer_id=retailer.id,
            product=product,
            tag__in=['new', 'returned']
        ).exclude(
            purchase__status='draft'
        )
        
        # Filter by store if provided
        if store_id:
            product_barcodes = product_barcodes.filter(purchase__store_id=sid)
        elif not (request.user.is_superuser or request.user.is_staff):
            product_barcodes = product_barcodes.filter(purchase__store_id__in=allowed_store_ids)
        
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
        low_stock_threshold = product.low_stock_threshold or 0
        
        # Get cost price from latest purchase
        cost_price = Decimal('0.00')
        latest_purchase = product.barcodes.filter(
            purchase__isnull=False
        ).exclude(
            purchase__status='draft'
        ).select_related('purchase').order_by('-purchase__created_at').first()
        
        if latest_purchase and latest_purchase.purchase:
            # Get cost price from purchase items
            from backend.purchasing.models import PurchaseItem
            purchase_item = PurchaseItem.objects.filter(
                purchase=latest_purchase.purchase,
                product=product
            ).first()
            if purchase_item:
                cost_price = purchase_item.unit_price or Decimal('0.00')
        
        product_data = {
            'product__id': product.id,
            'product__name': product.name,
            'product__sku': product.sku or 'N/A',
            'product__low_stock_threshold': low_stock_threshold,
            'product__cost_price': float(cost_price),
            'store__name': store_name or 'N/A',
            'available_quantity': available_count
        }
        
        # Categorize products
        if available_count == 0:
            out_of_stock.append(product_data)
            products_needing_order.append(product_data)
        elif low_stock_threshold > 0 and available_count > 0 and available_count <= low_stock_threshold:
            low_stock.append(product_data)
            products_needing_order.append(product_data)
    
    return Response({
        'out_of_stock': out_of_stock,
        'low_stock': low_stock,
        'products_needing_order': products_needing_order
    })
