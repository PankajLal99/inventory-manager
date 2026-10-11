"""
Emergency site-wide display mask.

When enabled, outbound JSON money fields are scaled by ``percent / 100``.
Database values and business logic are never mutated.

Activate via Admin-only API. Deactivate only via shell / DB (no UI disable).
"""
from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.core.cache import cache

SETTING_KEY = 'emergency_data_mask'
CACHE_KEY = 'emergency_data_mask:config'
CACHE_TTL_SECONDS = 30

DEFAULT_PERCENT = 3.0
MIN_PERCENT = 0.01
MAX_PERCENT = 100.0

# Paths whose responses must stay real so POS/credit cart recording can write back.
# Overview endpoints are display-only and are still masked.
SKIP_PATH_PREFIXES = (
    '/api/v1/pos/carts/',
    '/api/v1/credit/carts/',
)
# Display-only cart paths that should still be masked.
MASK_EVEN_UNDER_SKIP = (
    '/api/v1/pos/carts/overview/',
    '/api/v1/credit/carts/overview/',
)

# Exact keys never scaled (ids, counts, qty, rates, etc.)
DENY_KEYS = frozenset({
    'id', 'pk', 'count', 'page', 'page_size', 'pages', 'limit', 'offset',
    'quantity', 'qty', 'pending_qty', 'returned_quantity', 'returnable_quantity',
    'shop_quantity', 'warehouse_quantity', 'sold_count', 'stock', 'stock_qty',
    'rate', 'percent', 'percentage', 'ratio', 'tax_rate', 'discount_rate',
    'sort_order', 'priority', 'year', 'month', 'day', 'days', 'hours', 'minutes',
    'seconds', 'phone', 'pin', 'otp', 'status', 'code', 'sku', 'barcode',
    'short_code', 'invoice_number', 'purchase_number', 'bill_number',
    'enabled', 'active', 'is_active', 'emergency_mask_active',
    'emergency_mask_percent', 'name', 'label', 'type', 'date', 'username',
    'email', 'description',
})

# Money-rate keys that must be scaled despite the common `_rate` deny.
MONEY_RATE_KEYS = frozenset({
    'hourly_rate', 'hourly_rate_preview', 'daily_rate', 'weekly_rate',
    'monthly_rate', 'overtime_rate', 'wage_rate',
})

# Key looks like money if it matches these (case-insensitive).
MONEY_KEY_RE = re.compile(
    r'(?:^|_)(?:'
    r'amount|total|price|balance|due|paid|cost|revenue|sales|sale|profit|loss|'
    r'salary|wage|wages|advance|advances|booking|fee|fees|charge|charges|'
    r'receivable|payable|subtotal|mrp|net|gross|debit|credit|'
    r'line_total|tax_amount|discount_amount|display_total|computed_total|'
    r'computed_paid|stock_value|unit_price|selling_price|purchase_price|'
    r'manual_unit_price|accepted_return_price|original_sold_unit_price|'
    r'original_sold_line_total|booking_amount|credit_balance|paid_amount|'
    r'due_amount|net_salary|earned_salary|basic_salary|gross_salary|'
    r'total_advances|remaining|outstanding|receivables|payables|kpi|'
    r'cash|upi|inhand|value'
    r')s?$',
    re.IGNORECASE,
)

# Broader contains-match for nested KPI-style keys that don't end cleanly.
MONEY_CONTAINS = (
    'amount', 'total', 'price', 'balance', 'revenue', 'profit', 'loss',
    'salary', 'advance', 'receivable', 'payable', 'subtotal', 'stock_value',
    'booking', 'dues', 'due_', '_due', 'paid_', '_paid', 'credit_balance',
    'cash', 'upi', 'inhand', 'from_invoice', 'from_mixed', 'mix_cash', 'mix_upi',
    'manual_cash', 'manual_upi', 'retail_counter', 'defective', 'opening_cash',
    'closing_cash', 'credit_limit', 'order_value', 'hourly_rate', 'purchase_value',
    'discount_value', '_value',
)

_CURRENCY_PREFIX_RE = re.compile(
    r'^(?P<prefix>\s*(?:₹|rs\.?|inr)\s*)(?P<num>-?\d+(?:\.\d+)?)\s*$',
    re.IGNORECASE,
)


def default_config() -> dict:
    return {'enabled': False, 'percent': DEFAULT_PERCENT}


def _clamp_percent(value: Any) -> float:
    try:
        pct = float(value)
    except (TypeError, ValueError):
        return DEFAULT_PERCENT
    if pct < MIN_PERCENT:
        return MIN_PERCENT
    if pct > MAX_PERCENT:
        return MAX_PERCENT
    return pct


def _parse_config(raw: str | None) -> dict:
    cfg = default_config()
    if not raw:
        return cfg
    try:
        data = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return cfg
    if not isinstance(data, dict):
        return cfg
    cfg['enabled'] = bool(data.get('enabled', False))
    cfg['percent'] = _clamp_percent(data.get('percent', DEFAULT_PERCENT))
    return cfg


def get_emergency_mask_config(*, use_cache: bool = True) -> dict:
    if use_cache:
        cached = cache.get(CACHE_KEY)
        if isinstance(cached, dict):
            return cached

    from backend.core.models import Setting

    setting = Setting.objects.filter(key=SETTING_KEY).only('value').first()
    cfg = _parse_config(setting.value if setting else None)
    cache.set(CACHE_KEY, cfg, CACHE_TTL_SECONDS)
    return cfg


def is_emergency_mask_enabled(*, use_cache: bool = True) -> bool:
    return bool(get_emergency_mask_config(use_cache=use_cache).get('enabled'))


def _save_config(cfg: dict) -> dict:
    from backend.core.models import Setting

    cleaned = {
        'enabled': bool(cfg.get('enabled', False)),
        'percent': _clamp_percent(cfg.get('percent', DEFAULT_PERCENT)),
    }
    setting, _ = Setting.objects.get_or_create(
        key=SETTING_KEY,
        defaults={
            'value': json.dumps(cleaned),
            'description': 'Emergency display mask (hidden from admin UI)',
        },
    )
    setting.value = json.dumps(cleaned)
    if not setting.description:
        setting.description = 'Emergency display mask (hidden from admin UI)'
    setting.save(update_fields=['value', 'description', 'updated_at'])
    cache.set(CACHE_KEY, cleaned, CACHE_TTL_SECONDS)
    return cleaned


def activate_emergency_mask(percent: float | None = None) -> dict:
    """
    One-way activate. Does not expose a disable path for API/UI.
    Optional percent overrides the stored threshold (still clamped).
    """
    current = get_emergency_mask_config(use_cache=False)
    if percent is not None:
        current['percent'] = _clamp_percent(percent)
    elif not current.get('percent'):
        current['percent'] = DEFAULT_PERCENT
    current['enabled'] = True
    return _save_config(current)


def deactivate_emergency_mask() -> dict:
    """Shell/DB-only rollback helper. Not wired to any HTTP endpoint."""
    current = get_emergency_mask_config(use_cache=False)
    current['enabled'] = False
    return _save_config(current)


def set_emergency_mask_percent(percent: float) -> dict:
    """Update threshold without toggling enabled. Shell/DB-oriented."""
    current = get_emergency_mask_config(use_cache=False)
    current['percent'] = _clamp_percent(percent)
    return _save_config(current)


def should_skip_path(path: str | None) -> bool:
    if not path:
        return False
    normalized = path if path.endswith('/') else path + '/'
    for keep in MASK_EVEN_UNDER_SKIP:
        if path.startswith(keep.rstrip('/')) or normalized.startswith(keep):
            return False
    for prefix in SKIP_PATH_PREFIXES:
        if path.startswith(prefix.rstrip('/')) or normalized.startswith(prefix):
            return True
    return False


def _is_denied_key(key: str) -> bool:
    if not key:
        return True
    if key in DENY_KEYS:
        return True
    lower = key.lower()
    if lower in DENY_KEYS or lower.endswith('_id') or lower.endswith('_ids'):
        return True
    if lower.endswith('_count') or lower.endswith('_qty') or lower.endswith('_quantity'):
        return True
    if lower.endswith('_percent') or lower.endswith('_percentage'):
        return True
    if lower.endswith('_rate') and lower not in MONEY_RATE_KEYS:
        return True
    return False


def _is_money_key(key: str) -> bool:
    if _is_denied_key(key):
        return False
    lower = key.lower()
    if lower in MONEY_RATE_KEYS:
        return True
    if MONEY_KEY_RE.search(lower):
        return True
    return any(token in lower for token in MONEY_CONTAINS)


def _is_scalable_under_money_bag(key: str) -> bool:
    """Numeric leaves under cash_breakdown / kpis / etc. (e.g. repair, retail_counter)."""
    if _is_denied_key(key):
        return False
    lower = key.lower()
    # Explicit non-money labels that appear inside money bags
    if lower in {
        'name', 'label', 'type', 'status', 'date', 'sku', 'barcode',
        'username', 'email', 'description', 'store', 'store_name',
    }:
        return False
    return True


def _scale_number(value: Any, factor: Decimal) -> Any:
    if value is None or isinstance(value, bool):
        return value

    if isinstance(value, Decimal):
        scaled = (value * factor).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return scaled

    if isinstance(value, int) and not isinstance(value, bool):
        scaled = Decimal(value) * factor
        as_int = int(scaled.to_integral_value(rounding=ROUND_HALF_UP))
        return as_int

    if isinstance(value, float):
        scaled = float(Decimal(str(value)) * factor)
        return round(scaled, 2)

    if isinstance(value, str):
        text = value.strip()
        if not text or text in {'—', '-', '–', 'N/A', 'n/a'}:
            return value

        currency = _CURRENCY_PREFIX_RE.match(text)
        if currency:
            try:
                dec = Decimal(currency.group('num'))
            except (InvalidOperation, ValueError):
                return value
            scaled = (dec * factor).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            num_text = format(scaled, 'f').rstrip('0').rstrip('.') if '.' in format(scaled, 'f') else format(scaled, 'f')
            # Preserve compact original style (₹665 not ₹665.00 when input had no decimals)
            if '.' not in currency.group('num'):
                num_text = str(int(scaled.to_integral_value(rounding=ROUND_HALF_UP)))
            return f"{currency.group('prefix')}{num_text}"

        try:
            dec = Decimal(text)
        except (InvalidOperation, ValueError):
            return value
        scaled = (dec * factor).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if '.' not in text and 'e' not in text.lower():
            return str(int(scaled.to_integral_value(rounding=ROUND_HALF_UP)))
        return format(scaled, 'f')

    return value


def mask_value(
    data: Any,
    factor: Decimal,
    key: str | None = None,
    *,
    under_money_bag: bool = False,
) -> Any:
    if isinstance(data, dict):
        out = {}
        for k, v in data.items():
            child_bag = under_money_bag or _is_money_key(k)
            if isinstance(v, (dict, list)):
                out[k] = mask_value(v, factor, key=k, under_money_bag=child_bag)
            elif _is_money_key(k) or (under_money_bag and _is_scalable_under_money_bag(k)):
                out[k] = _scale_number(v, factor)
            else:
                out[k] = v
        return out

    if isinstance(data, list):
        return [
            mask_value(item, factor, key=key, under_money_bag=under_money_bag)
            for item in data
        ]

    if key is not None and (
        _is_money_key(key) or (under_money_bag and _is_scalable_under_money_bag(key))
    ):
        return _scale_number(data, factor)

    return data


def apply_emergency_mask(data: Any, percent: float | None = None) -> Any:
    cfg = get_emergency_mask_config()
    if not cfg.get('enabled'):
        return data
    pct = _clamp_percent(percent if percent is not None else cfg.get('percent', DEFAULT_PERCENT))
    factor = Decimal(str(pct)) / Decimal('100')
    return mask_value(data, factor)
