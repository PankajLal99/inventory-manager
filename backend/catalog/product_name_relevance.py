"""
Shared relevance ordering for product name search (name_only), used by global search and GET /products/.
"""
from __future__ import annotations

import heapq
import re
from collections import Counter
from difflib import SequenceMatcher

from backend.catalog.global_search_vocab import (
    get_global_search_brand_tokens,
    get_global_search_category_tokens,
)

_PRODUCT_NAME_TOKEN_RE = re.compile(r'[a-z0-9]+')


def order_product_ids_by_name_relevance(pairs, query: str, limit: int) -> list[int]:
    """
    Order product ids by practical relevance for tokenized name search.

    ProductFilter(name_only) already enforces token matching; within that set we want:
    - multiset token coverage (query words treated as a bag) so permutations like
      "OLED FOLDER IPHONE X ..." still rank highly for "iPhone X OLED FOLDER"
    - when users type "<MODEL> ... <PART ...>" but SKUs are stored as "<PART ...> <MODEL> ...",
      gently prefer the SKU-shaped ordering (without breaking normal substring/exact matches).
      Query shape uses active Brand + Category name tokens (cached): first word vs last word of the query.
      A part-first SKU boost treats a non-brand leading product token as the "accessory-first" layout.
    - among remaining candidates, prefer names whose *token order* is closer to the typed query
      (SequenceMatcher on whitespace tokens), with exact/substring matches as tie-breakers
    - tighter clustering of matched tokens (smaller span) before length / lexical tie-breakers

    `pairs` is a list of dicts: {'id': int, 'name': str}
    """
    if not pairs or not query:
        return []

    q = (query or '').strip()
    if not q:
        return [p['id'] for p in pairs][:limit]

    q_lower = q.lower()
    tokens = [t for t in q_lower.split() if t]
    if not tokens:
        return [p['id'] for p in pairs][:limit]

    brand_tokens = get_global_search_brand_tokens()
    category_tokens = get_global_search_category_tokens()
    qcnt = Counter(tokens)
    q_keys = frozenset(qcnt)
    tokens_len = len(tokens)
    query_part_first_eligible = (
        tokens_len >= 2
        and tokens[0] in brand_tokens
        and tokens[-1] in category_tokens
    )

    def _multiset_hits(name_tokens: list[str]) -> int:
        if not name_tokens:
            return 0
        nc: dict[str, int] = {}
        for t in name_tokens:
            if t in q_keys:
                nc[t] = nc.get(t, 0) + 1
        return sum(min(c, nc.get(t, 0)) for t, c in qcnt.items())

    def score_row(name: str) -> tuple:
        if not name:
            return (-0, 1, 0.0, 999, 10**9, 10**9, 10**9, 999, '')

        n = name.lower()

        if n == q_lower:
            tier = 0
        elif n.startswith(q_lower):
            tier = 1
        elif q_lower in n:
            tier = 2
        else:
            tier = 3

        name_tokens = _PRODUCT_NAME_TOKEN_RE.findall(n)
        token_hits = _multiset_hits(name_tokens)

        occ: dict[str, list[int]] = {}
        for idx, t in enumerate(name_tokens):
            occ.setdefault(t, []).append(idx)

        ptr: dict[str, int] = {t: 0 for t in occ}
        positions: list[int] = []
        missing = 0
        for tok in tokens:
            lst = occ.get(tok)
            if not lst:
                missing += 1
                continue
            p = ptr.get(tok, 0)
            if p >= len(lst):
                missing += 1
                continue
            positions.append(lst[p])
            ptr[tok] = p + 1

        if missing > 0:
            order_sim = SequenceMatcher(
                a=tokens,
                b=name_tokens,
                autojunk=False,
            ).ratio()
            return (-token_hits, 1, -order_sim, 40 + tier, missing, 10**9, len(n), tier, name)

        span = max(positions) - min(positions) if positions else 0
        inversions = 0
        lp = len(positions)
        for i in range(lp):
            pi = positions[i]
            for j in range(i + 1, lp):
                if pi > positions[j]:
                    inversions += 1

        name_len = len(n)

        order_sim = SequenceMatcher(
            a=tokens,
            b=name_tokens,
            autojunk=False,
        ).ratio()

        full_token_coverage = token_hits >= tokens_len
        effective_tier = 3 if full_token_coverage else tier

        part_first_boost = False
        if full_token_coverage and query_part_first_eligible and name_tokens:
            nf = name_tokens[0]
            part_first_boost = nf != tokens[0] and nf not in brand_tokens

        return (
            -token_hits,
            0 if part_first_boost else 1,
            -order_sim,
            effective_tier,
            inversions,
            span,
            name_len,
            tier,
            name,
        )

    if limit >= len(pairs):
        scored = sorted(pairs, key=lambda p: score_row(p.get('name') or ''))
    else:
        scored = heapq.nsmallest(limit, pairs, key=lambda p: score_row(p.get('name') or ''))
    return [p['id'] for p in scored[:limit]]
