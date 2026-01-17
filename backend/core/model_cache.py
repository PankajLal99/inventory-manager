"""
Optimized caching system for frequently accessed models: Store, Customer, and Product.

This module provides caching for these models to enable fast retrieval
without hitting the database repeatedly.
"""
from django.core.cache import cache
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver
import logging

logger = logging.getLogger(__name__)

# Cache key prefixes
STORE_KEY_PREFIX = 'store:'
STORE_LIST_KEY_PREFIX = 'store_list:'
CUSTOMER_KEY_PREFIX = 'customer:'
CUSTOMER_LIST_KEY_PREFIX = 'customer_list:'
CUSTOMER_PHONE_KEY_PREFIX = 'customer_phone:'
PRODUCT_KEY_PREFIX = 'product:'
PRODUCT_LIST_KEY_PREFIX = 'product_list:'
PRODUCT_SKU_KEY_PREFIX = 'product_sku:'

# Cache TTL (Time To Live) in seconds
# Stores: 15 minutes (change infrequently)
STORE_CACHE_TTL = 900  # 15 minutes
STORE_LIST_CACHE_TTL = 600  # 10 minutes (lists change more often)
# Customers: 10 minutes (change moderately)
CUSTOMER_CACHE_TTL = 600  # 10 minutes
CUSTOMER_LIST_CACHE_TTL = 300  # 5 minutes
# Products: 5 minutes (change more frequently)
PRODUCT_CACHE_TTL = 300  # 5 minutes
PRODUCT_LIST_CACHE_TTL = 180  # 3 minutes


# ==================== STORE CACHING ====================

def get_store_cache_key(store_id: int) -> str:
    """Get cache key for store by ID"""
    return f"{STORE_KEY_PREFIX}{store_id}"


def get_store_list_cache_key(user_groups_key: str = 'all') -> str:
    """Get cache key for store list (filtered by user groups)"""
    return f"{STORE_LIST_KEY_PREFIX}{user_groups_key}"


def cache_store_data(store_obj, ttl: int = None):
    """Cache store data for fast retrieval"""
    if not store_obj:
        return
    
    ttl = ttl or STORE_CACHE_TTL
    
    cached_data = {
        'id': store_obj.id,
        'name': store_obj.name,
        'code': store_obj.code,
        'shop_type': store_obj.shop_type,
        'address': store_obj.address,
        'phone': store_obj.phone,
        'email': store_obj.email,
        'is_active': store_obj.is_active,
    }
    
    store_key = get_store_cache_key(store_obj.id)
    cache.set(store_key, cached_data, ttl)
    logger.debug(f"Cached store data: {store_obj.name} (ID: {store_obj.id})")


def get_cached_store(store_id: int):
    """Get cached store data by ID"""
    cache_key = get_store_cache_key(store_id)
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug(f"Cache hit for store: {store_id}")
    return cached_data


def invalidate_store_cache(store_obj):
    """Invalidate all cache entries for a store"""
    if not store_obj:
        return
    
    # Invalidate by ID
    store_key = get_store_cache_key(store_obj.id)
    cache.delete(store_key)
    
    # Invalidate all store lists (they might include this store)
    # Use pattern deletion if available, otherwise rely on TTL
    logger.debug(f"Invalidated cache for store: {store_obj.name} (ID: {store_obj.id})")


# ==================== CUSTOMER CACHING ====================

def get_customer_cache_key(customer_id: int) -> str:
    """Get cache key for customer by ID"""
    return f"{CUSTOMER_KEY_PREFIX}{customer_id}"


def get_customer_phone_cache_key(phone: str) -> str:
    """Get cache key for customer by phone"""
    return f"{CUSTOMER_PHONE_KEY_PREFIX}{phone}"


def get_customer_list_cache_key(search_query: str = '') -> str:
    """Get cache key for customer list"""
    return f"{CUSTOMER_LIST_KEY_PREFIX}{search_query or 'all'}"


def cache_customer_data(customer_obj, ttl: int = None):
    """Cache customer data for fast retrieval"""
    if not customer_obj:
        return
    
    ttl = ttl or CUSTOMER_CACHE_TTL
    
    cached_data = {
        'id': customer_obj.id,
        'name': customer_obj.name,
        'phone': customer_obj.phone,
        'email': customer_obj.email,
        'address': customer_obj.address,
        'customer_group_id': customer_obj.customer_group_id,
        'credit_limit': str(customer_obj.credit_limit) if customer_obj.credit_limit else '0.00',
        'credit_balance': str(customer_obj.credit_balance) if customer_obj.credit_balance else '0.00',
        'is_active': customer_obj.is_active,
    }
    
    # Cache by ID
    customer_key = get_customer_cache_key(customer_obj.id)
    cache.set(customer_key, cached_data, ttl)
    
    # Cache by phone if available
    if customer_obj.phone:
        phone_key = get_customer_phone_cache_key(customer_obj.phone)
        cache.set(phone_key, cached_data, ttl)
    
    logger.debug(f"Cached customer data: {customer_obj.name} (ID: {customer_obj.id})")


def get_cached_customer(customer_id: int):
    """Get cached customer data by ID"""
    cache_key = get_customer_cache_key(customer_id)
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug(f"Cache hit for customer: {customer_id}")
    return cached_data


def get_cached_customer_by_phone(phone: str):
    """Get cached customer data by phone"""
    if not phone:
        return None
    
    cache_key = get_customer_phone_cache_key(phone)
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug(f"Cache hit for customer phone: {phone}")
    return cached_data


def invalidate_customer_cache(customer_obj):
    """Invalidate all cache entries for a customer"""
    if not customer_obj:
        return
    
    old_phone = getattr(customer_obj, '_old_phone', None) or customer_obj.phone
    
    # Invalidate by ID
    customer_key = get_customer_cache_key(customer_obj.id)
    cache.delete(customer_key)
    
    # Invalidate by phone
    if old_phone:
        phone_key = get_customer_phone_cache_key(old_phone)
        cache.delete(phone_key)
    
    # Invalidate customer lists
    logger.debug(f"Invalidated cache for customer: {customer_obj.name} (ID: {customer_obj.id})")


# ==================== PRODUCT CACHING ====================

def get_product_cache_key(product_id: int) -> str:
    """Get cache key for product by ID"""
    return f"{PRODUCT_KEY_PREFIX}{product_id}"


def get_product_sku_cache_key(sku: str) -> str:
    """Get cache key for product by SKU"""
    return f"{PRODUCT_SKU_KEY_PREFIX}{sku}"


def get_product_list_cache_key(cache_key_suffix: str = '') -> str:
    """Get cache key for product list"""
    return f"{PRODUCT_LIST_KEY_PREFIX}{cache_key_suffix or 'default'}"


def cache_product_data(product_obj, ttl: int = None):
    """Cache product data for fast retrieval"""
    if not product_obj:
        return
    
    ttl = ttl or PRODUCT_CACHE_TTL
    
    cached_data = {
        'id': product_obj.id,
        'name': product_obj.name,
        'sku': product_obj.sku,
        'product_type': product_obj.product_type,
        'category_id': product_obj.category_id,
        'brand_id': product_obj.brand_id,
        'description': product_obj.description,
        'can_go_below_purchase_price': product_obj.can_go_below_purchase_price,
        'tax_rate_id': product_obj.tax_rate_id,
        'track_inventory': product_obj.track_inventory,
        'track_batches': product_obj.track_batches,
        'low_stock_threshold': product_obj.low_stock_threshold,
        'image': product_obj.image,
        'is_active': product_obj.is_active,
    }
    
    # Add category and brand names if available
    if product_obj.category:
        cached_data['category_name'] = product_obj.category.name
    if product_obj.brand:
        cached_data['brand_name'] = product_obj.brand.name
    
    # Cache by ID
    product_key = get_product_cache_key(product_obj.id)
    cache.set(product_key, cached_data, ttl)
    
    # Cache by SKU if available
    if product_obj.sku:
        sku_key = get_product_sku_cache_key(product_obj.sku)
        cache.set(sku_key, cached_data, ttl)
    
    logger.debug(f"Cached product data: {product_obj.name} (ID: {product_obj.id})")


def get_cached_product(product_id: int):
    """Get cached product data by ID"""
    cache_key = get_product_cache_key(product_id)
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug(f"Cache hit for product: {product_id}")
    return cached_data


def get_cached_product_by_sku(sku: str):
    """Get cached product data by SKU"""
    if not sku:
        return None
    
    cache_key = get_product_sku_cache_key(sku)
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug(f"Cache hit for product SKU: {sku}")
    return cached_data


def invalidate_product_cache(product_obj):
    """Invalidate all cache entries for a product"""
    if not product_obj:
        return
    
    old_sku = getattr(product_obj, '_old_sku', None) or product_obj.sku
    
    # Invalidate by ID
    product_key = get_product_cache_key(product_obj.id)
    cache.delete(product_key)
    
    # Invalidate by SKU
    if old_sku:
        sku_key = get_product_sku_cache_key(old_sku)
        cache.delete(sku_key)
    
    # Invalidate product lists
    logger.debug(f"Invalidated cache for product: {product_obj.name} (ID: {product_obj.id})")


# ==================== DJANGO SIGNALS ====================

# Store signals
@receiver(pre_save)
def model_pre_save(sender, instance, **kwargs):
    """Store old values before save for cache invalidation"""
    # Handle Store, Customer, Product models
    model_name = sender.__name__
    if model_name in ['Store', 'Customer', 'Product']:
        if instance.pk:
            try:
                old_instance = sender.objects.get(pk=instance.pk)
                if model_name == 'Customer':
                    instance._old_phone = old_instance.phone
                elif model_name == 'Product':
                    instance._old_sku = old_instance.sku
            except sender.DoesNotExist:
                pass


@receiver(post_save)
def model_post_save(sender, instance, **kwargs):
    """Invalidate and refresh cache when model is saved"""
    model_name = sender.__name__
    
    if model_name == 'Store':
        from backend.locations.models import Store
        if isinstance(instance, Store):
            invalidate_store_cache(instance)
            cache_store_data(instance)
            logger.debug(f"Cache refreshed for store: {instance.name} (ID: {instance.id})")
    
    elif model_name == 'Customer':
        from backend.parties.models import Customer
        if isinstance(instance, Customer):
            invalidate_customer_cache(instance)
            cache_customer_data(instance)
            logger.debug(f"Cache refreshed for customer: {instance.name} (ID: {instance.id})")
    
    elif model_name == 'Product':
        from backend.catalog.models import Product
        if isinstance(instance, Product):
            invalidate_product_cache(instance)
            cache_product_data(instance)
            logger.debug(f"Cache refreshed for product: {instance.name} (ID: {instance.id})")
    
@receiver(post_delete)
def model_post_delete(sender, instance, **kwargs):
    """Invalidate cache when model is deleted"""
    model_name = sender.__name__
    
    if model_name == 'Store':
        from backend.locations.models import Store
        if isinstance(instance, Store):
            invalidate_store_cache(instance)
            logger.debug(f"Cache invalidated for deleted store: {instance.name} (ID: {instance.id})")
    
    elif model_name == 'Customer':
        from backend.parties.models import Customer
        if isinstance(instance, Customer):
            invalidate_customer_cache(instance)
            logger.debug(f"Cache invalidated for deleted customer: {instance.name} (ID: {instance.id})")
    
    elif model_name == 'Product':
        from backend.catalog.models import Product
        if isinstance(instance, Product):
            invalidate_product_cache(instance)
            logger.debug(f"Cache invalidated for deleted product: {instance.name} (ID: {instance.id})")
    
