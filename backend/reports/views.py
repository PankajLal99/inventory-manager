import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, Count, Avg, Q, F, DecimalField, ExpressionWrapper
from django.db.models.functions import TruncDate, TruncMonth, TruncYear
from django.utils import timezone
from datetime import datetime, timedelta
from decimal import Decimal

from backend.pos.models import Invoice, InvoiceItem, Payment, CartItem
from backend.catalog.models import Product, Barcode
from backend.inventory.models import Stock
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
    """Stock ordering report - low stock and out of stock products (barcode-based)"""
    store_id = request.query_params.get('store', None)
    
    # Only include products that have been purchased (have barcodes)
    products_with_barcodes = Product.objects.filter(
        barcodes__isnull=False
    ).distinct()
    
    # Filter by store if provided (through purchase relationship)
    if store_id:
        products_with_barcodes = products_with_barcodes.filter(
            barcodes__purchase__store_id=store_id
        ).distinct()
    
    # Get barcodes in active carts (reserved)
    active_carts_barcodes = set()
    cart_items = CartItem.objects.filter(
        cart__status='active'
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
                store = Store.objects.get(id=store_id)
                store_name = store.name
            except Store.DoesNotExist:
                pass
        
        # Count available barcodes for this product (new + returned, not in carts, not sold, not from draft purchases)
        product_barcodes = Barcode.objects.filter(
            product=product,
            tag__in=['new', 'returned']
        ).exclude(
            purchase__status='draft'
        )
        
        # Filter by store if provided
        if store_id:
            product_barcodes = product_barcodes.filter(purchase__store_id=store_id)
        
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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_kpis(request):
    """Dashboard KPIs with date range support"""
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
    
    # Base invoice queryset for the date range
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    invoices = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to
    ).exclude(status='void').exclude(customer__name__iexact='Manish Traders Loss')
    
    if store_id:
        invoices = invoices.filter(store_id=store_id)
    
    # Get invoice items for the period
    invoice_items = InvoiceItem.objects.filter(invoice__in=invoices)
    
    # Get payments for invoices in the date range (filter by payment date, not invoice date)
    # Exclude payments from Manish Traders Loss customer (internal shop usage, not actual sales)
    payments = Payment.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to
    )
    
    if store_id:
        # Filter payments by invoice store
        payments = payments.filter(invoice__store_id=store_id)
    
    # Exclude payments from void invoices and Manish Traders Loss customer
    payments = payments.exclude(invoice__status='void').exclude(invoice__customer__name__iexact='Manish Traders Loss')
    
    # 1. Total Cash - Sum of all cash payments in the date range
    total_cash = payments.filter(payment_method='cash').aggregate(
        total=Sum('amount', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    # 2. Total Online (UPI) - Sum of all UPI payments in the date range
    total_online = payments.filter(payment_method='upi').aggregate(
        total=Sum('amount', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    # 3. Total Expenses - Default 0 (coming soon)
    total_expenses = Decimal('0.00')
    
    # 4. Total Inhand - Cash only (not including UPI)
    total_inhand = total_cash
    
    # 5. Repairing Profit - Sales from Repair stores minus purchase price
    repair_invoices = invoices.filter(
        store__shop_type='repair',
        status__in=['paid', 'partial']
    )
    repair_items = InvoiceItem.objects.filter(invoice__in=repair_invoices)
    
    repairing_profit = Decimal('0.00')
    for item in repair_items.select_related('barcode', 'invoice__store'):
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        # Get purchase price from barcode
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            # Try to get from first barcode of product
            first_barcode = Barcode.objects.filter(
                product=item.product,
                tag__in=['new', 'returned']
            ).exclude(purchase__status='draft').first()
            if first_barcode:
                purchase_price = first_barcode.get_purchase_price()
        
        profit = (sale_price - purchase_price) * item.quantity
        repairing_profit += profit
    
    # 6. Counter Profit (Retail Profit) - Sales from Retail stores minus purchase price
    retail_invoices = invoices.filter(
        store__shop_type='retail',
        status__in=['paid', 'partial']
    )
    retail_items = InvoiceItem.objects.filter(invoice__in=retail_invoices)
    
    counter_profit = Decimal('0.00')
    for item in retail_items.select_related('barcode', 'invoice__store'):
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        # Get purchase price from barcode
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            # Try to get from first barcode of product
            first_barcode = Barcode.objects.filter(
                product=item.product,
                tag__in=['new', 'returned']
            ).exclude(purchase__status='draft').first()
            if first_barcode:
                purchase_price = first_barcode.get_purchase_price()
        
        profit = (sale_price - purchase_price) * item.quantity
        counter_profit += profit
    
    # 7. Pending Profit - Profit from credit invoices (selling price - purchase price)
    # Get all credit invoices (not filtered by date range - all credit invoices)
    # Include invoices with status='credit' OR invoice_type='pending'
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    credit_invoices = Invoice.objects.filter(
        Q(status='credit') | Q(invoice_type='pending')
    ).exclude(status='void').exclude(customer__name__iexact='Manish Traders Loss')
    
    if store_id:
        credit_invoices = credit_invoices.filter(store_id=store_id)
    
    credit_items = InvoiceItem.objects.filter(invoice__in=credit_invoices)
    
    pending_profit = Decimal('0.00')
    for item in credit_items.select_related('barcode', 'product'):
        # Get selling price from invoice item
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        # Get purchase price from barcode if available
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            # Try to get purchase price from purchase item
            # First try to get from barcode linked to purchase item
            purchase_item_barcode = Barcode.objects.filter(
                product=item.product,
                purchase_item__isnull=False
            ).exclude(purchase__status='draft').first()
            
            if purchase_item_barcode and purchase_item_barcode.purchase_item:
                # Get purchase price from purchase item (unit_price is the purchase price)
                purchase_price = purchase_item_barcode.purchase_item.unit_price or Decimal('0.00')
            else:
                # Fallback: get from first available barcode
                first_barcode = Barcode.objects.filter(
                    product=item.product,
                    tag__in=['new', 'returned']
                ).exclude(purchase__status='draft').first()
                if first_barcode:
                    purchase_price = first_barcode.get_purchase_price()
        
        profit = (sale_price - purchase_price) * item.quantity
        pending_profit += profit
    
    # 8. Overall Profit - Counter Profit + Repairing Profit
    overall_profit = counter_profit + repairing_profit
    
    # 9. Monthly Profit - Profit for custom month period (10th to 10th)
    # Custom month: from 10th of one month to 10th of next month
    now = timezone.now()
    current_day = now.day
    
    if current_day < 10:
        # Before 10th: use previous month's 10th to current month's 10th
        if now.month == 1:
            # January: use December 10 to January 10
            monthly_start = now.replace(month=12, day=10, year=now.year-1, hour=0, minute=0, second=0, microsecond=0)
        else:
            monthly_start = now.replace(month=now.month-1, day=10, hour=0, minute=0, second=0, microsecond=0)
        monthly_end = now.replace(day=10, hour=23, minute=59, second=59, microsecond=999999)
    else:
        # On or after 10th: use current month's 10th to next month's 10th
        monthly_start = now.replace(day=10, hour=0, minute=0, second=0, microsecond=0)
        if now.month == 12:
            # December: use December 10 to January 10 of next year
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
    
    monthly_items = InvoiceItem.objects.filter(invoice__in=monthly_invoices)
    monthly_profit = Decimal('0.00')
    for item in monthly_items.select_related('barcode'):
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        # Get purchase price from barcode
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            # Try to get from first barcode of product
            first_barcode = Barcode.objects.filter(
                product=item.product,
                tag__in=['new', 'returned']
            ).exclude(purchase__status='draft').first()
            if first_barcode:
                purchase_price = first_barcode.get_purchase_price()
        
        profit = (sale_price - purchase_price) * item.quantity
        monthly_profit += profit
    
    # 10. Total Stock - Count of barcodes with 'new' and 'returned' tags
    stock_barcodes = Barcode.objects.filter(tag__in=['new', 'returned'])
    if store_id:
        stock_barcodes = stock_barcodes.filter(purchase__store_id=store_id)
    stock_barcodes = stock_barcodes.exclude(purchase__status='draft')
    
    # Exclude sold barcodes
    sold_barcode_ids = InvoiceItem.objects.filter(
        barcode__in=stock_barcodes.values_list('id', flat=True)
    ).exclude(invoice__status='void').values_list('barcode_id', flat=True)
    
    total_stock = stock_barcodes.exclude(id__in=sold_barcode_ids).count()
    
    # 11. Total Stock Value - Purchase price value of barcodes
    available_barcodes = stock_barcodes.exclude(id__in=sold_barcode_ids)
    total_stock_value = Decimal('0.00')
    for barcode in available_barcodes:
        total_stock_value += barcode.get_purchase_price()
    
    # 12. Pending Invoices - Total amount of credit type invoices
    # Get all credit invoices (not filtered by date range - all credit invoices)
    # Include invoices with status='credit' OR invoice_type='pending'
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    all_credit_invoices = Invoice.objects.filter(
        Q(status='credit') | Q(invoice_type='pending')
    ).exclude(status='void').exclude(customer__name__iexact='Manish Traders Loss')
    
    if store_id:
        all_credit_invoices = all_credit_invoices.filter(store_id=store_id)
    
    pending_invoices_count = all_credit_invoices.count()
    pending_invoices_total = all_credit_invoices.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    # 13. Total Amount of Replacement - Default (Coming Soon)
    total_replacement = Decimal('0.00')
    
    # Calculate yesterday's date for comparison
    yesterday = date_from - timedelta(days=1)
    
    # 14. Loss Calculations - Total from Manish Traders Loss invoices (items used in shop, not sold)
    # Today's Loss - Loss for today only
    # Include all statuses except void
    # Use icontains for more flexible name matching in case of variations
    today = timezone.now().date()
    todays_loss_invoices = Invoice.objects.filter(
        created_at__date=today,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(status='void')
    
    if store_id:
        todays_loss_invoices = todays_loss_invoices.filter(store_id=store_id)
    
    todays_loss = todays_loss_invoices.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    # Monthly Loss - Loss for custom month period (10th to 10th, same as monthly profit)
    now = timezone.now()
    current_day = now.day
    
    if current_day < 10:
        # Before 10th: use previous month's 10th to current month's 10th
        if now.month == 1:
            # January: use December 10 to January 10
            monthly_loss_start = now.replace(month=12, day=10, year=now.year-1, hour=0, minute=0, second=0, microsecond=0)
        else:
            monthly_loss_start = now.replace(month=now.month-1, day=10, hour=0, minute=0, second=0, microsecond=0)
        monthly_loss_end = now.replace(day=10, hour=23, minute=59, second=59, microsecond=999999)
    else:
        # On or after 10th: use current month's 10th to next month's 10th
        monthly_loss_start = now.replace(day=10, hour=0, minute=0, second=0, microsecond=0)
        if now.month == 12:
            # December: use December 10 to January 10 of next year
            monthly_loss_end = now.replace(month=1, day=10, year=now.year+1, hour=23, minute=59, second=59, microsecond=999999)
        else:
            monthly_loss_end = now.replace(month=now.month+1, day=10, hour=23, minute=59, second=59, microsecond=999999)
    
    monthly_loss_invoices = Invoice.objects.filter(
        created_at__gte=monthly_loss_start,
        created_at__lte=monthly_loss_end,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(status='void')
    
    if store_id:
        monthly_loss_invoices = monthly_loss_invoices.filter(store_id=store_id)
    
    monthly_loss = monthly_loss_invoices.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    # Total Loss - Loss for the selected date range
    # Include all statuses except void (draft, paid, partial, credit, etc.)
    # Use icontains for more flexible name matching in case of variations
    total_loss_invoices = Invoice.objects.filter(
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        customer__name__icontains='Manish Traders Loss'
    ).exclude(status='void')
    
    if store_id:
        total_loss_invoices = total_loss_invoices.filter(store_id=store_id)
    
    total_loss = total_loss_invoices.aggregate(
        total=Sum('total', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    # Debug logging
    logger.info(f"Total Loss calculation: date_from={date_from}, date_to={date_to}, "
                f"invoice_count={total_loss_invoices.count()}, total_loss={total_loss}")
    
    # Calculate yesterday's metrics for comparison
    # Exclude Manish Traders Loss customer (internal shop usage, not actual sales)
    yesterday_invoices = Invoice.objects.filter(
        created_at__date=yesterday
    ).exclude(status='void').exclude(customer__name__iexact='Manish Traders Loss')
    
    if store_id:
        yesterday_invoices = yesterday_invoices.filter(store_id=store_id)
    
    # Get yesterday's payments (filter by payment date)
    # Exclude payments from Manish Traders Loss customer (internal shop usage, not actual sales)
    yesterday_payments = Payment.objects.filter(
        created_at__date=yesterday
    ).exclude(invoice__status='void').exclude(invoice__customer__name__iexact='Manish Traders Loss')
    
    if store_id:
        yesterday_payments = yesterday_payments.filter(invoice__store_id=store_id)
    
    yesterday_cash = yesterday_payments.filter(payment_method='cash').aggregate(
        total=Sum('amount', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    yesterday_online = yesterday_payments.filter(payment_method='upi').aggregate(
        total=Sum('amount', output_field=DecimalField())
    )['total'] or Decimal('0.00')
    
    # Yesterday Total Inhand - Cash only (not including UPI)
    yesterday_inhand = yesterday_cash
    
    # Yesterday profit
    yesterday_items = InvoiceItem.objects.filter(
        invoice__in=yesterday_invoices.filter(status__in=['paid', 'partial'])
    )
    yesterday_profit = Decimal('0.00')
    for item in yesterday_items.select_related('barcode'):
        sale_price = item.manual_unit_price or item.unit_price or Decimal('0.00')
        purchase_price = Decimal('0.00')
        
        if item.barcode:
            purchase_price = item.barcode.get_purchase_price()
        elif item.product:
            first_barcode = Barcode.objects.filter(
                product=item.product,
                tag__in=['new', 'returned']
            ).exclude(purchase__status='draft').first()
            if first_barcode:
                purchase_price = first_barcode.get_purchase_price()
        
        profit = (sale_price - purchase_price) * item.quantity
        yesterday_profit += profit
    
    response = Response({
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
            'repairing_profit': float(repairing_profit),
            'counter_profit': float(counter_profit),
            'pending_profit': float(pending_profit),
            'overall_profit': float(overall_profit),
            'monthly_profit': float(monthly_profit),
            'total_stock': total_stock,
            'total_stock_value': float(total_stock_value),
            'pending_invoices_count': pending_invoices_count,
            'pending_invoices_total': float(pending_invoices_total),
            'total_replacement': float(total_replacement),
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
    })
    # Add cache headers for browser-level caching
    # Use private cache since this is authenticated content
    # Max-age of 1 minute for dashboard KPIs (they change frequently with new transactions)
    response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
    return response
