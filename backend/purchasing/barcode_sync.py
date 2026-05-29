"""
Keep purchase line barcodes aligned with quantity (increase / decrease / zero).
"""
from decimal import Decimal
from typing import Any, Dict, List, Tuple


def _trim_deletable_barcodes(purchase_item, qty_to_remove: int) -> int:
    """Remove up to qty_to_remove newest non-sold, non-in-cart barcodes. Returns count removed."""
    if qty_to_remove <= 0:
        return 0

    from backend.catalog.models import Barcode
    from backend.catalog.azure_label_service import delete_blobs_for_barcodes_async

    deletable = (
        Barcode.objects.filter(purchase_item=purchase_item)
        .exclude(tag__in=['sold', 'in-cart'])
        .order_by('-created_at')
    )
    count_to_delete = min(int(qty_to_remove), deletable.count())
    if count_to_delete <= 0:
        return 0

    barcode_ids = list(deletable.values_list('id', flat=True)[:count_to_delete])
    Barcode.objects.filter(id__in=barcode_ids).delete()
    delete_blobs_for_barcodes_async(barcode_ids)
    return count_to_delete


def sync_barcodes_to_quantity(purchase_item) -> Tuple[int, int]:
    """
    Align barcode rows with purchase_item.quantity.

    - Increase: create missing barcodes (and labels are queued separately).
    - Decrease: remove newest deletable barcodes (sold / in-cart are kept).
    - Qty 0: remove all deletable barcodes.

    Returns (added_count, removed_count).
    """
    from backend.catalog.models import Barcode

    product = purchase_item.product
    if not product:
        return 0, 0

    target = int(Decimal(str(purchase_item.quantity or 0)))
    if target < 0:
        target = 0

    sold_count = Barcode.objects.filter(purchase_item=purchase_item, tag='sold').count()
    if target < sold_count:
        return 0, 0

    from backend.purchasing.serializers import generate_barcodes_for_purchase_item

    if not product.track_inventory:
        total = Barcode.objects.filter(purchase_item=purchase_item).count()
        if target <= 0:
            removed = _trim_deletable_barcodes(purchase_item, total)
            return 0, removed
        if total == 0:
            generate_barcodes_for_purchase_item(purchase_item, 1)
            return 1, 0
        return 0, 0

    total = Barcode.objects.filter(purchase_item=purchase_item).count()
    if total < target:
        shortfall = target - total
        generate_barcodes_for_purchase_item(purchase_item, shortfall)
        return shortfall, 0

    if total > target:
        removed = _trim_deletable_barcodes(purchase_item, total - target)
        return 0, removed

    return 0, 0


def sync_all_purchase_item_barcodes(purchase) -> Tuple[int, int]:
    """Sync every line on a purchase. Returns (total_added, total_removed)."""
    added = removed = 0
    for item in purchase.items.select_related('product'):
        a, r = sync_barcodes_to_quantity(item)
        added += a
        removed += r
    return added, removed


def _expected_barcode_count(purchase_item) -> int:
    """How many barcode rows this line should have after sync."""
    product = purchase_item.product
    if not product:
        return 0
    qty = int(Decimal(str(purchase_item.quantity or 0)))
    if qty <= 0:
        return 0
    if not product.track_inventory:
        return 1
    return qty


def audit_purchase_barcodes(purchase) -> Dict[str, Any]:
    """Report per-line expected vs actual barcode counts (after sync)."""
    from backend.catalog.models import Barcode

    lines: List[Dict[str, Any]] = []
    all_complete = True

    for item in purchase.items.select_related('product'):
        expected = _expected_barcode_count(item)
        actual = Barcode.objects.filter(purchase_item=item).count()
        complete = actual == expected
        if not complete:
            all_complete = False
        if expected > 0 or actual > 0:
            lines.append({
                'purchase_item_id': item.id,
                'product_id': item.product_id,
                'product_name': item.product.name if item.product else None,
                'quantity': str(item.quantity),
                'expected_barcodes': expected,
                'actual_barcodes': actual,
                'complete': complete,
            })

    return {'all_complete': all_complete, 'lines': lines}


def ensure_purchase_barcodes_on_save(purchase) -> Dict[str, Any]:
    """
    Run on every purchase Save: reconcile barcodes to line qty, verify, retry once if needed.
    """
    added, removed = sync_all_purchase_item_barcodes(purchase)
    audit = audit_purchase_barcodes(purchase)

    if not audit['all_complete']:
        added2, removed2 = sync_all_purchase_item_barcodes(purchase)
        added += added2
        removed += removed2
        audit = audit_purchase_barcodes(purchase)

    return {
        'barcodes_added': added,
        'barcodes_removed': removed,
        'all_barcodes_present': audit['all_complete'],
        'lines': audit['lines'],
    }
