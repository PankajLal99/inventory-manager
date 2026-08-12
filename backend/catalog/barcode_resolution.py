"""Strict Barcode lookups: barcode and short_code are globally unique — use get(), never queryset.first()."""

import re

from backend.catalog.models import Barcode


def clean_scanned_barcode(barcode_str: str) -> str:
    """Trim, drop scanner-inserted whitespace, uppercase.

    Physical scanners often insert a space next to a slash, e.g. "ON/ -0185" vs "ON/-0185".
    """
    if not barcode_str:
        return ''
    return re.sub(r'\s+', '', str(barcode_str).strip()).upper()


def get_catalog_barcode_by_printed_value(raw: str):
    """Return the single Barcode row for this printed value, or None."""
    if raw is None:
        return None
    raw = clean_scanned_barcode(raw)
    if not raw:
        return None
    try:
        return Barcode.all_objects.get(barcode=raw)
    except Barcode.DoesNotExist:
        try:
            return Barcode.all_objects.get(short_code=raw)
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
