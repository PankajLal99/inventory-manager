"""Helpers for recording when POS cart lines / barcodes were scanned and locked into a cart."""
from __future__ import annotations

from django.utils import timezone
from django.utils.dateparse import parse_datetime


def _iso_now() -> str:
    return timezone.now().isoformat()


def _barcode_key(barcode: str) -> str:
    return str(barcode or '').strip().upper()


def record_barcode_scan(cart_item, barcode: str) -> None:
    """Record server time when a barcode is locked into the cart."""
    key = _barcode_key(barcode)
    if not key:
        return
    times = dict(cart_item.barcode_scanned_at or {})
    times[key] = _iso_now()
    cart_item.barcode_scanned_at = times


def remove_barcode_scan(cart_item, barcode: str) -> None:
    """Drop scan time when a barcode is removed from the cart line."""
    if not barcode:
        return
    times = dict(cart_item.barcode_scanned_at or {})
    key = _barcode_key(barcode)
    times.pop(key, None)
    for k in list(times.keys()):
        if _barcode_key(k) == key:
            times.pop(k, None)
    cart_item.barcode_scanned_at = times


def pop_last_barcode_scan(cart_item) -> None:
    """Remove scan time for the last barcode when decrementing tracked qty."""
    barcodes = cart_item.scanned_barcodes or []
    if not barcodes:
        return
    remove_barcode_scan(cart_item, barcodes[-1])


def ensure_line_scanned_at(cart_item) -> None:
    """First add time for lines without per-barcode tracking (custom / non-tracked)."""
    if cart_item.scanned_at is None:
        cart_item.scanned_at = timezone.now()


def barcode_scan_iso(times: dict, barcode: str):
    """Return stored ISO string for a barcode, or None."""
    if not times or not barcode:
        return None
    key = _barcode_key(barcode)
    iso = times.get(key)
    if iso:
        return iso
    for k, v in times.items():
        if _barcode_key(k) == key:
            return v
    return None


def scanned_times_list(cart_item) -> list:
    """ISO timestamps aligned with scanned_barcodes for API consumers."""
    times = cart_item.barcode_scanned_at or {}
    result = []
    for bc in cart_item.scanned_barcodes or []:
        if not bc:
            result.append(None)
            continue
        result.append(barcode_scan_iso(times, bc))
    return result


def lookup_barcode_scan_time(cart_item, barcode: str):
    """Return aware datetime for a barcode on this line, or None."""
    if not barcode:
        return None
    iso = barcode_scan_iso(cart_item.barcode_scanned_at or {}, barcode)
    return parse_scan_time(iso)


def parse_scan_time(iso_value):
    if not iso_value:
        return None
    parsed = parse_datetime(str(iso_value))
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed
