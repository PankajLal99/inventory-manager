"""
Barcode-safe cart discard shared by API DELETE and abandoned-cart cleanup.

Rules:
- Barcodes linked to any non-void invoice keep their current tag (sold / in-cart / etc).
- Only free `in-cart` barcodes (not on a non-void invoice) are released to `new`.
- Never flip `sold` -> `new` just because the barcode appears in an EDIT cart.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from backend.catalog.barcode_cache import invalidate_barcode_cache
from backend.catalog.models import Barcode
from backend.core.utils import create_audit_log
from backend.inventory.models import Stock
from backend.pos.models import Cart, InvoiceItem

logger = logging.getLogger(__name__)

# Fallback when Setting row is missing/invalid. Change via Django Admin → Settings
# key ``edit_cart_stale_hours`` (hours as plain integer string, e.g. "1").
DEFAULT_EDIT_CART_HOURS = 1
EDIT_CART_STALE_HOURS_KEY = 'edit_cart_stale_hours'
EDIT_CART_STALE_HOURS_DESCRIPTION = (
    'Hours before abandoned invoice-edit (EDIT-*) carts are auto-cleared '
    'on Active Carts / Invoice Edit. Fully invoice-covered carts clear immediately. '
    'Value: positive integer hours (default 1).'
)


def get_edit_cart_stale_hours() -> int:
    """
    Read EDIT cart TTL from Admin Settings (key=edit_cart_stale_hours).

    Ensures the Setting row exists so it appears in Django Admin.
    Invalid/missing values fall back to DEFAULT_EDIT_CART_HOURS.
    """
    from backend.core.models import Setting

    setting, created = Setting.objects.get_or_create(
        key=EDIT_CART_STALE_HOURS_KEY,
        defaults={
            'value': str(DEFAULT_EDIT_CART_HOURS),
            'description': EDIT_CART_STALE_HOURS_DESCRIPTION,
        },
    )
    if not created and not (setting.description or '').strip():
        setting.description = EDIT_CART_STALE_HOURS_DESCRIPTION
        setting.save(update_fields=['description', 'updated_at'])

    raw = (setting.value or '').strip()
    try:
        hours = int(raw)
    except (TypeError, ValueError):
        logger.warning(
            'Invalid %s=%r; using default %s',
            EDIT_CART_STALE_HOURS_KEY,
            raw,
            DEFAULT_EDIT_CART_HOURS,
        )
        return DEFAULT_EDIT_CART_HOURS
    if hours < 1:
        logger.warning(
            '%s must be >= 1 (got %s); using default %s',
            EDIT_CART_STALE_HOURS_KEY,
            hours,
            DEFAULT_EDIT_CART_HOURS,
        )
        return DEFAULT_EDIT_CART_HOURS
    return hours


def non_void_invoice_barcode_ids() -> set[int]:
    """Barcode IDs present on any invoice that is not void."""
    return set(
        InvoiceItem.objects.exclude(invoice__status='void')
        .exclude(barcode_id__isnull=True)
        .values_list('barcode_id', flat=True)
        .distinct()
    )


def resolve_barcode(barcode_value: str, *, for_update: bool = False) -> Barcode | None:
    """Look up a barcode by printed value or short code (case-insensitive trim)."""
    if not barcode_value:
        return None
    key = str(barcode_value).strip()
    if not key:
        return None
    qs = Barcode.objects.all()
    if for_update:
        qs = qs.select_for_update()
    return qs.filter(Q(barcode__iexact=key) | Q(short_code__iexact=key)).first()


def edit_cart_is_fully_invoice_covered(cart: Cart, protected_ids: set[int] | None = None) -> bool:
    """
    True when the cart is an EDIT-* cart and every scanned barcode is already on a
    non-void invoice (stale leftover; safe to clear immediately).
    Empty EDIT carts (no scanned barcodes) are treated as covered.
    """
    cart_number = (cart.cart_number or '').strip().upper()
    if not cart_number.startswith('EDIT-'):
        return False

    if protected_ids is None:
        protected_ids = non_void_invoice_barcode_ids()

    scanned_values: list[str] = []
    for item in cart.items.all():
        for bc in item.scanned_barcodes or []:
            if bc and str(bc).strip():
                scanned_values.append(str(bc).strip())

    if not scanned_values:
        return True

    # One query for the whole cart instead of per-barcode lookups.
    keys = {v.upper() for v in scanned_values}
    found = set(
        Barcode.objects.filter(
            Q(barcode__in=keys) | Q(short_code__in=keys) |
            Q(barcode__in=scanned_values) | Q(short_code__in=scanned_values)
        ).values_list('id', 'barcode', 'short_code')
    )
    # Case-insensitive match: rebuild lookup from DB rows
    by_key: dict[str, int] = {}
    for bc_id, barcode, short_code in found:
        if barcode:
            by_key[str(barcode).strip().upper()] = bc_id
        if short_code:
            by_key[str(short_code).strip().upper()] = bc_id

    for value in scanned_values:
        bc_id = by_key.get(value.upper())
        if bc_id is None or bc_id not in protected_ids:
            return False
    return True


def discard_cart_safely(
    cart: Cart,
    *,
    request=None,
    protected_ids: set[int] | None = None,
    skip_barcode_work: bool = False,
) -> dict:
    """
    Restore free cart-held inventory, preserve invoice-linked barcodes, delete cart.

    Returns a summary dict with counts for logging.

    ``skip_barcode_work``: when True (fully invoice-covered EDIT carts), only delete
    the cart row — barcode tags are already correct on the invoice.
    """
    summary = {
        'cart_id': cart.id,
        'cart_number': cart.cart_number,
        'released': 0,
        'preserved': 0,
        'missing': 0,
        'stock_restored_lines': 0,
    }

    with transaction.atomic():
        cart = Cart.objects.select_for_update().prefetch_related(
            'items', 'items__product', 'items__variant'
        ).get(pk=cart.pk)

        if skip_barcode_work:
            cart.delete()
            return summary

        if protected_ids is None:
            protected_ids = non_void_invoice_barcode_ids()

        for cart_item in cart.items.all():
            # Restore stock for non-tracked inventory items held by this cart.
            if not cart_item.product.track_inventory and cart.store:
                stock, _created = Stock.objects.select_for_update().get_or_create(
                    product=cart_item.product,
                    variant=cart_item.variant,
                    store=cart.store,
                    defaults={'quantity': Decimal('0.000')},
                )
                Stock.objects.filter(id=stock.id).update(
                    quantity=F('quantity') + cart_item.quantity,
                )
                summary['stock_restored_lines'] += 1

            if not cart_item.scanned_barcodes:
                continue

            for barcode_value in cart_item.scanned_barcodes:
                if not barcode_value:
                    continue
                barcode_obj = resolve_barcode(barcode_value, for_update=True)

                if barcode_obj is None:
                    summary['missing'] += 1
                    continue

                # Already on a live invoice — leave tag alone.
                if barcode_obj.id in protected_ids:
                    summary['preserved'] += 1
                    continue

                # Only release free reservations. Never flip sold -> new here.
                if barcode_obj.tag == 'in-cart':
                    old_tag = barcode_obj.tag
                    barcode_obj.tag = 'new'
                    barcode_obj.save(update_fields=['tag'])
                    invalidate_barcode_cache(barcode_obj)
                    summary['released'] += 1
                    if request is not None:
                        create_audit_log(
                            request=request,
                            action='barcode_tag_change',
                            model_name='Barcode',
                            object_id=str(barcode_obj.id),
                            object_name=cart_item.product.name,
                            object_reference=f"Cart #{cart.cart_number or cart.id}",
                            barcode=barcode_obj.barcode,
                            changes={
                                'tag': {'old': old_tag, 'new': 'new'},
                                'barcode': barcode_obj.barcode,
                                'product_id': cart_item.product.id,
                                'product_name': cart_item.product.name,
                                'cart_id': cart.id,
                                'cart_number': cart.cart_number,
                                'context': 'cart_discarded_safely',
                            },
                        )
                else:
                    # sold / defective / unknown / etc. without invoice link: leave alone
                    summary['preserved'] += 1

        cart.delete()

    return summary


# Keep Active Carts / Invoice Edit responsive when many orphans exist.
MAX_STALE_EDIT_CLEAR_PER_REQUEST = 15


def clear_stale_edit_carts(
    *,
    edit_hours: int | None = None,
    created_by=None,
    exclude_cart_ids: set[int] | None = None,
    request=None,
    limit: int = MAX_STALE_EDIT_CLEAR_PER_REQUEST,
) -> dict:
    """
    Opportunistically discard stale EDIT-* carts (no cron required).

    Clears carts that are either:
    - older than ``edit_hours`` (defaults to Admin Setting edit_cart_stale_hours), or
    - fully covered by non-void invoice barcodes (post-save orphans)

    Skips locked carts. Optionally scopes to ``created_by`` and excludes ids.
    Caps work per request so overview stays fast; remaining carts clear on later visits.
    """
    from backend.core.cache_signals import (
        invalidate_products_cache_manual,
        suspend_cache_signals,
    )

    if edit_hours is None:
        edit_hours = get_edit_cart_stale_hours()
    exclude_cart_ids = exclude_cart_ids or set()
    cutoff = timezone.now() - timedelta(hours=edit_hours)

    qs = (
        Cart.objects.filter(
            status__in=['active', 'held'],
            cart_number__istartswith='EDIT-',
        )
        .exclude(locked=True)
        .prefetch_related('items', 'items__product', 'items__variant')
        .order_by('updated_at')
    )
    if created_by is not None:
        qs = qs.filter(created_by=created_by)
    if exclude_cart_ids:
        qs = qs.exclude(id__in=exclude_cart_ids)

    protected_ids = non_void_invoice_barcode_ids()
    candidates: list[tuple[Cart, bool]] = []  # (cart, fully_covered)
    for cart in qs:
        if cart.id in exclude_cart_ids:
            continue
        fully_covered = edit_cart_is_fully_invoice_covered(cart, protected_ids)
        if cart.updated_at < cutoff or fully_covered:
            candidates.append((cart, fully_covered))
        if len(candidates) >= limit:
            break

    cleared = 0
    errors = 0
    with suspend_cache_signals():
        for cart, fully_covered in candidates:
            cart_number = cart.cart_number
            try:
                discard_cart_safely(
                    cart,
                    request=request,
                    protected_ids=protected_ids,
                    skip_barcode_work=fully_covered,
                )
                cleared += 1
            except Exception:
                errors += 1
                logger.exception('Failed opportunistic clear of edit cart %s', cart_number)

    if cleared:
        # One products-cache bust for the whole batch (signals were suspended).
        invalidate_products_cache_manual()
        logger.info(
            'Opportunistically cleared %s stale EDIT cart(s)%s',
            cleared,
            f' for user={getattr(created_by, "id", created_by)}' if created_by is not None else '',
        )

    return {
        'cleared': cleared,
        'errors': errors,
        'candidates': len(candidates),
        'limited': len(candidates) >= limit,
    }
