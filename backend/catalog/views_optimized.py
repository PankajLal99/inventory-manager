"""
Optimized product views with Redis caching and query optimization

Key optimizations:
1. Redis caching for expensive queries
2. Database query optimization (select_related, prefetch_related)
3. Reduced N+1 queries
4. Batch processing where possible
5. Early filtering to reduce dataset size
"""
from django.db.models import Count, Prefetch, Sum
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from backend.core.cache_utils import (
    get_cached_products_list,
    cache_products_list,
    make_cache_key,
    PRODUCTS_LIST_CACHE_TTL,
)
from backend.catalog.models import Product, Barcode, DefectiveProductItem
from backend.catalog.serializers import ProductListSerializer
from backend.catalog.filters import ProductFilter
from backend.pos.models import CartItem, InvoiceItem
import logging

logger = logging.getLogger(__name__)


def _attach_page_barcode_counts(page_results, barcode_tags):
    """Count barcodes only for the current page.

    Annotating Count(distinct barcodes) on the full product queryset forces a
    GROUP BY across every matching product before LIMIT, which is what made the
    Products page feel stuck on first load.
    """
    if not page_results:
        return
    page_ids = [product.id for product in page_results if getattr(product, 'id', None)]
    if not page_ids:
        return
    counts = {
        row['product_id']: row['c']
        for row in Barcode.objects.filter(
            product_id__in=page_ids,
            tag__in=barcode_tags,
        ).exclude(
            purchase__status='draft'
        ).filter(
            purchase__deleted_at__isnull=True
        ).values('product_id').annotate(c=Count('id'))
    }
    for product in page_results:
        product.annotated_barcode_count = counts.get(product.id, 0)


# Public API with decorators for backwards compatibility


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
        'search_mode': request.query_params.get('search_mode', ''),
        'category': request.query_params.get('category', ''),
        'brand': request.query_params.get('brand', ''),
        'supplier': request.query_params.get('supplier', ''),
        'stock_status': request.query_params.get('stock_status', ''),
        'tag': request.query_params.get('tag', 'new'),
        'in_stock': request.query_params.get('in_stock', ''),
        'low_stock': request.query_params.get('low_stock', ''),
        'out_of_stock': request.query_params.get('out_of_stock', ''),
        'exclude_other_custom': request.query_params.get('exclude_other_custom', ''),
        'warehouse_qty_gt_zero': request.query_params.get('warehouse_qty_gt_zero', ''),
        'page': request.query_params.get('page', 1),
        'limit': request.query_params.get('limit', 50),
        'lite': request.query_params.get('lite', ''),
        'include_barcodes': request.query_params.get('include_barcodes', ''),
        'include_prices': request.query_params.get('include_prices', ''),
    }
    
    # Try cache first (skip if Redis not available)
    try:
        cached_data, cache_key = get_cached_products_list(filters_dict)
        if cached_data:
            logger.info(f"Products list cache HIT (user: {request.user.username})")
            response = Response(cached_data)
            response['X-Cache'] = 'HIT'
            response['Cache-Control'] = 'private, max-age=0, must-revalidate'
            return response
        logger.info(f"Products list cache MISS (user: {request.user.username})")
    except Exception as e:
        logger.warning(f"Cache unavailable, proceeding without cache: {e}")
        cache_key = make_cache_key("products_list", **filters_dict)

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
    is_lite = str(request.query_params.get('lite', '')).lower() in ('true', '1', 'yes')
    
    # Determine which barcode tags to count/fetch based on filter
    tag_to_barcode_tags = {
        'defective': ['defective'],
        'returned': ['returned'],
        'sold': ['sold'],
        'in-cart': ['in-cart'],
        'unknown': ['unknown'],
        'new': ['new', 'returned'],
    }
    barcode_tags = tag_to_barcode_tags.get(tag, ['new', 'returned'])

    # Tags that need individual barcode objects in the list response
    # 'sold' excluded: list only needs aggregate count; View SKU modal fetches details
    # Fresh/new list does not serialize barcodes; skip prefetch unless lite is off
    # and bifurcation fields need them (POS/search).
    needs_barcode_details = (
        tag in ['defective', 'returned', 'in-cart', 'unknown'] or
        include_barcodes.lower() == 'true'
    )
    # Lite lists never prefetch barcodes on the full queryset. Defective/returned
    # rows are attached after pagination as compact dicts.
    needs_barcode_prefetch = (not is_lite) and (
        needs_barcode_details or tag in ['new', None, '']
    )

    if needs_barcode_prefetch:
        barcode_qs = Barcode.objects.filter(
            tag__in=barcode_tags
        ).exclude(
            purchase__status='draft'
        ).filter(
            purchase__deleted_at__isnull=True
        ).select_related('purchase', 'purchase__supplier',
                         'purchase_item', 'purchase_item__purchase',
                         'purchase_item__purchase__supplier')

        queryset = queryset.prefetch_related(
            Prefetch('barcodes', queryset=barcode_qs)
        )
        logger.info(f"Fetching barcodes with tags {barcode_tags} (tag filter requires them)")
    else:
        logger.info(f"Skipping barcode prefetch for tag '{tag}'")
    
    # OPTIMIZATION 3: Apply filters using django-filter early to reduce dataset
    filterset = ProductFilter(request.query_params, queryset=queryset)
    queryset = filterset.qs
    
    # Exclude Other/Custom products (name starts with "Other -") when requested (e.g. Purchases, Products pages)
    if request.query_params.get('exclude_other_custom') in ('true', '1', 'yes'):
        queryset = queryset.exclude(name__startswith='Other -')
    
    # Filter: only products that have at least one PurchaseItem with warehouse_quantity > 0 (finalized purchases)
    if request.query_params.get('warehouse_qty_gt_zero') in ('true', '1', 'yes'):
        from backend.purchasing.models import PurchaseItem
        product_ids_with_wh = set(
            PurchaseItem.objects.filter(
                purchase__status='finalized',
                purchase__deleted_at__isnull=True,
                warehouse_quantity__gt=0
            ).values_list('product_id', flat=True).distinct()
        )
        queryset = queryset.filter(id__in=product_ids_with_wh)
    
    # OPTIMIZATION 4: Only do expensive stock filtering when explicitly requested
    # Skip stock calculations for search/tag filters that don't need them
    needs_stock_calculation = (in_stock == 'true' or low_stock == 'true' or out_of_stock == 'true')

    # Build active-cart context ONCE and reuse for stock filtering + serializer context.
    active_cart_barcodes = set()
    active_cart_product_quantities = {}
    if needs_stock_calculation or (needs_barcode_prefetch and not is_lite):
        cart_rows = CartItem.objects.filter(cart__status='active').values_list(
            'scanned_barcodes', 'product_id', 'quantity'
        )
        for scanned_barcodes, product_id, quantity in cart_rows:
            if scanned_barcodes:
                active_cart_barcodes.update(scanned_barcodes)
            if product_id:
                try:
                    active_cart_product_quantities[product_id] = (
                        active_cart_product_quantities.get(product_id, 0) + float(quantity)
                    )
                except (ValueError, TypeError):
                    pass

    if needs_stock_calculation:
        
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
            ).filter(
                purchase__deleted_at__isnull=True
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
            ).filter(
                purchase__deleted_at__isnull=True
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

    page = int(request.query_params.get('page', 1))
    limit = int(request.query_params.get('limit', 50))
    offset = (page - 1) * limit
    search_mode = (request.query_params.get('search_mode') or '').strip().lower()
    search_q = (search or '').strip() if search else ''
    use_name_relevance = bool(search_q and search_mode == 'name_only')

    # OPTIMIZATION 5: Order and paginate (name_only search shares global-search relevance ranking)
    if use_name_relevance:
        from django.db.models import Case, IntegerField, Value, When

        from backend.catalog.product_name_relevance import order_product_ids_by_name_relevance

        candidate_cap = min(2000, max(limit * 10, 200, offset + limit + 1))
        pairs = list(queryset.values('id', 'name')[:candidate_cap])
        ordered_ids = order_product_ids_by_name_relevance(pairs, search_q, len(pairs))
        page_slice = ordered_ids[offset : offset + limit + 1]
        has_next = len(page_slice) > limit
        if has_next:
            page_slice = page_slice[:limit]

        if page_slice:
            order_case = Case(
                *[When(pk=pid, then=Value(idx)) for idx, pid in enumerate(page_slice)],
                output_field=IntegerField(),
            )
            page_results = list(
                queryset.filter(pk__in=page_slice)
                .annotate(_name_relevance_rank=order_case)
                .order_by('_name_relevance_rank')
            )
        else:
            page_results = []

        has_previous = page > 1
        if len(pairs) < candidate_cap:
            estimated_count = len(ordered_ids)
        else:
            try:
                estimated_count = queryset.count()
            except Exception:
                estimated_count = offset + len(page_results) + (1 if has_next else 0)
    else:
        queryset = queryset.order_by('-updated_at', '-created_at')
        page_queryset = queryset[offset : offset + limit + 1]
        page_results = list(page_queryset)

        has_next = len(page_results) > limit
        if has_next:
            page_results = page_results[:limit]

        has_previous = page > 1
        if has_next:
            estimated_count = page * limit + 1
        else:
            estimated_count = offset + len(page_results)

    _attach_page_barcode_counts(page_results, barcode_tags)

    moved_out_barcode_ids = set()
    if tag == 'defective' and page_results and not is_lite:
        page_product_ids = [p.id for p in page_results if getattr(p, 'id', None)]
        if page_product_ids:
            moved_out_barcode_ids = set(
                DefectiveProductItem.objects.filter(
                    barcode__product_id__in=page_product_ids
                ).values_list('barcode_id', flat=True)
            )

    warehouse_qty_by_product = {}
    lite_barcodes_by_product = {}
    if is_lite and page_results and tag in (None, '', 'new'):
        from backend.purchasing.models import PurchaseItem
        page_product_ids = [p.id for p in page_results if getattr(p, 'id', None)]
        if page_product_ids:
            warehouse_qty_by_product = {
                row['product_id']: float(row['wh'] or 0)
                for row in PurchaseItem.objects.filter(
                    product_id__in=page_product_ids,
                    purchase__status='finalized',
                    purchase__deleted_at__isnull=True,
                ).values('product_id').annotate(wh=Sum('warehouse_quantity'))
            }

    context = {
        'request': request,
        'active_cart_barcodes': active_cart_barcodes,
        'active_cart_product_quantities': active_cart_product_quantities,
        'moved_out_barcode_ids': moved_out_barcode_ids,
        'warehouse_qty_by_product': warehouse_qty_by_product,
        'lite_barcodes_by_product': lite_barcodes_by_product,
    }

    # Serialize only the current page
    serializer = ProductListSerializer(page_results, many=True, context=context)
    
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
    response['Cache-Control'] = 'private, max-age=0, must-revalidate'  # No browser cache, only server cache
    
    # Add timestamp for cache busting
    from django.utils import timezone
    response['X-Data-Version'] = timezone.now().isoformat()
    
    logger.info(f"Products list query completed")
    
    return response
