"""
Advanced caching utilities for expensive queries
Uses Redis for caching complex query results
"""
from django.core.cache import cache
from django.db.models import Count, Q, Sum, DecimalField
from functools import wraps
import hashlib
import json
import logging

logger = logging.getLogger(__name__)

# Cache TTLs (in seconds)
PRODUCTS_LIST_CACHE_TTL = 120  # 2 minutes
DASHBOARD_KPI_CACHE_TTL = 300  # 5 minutes  
STOCK_LIST_CACHE_TTL = 180  # 3 minutes
REPORTS_CACHE_TTL = 600  # 10 minutes


def make_cache_key(prefix, *args, **kwargs):
    """Generate a unique cache key from arguments"""
    # Convert args and kwargs to a stable string representation
    key_data = f"{prefix}:{args}:{sorted(kwargs.items())}"
    # Hash it to keep key length reasonable
    key_hash = hashlib.md5(key_data.encode()).hexdigest()
    return f"{prefix}:{key_hash}"


def cached_query(cache_ttl=60, key_prefix="query"):
    """
    Decorator to cache expensive queries
    
    Usage:
        @cached_query(cache_ttl=120, key_prefix="products_list")
        def get_expensive_data(user_id, filters):
            # expensive query here
            return data
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            cache_key = make_cache_key(key_prefix, *args, **kwargs)
            
            # Try to get from cache
            cached_data = cache.get(cache_key)
            if cached_data is not None:
                logger.debug(f"Cache HIT for {key_prefix}: {cache_key}")
                return cached_data
            
            # Cache miss - execute function
            logger.debug(f"Cache MISS for {key_prefix}: {cache_key}")
            result = func(*args, **kwargs)
            
            # Store in cache
            cache.set(cache_key, result, cache_ttl)
            
            return result
        return wrapper
    return decorator


def invalidate_cache_pattern(pattern):
    """
    Invalidate all cache keys matching a pattern
    Note: This requires Redis with SCAN command support
    """
    try:
        from django_redis import get_redis_connection
        redis_conn = get_redis_connection("default")
        
        keys = []
        cursor = 0
        while True:
            cursor, partial_keys = redis_conn.scan(cursor, match=f"*{pattern}*", count=100)
            keys.extend(partial_keys)
            if cursor == 0:
                break
        
        if keys:
            redis_conn.delete(*keys)
            logger.info(f"Invalidated {len(keys)} cache keys matching pattern: {pattern}")
    except Exception as e:
        logger.warning(f"Could not invalidate cache pattern {pattern}: {str(e)}")


def get_cached_products_list(filters_dict):
    """
    Get cached products list with filters
    Returns tuple: (cached_data, cache_key)
    """
    cache_key = make_cache_key("products_list", **filters_dict)
    cached_data = cache.get(cache_key)
    return cached_data, cache_key


def cache_products_list(cache_key, data, ttl=PRODUCTS_LIST_CACHE_TTL):
    """Cache products list data"""
    cache.set(cache_key, data, ttl)
    logger.debug(f"Cached products list: {cache_key}")


def get_cached_dashboard_kpis(date_from, date_to, store_id=None):
    """Get cached dashboard KPIs"""
    cache_key = make_cache_key("dashboard_kpis", date_from, date_to, store_id)
    return cache.get(cache_key), cache_key


def cache_dashboard_kpis(cache_key, data, ttl=DASHBOARD_KPI_CACHE_TTL):
    """Cache dashboard KPIs data"""
    cache.set(cache_key, data, ttl)
    logger.debug(f"Cached dashboard KPIs: {cache_key}")


def get_cached_stock_calculations(product_ids, store_id=None):
    """
    Get cached stock calculations for products
    Returns dict mapping product_id -> stock_info
    """
    cache_key = make_cache_key("stock_calc", tuple(sorted(product_ids)), store_id)
    return cache.get(cache_key), cache_key


def cache_stock_calculations(cache_key, data, ttl=STOCK_LIST_CACHE_TTL):
    """Cache stock calculations"""
    cache.set(cache_key, data, ttl)
    logger.debug(f"Cached stock calculations: {cache_key}")


def invalidate_products_cache():
    """Invalidate all products-related cache"""
    invalidate_cache_pattern("products_list")
    logger.info("Invalidated products cache")


def invalidate_stock_cache():
    """Invalidate all stock-related cache"""
    invalidate_cache_pattern("stock_calc")
    logger.info("Invalidated stock cache")


def invalidate_dashboard_cache():
    """Invalidate dashboard KPIs cache"""
    invalidate_cache_pattern("dashboard_kpis")
    logger.info("Invalidated dashboard cache")
