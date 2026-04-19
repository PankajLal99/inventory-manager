"""
Vocabulary for global product search ranking: lowercase alphanum tokens taken from active
`Brand.name` and `Category.name` strings (same tokenization as product-name ranking).

Used to detect queries typed roughly as "<brand> ... <category> ..." vs SKU titles that lead
with a non-brand token.

Cached in-process with a **2-day TTL** (refreshed from the DB when stale). Call
`invalidate_global_search_vocab_cache()` to drop the cache immediately (e.g. on Brand/Category
writes — see `backend.catalog.apps`).
"""
from __future__ import annotations

import re
import time
from typing import Optional

_TOKEN_RE = re.compile(r'[a-z0-9]+')

# Lazy refresh: reload from DB at most once per TTL (per process), or sooner if invalidated.
_CACHE_TTL_SECONDS = 2 * 24 * 60 * 60

_brand_tokens: Optional[frozenset[str]] = None
_category_tokens: Optional[frozenset[str]] = None
_loaded_at: float = 0.0


def invalidate_global_search_vocab_cache() -> None:
    global _brand_tokens, _category_tokens, _loaded_at
    _brand_tokens = None
    _category_tokens = None
    _loaded_at = 0.0


def _names_to_tokens(names) -> frozenset[str]:
    out: set[str] = set()
    for raw in names:
        if not raw:
            continue
        out.update(_TOKEN_RE.findall(str(raw).lower()))
    return frozenset(out)


def _refresh_vocab_if_stale() -> None:
    """Load Brand + Category tokens once if missing or older than ``_CACHE_TTL_SECONDS``."""
    global _brand_tokens, _category_tokens, _loaded_at

    now = time.time()
    if (
        _brand_tokens is not None
        and _category_tokens is not None
        and (now - _loaded_at) < _CACHE_TTL_SECONDS
    ):
        return

    from backend.catalog.models import Brand, Category

    brand_names = Brand.objects.filter(is_active=True).values_list('name', flat=True)
    category_names = Category.objects.filter(is_active=True).values_list('name', flat=True)
    _brand_tokens = _names_to_tokens(brand_names)
    _category_tokens = _names_to_tokens(category_names)
    _loaded_at = now


def get_global_search_brand_tokens() -> frozenset[str]:
    """Lowercase alphanum tokens from all active Brand names (cached, TTL 2 days)."""
    _refresh_vocab_if_stale()
    return _brand_tokens if _brand_tokens is not None else frozenset()


def get_global_search_category_tokens() -> frozenset[str]:
    """Lowercase alphanum tokens from all active Category names (cached, TTL 2 days)."""
    _refresh_vocab_if_stale()
    return _category_tokens if _category_tokens is not None else frozenset()
