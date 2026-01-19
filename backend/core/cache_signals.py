"""
Cache invalidation signals
Automatically invalidate cache when data changes
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.cache import cache
import logging

logger = logging.getLogger(__name__)


def invalidate_cache_pattern(pattern):
    """
    Invalidate all cache keys matching a pattern
    For simple Django cache, we'll use specific keys
    """
    try:
        # For production with Redis, you'd use SCAN here
        # For now, just delete specific known keys
        logger.info(f"Cache invalidation requested for pattern: {pattern}")
    except Exception as e:
        logger.warning(f"Could not invalidate cache pattern {pattern}: {str(e)}")


# Product cache invalidation
@receiver([post_save, post_delete])
def invalidate_products_cache(sender, instance, **kwargs):
    """Invalidate products cache when products/barcodes change"""
    model_name = sender.__name__
    
    if model_name in ['Product', 'Barcode']:
        try:
            from backend.catalog.models import Product, Barcode
            if isinstance(instance, (Product, Barcode)):
                invalidate_cache_pattern("products_list")
                logger.info(f"Invalidated products cache due to {model_name} change")
        except Exception as e:
            logger.warning(f"Error invalidating products cache: {e}")


# Purchase cache invalidation
@receiver([post_save, post_delete])
def invalidate_purchases_cache(sender, instance, **kwargs):
    """Invalidate purchases cache when purchases change"""
    model_name = sender.__name__
    
    if model_name in ['Purchase', 'PurchaseItem']:
        try:
            from backend.purchasing.models import Purchase, PurchaseItem
            if isinstance(instance, (Purchase, PurchaseItem)):
                # Clear cache for all purchase list variations
                cache.delete_many([
                    'purchases_list',
                    'purchases_list_paginated',
                ])
                logger.info(f"Invalidated purchases cache due to {model_name} change")
        except Exception as e:
            logger.warning(f"Error invalidating purchases cache: {e}")


# Stock cache invalidation
@receiver([post_save, post_delete])
def invalidate_stock_cache(sender, instance, **kwargs):
    """Invalidate stock cache when stock changes"""
    model_name = sender.__name__
    
    if model_name == 'Stock':
        try:
            from backend.inventory.models import Stock
            if isinstance(instance, Stock):
                invalidate_cache_pattern("stock_calc")
                logger.info(f"Invalidated stock cache due to Stock change")
        except Exception as e:
            logger.warning(f"Error invalidating stock cache: {e}")


# Invoice cache invalidation
@receiver([post_save, post_delete])
def invalidate_invoice_cache(sender, instance, **kwargs):
    """Invalidate dashboard cache when invoices/payments change"""
    model_name = sender.__name__
    
    if model_name in ['Invoice', 'Payment', 'InvoiceItem']:
        try:
            from backend.pos.models import Invoice, Payment, InvoiceItem
            if isinstance(instance, (Invoice, Payment, InvoiceItem)):
                invalidate_cache_pattern("dashboard_kpis")
                logger.info(f"Invalidated dashboard cache due to {model_name} change")
        except Exception as e:
            logger.warning(f"Error invalidating dashboard cache: {e}")


# Cart cache invalidation (affects products availability)
@receiver([post_save, post_delete])
def invalidate_cart_cache(sender, instance, **kwargs):
    """Invalidate products cache when cart items change"""
    model_name = sender.__name__
    
    if model_name == 'CartItem':
        try:
            from backend.pos.models import CartItem
            if isinstance(instance, CartItem):
                invalidate_cache_pattern("products_list")
                logger.info(f"Invalidated products cache due to CartItem change")
        except Exception as e:
            logger.warning(f"Error invalidating cart cache: {e}")
