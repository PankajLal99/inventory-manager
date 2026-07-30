"""
Lightweight stock-alert helpers with Redis caching.

counts_only path avoids loading full product ID lists and only joins thresholds
for products that still have available stock (low-stock candidates).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from django.core.cache import cache
from django.db.models import Count

from backend.catalog.models import Product, Barcode
from backend.pos.models import InvoiceItem, CartItem

logger = logging.getLogger('backend.reports')

STOCK_ALERTS_COUNTS_TTL = 90  # seconds — badge can be slightly stale
STOCK_ALERTS_LIST_TTL = 60


def _counts_cache_key(store_id: Optional[str] = None) -> str:
    return f'stock_alerts:v2:counts:{store_id or "all"}'


def _list_cache_key(store_id: Optional[str] = None) -> str:
    return f'stock_alerts:v2:list:{store_id or "all"}'


def invalidate_stock_alerts_cache() -> None:
    """Drop all stock-alert cache entries (best-effort)."""
    try:
        from django_redis import get_redis_connection
        con = get_redis_connection('default')
        keys = con.keys('*stock_alerts:v2:*')
        if keys:
            con.delete(*keys)
            logger.debug('Invalidated %s stock alert cache keys', len(keys))
            return
    except Exception as exc:
        logger.debug('stock alert cache pattern delete skipped: %s', exc)

    for store in (None,):
        cache.delete(_counts_cache_key(store))
        cache.delete(_list_cache_key(store))


def _active_cart_barcode_codes() -> Set[str]:
    codes: Set[str] = set()
    for scanned in CartItem.objects.filter(cart__status='active').exclude(
        scanned_barcodes__isnull=True
    ).exclude(scanned_barcodes=[]).values_list('scanned_barcodes', flat=True):
        if scanned:
            codes.update(scanned)
    return codes


def _available_qty_by_product(store_id: Optional[str] = None) -> Dict[int, int]:
    """
    One aggregation: product_id -> available barcode count (>0 only).
    Excludes draft/soft-deleted purchases, sold barcodes, and active-cart codes.
    """
    barcode_qs = Barcode.objects.filter(
        tag__in=['new', 'returned'],
    ).exclude(
        purchase__status='draft',
    ).filter(
        purchase__deleted_at__isnull=True,
    )
    if store_id:
        barcode_qs = barcode_qs.filter(purchase__store_id=store_id)

    sold_ids = InvoiceItem.objects.filter(
        barcode_id__isnull=False,
    ).exclude(
        invoice__status='void',
    ).values('barcode_id')

    available_qs = barcode_qs.exclude(id__in=sold_ids)

    cart_codes = _active_cart_barcode_codes()
    if cart_codes:
        available_qs = available_qs.exclude(barcode__in=cart_codes)

    return {
        row['product_id']: row['count']
        for row in available_qs.values('product_id').annotate(count=Count('id'))
    }


def _purchased_product_ids_qs(store_id: Optional[str] = None):
    qs = Product.objects.filter(barcodes__isnull=False)
    if store_id:
        qs = qs.filter(barcodes__purchase__store_id=store_id)
    return qs.distinct()


def compute_stock_alert_counts(store_id: Optional[str] = None) -> Dict[str, int]:
    """
    Ultra-light counts:
    - out_of_stock = purchased products - products with available > 0
    - low_stock = available > 0 and available <= threshold (threshold > 0)
    """
    available_map = _available_qty_by_product(store_id)
    total_purchased = _purchased_product_ids_qs(store_id).count()
    with_stock = len(available_map)
    out_count = max(0, total_purchased - with_stock)

    low_count = 0
    if available_map:
        threshold_map = dict(
            Product.objects.filter(
                id__in=list(available_map.keys()),
                low_stock_threshold__gt=0,
            ).values_list('id', 'low_stock_threshold')
        )
        for product_id, qty in available_map.items():
            threshold = threshold_map.get(product_id)
            if threshold and qty <= threshold:
                low_count += 1

    return {
        'out_of_stock_count': out_count,
        'low_stock_count': low_count,
        'total_count': out_count + low_count,
    }


def get_stock_alert_counts(
    store_id: Optional[str] = None,
    *,
    bypass_cache: bool = False,
) -> Dict[str, int]:
    cache_key = _counts_cache_key(store_id)
    if not bypass_cache:
        try:
            cached = cache.get(cache_key)
            if cached is not None:
                return cached
        except Exception as exc:
            logger.debug('stock alert counts cache get failed: %s', exc)

    data = compute_stock_alert_counts(store_id)
    try:
        cache.set(cache_key, data, STOCK_ALERTS_COUNTS_TTL)
    except Exception as exc:
        logger.debug('stock alert counts cache set failed: %s', exc)
    return data


def compute_stock_alert_list(store_id: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    from backend.purchasing.models import PurchaseItem
    from backend.locations.models import Store

    store_name = 'N/A'
    if store_id:
        store = Store.objects.filter(id=store_id).only('name').first()
        if store:
            store_name = store.name

    available_map = _available_qty_by_product(store_id)
    available_ids = list(available_map.keys())

    # Out of stock: purchased, but no available barcodes
    out_ids = list(
        _purchased_product_ids_qs(store_id)
        .exclude(id__in=available_ids or [-1])
        .values_list('id', flat=True)
    )

    low_ids: List[int] = []
    if available_map:
        threshold_map = dict(
            Product.objects.filter(
                id__in=available_ids,
                low_stock_threshold__gt=0,
            ).values_list('id', 'low_stock_threshold')
        )
        for product_id, qty in available_map.items():
            threshold = threshold_map.get(product_id)
            if threshold and qty <= threshold:
                low_ids.append(product_id)

    alert_ids = out_ids + low_ids
    if not alert_ids:
        return {
            'out_of_stock': [],
            'low_stock': [],
            'products_needing_order': [],
        }

    products_by_id = {
        p.id: p
        for p in Product.objects.filter(id__in=alert_ids)
        .select_related('category', 'brand')
        .only(
            'id', 'name', 'sku', 'low_stock_threshold',
            'category_id', 'brand_id',
            'category__name', 'brand__name',
        )
    }

    latest_purchase_by_product: Dict[int, Any] = {}
    purchase_items = (
        PurchaseItem.objects.filter(
            product_id__in=alert_ids,
            purchase__deleted_at__isnull=True,
        )
        .exclude(purchase__status='draft')
        .select_related('purchase__supplier')
        .order_by('product_id', '-purchase__created_at')
        .only(
            'product_id',
            'unit_price',
            'purchase_id',
            'purchase__supplier_id',
            'purchase__supplier__name',
            'purchase__created_at',
        )
    )
    for item in purchase_items.iterator(chunk_size=500):
        if item.product_id not in latest_purchase_by_product:
            latest_purchase_by_product[item.product_id] = item

    def build_row(product_id: int, available_count: int) -> Optional[Dict[str, Any]]:
        product = products_by_id.get(product_id)
        if not product:
            return None
        purchase_item = latest_purchase_by_product.get(product_id)
        supplier = (
            purchase_item.purchase.supplier
            if purchase_item and purchase_item.purchase
            else None
        )
        cost_price = (
            float(purchase_item.unit_price)
            if purchase_item and purchase_item.unit_price is not None
            else 0.0
        )
        return {
            'product__id': product.id,
            'product__name': product.name,
            'product__sku': product.sku or 'N/A',
            'product__category_id': product.category_id,
            'product__category': product.category.name if product.category else 'N/A',
            'product__brand_id': product.brand_id,
            'product__brand': product.brand.name if product.brand else 'N/A',
            'product__low_stock_threshold': product.low_stock_threshold or 0,
            'product__cost_price': cost_price,
            'supplier__id': supplier.id if supplier else None,
            'supplier__name': supplier.name if supplier else 'N/A',
            'store__name': store_name,
            'available_quantity': available_count,
        }

    out_of_stock: List[Dict[str, Any]] = []
    low_stock: List[Dict[str, Any]] = []
    for product_id in out_ids:
        row = build_row(product_id, 0)
        if row:
            out_of_stock.append(row)
    for product_id in low_ids:
        row = build_row(product_id, available_map.get(product_id, 0))
        if row:
            low_stock.append(row)

    return {
        'out_of_stock': out_of_stock,
        'low_stock': low_stock,
        'products_needing_order': out_of_stock + low_stock,
    }


def get_stock_alert_list(
    store_id: Optional[str] = None,
    *,
    bypass_cache: bool = False,
) -> Dict[str, List[Dict[str, Any]]]:
    cache_key = _list_cache_key(store_id)
    if not bypass_cache:
        try:
            cached = cache.get(cache_key)
            if cached is not None:
                return cached
        except Exception as exc:
            logger.debug('stock alert list cache get failed: %s', exc)

    data = compute_stock_alert_list(store_id)
    try:
        cache.set(cache_key, data, STOCK_ALERTS_LIST_TTL)
    except Exception as exc:
        logger.debug('stock alert list cache set failed: %s', exc)
    return data
