"""
Optimized inventory/stock views with caching and query optimization

Key optimizations:
1. Pagination for stock list (previously caused timeout)
2. Redis caching
3. Batch queries
4. Index-friendly queries
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.core.paginator import Paginator
from django.db.models import Q, Count, Sum, F
from django.core.cache import cache
from backend.inventory.models import Stock
from backend.inventory.serializers import StockSerializer
import logging

logger = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def optimized_stock_list(request):
    """
    Optimized stock list with pagination and caching
    
    Key fix: Added pagination to prevent timeout on large datasets
    
    Optimizations:
    1. Pagination (default 50 items per page)
    2. select_related for foreign keys
    3. Early filtering
    4. Cache support for repeated queries
    """
    product_id = request.query_params.get('product_id', None)
    store_id = request.query_params.get('store_id', None)
    warehouse_id = request.query_params.get('warehouse_id', None)
    page = int(request.query_params.get('page', 1))
    limit = int(request.query_params.get('limit', 20))  # Smaller default for stock (10K+ records)
    
    # Build cache key
    cache_key = f"stock_list:{product_id}:{store_id}:{warehouse_id}:{page}:{limit}"
    try:
        cached_data = cache.get(cache_key)
        
        if cached_data:
            logger.info(f"Stock list cache HIT")
            response = Response(cached_data)
            response['X-Cache'] = 'HIT'
            response['Cache-Control'] = 'private, max-age=180'  # 3 minutes
            return response
        logger.info(f"Stock list cache MISS")
    except Exception as e:
        logger.warning(f"Cache unavailable, proceeding without cache: {e}")
    
    # OPTIMIZATION 1: Use select_related to avoid N+1 queries
    queryset = Stock.objects.select_related(
        'product',
        'product__category',
        'product__brand',
        'variant',
        'store',
        'warehouse'
    ).all()
    
    # OPTIMIZATION 2: Apply filters early
    if product_id:
        queryset = queryset.filter(product_id=product_id)
    if store_id:
        queryset = queryset.filter(store_id=store_id)
    if warehouse_id:
        queryset = queryset.filter(warehouse_id=warehouse_id)
    
    # OPTIMIZATION 3: Order by ID for consistent pagination
    queryset = queryset.order_by('id')
    
    # OPTIMIZATION 4: Paginate (THIS WAS MISSING - caused timeout!)
    paginator = Paginator(queryset, limit)
    page_obj = paginator.get_page(page)
    
    # Serialize
    serializer = StockSerializer(page_obj, many=True)
    
    # Build paginated response
    response_data = {
        'results': serializer.data,
        'count': paginator.count,
        'next': page_obj.next_page_number() if page_obj.has_next() else None,
        'previous': page_obj.previous_page_number() if page_obj.has_previous() else None,
        'page': page,
        'page_size': limit,
        'total_pages': paginator.num_pages,
    }
    
    # Cache for 3 minutes
    try:
        cache.set(cache_key, response_data, 180)
    except Exception as e:
        logger.warning(f"Unable to cache response: {e}")
    
    response = Response(response_data)
    response['X-Cache'] = 'MISS'
    response['Cache-Control'] = 'private, max-age=180'
    
    logger.info(f"Stock list query completed (page {page}, {len(serializer.data)} items)")
    
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def optimized_stock_low(request):
    """
    Optimized low stock query with caching
    
    Optimizations:
    1. Index-friendly query (uses F expressions)
    2. select_related for related objects
    3. Caching with 5-minute TTL
    """
    cache_key = "stock_low"
    try:
        cached_data = cache.get(cache_key)
        
        if cached_data:
            logger.info("Low stock cache HIT")
            return Response(cached_data)
        logger.info("Low stock cache MISS")
    except Exception as e:
        logger.warning(f"Cache unavailable: {e}")
    
    # OPTIMIZATION: Use F() expression for database-level comparison
    stocks = Stock.objects.select_related(
        'product',
        'product__category',
        'product__brand',
        'store'
    ).filter(
        product__low_stock_threshold__gt=0
    ).filter(
        quantity__lte=F('product__low_stock_threshold')
    ).order_by('quantity')
    
    serializer = StockSerializer(stocks, many=True)
    
    # Cache for 5 minutes
    cache.set(cache_key, serializer.data, 300)
    
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def optimized_stock_out_of_stock(request):
    """
    Optimized out of stock query with caching
    
    Optimizations:
    1. Simple query with index on quantity field
    2. select_related for related objects
    3. Caching with 5-minute TTL
    """
    cache_key = "stock_out_of_stock"
    try:
        cached_data = cache.get(cache_key)
        
        if cached_data:
            logger.info("Out of stock cache HIT")
            return Response(cached_data)
        logger.info("Out of stock cache MISS")
    except Exception as e:
        logger.warning(f"Cache unavailable: {e}")
    
    stocks = Stock.objects.select_related(
        'product',
        'product__category',
        'product__brand',
        'store'
    ).filter(
        quantity=0
    ).order_by('product__name')
    
    serializer = StockSerializer(stocks, many=True)
    
    # Cache for 5 minutes
    try:
        cache.set(cache_key, serializer.data, 300)
    except Exception as e:
        logger.warning(f"Unable to cache: {e}")
    
    return Response(serializer.data)
