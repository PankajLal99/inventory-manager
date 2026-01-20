"""
Cache invalidation signals
Automatically invalidate cache when data changes
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.cache import cache
import logging
import threading
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Thread-local storage to track signal suspension
_thread_locals = threading.local()

@contextmanager
def suspend_cache_signals():
    """
    Context manager to temporarily suspend cache invalidation signals.
    Useful for bulk operations to prevent excessive cache clearing.
    Remember to manually invalidate cache after the block!
    """
    try:
        _thread_locals.suspended = True
        yield
    finally:
        _thread_locals.suspended = False

def set_signals_suspended(suspended: bool):
    """Manually set signal suspension state without context manager"""
    _thread_locals.suspended = suspended

def is_suspended():
    return getattr(_thread_locals, 'suspended', False)

def suspend_cache_signals_decorator(func):
    """Decorator to suspend cache signals during function execution"""
    def wrapper(*args, **kwargs):
        try:
            _thread_locals.suspended = True
            result = func(*args, **kwargs)
            return result
        finally:
            _thread_locals.suspended = False
    return wrapper

def invalidate_cache_pattern(pattern):
    """
    Invalidate all cache keys matching a pattern
    Uses Redis SCAN to find and delete matching keys
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
            logger.info(f"Cache invalidation requested for pattern: {pattern} - Deleted {len(keys)} keys")
        else:
            logger.info(f"Cache invalidation requested for pattern: {pattern} - No keys found")
    except Exception as e:
        logger.warning(f"Could not invalidate cache pattern {pattern}: {str(e)}")


# --- Manual Invalidation Helpers ---

def invalidate_products_cache_manual():
    """Manually invalidate products cache"""
    try:
        invalidate_cache_pattern("products_list")
        logger.info("Invalidated products cache (Manual/Signal)")
    except Exception as e:
        logger.warning(f"Error invalidating products cache: {e}")

def invalidate_purchases_cache_manual():
    """Manually invalidate purchases cache"""
    try:
        invalidate_cache_pattern("purchases_list")
        logger.info("Invalidated purchases cache (Manual/Signal)")
    except Exception as e:
        logger.warning(f"Error invalidating purchases cache: {e}")

def invalidate_stock_cache_manual():
    """Manually invalidate stock cache"""
    try:
        invalidate_cache_pattern("stock_calc")
        logger.info("Invalidated stock cache (Manual/Signal)")
    except Exception as e:
        logger.warning(f"Error invalidating stock cache: {e}")

def invalidate_dashboard_cache_manual():
    """Manually invalidate dashboard cache"""
    try:
        invalidate_cache_pattern("dashboard_kpis")
        logger.info("Invalidated dashboard cache (Manual/Signal)")
    except Exception as e:
        logger.warning(f"Error invalidating dashboard cache: {e}")


# --- Signal Handlers ---

# Product cache invalidation
@receiver([post_save, post_delete])
def invalidate_products_cache(sender, instance, **kwargs):
    """Invalidate products cache when products/barcodes change"""
    if is_suspended():
        return
        
    model_name = sender.__name__
    
    if model_name in ['Product', 'Barcode']:
        try:
            from backend.catalog.models import Product, Barcode
            from django.db import transaction
            
            if isinstance(instance, (Product, Barcode)):
                # Use transaction.on_commit to ensure cache is invalidated AFTER DB commit
                # This prevents cache from being repopulated with stale data
                def invalidate_after_commit():
                    invalidate_products_cache_manual()
                
                transaction.on_commit(invalidate_after_commit)
        except Exception as e:
            logger.warning(f"Error in invalidate_products_cache signal: {e}")


# Purchase cache invalidation
@receiver([post_save, post_delete])
def invalidate_purchases_cache(sender, instance, **kwargs):
    """Invalidate purchases cache when purchases change"""
    if is_suspended():
        return

    model_name = sender.__name__
    
    if model_name in ['Purchase', 'PurchaseItem']:
        try:
            from backend.purchasing.models import Purchase, PurchaseItem
            if isinstance(instance, (Purchase, PurchaseItem)):
                invalidate_purchases_cache_manual()
        except Exception as e:
            logger.warning(f"Error in invalidate_purchases_cache signal: {e}")


# Stock cache invalidation
@receiver([post_save, post_delete])
def invalidate_stock_cache(sender, instance, **kwargs):
    """Invalidate stock cache when stock changes"""
    if is_suspended():
        return

    model_name = sender.__name__
    
    if model_name == 'Stock':
        try:
            from backend.inventory.models import Stock
            if isinstance(instance, Stock):
                invalidate_stock_cache_manual()
        except Exception as e:
            logger.warning(f"Error in invalidate_stock_cache signal: {e}")


# Invoice cache invalidation
@receiver([post_save, post_delete])
def invalidate_invoice_cache(sender, instance, **kwargs):
    """Invalidate dashboard cache when invoices/payments change"""
    if is_suspended():
        return

    model_name = sender.__name__
    
    if model_name in ['Invoice', 'Payment', 'InvoiceItem']:
        try:
            from backend.pos.models import Invoice, Payment, InvoiceItem
            if isinstance(instance, (Invoice, Payment, InvoiceItem)):
                invalidate_dashboard_cache_manual()
        except Exception as e:
            logger.warning(f"Error in invalidate_invoice_cache signal: {e}")


# Cart cache invalidation (affects products availability)
@receiver([post_save, post_delete])
def invalidate_cart_cache(sender, instance, **kwargs):
    """Invalidate products cache when cart items change"""
    if is_suspended():
        return

    model_name = sender.__name__
    
    if model_name == 'CartItem':
        try:
            from backend.pos.models import CartItem
            if isinstance(instance, CartItem):
                # CartItem affects product availability (in-cart status) usually
                invalidate_products_cache_manual()
        except Exception as e:
            logger.warning(f"Error in invalidate_cart_cache signal: {e}")
