import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, Count, Avg, Max, DecimalField, IntegerField, Exists, OuterRef, Subquery, Value
from django.db.models.functions import TruncDate, TruncMonth, Coalesce
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

        sid = None
        if store_id:
            try:
                sid = int(store_id)
            except (TypeError, ValueError):
                return Response({'detail': 'Invalid store filter.'}, status=status.HTTP_400_BAD_REQUEST)
            if sid not in allowed_store_ids:
                return Response({'detail': 'Store access denied.'}, status=status.HTTP_403_FORBIDDEN)

        product_ids = _purchased_product_ids(retailer.id, sid, allowed_store_ids, request.user)
        total_products = len(product_ids)

        total_quantity_count = Barcode.objects.filter(
            retailer_id=retailer.id,
            tag__in=['new', 'returned'],
            product_id__in=product_ids,
            deleted_at__isnull=True,
        ).exclude(
            purchase__status='draft',
        ).filter(
            purchase__deleted_at__isnull=True,
        )
        total_quantity_count = _apply_store_scope_to_barcode_qs(
            total_quantity_count, sid, allowed_store_ids, request.user,
        ).count()

        active_carts_barcodes = _active_cart_barcode_values(retailer.id)
        counts = _bulk_available_barcode_counts(
            retailer.id, sid, allowed_store_ids, request.user, active_carts_barcodes,
        )
        total_available = sum(int(v or 0) for v in counts.values())
        total_reserved = len(active_carts_barcodes)

        thresholds = dict(
            Product.objects.filter(id__in=product_ids, retailer_id=retailer.id)
            .values_list('id', 'low_stock_threshold')
        ) if product_ids else {}

        low_stock_count = 0
        out_of_stock_count = 0
        for pid in product_ids:
            available_count = int(counts.get(pid, 0) or 0)
            if available_count == 0:
                out_of_stock_count += 1
            else:
                threshold = thresholds.get(pid) or 0
                if threshold > 0 and available_count <= threshold:
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
    
    sid = None
    if store_id:
        try:
            sid = int(store_id)
        except (TypeError, ValueError):
            return Response({'detail': 'Invalid store filter.'}, status=status.HTTP_400_BAD_REQUEST)
        if sid not in allowed_store_ids:
            return Response({'detail': 'Store access denied.'}, status=status.HTTP_403_FORBIDDEN)

    product_ids = _purchased_product_ids(retailer.id, sid, allowed_store_ids, request.user)
    if not product_ids:
        return Response({
            'in_stock': [],
            'out_of_stock': [],
            'low_stock': [],
            'products_needing_order': [],
        })

    active_carts_barcodes = _active_cart_barcode_values(retailer.id)
    counts = _bulk_available_barcode_counts(
        retailer.id, sid, allowed_store_ids, request.user, active_carts_barcodes,
    )
    costs = _bulk_product_max_costs(retailer.id, sid, allowed_store_ids, request.user, product_ids)
    store_name = _store_display_name(retailer.id, sid)

    product_rows = list(
        Product.objects.filter(id__in=product_ids, retailer_id=retailer.id)
        .values('id', 'name', 'sku', 'low_stock_threshold', 'category__name', 'brand__name')
    )

    in_stock = []
    out_of_stock = []
    low_stock = []
    products_needing_order = []

    for p in product_rows:
        available_count = int(counts.get(p['id'], 0) or 0)
        low_stock_threshold = p['low_stock_threshold'] or 0
        unit_cost = float(costs.get(p['id']) or 0)
        product_data = {
            'product__id': p['id'],
            'product__name': p['name'],
            'product__sku': p['sku'] or 'N/A',
            'product__category__name': p['category__name'],
            'product__brand__name': p['brand__name'],
            'product__low_stock_threshold': low_stock_threshold,
            'product__unit_cost': unit_cost,
            'product__cost_price': _product_stock_value(unit_cost, available_count),
            'store__name': store_name,
            'available_quantity': available_count,
        }

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


# ─── Stock / barcode helpers (bulk counts — avoid per-product N+1) ───────────

def _is_staff_user(user):
    return user.is_superuser or user.is_staff


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


def _apply_store_scope_to_barcode_qs(qs, store_id, allowed_store_ids, user):
    if store_id:
        return qs.filter(purchase__store_id=store_id)
    if allowed_store_ids is not None and not _is_staff_user(user):
        return qs.filter(purchase__store_id__in=allowed_store_ids)
    return qs


def _purchased_product_ids(retailer_id, store_id, allowed_store_ids, user):
    qs = Barcode.objects.filter(
        retailer_id=retailer_id,
        product_id__isnull=False,
        deleted_at__isnull=True,
    ).exclude(
        purchase__status='draft',
    ).filter(
        purchase__deleted_at__isnull=True,
    )
    qs = _apply_store_scope_to_barcode_qs(qs, store_id, allowed_store_ids, user)
    return list(qs.values_list('product_id', flat=True).distinct())


def _bulk_available_barcode_counts(retailer_id, store_id, allowed_store_ids, user, active_carts=None):
    """
    Available = new/returned barcodes, not draft purchase, not sold (invoice line),
    not reserved in an active cart. One aggregate query via EXISTS (not global NOT IN).
    """
    if active_carts is None:
        active_carts = _active_cart_barcode_values(retailer_id)

    sold_exists = InvoiceItem.objects.filter(
        barcode_id=OuterRef('pk'),
        invoice__retailer_id=retailer_id,
    ).exclude(invoice__status='void')

    bc_qs = Barcode.objects.filter(
        retailer_id=retailer_id,
        product_id__isnull=False,
        tag__in=['new', 'returned'],
        deleted_at__isnull=True,
    ).exclude(
        purchase__status='draft',
    ).filter(
        purchase__deleted_at__isnull=True,
    )
    bc_qs = _apply_store_scope_to_barcode_qs(bc_qs, store_id, allowed_store_ids, user)
    bc_qs = bc_qs.annotate(_sold=Exists(sold_exists)).filter(_sold=False)

    if active_carts:
        bc_qs = bc_qs.exclude(barcode__in=active_carts)

    return dict(
        bc_qs.values('product_id').annotate(cnt=Count('id')).values_list('product_id', 'cnt')
    )


def _bulk_product_max_costs(retailer_id, store_id, allowed_store_ids, user, product_ids):
    """
    Cost (Rs.) per product for stock reports.

    Resolution order (first non-null wins):
      1. Latest PurchaseItem.unit_price for the product (purchasing — primary source)
      2. Latest barcode-linked purchase_item.unit_price (catalog / POS barcode path)
      3. Max PurchaseItem.unit_price across all purchases (legacy rows missing links)

    InvoiceItem.purchase_price / CartItem.purchase_price are sale-time overrides for
    custom 'Other -' lines only — not used for purchased inventory stock valuation.
    """
    if not product_ids:
        return {}
    from backend.purchasing.models import PurchaseItem

    pi_base = PurchaseItem.objects.filter(
        product_id=OuterRef('id'),
        purchase__retailer_id=retailer_id,
        purchase__deleted_at__isnull=True,
    ).exclude(purchase__status='draft')

    latest_pi = pi_base.order_by('-purchase__created_at', '-purchase_id', '-id').values('unit_price')[:1]

    bc_base = Barcode.objects.filter(
        product_id=OuterRef('id'),
        retailer_id=retailer_id,
        purchase_item_id__isnull=False,
        deleted_at__isnull=True,
    ).exclude(purchase__status='draft').filter(purchase__deleted_at__isnull=True)

    latest_bc = bc_base.order_by('-purchase__created_at').values('purchase_item__unit_price')[:1]

    rows = Product.objects.filter(
        id__in=product_ids,
        retailer_id=retailer_id,
    ).annotate(
        cost=Coalesce(
            Subquery(latest_pi, output_field=DecimalField()),
            Subquery(latest_bc, output_field=DecimalField()),
            Value(Decimal('0.00')),
            output_field=DecimalField(),
        ),
    ).values_list('id', 'cost')

    costs = {pid: float(cost or 0) for pid, cost in rows}

    missing = [pid for pid in product_ids if costs.get(pid, 0) == 0]
    if missing:
        max_pi_qs = PurchaseItem.objects.filter(
            product_id__in=missing,
            purchase__retailer_id=retailer_id,
            purchase__deleted_at__isnull=True,
        ).exclude(purchase__status='draft')
        for pid, cost in max_pi_qs.values('product_id').annotate(
            cost=Max('unit_price'),
        ).values_list('product_id', 'cost'):
            if cost:
                costs[pid] = float(cost)

    return costs


def _product_stock_value(unit_cost, quantity):
    """Total worth of on-hand stock = available qty × unit purchase cost."""
    return float(unit_cost or 0) * int(quantity or 0)


def _store_display_name(retailer_id, store_id):
    if not store_id:
        return 'N/A'
    from backend.locations.models import Store as StoreModel
    return (
        StoreModel.objects.filter(id=store_id, retailer_id=retailer_id)
        .values_list('name', flat=True)
        .first()
    ) or 'N/A'


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

    product_ids = _purchased_product_ids(retailer.id, store_id, allowed_store_ids, request.user)
    if not product_ids:
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
    counts = _bulk_available_barcode_counts(
        retailer.id, store_id, allowed_store_ids, request.user, active_carts,
    )
    store_name = _store_display_name(retailer.id, store_id)

    product_rows = list(
        Product.objects.filter(id__in=product_ids, retailer_id=retailer.id)
        .values('id', 'name', 'sku', 'low_stock_threshold', 'category__name', 'brand__name')
    )

    in_stock_keys = []
    out_of_stock_keys = []
    for p in product_rows:
        pid = p['id']
        qty = int(counts.get(pid, 0) or 0)
        name_key = (p['name'] or '').lower()
        if qty > 0:
            in_stock_keys.append((pid, qty, name_key))
        else:
            out_of_stock_keys.append((pid, name_key))

    in_stock_keys.sort(key=lambda x: (-x[1], x[2]))
    out_of_stock_keys.sort(key=lambda x: x[1])
    ordered_ids = [x[0] for x in in_stock_keys] + [x[0] for x in out_of_stock_keys]

    total_count = len(ordered_ids)
    offset = (page - 1) * page_size
    page_ids = ordered_ids[offset:offset + page_size]
    product_by_id = {p['id']: p for p in product_rows}
    costs = _bulk_product_max_costs(
        retailer.id, store_id, allowed_store_ids, request.user, page_ids,
    )

    results = []
    for pid in page_ids:
        p = product_by_id[pid]
        qty = int(counts.get(pid, 0) or 0)
        threshold = p['low_stock_threshold'] or 0
        if qty == 0:
            row_status = 'Out of Stock'
        elif threshold > 0 and qty <= threshold:
            row_status = 'Low Stock'
        else:
            row_status = 'In Stock'

        unit_cost = float(costs.get(pid) or 0)

        results.append({
            'product__id': pid,
            'product__name': p['name'],
            'product__sku': p['sku'] or 'N/A',
            'product__category__name': p['category__name'],
            'product__brand__name': p['brand__name'],
            'product__low_stock_threshold': threshold,
            'product__unit_cost': unit_cost,
            'product__cost_price': _product_stock_value(unit_cost, qty),
            'store__name': store_name,
            'available_quantity': qty,
            'status': row_status,
        })

    has_more = offset + len(results) < total_count

    return Response({
        'results': results,
        'page': page,
        'page_size': page_size,
        'total_count': total_count,
        'has_more': has_more,
        'in_stock_count': len(in_stock_keys),
        'out_of_stock_count': len(out_of_stock_keys),
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

