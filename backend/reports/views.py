import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, Count, Avg, Max, DecimalField, IntegerField
from django.db.models.functions import TruncDate, TruncMonth
from django.utils import timezone
from datetime import datetime, timedelta
from decimal import Decimal

from backend.pos.models import Invoice, InvoiceItem, CartItem, Payment
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
def stock_sold_report(request):
    """Stock sold report -- date range wise, including total amount from Invoices"""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    store_id = request.query_params.get('store', None)
    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)
    
    if not date_from:
        date_from = (timezone.now() - timedelta(days=30)).date()
    else:
        date_from = datetime.strptime(date_from, '%Y-%m-%d').date()
    
    if not date_to:
        date_to = timezone.now().date()
    else:
        date_to = datetime.strptime(date_to, '%Y-%m-%d').date()
    
    # Base invoices
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
        invoices = invoices.filter(store_id=sid)
    elif allowed_store_ids is not None and not (request.user.is_superuser or request.user.is_staff):
        invoices = invoices.filter(store_id__in=allowed_store_ids)

    # Sum of Invoice totals (user specifically requested this field for value)
    total_invoice_value = invoices.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')

    # All products sold in this period
    products_sold = list(InvoiceItem.objects.filter(
        invoice__in=invoices
    ).values(
        'product__id',
        'product__name',
        'product__sku',
        'product__category__name',
        'product__brand__name',
    ).annotate(
        total_quantity=Sum('quantity', output_field=DecimalField()),
        total_revenue=Sum('line_total', output_field=DecimalField()),
        order_count=Count('invoice', distinct=True)
    ).order_by('-total_quantity'))

    # Annotate each product with current available stock (barcodes with tag='new')
    product_ids = [p['product__id'] for p in products_sold if p['product__id']]
    if product_ids:
        barcode_qs = Barcode.objects.filter(
            product_id__in=product_ids,
            retailer_id=retailer.id,
            tag='new',
            deleted_at__isnull=True,
        )
        if store_id:
            barcode_qs = barcode_qs.filter(current_store_id=sid)
        available_counts = dict(
            barcode_qs.values('product_id').annotate(cnt=Count('id')).values_list('product_id', 'cnt')
        )
    else:
        available_counts = {}

    for p in products_sold:
        p['available_quantity'] = available_counts.get(p['product__id'], 0)

    return Response({
        'period': {
            'from': date_from.isoformat(),
            'to': date_to.isoformat()
        },
        'total_invoice_value': float(total_invoice_value),
        'products': products_sold
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
    
    in_stock = []
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
            'product__category__name': product.category.name if product.category_id else None,
            'product__brand__name': product.brand.name if product.brand_id else None,
            'product__low_stock_threshold': low_stock_threshold,
            'product__cost_price': float(cost_price),
            'store__name': store_name or 'N/A',
            'available_quantity': available_count,
        }
        
        # Categorize products (purchased = has barcodes; in_stock before out_of_stock in exports)
        if available_count == 0:
            out_of_stock.append(product_data)
            products_needing_order.append(product_data)
        else:
            in_stock.append(product_data)
            if low_stock_threshold > 0 and available_count <= low_stock_threshold:
                low_stock.append(product_data)
                products_needing_order.append(product_data)

    in_stock.sort(
        key=lambda x: (-int(x['available_quantity'] or 0), (x['product__name'] or '').lower())
    )
    out_of_stock.sort(key=lambda x: (x['product__name'] or '').lower())
    low_stock.sort(
        key=lambda x: (int(x['available_quantity'] or 0), (x['product__name'] or '').lower())
    )
    
    return Response({
        'in_stock': in_stock,
        'out_of_stock': out_of_stock,
        'low_stock': low_stock,
        'products_needing_order': products_needing_order,
    })


# ─── Helper ───────────────────────────────────────────────────────────────────

def _build_invoice_qs(retailer, date_from, date_to, store_id, allowed_store_ids, user):
    """Return a filtered Invoice queryset (paid/partial, right dates, right store)."""
    qs = Invoice.objects.filter(
        retailer_id=retailer.id,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        status__in=['paid', 'partial'],
    ).exclude(customer__name__iexact='Manish Traders Loss')

    if store_id:
        qs = qs.filter(store_id=store_id)
    elif allowed_store_ids is not None and not (user.is_superuser or user.is_staff):
        qs = qs.filter(store_id__in=allowed_store_ids)

    return qs


def _invoice_metrics(qs):
    """Aggregate total_sales, total_invoices, items_sold, avg_order_value from queryset."""
    agg = qs.aggregate(
        total_sales=Sum('total', output_field=DecimalField()),
        total_invoices=Count('id'),
        avg_order_value=Avg('total', output_field=DecimalField()),
    )
    items_sold_agg = InvoiceItem.objects.filter(invoice__in=qs).aggregate(
        items_sold=Sum('quantity', output_field=DecimalField())
    )
    return {
        'total_sales': float(agg['total_sales'] or 0),
        'total_invoices': agg['total_invoices'] or 0,
        'items_sold': float(items_sold_agg['items_sold'] or 0),
        'avg_order_value': float(agg['avg_order_value'] or 0),
    }


def _pct_change(curr, prev):
    """Return % change between two floats, None if prev is 0."""
    if prev and prev != 0:
        return round(((curr - prev) / prev) * 100, 1)
    return None


# ─── analytics_comparison ────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def analytics_comparison(request):
    """
    Current period + comparison period metrics with % change.
    Auto-computes previous period if compare_from/compare_to not given.
    """
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err

    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)

    # Parse dates
    def parse_date(val, default):
        return datetime.strptime(val, '%Y-%m-%d').date() if val else default

    date_from = parse_date(request.query_params.get('date_from'), (timezone.now() - timedelta(days=30)).date())
    date_to = parse_date(request.query_params.get('date_to'), timezone.now().date())
    store_id_raw = request.query_params.get('store')
    store_id = int(store_id_raw) if store_id_raw else None

    # Build comparison period (auto = same length shifted back)
    compare_from_raw = request.query_params.get('compare_from')
    compare_to_raw = request.query_params.get('compare_to')
    if compare_from_raw and compare_to_raw:
        compare_from = parse_date(compare_from_raw, None)
        compare_to = parse_date(compare_to_raw, None)
    else:
        delta = (date_to - date_from).days + 1
        compare_to = date_from - timedelta(days=1)
        compare_from = compare_to - timedelta(days=delta - 1)

    # Querysets
    curr_qs = _build_invoice_qs(retailer, date_from, date_to, store_id, allowed_store_ids, request.user)
    prev_qs = _build_invoice_qs(retailer, compare_from, compare_to, store_id, allowed_store_ids, request.user)

    curr = _invoice_metrics(curr_qs)
    prev = _invoice_metrics(prev_qs)

    # Daily breakdown for chart (current period)
    daily_current = list(
        curr_qs.annotate(date=TruncDate('created_at'))
        .values('date')
        .annotate(
            total=Sum('total', output_field=DecimalField()),
            count=Count('id'),
        )
        .order_by('date')
    )

    daily_prev = list(
        prev_qs.annotate(date=TruncDate('created_at'))
        .values('date')
        .annotate(
            total=Sum('total', output_field=DecimalField()),
            count=Count('id'),
        )
        .order_by('date')
    )

    # Per-store breakdown (for store comparison panel)
    from backend.locations.models import Store as StoreModel
    stores = StoreModel.objects.filter(retailer_id=retailer.id, is_active=True)
    store_comparison = []
    for store in stores:
        sq = _build_invoice_qs(retailer, date_from, date_to, store.id, allowed_store_ids, request.user)
        metrics = _invoice_metrics(sq)
        store_comparison.append({
            'store_id': store.id,
            'store_name': store.name,
            **metrics,
        })

    return Response({
        'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
        'compare_period': {'from': compare_from.isoformat(), 'to': compare_to.isoformat()},
        'current': curr,
        'previous': prev,
        'pct_change': {
            'total_sales': _pct_change(curr['total_sales'], prev['total_sales']),
            'total_invoices': _pct_change(curr['total_invoices'], prev['total_invoices']),
            'items_sold': _pct_change(curr['items_sold'], prev['items_sold']),
            'avg_order_value': _pct_change(curr['avg_order_value'], prev['avg_order_value']),
        },
        'daily_current': daily_current,
        'daily_previous': daily_prev,
        'store_comparison': store_comparison,
    })


# ─── category_brand_analytics ────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def category_brand_analytics(request):
    """
    Top categories, top brands, slow-moving, fast-selling products.
    Supports optional ?category=<id> and ?brand=<id> filters.
    """
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err

    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)

    def parse_date(val, default):
        return datetime.strptime(val, '%Y-%m-%d').date() if val else default

    date_from = parse_date(request.query_params.get('date_from'), (timezone.now() - timedelta(days=30)).date())
    date_to = parse_date(request.query_params.get('date_to'), timezone.now().date())
    store_id_raw = request.query_params.get('store')
    store_id = int(store_id_raw) if store_id_raw else None
    category_id = request.query_params.get('category')
    brand_id = request.query_params.get('brand')
    limit = int(request.query_params.get('limit', 10))

    inv_qs = _build_invoice_qs(retailer, date_from, date_to, store_id, allowed_store_ids, request.user)
    items_qs = InvoiceItem.objects.filter(invoice__in=inv_qs)

    if category_id:
        items_qs = items_qs.filter(product__category_id=category_id)
    if brand_id:
        items_qs = items_qs.filter(product__brand_id=brand_id)

    # Top categories
    top_categories = list(
        items_qs.filter(product__category__isnull=False)
        .values('product__category__id', 'product__category__name')
        .annotate(
            total_quantity=Sum('quantity', output_field=DecimalField()),
            total_revenue=Sum('line_total', output_field=DecimalField()),
            order_count=Count('invoice', distinct=True),
        )
        .order_by('-total_revenue')[:limit]
    )

    # Top brands
    top_brands = list(
        items_qs.filter(product__brand__isnull=False)
        .values('product__brand__id', 'product__brand__name')
        .annotate(
            total_quantity=Sum('quantity', output_field=DecimalField()),
            total_revenue=Sum('line_total', output_field=DecimalField()),
            order_count=Count('invoice', distinct=True),
        )
        .order_by('-total_revenue')[:limit]
    )

    # All products in period with metrics
    product_metrics = list(
        items_qs.values(
            'product__id', 'product__name', 'product__sku',
            'product__category__name', 'product__brand__name'
        ).annotate(
            total_quantity=Sum('quantity', output_field=DecimalField()),
            total_revenue=Sum('line_total', output_field=DecimalField()),
            order_count=Count('invoice', distinct=True),
        )
    )

    # Fast-selling = highest quantity
    fast_selling = sorted(product_metrics, key=lambda x: float(x['total_quantity'] or 0), reverse=True)[:10]
    # Slow-moving = lowest quantity (but >0 i.e. sold at least something)
    slow_moving = sorted(
        [p for p in product_metrics if float(p['total_quantity'] or 0) > 0],
        key=lambda x: float(x['total_quantity'] or 0)
    )[:10]

    return Response({
        'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
        'top_categories': top_categories,
        'top_brands': top_brands,
        'fast_selling': fast_selling,
        'slow_moving': slow_moving,
    })


# ─── kpi_detail ──────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def kpi_detail(request):
    """
    Drill-down: return invoices contributing to a KPI.
    ?metric=total_sales|total_invoices|items_sold|avg_order_value
    """
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err

    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)

    def parse_date(val, default):
        return datetime.strptime(val, '%Y-%m-%d').date() if val else default

    date_from = parse_date(request.query_params.get('date_from'), (timezone.now() - timedelta(days=30)).date())
    date_to = parse_date(request.query_params.get('date_to'), timezone.now().date())
    store_id_raw = request.query_params.get('store')
    store_id = int(store_id_raw) if store_id_raw else None
    metric = request.query_params.get('metric', 'total_sales')
    page = int(request.query_params.get('page', 1))
    page_size = int(request.query_params.get('page_size', 50))

    inv_qs = _build_invoice_qs(retailer, date_from, date_to, store_id, allowed_store_ids, request.user)

    # Order differently depending on metric
    order_map = {
        'total_sales': '-total',
        'total_invoices': '-created_at',
        'items_sold': '-created_at',
        'avg_order_value': '-total',
    }
    inv_qs = inv_qs.select_related('customer', 'store').order_by(order_map.get(metric, '-created_at'))

    total_count = inv_qs.count()
    offset = (page - 1) * page_size
    invoices_page = inv_qs[offset:offset + page_size]

    rows = []
    for inv in invoices_page:
        rows.append({
            'id': inv.id,
            'invoice_number': inv.invoice_number,
            'created_at': inv.created_at.isoformat(),
            'customer_name': inv.customer.name if inv.customer else 'Walk-in',
            'store_name': inv.store.name if inv.store else '',
            'status': inv.status,
            'invoice_type': inv.invoice_type,
            'subtotal': float(inv.subtotal),
            'discount_amount': float(inv.discount_amount),
            'tax_amount': float(inv.tax_amount),
            'total': float(inv.total),
            'paid_amount': float(inv.paid_amount),
            'due_amount': float(inv.due_amount),
        })

    return Response({
        'metric': metric,
        'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
        'total_count': total_count,
        'page': page,
        'page_size': page_size,
        'invoices': rows,
    })


# ─── Shared export helpers ───────────────────────────────────────────────────

def _parse_export_page(request):
    try:
        page = max(1, int(request.query_params.get('page', 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.query_params.get('page_size', 100))
    except (TypeError, ValueError):
        page_size = 100
    page_size = max(1, min(page_size, 200))
    return page, page_size


def _parse_export_date(val, default):
    if not val:
        return default
    try:
        return datetime.strptime(val, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return default


def _parse_export_store_id(request):
    store_id_raw = request.query_params.get('store')
    if store_id_raw is None or store_id_raw == '':
        return None, None
    try:
        return int(store_id_raw), None
    except (TypeError, ValueError):
        return None, Response({'detail': 'Invalid store filter.'}, status=status.HTTP_400_BAD_REQUEST)


def _export_store_access_error(request, retailer, store_id, allowed_store_ids):
    """Return a 403 Response when the user cannot access export data, else None."""
    if not allowed_store_ids and not (request.user.is_superuser or request.user.is_staff):
        return Response({'detail': 'No shop access for this retailer.'}, status=status.HTTP_403_FORBIDDEN)
    if store_id is not None and allowed_store_ids is not None and store_id not in allowed_store_ids and not (
        request.user.is_superuser or request.user.is_staff
    ):
        return Response({'detail': 'Store access denied.'}, status=status.HTTP_403_FORBIDDEN)
    return None


def _active_cart_barcode_values(retailer_id):
    active = set()
    cart_items = CartItem.objects.filter(
        cart__status='active',
        cart__retailer_id=retailer_id,
    ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
    for cart_item in cart_items.iterator(chunk_size=200):
        if cart_item.scanned_barcodes:
            active.update(cart_item.scanned_barcodes)
    return active


# ─── sales_export (lean payload for Excel) ───────────────────────────────────

def _sales_export_item_tax(item):
    """Minimal tax rate / inclusive flags for export (no full tax_bifurcation math)."""
    rate = 0.0
    is_inclusive = False
    try:
        barcode = item.barcode
        purchase_item = barcode.purchase_item if barcode is not None else None
        if purchase_item is not None:
            if purchase_item.gst_percent is not None:
                rate = float(purchase_item.gst_percent)
            is_inclusive = bool(purchase_item.gst_inclusive)
        elif item.product_id and getattr(item.product, 'tax_rate', None) is not None:
            tr = item.product.tax_rate
            if tr is not None and tr.rate is not None:
                rate = float(tr.rate)
    except Exception:
        pass

    tax_amt = float(item.tax_amount or 0)
    if rate <= 0 and tax_amt > 0:
        line_total = float(item.line_total or 0)
        base = line_total - tax_amt
        if base > 0:
            rate = round((tax_amt / base) * 100, 2)

    if tax_amt <= 0:
        return None
    return {'rate': rate, 'is_inclusive': is_inclusive}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sales_export(request):
    """
    Lean invoice rows for Sales Report Excel.

    Replaces POS invoice list for export: avoids InvoiceSerializer (tax_bifurcation,
    display_total, repair, replacement ledgers, etc.) which OOMs small hosts.
    Paginated so peak memory stays bounded.
    """
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err

    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)
    store_id, store_err = _parse_export_store_id(request)
    if store_err:
        return store_err
    access_err = _export_store_access_error(request, retailer, store_id, allowed_store_ids)
    if access_err:
        return access_err

    date_from = _parse_export_date(
        request.query_params.get('date_from'),
        (timezone.now() - timedelta(days=30)).date(),
    )
    date_to = _parse_export_date(request.query_params.get('date_to'), timezone.now().date())
    page, page_size = _parse_export_page(request)

    # Match POS invoice list filters used by the previous Excel export path.
    inv_qs = (
        Invoice.objects.filter(
            retailer_id=retailer.id,
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
            repair__isnull=True,
        )
        .exclude(invoice_type='defective')
        .select_related('customer')
        .only(
            'id',
            'invoice_number',
            'created_at',
            'tax_amount',
            'total',
            'due_amount',
            'customer_id',
            'customer__name',
        )
        .order_by('created_at', 'id')
    )
    if store_id:
        inv_qs = inv_qs.filter(store_id=store_id)
    elif not (request.user.is_superuser or request.user.is_staff):
        inv_qs = inv_qs.filter(store_id__in=allowed_store_ids)

    total_count = inv_qs.count()
    offset = (page - 1) * page_size
    invoices = list(inv_qs[offset:offset + page_size])
    inv_ids = [inv.id for inv in invoices]

    payments_by_inv = {iid: [] for iid in inv_ids}
    items_by_inv = {iid: [] for iid in inv_ids}

    if inv_ids:
        for payment in (
            Payment.objects.filter(invoice_id__in=inv_ids)
            .only('invoice_id', 'payment_method', 'amount')
            .iterator(chunk_size=200)
        ):
            payments_by_inv[payment.invoice_id].append({
                'payment_method': payment.payment_method,
                'amount': str(payment.amount),
            })

        for item in (
            InvoiceItem.objects.filter(invoice_id__in=inv_ids)
            .select_related('product__tax_rate', 'barcode__purchase_item')
            .only(
                'invoice_id',
                'product_id',
                'product__name',
                'quantity',
                'unit_price',
                'manual_unit_price',
                'discount_amount',
                'tax_amount',
                'line_total',
                'barcode_id',
                'barcode__purchase_item__gst_percent',
                'barcode__purchase_item__gst_inclusive',
                'product__tax_rate_id',
                'product__tax_rate__rate',
            )
            .iterator(chunk_size=200)
        ):
            items_by_inv[item.invoice_id].append({
                'product_name': item.product.name if item.product_id else '',
                'quantity': str(item.quantity),
                'unit_price': str(item.unit_price),
                'manual_unit_price': (
                    str(item.manual_unit_price) if item.manual_unit_price is not None else None
                ),
                'discount_amount': str(item.discount_amount or 0),
                'tax_amount': str(item.tax_amount or 0),
                'line_total': str(item.line_total),
                'tax_bifurcation': _sales_export_item_tax(item),
            })

    results = [
        {
            'created_at': inv.created_at.isoformat() if inv.created_at else None,
            'invoice_number': inv.invoice_number,
            'customer_name': inv.customer.name if inv.customer_id else '',
            'tax_amount': str(inv.tax_amount or 0),
            'total': str(inv.total or 0),
            'due_amount': str(inv.due_amount or 0),
            'payments': payments_by_inv.get(inv.id, []),
            'items': items_by_inv.get(inv.id, []),
        }
        for inv in invoices
    ]

    has_more = offset + len(results) < total_count
    return Response({
        'results': results,
        'page': page,
        'page_size': page_size,
        'total_count': total_count,
        'has_more': has_more,
    })


# ─── stock_inventory_export / stock_sold_export (lean, paginated) ─────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_inventory_export(request):
    """
    Paginated inventory rows for Stock Report Excel/PDF.
    Bulk barcode counts (no per-product N+1). Order: in-stock first, then out-of-stock.
    """
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err

    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)
    store_id, store_err = _parse_export_store_id(request)
    if store_err:
        return store_err
    access_err = _export_store_access_error(request, retailer, store_id, allowed_store_ids)
    if access_err:
        return access_err

    page, page_size = _parse_export_page(request)

    products_qs = Product.objects.filter(
        retailer_id=retailer.id,
        barcodes__isnull=False,
    ).distinct()
    if store_id:
        products_qs = products_qs.filter(barcodes__purchase__store_id=store_id).distinct()
    elif not (request.user.is_superuser or request.user.is_staff):
        products_qs = products_qs.filter(barcodes__purchase__store_id__in=allowed_store_ids).distinct()

    products = list(
        products_qs.select_related('category', 'brand').only(
            'id', 'name', 'sku', 'low_stock_threshold',
            'category_id', 'category__name', 'brand_id', 'brand__name',
        )
    )
    if not products:
        return Response({
            'results': [],
            'page': page,
            'page_size': page_size,
            'total_count': 0,
            'has_more': False,
            'in_stock_count': 0,
            'out_of_stock_count': 0,
        })

    active_carts = _active_cart_barcode_values(retailer.id)

    # Bulk counts for the retailer/store (avoid huge product_id__in lists).
    bc_qs = Barcode.objects.filter(
        retailer_id=retailer.id,
        product_id__isnull=False,
        tag__in=['new', 'returned'],
    ).exclude(purchase__status='draft')
    if store_id:
        bc_qs = bc_qs.filter(purchase__store_id=store_id)
    elif not (request.user.is_superuser or request.user.is_staff):
        bc_qs = bc_qs.filter(purchase__store_id__in=allowed_store_ids)
    if active_carts:
        bc_qs = bc_qs.exclude(barcode__in=active_carts)

    sold_barcode_ids = InvoiceItem.objects.filter(
        barcode_id__isnull=False,
        invoice__retailer_id=retailer.id,
    ).exclude(invoice__status='void').values('barcode_id')
    bc_qs = bc_qs.exclude(id__in=sold_barcode_ids)

    counts = dict(
        bc_qs.values('product_id').annotate(cnt=Count('id')).values_list('product_id', 'cnt')
    )
    cost_qs = Barcode.objects.filter(
        retailer_id=retailer.id,
        product_id__isnull=False,
    ).exclude(purchase__status='draft')
    if store_id:
        cost_qs = cost_qs.filter(purchase__store_id=store_id)
    elif not (request.user.is_superuser or request.user.is_staff):
        cost_qs = cost_qs.filter(purchase__store_id__in=allowed_store_ids)
    costs = dict(
        cost_qs.values('product_id')
        .annotate(cost=Max('purchase_price'))
        .values_list('product_id', 'cost')
    )

    store_name = 'N/A'
    if store_id:
        from backend.locations.models import Store as StoreModel
        store_name = (
            StoreModel.objects.filter(id=store_id, retailer_id=retailer.id)
            .values_list('name', flat=True)
            .first()
        ) or 'N/A'

    in_stock = []
    out_of_stock = []
    for product in products:
        qty = int(counts.get(product.id, 0) or 0)
        threshold = product.low_stock_threshold or 0
        if qty == 0:
            status = 'Out of Stock'
        elif threshold > 0 and qty <= threshold:
            status = 'Low Stock'
        else:
            status = 'In Stock'

        row = {
            'product__id': product.id,
            'product__name': product.name,
            'product__sku': product.sku or 'N/A',
            'product__category__name': product.category.name if product.category_id else None,
            'product__brand__name': product.brand.name if product.brand_id else None,
            'product__low_stock_threshold': threshold,
            'product__cost_price': float(costs.get(product.id) or 0),
            'store__name': store_name,
            'available_quantity': qty,
            'status': status,
        }
        if qty == 0:
            out_of_stock.append(row)
        else:
            in_stock.append(row)

    in_stock.sort(key=lambda x: (-int(x['available_quantity'] or 0), (x['product__name'] or '').lower()))
    out_of_stock.sort(key=lambda x: (x['product__name'] or '').lower())
    all_rows = in_stock + out_of_stock

    total_count = len(all_rows)
    offset = (page - 1) * page_size
    results = all_rows[offset:offset + page_size]
    has_more = offset + len(results) < total_count

    return Response({
        'results': results,
        'page': page,
        'page_size': page_size,
        'total_count': total_count,
        'has_more': has_more,
        'in_stock_count': len(in_stock),
        'out_of_stock_count': len(out_of_stock),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_sold_export(request):
    """Paginated products-sold rows for Stock Report Excel/PDF."""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err

    allowed_store_ids = get_user_allowed_store_ids(request.user, retailer)
    store_id, store_err = _parse_export_store_id(request)
    if store_err:
        return store_err
    access_err = _export_store_access_error(request, retailer, store_id, allowed_store_ids)
    if access_err:
        return access_err

    date_from = _parse_export_date(
        request.query_params.get('date_from'),
        (timezone.now() - timedelta(days=30)).date(),
    )
    date_to = _parse_export_date(request.query_params.get('date_to'), timezone.now().date())
    page, page_size = _parse_export_page(request)

    invoices = Invoice.objects.filter(
        retailer_id=retailer.id,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        status__in=['paid', 'partial'],
    ).exclude(customer__name__iexact='Manish Traders Loss')
    if store_id:
        invoices = invoices.filter(store_id=store_id)
    elif allowed_store_ids is not None and not (request.user.is_superuser or request.user.is_staff):
        invoices = invoices.filter(store_id__in=allowed_store_ids)

    products_qs = (
        InvoiceItem.objects.filter(invoice__in=invoices)
        .values(
            'product__id',
            'product__name',
            'product__sku',
            'product__category__name',
            'product__brand__name',
        )
        .annotate(
            total_quantity=Sum('quantity', output_field=DecimalField()),
            total_revenue=Sum('line_total', output_field=DecimalField()),
            order_count=Count('invoice', distinct=True),
        )
        .order_by('-total_quantity')
    )

    total_count = products_qs.count()
    offset = (page - 1) * page_size
    page_rows = list(products_qs[offset:offset + page_size])

    product_ids = [p['product__id'] for p in page_rows if p['product__id']]
    available_counts = {}
    if product_ids:
        barcode_qs = Barcode.objects.filter(
            product_id__in=product_ids,
            retailer_id=retailer.id,
            tag='new',
            deleted_at__isnull=True,
        )
        if store_id:
            barcode_qs = barcode_qs.filter(current_store_id=store_id)
        available_counts = dict(
            barcode_qs.values('product_id').annotate(cnt=Count('id')).values_list('product_id', 'cnt')
        )

    results = []
    for p in page_rows:
        results.append({
            'product__id': p['product__id'],
            'product__name': p['product__name'],
            'product__sku': p['product__sku'],
            'product__category__name': p['product__category__name'],
            'product__brand__name': p['product__brand__name'],
            'total_quantity': float(p['total_quantity'] or 0),
            'total_revenue': float(p['total_revenue'] or 0),
            'order_count': p['order_count'] or 0,
            'available_quantity': available_counts.get(p['product__id'], 0),
        })

    has_more = offset + len(results) < total_count
    return Response({
        'results': results,
        'page': page,
        'page_size': page_size,
        'total_count': total_count,
        'has_more': has_more,
        'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
    })

