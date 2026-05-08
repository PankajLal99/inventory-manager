# ReplacementPOS.tsx - Redevelopment Guide

> **Backend note (verify on your checkout):** Replacement POS APIs are implemented in `backend/pos/views.py` and mounted at hyphenated paths **`pos/replacement-pos/...`** (not `pos/replacement/pos/...`). The frontend should call **`/pos/replacement-pos/lookup/`** and **`/pos/replacement-pos/create/`** relative to `VITE_API_URL` (`/api/v1` prefix comes from Django `backend/config/urls.py`).
>
> **HTTP reference (exact calls from the Replacement POS page):** see `Doc/REPLACEMENT_POS_CALLED_APIS.md`.

## Scope
This document explains how `frontend/src/pages/replacement/ReplacementPOS.tsx` works, how it maps to **live backend** Replacement POS endpoints, and what shared modules/models are involved so UI/UX and backend can redevelop safely.

---

## What This Page Does
- Provides a barcode-first replacement **return POS** flow: resolve **already-sold** `InvoiceItem` rows by scanned barcode/short code, collect per-line **`return_tag`** and **`accepted_return_price`**, then create a dedicated **replacement-return invoice** (`Invoice.is_replacement_return`).
- **`mode`**:
  - **`pending`**:Creates the invoice as **`status=draft`**, **`invoice_type=pending`**. Ledger/stock finalize **later** when the invoice is completed through the usual invoice checkout path that applies replacement POS checkout semantics.
  - **`instant`**: After creating line items on that same invoice in one transaction, the server runs **`_apply_replacement_pos_checkout`**, which settles the invoice (paid zero due), writes the **replacement settlement ledger credit**, updates barcode tags, and optionally restocks tracked/untracked quantities by tag (`defective` vs returned path).
- **`settlement_invoice_type`** is used only when **`mode == instant`** and must be one of: `cash` | `upi` | `mixed` | `credit`. **`mixed`** requires **`cash_amount`** and **`upi_amount`**; their sum must equal the invoice **total**.
- **`customer`** is optional UI override when original lines span multiple invoice customers (`replacement_customer_warning` is set accordingly on the invoice).

---

## High-Level User Flow
1. Operator opens page (barcode field focused).
2. Operator scans/types normalized barcode/sticker → **lookup**.
3. If **ambiguous**, pick one suggested line; backend returns up to 25 candidates.
4. Operator sets **traffic-light / tag** (`returned` | `unknown` | `defective`) **per line**.
5. Operator enters **`accepted_return_price`** for **every line** (required by API **for both modes**).
6. Operator chooses **`mode`** (+ settlement when **`instant`**), optional customer override, submit **create**.
7. API returns **`201`** with serialized **`Invoice`** (includes `id`); UI navigates to `/invoices/:id`.

---

## Frontend Wiring
- **`customersApi.list({ search })`** — autocomplete when query length ≥ 2.
- **`posApi.replacement.replacementPos.lookup({ barcode })`** → `POST /pos/replacement-pos/lookup/` with JSON body `{ barcode }` (backend also accepts **`scanned`** as an alias — see Backend section).
- **`posApi.replacement.replacementPos.create(payload)`** → `POST /pos/replacement-pos/create/`.

Reuse: React Query mutations, UI kit (`Button`, `Input`, `Select`), `BarcodeScanner`, `ToastContainer`, `formatNumber`, `getProductNameColor`.

---

## Backend — URLs and views
Mounted under **`api/v1/`** alongside other POS routes (`backend/config/urls.py` includes `backend.pos.urls`):

| Django name | HTTP | Path suffix |
|---|---|---|
| `replacement-pos-lookup` | POST | `/pos/replacement-pos/lookup/` |
| `replacement-pos-create` | POST | `/pos/replacement-pos/create/` |

Implementations **`replacement_pos_lookup`** and **`replacement_pos_create`** live in **`backend/pos/views.py`** (helper functions prefixed `_replacement_pos_*` and **`_apply_replacement_pos_checkout`** above them).

**Automated regression:** `backend/pos/tests.py` exercises lookup/create (URL reverses **`replacement-pos-lookup`** / **`replacement-pos-create`**).

---

## Backend — Lookup contract (`replacement_pos_lookup`)
- **Request body**: `barcode` **or** `scanned` (trimmed uppercased). Missing → `400` `barcode is required`.
- **Selection logic**: Matches `InvoiceItem` with `quantity > 0`, invoice **`status` ∈ {`paid`,`partial`,`credit`}**, keyed by barcode FK field **or** `sold_barcode_value`, ordered newest sale first.
- **Ambiguous**: `200` **`{ ambiguous: true, matches: LookupLine[] }`** (truncated **25** candidates).
- **Single match**: `200` **`{ ambiguous: false, line: LookupLine }`**, after **`validate_barcode_for_replacement`** on resolved barcode(s). If invalid → `400` with `error`/`message`.

**Serialized line (`_serialize_replacement_pos_lookup_line`)** includes fields such as: `original_invoice_item_id`, `original_invoice_number`, **`original_invoice_id`**, **`store_id`/`store_name`**, **`customer_id`/`customer_name`**, **`product_id`/`product_name`/`product_sku`**, **`sold_barcode_value`/`barcode_short`/`barcode_full`/`barcode_id`**, **`barcode_tag`**, **`sold_unit_price`** (effective unit = `manual_unit_price` then `unit_price`), **`quantity`**.

---

## Backend — Create contract (`replacement_pos_create`)
- **`require_active_retailer`** must pass (tenant-aware).
- **Top-level**: `mode` ∈ {`instant`,`pending`}; `lines` required non-empty list; optional `customer` id; **`settlement_invoice_type`** defaults `cash` if omitted; **`store`** optional but if present **must equal** inferred store id from scanned lines.

**Lines** (`lines[]`): each requires:
- **`original_invoice_item_id`**
- **`return_tag`** or alias **`replacement_return_tag`**: **`returned` | `unknown` | `defective`**
- **`accepted_return_price`**: strictly **>** `0` (Decimal-parsed — **missing/zero/sentinel zero rejected** regardless of pending vs instant)

**Structural rules:**
- Duplicate `original_invoice_item_id` in one request → `400`.
- All original lines required to exist within **same retailer**.
- Derived **single store**: all originals must belong to same `invoice.store`; else **`400`** *“Original sales span multiple stores.”*

**Pricing rules:**
- For each `(line, InvoiceItem)`, accepted price must be **≤** effective sold ceiling (`manual_unit_price` else `unit_price`); otherwise `400`.

**Customer warning:**
- If originals reference multiple distinct invoice customers (`replacement_source_customers` JSON differs), **`replacement_customer_warning = true`**; optional request **`customer`** must be a **`Customer`** in same retailer (`get_object_or_404`).

**Persistence (atomic):**
Creates `Invoice`:
- **`is_replacement_return = True`**
- **`replacement_mode = mode`**
- **`replacement_customer_warning`** + **`replacement_source_customers`** (JSON rows with customer invoice provenance helpers)

Creates `InvoiceItem` rows cloning product/variant/barcodes from originals with:
- **`manual_unit_price` = accepted return unit**
- **`unit_price`** snapshot of historical sold effective unit (`original_*` linkage + snapshot fields populated)
- **`replacement_return_tag`**, **`accepted_return_price`**, links **`original_invoice`**, **`original_invoice_item`**, string snapshots (**`original_invoice_number`**, **`original_customer_name`**, etc.)

**After line insert:** **`update_invoice_totals`**.

**If `mode == instant`:** invokes **`_apply_replacement_pos_checkout(invoice, request, settlement_type, cash_amt?, upi_amt?)`**:
- Validates all lines priced, barcode eligibility, **`mixed`** split totals == invoice **`total`**.
- Sets invoice **`status=paid`**, **`paid_amount=total`**, **`due_amount=0`**, sets **`invoice_type`** to **`settlement_invoice_type`**.
- Deletes **existing `Payment` rows** and reverses stray payment-linked ledger postings (see extensive docstring in code for why).
- Writes **exactly one ledger `credit`** (**`replacement_pos_checkout`** audit) increasing customer **`credit_balance`**, annotated with settlement description (**CASH / UPI / MIXED / CREDIT**).
- Iterates barcode + stock increments per tag (**`defective`** avoids stock bump; **`returned`/`unknown`** restock semantics per tracked vs single virtual barcode helpers).

Returns **`InvoiceSerializer`** data **`201`**; transaction-level **`ValueError`** → `400`.

---

## Database models touched (replacement POS additions)
Formal schema introduction: Django migration **`0035_replacement_pos_invoice_fields.py`** (+ merge **`0037_...`** if present). Core pieces:

 **`Invoice`** (replacement POS semantics):
- `is_replacement_return` (**indexed** bool)
- `replacement_mode`
- `replacement_customer_warning`
- `replacement_source_customers` (JSON list summarizing originating invoice/customer combos)

 **`InvoiceItem`**:
- FK **`original_invoice`**, FK **`original_invoice_item`**
- **`replacement_return_tag`**, **`accepted_return_price`**
- **`original_sold_unit_price`**, **`original_sold_line_total`**
- **`original_invoice_number`**, **`original_customer_name`**

Older replacement tracking fields (**`replaced_quantity`**, etc.) remain adjacent for other Replacement Module flows — Replacement POS layering reuses linkage/snapshot fields primarily above.

 **`core.AuditLog` actions**: `replacement_pos_create`, `replacement_pos_checkout`.

---

## Backend vs legacy `/pos/replacement/...`
The older replacement endpoints (`replacement_check`, `process_replacement`, `replacement_return`, etc.) coexist for non–Replacement-POS workflows. Replacement POS endpoints are **`/pos/replacement-pos/...`** and create **standalone `Invoice`** documents rather than invoking only legacy tag flips alone.

---

## Frontend validation sanity check
Server **requires** **`accepted_return_price > 0` for EVERY line**, including **`pending`** mode. Frontend must mirror that UX guard (instant already did; **`pending`** must NOT submit blank/`"0"` while expecting success).

---

## Suggested redev splits
| Area | Responsibility |
|---|---|
| Frontend | Maintain parity lookup/create contracts; barcode normalization UX; ambiguity resolver; totals preview vs actual backend rounding; instant settlement split validation messaging. |
| Backend | Stability of serializer fields after create; concurrency on duplicate scans; tightening tag semantics for `unknown` stock policy; documenting open POST-finalize paths when `pending` invoice later settles. |
