"""Strict Barcode lookups: barcode and short_code are globally unique — use get(), never queryset.first()."""

import re

from django.db.models import Q, Value
from django.db.models.functions import Replace, Upper

from backend.catalog.models import Barcode


def clean_scanned_barcode(barcode_str: str) -> str:
    """Trim, drop scanner-inserted whitespace, uppercase.

    Physical scanners often insert a space next to a slash, e.g. "ON/ -0185" vs "ON/-0185".
    """
    if not barcode_str:
        return ''
    return re.sub(r'\s+', '', str(barcode_str).strip()).upper()


def compact_stored_barcode_expr(field_name: str):
    """SQL: strip spaces from a stored barcode/short_code, then uppercase.

    Matches clean_scanned_barcode() so "DD -0002" in the DB equals search "DD-0002".
    """
    return Upper(Replace(field_name, Value(' '), Value('')))


def get_barcode_matching_printed_value(raw: str, queryset=None):
    """Return the single Barcode row for this printed value, or None.

    Tries indexed exact barcode/short_code first, then compares after stripping
    spaces from the stored values (DB may contain "DD -0002" while search is "DD-0002").
    """
    cleaned = clean_scanned_barcode(raw)
    if not cleaned:
        return None

    qs = queryset if queryset is not None else Barcode.objects
    try:
        return qs.get(barcode=cleaned)
    except Barcode.DoesNotExist:
        pass
    except Barcode.MultipleObjectsReturned:
        raise

    try:
        return qs.get(short_code=cleaned)
    except Barcode.DoesNotExist:
        pass
    except Barcode.MultipleObjectsReturned:
        raise

    compact_qs = qs.annotate(
        _barcode_compact=compact_stored_barcode_expr('barcode'),
        _short_code_compact=compact_stored_barcode_expr('short_code'),
    )
    try:
        return compact_qs.get(Q(_barcode_compact=cleaned) | Q(_short_code_compact=cleaned))
    except Barcode.DoesNotExist:
        return None
    except Barcode.MultipleObjectsReturned:
        raise


def get_catalog_barcode_by_printed_value(raw: str):
    """Return the single Barcode row for this printed value, or None."""
    if raw is None:
        return None
    return get_barcode_matching_printed_value(raw, queryset=Barcode.all_objects)


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
