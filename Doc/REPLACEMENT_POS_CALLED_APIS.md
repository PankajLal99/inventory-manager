# Replacement POS — APIs called from the UI

This document lists **only** the HTTP APIs invoked by `frontend/src/pages/replacement/ReplacementPOS.tsx`, how the frontend calls them (`frontend/src/lib/api.ts`), and where they are implemented in Django.

For product behaviour (pending vs instant, ledger, checkout), see also `Doc/REPLACEMENT_POS_TSX_REDEVELOPMENT.md`.

---

## Base URL and auth

| Item | Detail |
|------|--------|
| **API root** | Paths below are **relative to** the axios `baseURL` (typically `…/api/v1` from `VITE_API_URL` / `window.__ENV__`; see `frontend/src/lib/api.ts`). Full URL example: `{baseURL}/customers/`. |
| **Django mount** | Project includes POS and parties under `path('api/v1/', …)` in `backend/config/urls.py`. |
| **Auth** | `Authorization: Bearer <access_token>` (interceptor in `frontend/src/lib/api.ts`). All listed endpoints use **`IsAuthenticated`**. |
| **Tenant** | Replacement POS **create** requires an **active retailer** context (`require_active_retailer`). Customer list is also retailer-scoped. |

---

## Summary table (calls from `ReplacementPOS.tsx`)

| # | When | Frontend helper | HTTP | Path (under `api/v1`) | Django view |
|---|------|-----------------|------|----------------------|-------------|
| 1 | Customer typeahead (`search` ≥ 2 chars) | `customersApi.list({ search })` | **GET** | `/customers/?search=…` | `customer_list_create` (GET branch) — `backend/parties/views.py`; route `backend/parties/urls.py` |
| 2 | Barcode lookup | `posApi.replacement.replacementPos.lookup({ barcode })` | **POST** | `/pos/replacement-pos/lookup/` | `replacement_pos_lookup` — `backend/pos/views.py`; route `backend/pos/urls.py` |
| 3 | Submit return | `posApi.replacement.replacementPos.create(payload)` | **POST** | `/pos/replacement-pos/create/` | `replacement_pos_create` — `backend/pos/views.py`; route `backend/pos/urls.py` |

> **Note:** `frontend/src/lib/api.ts` also defines a top-level alias `posApi.replacementPos.lookup/create` with the same URLs. The Replacement POS page uses **`posApi.replacement.replacementPos`**.

---

## 1. Customer search (autocomplete)

**Called from:** `useQuery` → `customersApi.list({ search: q })`.

| | |
|--|--|
| **Method / path** | `GET /customers/` |
| **Query params** | `search` — free text; filters `name`, `phone`, `email` (icontains). Other list filters exist (`customer_group`, etc.) but Replacement POS does **not** send them. |
| **Response** | JSON **array** of customers (up to **100** rows), serialized with `CustomerSerializer` (`backend/parties/views.py`). Frontend also tolerates paginated `{ results: [] }` if ever returned. |
| **Errors** | Non-200 if unauthenticated; tenant/restrictions per `require_active_retailer` on GET. |

---

## 2. Replacement POS — lookup sold line

**Called from:** lookup mutation → `posApi.replacement.replacementPos.lookup({ barcode })`.

| | |
|--|--|
| **Method / path** | `POST /pos/replacement-pos/lookup/` |
| **Body (JSON)** | `barcode` (string) — **required** for the UI. Backend also accepts **`scanned`** as an alternative key (same meaning). Value is **trimmed** and uppercased server-side. |
| **Success — single match** | `200` `{ "ambiguous": false, "line": { … } }`. Line shape from `_serialize_replacement_pos_lookup_line` (e.g. `original_invoice_item_id`, `original_invoice_id`, `original_invoice_number`, store/customer/product fields, barcode fields, `sold_unit_price`, `quantity`, `barcode_tag`). |
| **Success — ambiguous** | `200` `{ "ambiguous": true, "matches": [ … ] }` (up to **25** lines). |
| **Errors** | `400` missing barcode; `400` barcode not eligible (validation message); `404` no sold line found. Payload often includes `error` and sometimes `message`. |

**Django name:** `replacement-pos-lookup` (for `reverse()` in tests).

---

## 3. Replacement POS — create replacement-return invoice

**Called from:** create mutation → `posApi.replacement.replacementPos.create(payload)`.

| | |
|--|--|
| **Method / path** | `POST /pos/replacement-pos/create/` |
| **Body (JSON)** | See below. |

### Request body fields

| Field | Type | Notes |
|-------|------|--------|
| `mode` | string | **`pending`** \| **`instant`** (required). |
| `lines` | array | Non-empty. Each element: **`original_invoice_item_id`** (int), **`return_tag`** or **`replacement_return_tag`** (`returned` \| `unknown` \| `defective`), **`accepted_return_price`** (must parse to **>** `0`). |
| `customer` | int / null | Optional override; must belong to retailer. |
| `settlement_invoice_type` | string | Optional for create; defaults **`cash`**. Allowed: **`cash`**, **`upi`**, **`mixed`**, **`credit`**. Applied when **`mode === instant`** for checkout semantics. |
| `cash_amount` | string/number | Required when **`settlement_invoice_type === mixed`** (`instant`). |
| `upi_amount` | string/number | Required when **`settlement_invoice_type === mixed`** (`instant`). |
| `store` | int | Optional; if sent, **must equal** store inferred from all original lines. |

Backend validates retailer, duplicate line IDs, single store, original invoice status/eligibility, price ceiling vs original sold unit, barcode eligibility, mixed split vs invoice total, etc.

### Successful response

| | |
|--|--|
| **Status** | `201 Created` |
| **Body** | Serialized invoice: `InvoiceSerializer` output for the new replacement-return **`Invoice`** (includes **`id`**). The frontend navigates to `/invoices/<id>` (separate route; **invoice detail load** uses `GET /pos/invoices/<id>/` from another page—not issued inside `ReplacementPOS.tsx`). |

### Error response

Typically `400` with `{ "error": "…", "message": "…" }` fragments depending on validation path; some errors omit `message`.

**Django name:** `replacement-pos-create`.

---

## Follow-on (not called from `ReplacementPOS.tsx`)

After navigation to the invoice screen, the app loads the invoice with **`posApi.invoices.get(id)`** → `GET /pos/invoices/<id>/` (`invoice_detail` in `backend/pos/views.py`). That call is **outside** this page but is the natural next network request in the user flow.

---

## Automated tests (backend)

Replacement POS behaviour is covered in **`backend/pos/tests.py`** using:

- `reverse('replacement-pos-lookup')`
- `reverse('replacement-pos-create')`

Use those tests as executable documentation for edge cases and regression expectations.
