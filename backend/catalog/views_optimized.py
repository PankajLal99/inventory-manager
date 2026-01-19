"""
Optimized product views with Redis caching and query optimization

Key optimizations:
1. Redis caching for expensive queries
2. Database query optimization (select_related, prefetch_related)
3. Reduced N+1 queries
4. Batch processing where possible
5. Early filtering to reduce dataset size
"""
from django.db.models import Q, Count, Prefetch
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from backend.core.cache_utils import (
    get_cached_products_list,
    cache_products_list,
    PRODUCTS_LIST_CACHE_TTL
)
from backend.catalog.models import Product, Barcode
from backend.catalog.serializers import ProductListSerializer
from backend.catalog.filters import ProductFilter
from backend.pos.models import CartItem, InvoiceItem
import logging

logger = logging.getLogger(__name__)


# Public API with decorators for backwards compatibility
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def optimized_product_list(request):
    """
    Public wrapper with decorators
    """
    return _optimized_product_list_internal(request)


def _optimized_product_list_internal(request):
    """
    INTERNAL: Optimized product list logic (no decorators)
    Use the wrapper in urls.py instead of calling this directly.
    
    Optimizations:
    1. Redis caching with 2-minute TTL
    2. Eager loading (select_related, prefetch_related)
    3. Batch queries for stock calculations
    4. Early filtering to reduce dataset
    """
    # Build cache key from query parameters
    filters_dict = {
        'search': request.query_params.get('search', ''),
        'category': request.query_params.get('category', ''),
        'brand': request.query_params.get('brand', ''),
        'supplier': request.query_params.get('supplier', ''),
        'stock_status': request.query_params.get('stock_status', ''),
        'tag': request.query_params.get('tag', 'new'),
        'in_stock': request.query_params.get('in_stock', ''),
        'low_stock': request.query_params.get('low_stock', ''),
        'out_of_stock': request.query_params.get('out_of_stock', ''),
        'page': request.query_params.get('page', 1),
        'limit': request.query_params.get('limit', 50),
    }
    
    # Try cache first (skip if Redis not available)
    try:
        cached_data, cache_key = get_cached_products_list(filters_dict)
        if cached_data:
            logger.info(f"Products list cache HIT (user: {request.user.username})")
            response = Response(cached_data)
            response['X-Cache'] = 'HIT'
            response['Cache-Control'] = 'private, max-age=10, must-revalidate'
            return response
        logger.info(f"Products list cache MISS (user: {request.user.username})")
    except Exception as e:
        logger.warning(f"Cache unavailable, proceeding without cache: {e}")
    
    # OPTIMIZATION 1: Base queryset without barcodes (faster for simple lists)
    queryset = Product.objects.select_related(
        'brand',
        'category',
        'tax_rate',
    )
    
    # OPTIMIZATION 2: Only fetch barcodes when needed
    # Check if we need barcode data based on filters AND frontend request
    search = request.query_params.get('search', None)
    tag = request.query_params.get('tag', None)
    in_stock = request.query_params.get('in_stock', None)
    low_stock = request.query_params.get('low_stock', None)
    out_of_stock = request.query_params.get('out_of_stock', None)
    include_barcodes = request.query_params.get('include_barcodes', 'false')
    
    # Only fetch barcodes when:
    # 1. Tag-based filters require them (defective, returned, sold, in-cart)
    # 2. OR frontend explicitly requests them (include_barcodes=true)
    needs_barcode_prefetch = (
        tag in ['defective', 'returned', 'sold', 'in-cart'] or 
        include_barcodes.lower() == 'true'
    )
    
    if needs_barcode_prefetch:
        # Determine which barcode tags to fetch based on filter
        if tag == 'defective':
            barcode_tags = ['defective']
        elif tag == 'returned':
            barcode_tags = ['returned']
        elif tag == 'sold':
            barcode_tags = ['sold']
        elif tag == 'in-cart':
            barcode_tags = ['in-cart']
        else:
            barcode_tags = ['new', 'returned']  # Fallback
        
        # Only fetch barcodes when tag filters require them
        queryset = queryset.prefetch_related(
            Prefetch(
                'barcodes',
                queryset=Barcode.objects.filter(
                    tag__in=barcode_tags
                ).exclude(
                    purchase__status='draft'
                ).select_related('purchase', 'purchase__supplier'),
                to_attr='available_barcodes'
            )
        ).annotate(
            annotated_barcode_count=Count(
                'barcodes',
                filter=Q(barcodes__tag__in=barcode_tags) & ~Q(barcodes__purchase__status='draft')
            )
        )
        logger.info(f"Fetching barcodes with tags {barcode_tags} (tag filter requires them)")
    else:
        # No barcode prefetch for simple lists, searches, or stock filters
        logger.info(f"Skipping barcode prefetch (not needed for this query type)")
    
    # OPTIMIZATION 3: Apply filters using django-filter early to reduce dataset
    filterset = ProductFilter(request.query_params, queryset=queryset)
    queryset = filterset.qs
    
    # OPTIMIZATION 4: Only do expensive stock filtering when explicitly requested
    # Skip stock calculations for search/tag filters that don't need them
    needs_stock_calculation = (in_stock == 'true' or low_stock == 'true' or out_of_stock == 'true')
    
    if needs_stock_calculation:
        # Get active cart barcodes ONCE
        active_cart_barcodes = set()
        cart_items = CartItem.objects.filter(
            cart__status='active'
        ).exclude(
            scanned_barcodes__isnull=True
        ).exclude(
            scanned_barcodes=[]
        ).only('scanned_barcodes')
        
        for cart_item in cart_items:
            if cart_item.scanned_barcodes:
                active_cart_barcodes.update(cart_item.scanned_barcodes)
        
        # Get all product IDs AFTER other filters are applied (smaller dataset)
        all_product_ids = list(queryset.values_list('id', flat=True))
        
        if not all_product_ids:
            queryset = queryset.none()
        else:
            # Get sold barcode IDs for these specific products
            all_barcode_ids = Barcode.objects.filter(
                product_id__in=all_product_ids,
                tag__in=['new', 'returned']
            ).exclude(
                purchase__status='draft'
            ).values_list('id', flat=True)
            
            sold_barcode_ids = set(
                InvoiceItem.objects.filter(
                    barcode_id__in=all_barcode_ids
                ).exclude(
                    invoice__status='void'
                ).values_list('barcode_id', flat=True)
            )
            
            # BULK query: Get available barcode counts per product in ONE query
            available_barcodes = Barcode.objects.filter(
                product_id__in=all_product_ids,
                tag__in=['new', 'returned']
            ).exclude(
                purchase__status='draft'
            ).exclude(
                id__in=sold_barcode_ids
            )
            
            if active_cart_barcodes:
                available_barcodes = available_barcodes.exclude(
                    barcode__in=active_cart_barcodes
                )
            
            # BULK aggregation: Count barcodes per product in ONE query
            product_barcode_counts = available_barcodes.values('product_id').annotate(
                count=Count('id')
            )
            
            # Create dict mapping product_id -> barcode count
            barcode_count_map = {item['product_id']: item['count'] for item in product_barcode_counts}
            
            # Get products with low_stock_threshold in bulk (ONE query)
            products = Product.objects.filter(id__in=all_product_ids).only('id', 'low_stock_threshold')
            product_threshold_map = {p.id: (p.low_stock_threshold or 0) for p in products}
            
            # Filter products based on stock criteria (in memory, fast)
            product_ids_with_stock = []
            for product_id in all_product_ids:
                available_count = barcode_count_map.get(product_id, 0)
                low_stock_threshold = product_threshold_map.get(product_id, 0)
                
                if in_stock == 'true' and available_count > 0:
                    product_ids_with_stock.append(product_id)
                elif low_stock == 'true' and 0 < available_count <= low_stock_threshold:
                    product_ids_with_stock.append(product_id)
                elif out_of_stock == 'true' and available_count == 0:
                    product_ids_with_stock.append(product_id)
            
            queryset = queryset.filter(id__in=product_ids_with_stock)
    
    # OPTIMIZATION 5: Order and paginate
    queryset = queryset.order_by('-updated_at', '-created_at')
    
    page = int(request.query_params.get('page', 1))
    limit = int(request.query_params.get('limit', 50))
    
    # OPTIMIZATION 6: Only prepare cart context when barcodes were fetched
    if needs_barcode_prefetch:
        # Reuse active cart data if already calculated
        if 'active_cart_barcodes' not in locals():
            active_cart_barcodes = set()
            cart_items = CartItem.objects.filter(
                cart__status='active'
            ).exclude(
                scanned_barcodes__isnull=True
            ).exclude(
                scanned_barcodes=[]
            ).only('scanned_barcodes')
            
            for cart_item in cart_items:
                if cart_item.scanned_barcodes:
                    active_cart_barcodes.update(cart_item.scanned_barcodes)
        
        # Get product quantities in active carts (for non-tracked items)
        active_cart_product_quantities = {}
        for item in CartItem.objects.filter(cart__status='active').select_related('product'):
            if item.product_id:
                current_qty = active_cart_product_quantities.get(item.product_id, 0)
                try:
                    current_qty += float(item.quantity)
                except (ValueError, TypeError):
                    pass
                active_cart_product_quantities[item.product_id] = current_qty
    else:
        # No cart checks needed for simple product list
        active_cart_barcodes = set()
        active_cart_product_quantities = {}
    
    context = {
        'request': request,
        'active_cart_barcodes': active_cart_barcodes,
        'active_cart_product_quantities': active_cart_product_quantities
    }
    
    # OPTIMIZATION: Manual pagination (faster than Paginator for large datasets)
    offset = (page - 1) * limit
    
    # Slice queryset for current page only
    page_queryset = queryset[offset:offset + limit + 1]  # +1 to check if there's a next page
    page_results = list(page_queryset)
    
    has_next = len(page_results) > limit
    if has_next:
        page_results = page_results[:limit]  # Remove the extra item
    
    has_previous = page > 1
    
    # Serialize only the current page
    serializer = ProductListSerializer(page_results, many=True, context=context)
    
    # OPTIMIZATION: Avoid expensive COUNT(*) query
    # Estimate total count based on pagination (faster for UI)
    if has_next:
        # There are more pages, so count is at least (current page * limit + 1)
        estimated_count = page * limit + 1
    else:
        # Last page, exact count
        estimated_count = offset + len(page_results)
    
    # Build response
    response_data = {
        'results': serializer.data,
        'count': estimated_count,  # Estimated (fast) instead of exact (slow)
        'next': page + 1 if has_next else None,
        'previous': page - 1 if has_previous else None,
        'page': page,
        'page_size': limit,
    }
    
    # Cache the response (skip if Redis not available)
    try:
        cache_products_list(cache_key, response_data, PRODUCTS_LIST_CACHE_TTL)
    except Exception as e:
        logger.warning(f"Unable to cache response: {e}")
    
    response = Response(response_data)
    response['X-Cache'] = 'MISS'
    response['Cache-Control'] = 'private, max-age=10, must-revalidate'  # Reduced cache time
    
    # Add timestamp for cache busting
    from django.utils import timezone
    response['X-Data-Version'] = timezone.now().isoformat()
    
    logger.info(f"Products list query completed")
    
    return response
