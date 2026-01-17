"""
Optimized barcode caching system for fast retrieval and searching.

This module provides caching for barcodes and short_codes with their status,
enabling fast lookups across the application without hitting the database.
"""
from django.core.cache import cache
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver
from .models import Barcode
import logging

logger = logging.getLogger(__name__)

# Cache key prefixes
BARCODE_KEY_PREFIX = 'barcode:'
SHORT_CODE_KEY_PREFIX = 'short_code:'
BARCODE_LOOKUP_KEY_PREFIX = 'barcode_lookup:'
BARCODE_STATUS_KEY_PREFIX = 'barcode_status:'

# Cache TTL (Time To Live) in seconds
# Barcode data cache: 10 minutes (barcodes change frequently but not constantly)
BARCODE_CACHE_TTL = 600  # 10 minutes
# Lookup cache: 5 minutes (for API responses)
LOOKUP_CACHE_TTL = 300  # 5 minutes
# Status cache: 2 minutes (status changes more frequently)
STATUS_CACHE_TTL = 120  # 2 minutes


def get_barcode_cache_key(barcode_value: str) -> str:
    """Get cache key for barcode lookup"""
    return f"{BARCODE_KEY_PREFIX}{barcode_value}"


def get_short_code_cache_key(short_code_value: str) -> str:
    """Get cache key for short_code lookup"""
    return f"{SHORT_CODE_KEY_PREFIX}{short_code_value}"


def get_barcode_lookup_cache_key(barcode_value: str) -> str:
    """Get cache key for barcode lookup API response"""
    return f"{BARCODE_LOOKUP_KEY_PREFIX}{barcode_value}"


def get_barcode_status_cache_key(barcode_id: int) -> str:
    """Get cache key for barcode status"""
    return f"{BARCODE_STATUS_KEY_PREFIX}{barcode_id}"


def cache_barcode_data(barcode_obj: Barcode, ttl: int = None):
    """
    Cache barcode data for fast retrieval.
    
    Caches:
    - By barcode value
    - By short_code (if exists)
    - Status information
    
    Args:
        barcode_obj: Barcode model instance
        ttl: Time to live in seconds (defaults to BARCODE_CACHE_TTL)
    """
    if not barcode_obj:
        return
    
    ttl = ttl or BARCODE_CACHE_TTL
    
    # Prepare cached data structure
    cached_data = {
        'id': barcode_obj.id,
        'barcode': barcode_obj.barcode,
        'short_code': barcode_obj.short_code,
        'tag': barcode_obj.tag,
        'product_id': barcode_obj.product_id,
        'is_primary': barcode_obj.is_primary,
        'purchase_id': barcode_obj.purchase_id,
        'purchase_item_id': barcode_obj.purchase_item_id,
    }
    
    # Add product info if available
    if barcode_obj.product:
        cached_data['product'] = {
            'id': barcode_obj.product.id,
            'name': barcode_obj.product.name,
            'sku': barcode_obj.product.sku,
            'is_active': barcode_obj.product.is_active,
        }
    
    # Cache by barcode value
    barcode_key = get_barcode_cache_key(barcode_obj.barcode)
    cache.set(barcode_key, cached_data, ttl)
    
    # Cache by short_code if it exists
    if barcode_obj.short_code:
        short_code_key = get_short_code_cache_key(barcode_obj.short_code)
        cache.set(short_code_key, cached_data, ttl)
    
    # Cache status separately for quick status checks
    status_key = get_barcode_status_cache_key(barcode_obj.id)
    status_data = {
        'tag': barcode_obj.tag,
        'barcode': barcode_obj.barcode,
        'short_code': barcode_obj.short_code,
        'product_id': barcode_obj.product_id,
        'is_active': barcode_obj.product.is_active if barcode_obj.product else False,
    }
    cache.set(status_key, status_data, STATUS_CACHE_TTL)
    
    logger.debug(f"Cached barcode data: {barcode_obj.barcode} (ID: {barcode_obj.id})")


def get_cached_barcode(barcode_value: str):
    """
    Get cached barcode data by barcode value.
    
    Returns:
        Cached barcode data dict or None if not found
    """
    cache_key = get_barcode_cache_key(barcode_value)
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug(f"Cache hit for barcode: {barcode_value}")
    return cached_data


def get_cached_barcode_by_short_code(short_code_value: str):
    """
    Get cached barcode data by short_code value.
    
    Returns:
        Cached barcode data dict or None if not found
    """
    if not short_code_value:
        return None
    
    cache_key = get_short_code_cache_key(short_code_value)
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug(f"Cache hit for short_code: {short_code_value}")
    return cached_data


def get_cached_barcode_status(barcode_id: int):
    """
    Get cached barcode status.
    
    Returns:
        Status data dict or None if not found
    """
    cache_key = get_barcode_status_cache_key(barcode_id)
    return cache.get(cache_key)


def invalidate_barcode_cache(barcode_obj: Barcode):
    """
    Invalidate all cache entries for a barcode.
    
    This should be called when a barcode is updated or deleted.
    """
    if not barcode_obj:
        return
    
    # Get old values before deletion (if available)
    old_barcode = getattr(barcode_obj, '_old_barcode', None) or barcode_obj.barcode
    old_short_code = getattr(barcode_obj, '_old_short_code', None) or barcode_obj.short_code
    
    # Invalidate by barcode
    barcode_key = get_barcode_cache_key(old_barcode)
    cache.delete(barcode_key)
    
    # Invalidate by short_code
    if old_short_code:
        short_code_key = get_short_code_cache_key(old_short_code)
        cache.delete(short_code_key)
    
    # Invalidate status cache
    status_key = get_barcode_status_cache_key(barcode_obj.id)
    cache.delete(status_key)
    
    # Invalidate lookup cache (API response cache)
    lookup_key = get_barcode_lookup_cache_key(old_barcode)
    cache.delete(lookup_key)
    
    # Also invalidate by short_code lookup if it exists
    if old_short_code:
        lookup_key_short = get_barcode_lookup_cache_key(old_short_code)
        cache.delete(lookup_key_short)
    
    logger.debug(f"Invalidated cache for barcode: {old_barcode} (ID: {barcode_obj.id})")


def invalidate_all_barcode_caches():
    """
    Invalidate all barcode-related caches.
    Use this sparingly - only when you need to clear everything.
    """
    # Note: Django's cache doesn't support pattern-based deletion by default
    # For production, consider using Redis with pattern deletion
    # For now, we'll rely on TTL expiration
    logger.warning("Invalidate all barcode caches called - relying on TTL expiration")


# Django signals to automatically invalidate cache on barcode changes
@receiver(pre_save, sender=Barcode)
def barcode_pre_save(sender, instance, **kwargs):
    """Store old values before save to enable cache invalidation"""
    if instance.pk:
        try:
            old_instance = Barcode.objects.get(pk=instance.pk)
            instance._old_barcode = old_instance.barcode
            instance._old_short_code = old_instance.short_code
        except Barcode.DoesNotExist:
            pass


@receiver(post_save, sender=Barcode)
def barcode_post_save(sender, instance, created, **kwargs):
    """Invalidate and refresh cache when barcode is saved"""
    # Invalidate old cache entries
    invalidate_barcode_cache(instance)
    
    # Refresh cache with new data
    cache_barcode_data(instance)
    
    logger.debug(f"Cache refreshed for barcode: {instance.barcode} (ID: {instance.id}, created: {created})")


@receiver(post_delete, sender=Barcode)
def barcode_post_delete(sender, instance, **kwargs):
    """Invalidate cache when barcode is deleted"""
    invalidate_barcode_cache(instance)
    logger.debug(f"Cache invalidated for deleted barcode: {instance.barcode} (ID: {instance.id})")
