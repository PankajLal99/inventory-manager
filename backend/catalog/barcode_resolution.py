"""Strict Barcode lookups per retailer: barcode and short_code are unique within a retailer — use get(), never queryset.first()."""

from backend.catalog.models import Barcode


def get_catalog_barcode_by_printed_value(raw: str, retailer_id: int | None = None):
    """Return the single Barcode row for this printed value, or None.

    When retailer_id is set, resolution is scoped to that tenant.
    When retailer_id is None (legacy callers), search is unrestricted (single-tenant DBs only).
    """
    if raw is None:
        return None
    raw = str(raw).strip().upper()
    if not raw:
        return None
    qs = Barcode.all_objects.all()
    if retailer_id is not None:
        qs = qs.filter(retailer_id=retailer_id)
    try:
        return qs.get(barcode=raw)
    except Barcode.DoesNotExist:
        try:
            return qs.get(short_code=raw)
        except Barcode.DoesNotExist:
            return None
    except Barcode.MultipleObjectsReturned:
        raise


def single_barcode_for_untracked_product(product):
    """Pick one catalog barcode for POS validation when the line has no barcode (non-tracked). Never first()."""
    if not product:
        return None
    try:
        return product.barcodes.filter(is_primary=True).get()
    except Barcode.DoesNotExist:
        pass
    except Barcode.MultipleObjectsReturned:
        return None
    n = product.barcodes.count()
    if n == 1:
        return product.barcodes.get()
    return None
