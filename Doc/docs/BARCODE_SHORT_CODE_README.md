# Barcode vs Short Code: Display and Validation Analysis

This document captures where **barcodes** are shown on the UI and where **validation** happens, and what must change to **show short_code instead of barcode** on the UI while keeping storage and validation correct.

**Model reference** (`backend/catalog/models.py`):

- `Barcode.barcode` — full unique barcode (e.g. with date).
- `Barcode.short_code` — short identifier without date (e.g. `FRAM-0001`), optional, unique.

**Principle:** Storage and cart/invoice logic must keep using the **canonical barcode**. Only **display** should prefer short_code when available.

**Implementation status:** Backend and frontend display changes are implemented (see §3, §5, §8). Optional: History `barcode_display`, ReplacementModal label "Short code", manual verification.

---

## Table of Contents

1. [Summary](#1-summary)
2. [Backend – Already Aligned](#2-backend--already-aligned)
3. [Backend – Changes for Display / Lookup](#3-backend--changes-for-display--lookup)
4. [Backend – Deep Dive (All Usages)](#4-backend--deep-dive-all-usages)
5. [Frontend – Display Changes](#5-frontend--display-changes)
6. [Frontend – Deep Dive (All Usages)](#6-frontend--deep-dive-all-usages)
7. [Validation (Keep As-Is or Extend)](#7-validation-keep-as-is-or-extend)
8. [Checklist and Implementation Order](#8-checklist-and-implementation-order)

---

## 1. Summary

| Area | Display change | Validation / storage |
|------|----------------|------------------------|
| Global search | Prefer short_code in result list | No change |
| POS cart (scanned list) | Use `scanned_barcodes_display` when API provides it | Keep using `scanned_barcodes` (canonical) for remove-SKU and checks |
| POS / POSRepair status & product row | Use short_code when available from product/barcode-check | No change |
| Invoice detail (tables, PDF, copy) | Use short_code (or new display field) from API | No change |
| Product detail / Products list | Use short_code \|\| barcode for barcode tables and modals | No change |
| Credit note / replacement / return UIs | Use display value (short_code) from API | No change |
| History | Optional: show short_code if API adds display field | No change |
| Backend serializers | Add/use display field for invoice/return items; add `scanned_barcodes_display` for cart | Keep canonical for storage and lookups |

---

## 2. Backend – Already Aligned

- **`backend/catalog/views.py`** (product by barcode):
  - `matched_barcode = barcode_obj.short_code or barcode_obj.barcode` (for display).
  - `canonical_barcode = barcode_obj.barcode` (for cart/invoice).
- **`backend/core/views.py`**: Global search returns barcodes with both `barcode` and `short_code`; `BarcodeSerializer` includes both.
- **`backend/catalog/serializers.py`**: `BarcodeSerializer` has `'barcode', 'short_code'` in `fields`.
- **`backend/pos/views.py`**: Add-to-cart and main barcode resolution use `Q(barcode=...) | Q(short_code=...)`; cart/invoice store canonical `barcode`; comment at ~1281: store full barcode when user scans short_code.

---

## 3. Backend – Changes for Display / Lookup

### 3.1 Serializers / API response (display value)

| Location | Status | Implementation |
|----------|--------|----------------|
| **`pos/serializers.py` – `InvoiceItemSerializer`** | Done | `barcode_value` is a `SerializerMethodField` returning `obj.barcode.short_code or obj.barcode.barcode` for UI. |
| **`pos/serializers.py` – `ReturnItemSerializer.get_barcode_value`** | Done | Returns `short_code or barcode` for display. |
| **`catalog/serializers.py` – `BarcodeSerializer`** | No change | Exposes both; frontend prefers `short_code` when present. |
| **Cart item scanned barcodes** | Done | `CartItemSerializer` has `scanned_barcodes_display` (SerializerMethodField): for each entry in `scanned_barcodes`, resolves `Barcode` and returns `short_code or barcode`. Frontend uses it for display; remove-SKU still uses `scanned_barcodes`. |

### 3.2 Lookup by barcode value (accept short_code everywhere)

These flows currently use `Barcode.objects.get(barcode=barcode_value)` and do **not** accept short_code. They should use `Q(barcode=...) | Q(short_code=...)` so that when the frontend (or API client) sends short_code, lookup still works:

| File | Line (approx) | Context | Status |
|------|----------------|--------|--------|
| **`pos/views.py`** | ~3813 | Invoice item search: find product by `barcode_value` | Done: lookup uses `Q(barcode=barcode_value) \| Q(short_code=barcode_value)`. |
| **`pos/views.py`** | ~3997 | Replacement create: mark barcode as unknown by `barcode_value` | Done: same `Q(barcode=...) \| Q(short_code=...)`. |

(Add-to-cart and similar flows already use `Q(barcode=...) | Q(short_code=...)`.)

### 3.3 Audit / activity log (optional)

- Many `log_action(..., barcode=barcode_obj.barcode)` in `pos/views.py` and elsewhere. If History UI should show short_code, either add a display field in the log serializer (e.g. `barcode_display = short_code or barcode`) or keep storing full barcode and resolve display on frontend.

---

## 4. Backend – Deep Dive (All Usages)

### 4.1 Files that reference barcode / short_code

| File | Role | Display vs storage/validation |
|------|------|-------------------------------|
| **catalog/models.py** | Barcode model: `barcode`, `short_code` fields | Source of truth |
| **catalog/serializers.py** | BarcodeSerializer, product serializers with barcodes | Expose both; display = prefer short_code on frontend |
| **catalog/views.py** | byBarcode (matched_barcode, canonical_barcode), barcode CRUD, labels | Display: matched_barcode already short_code when set; labels may need to stay full barcode for scanning |
| **catalog/filters.py** | Product/barcode lookup by barcode or short_code | Lookup only; already supports both |
| **catalog/barcode_cache.py** | Cache by barcode value; cache key/response use barcode | Storage; no display change |
| **catalog/label_generator.py** | Encode barcode_value in image | Physical label: usually full barcode for scanning |
| **catalog/azure_label_service.py** | Blob path by barcode_id | No display |
| **catalog/admin.py** | Admin list: barcode_value from barcode.barcode | Could show short_code in admin list |
| **catalog/utils.py** | generate_category_based_short_code, etc. | Generation only |
| **catalog/management/commands/backfill_short_codes.py** | Backfill short_code from barcode | One-off |
| **core/views.py** | Global search: barcode + short_code in query and BarcodeSerializer | Already returns both |
| **core/serializers.py** | Audit log: `barcode` field | Optional display field for History |
| **core/models.py** | AuditLog.barcode | Stored value; optional display field in API |
| **pos/models.py** | CartItem.scanned_barcodes (JSON list of strings), InvoiceItem.barcode FK, Repair.barcode | Cart/invoice store canonical; Repair.barcode is separate entity |
| **pos/serializers.py** | InvoiceItemSerializer.barcode_value (barcode.barcode), ReturnItemSerializer.get_barcode_value, CartItemSerializer.scanned_barcodes | **Display**: switch barcode_value to short_code or add barcode_display; add scanned_barcodes_display |
| **pos/views.py** | Add to cart (Q barcode|short_code), cart release, invoice creation, replacement, mark unknown, audit logs | Lookup: fix 3813, 3997 to accept short_code; logs: optional barcode_display |
| **pos/tests.py** | Tests use barcode/short_code; test_add_by_short_code_stores_canonical_barcode_in_cart | No display change |
| **purchasing/serializers.py** | Barcode creation with short_code; label response barcode_value from barcode.barcode | Display: could expose short_code in label/invoice context |
| **purchasing/views.py** | Audit with barcode detail | Optional |
| **reports/views.py**, **reports/views_optimized.py** | Counts and stock by barcode IDs; purchase price from item.barcode | No barcode string display; no change |
| **catalog/views_optimized.py** | Prefetch barcodes, active_cart_barcodes, counts | No display |
| **inventory/views.py** | Barcode creation, audit | No display |
| **config/settings.py** | AZURE_STORAGE_CONTAINER='barcode-labels', skip label generation flag | No display |

### 4.2 Backend summary

- **Display-related:** Serializers for invoice item, return item, and cart (scanned_barcodes_display); optional audit log display field.
- **Lookup-related:** Two places in `pos/views.py` (~3813, ~3997) that assume `barcode_value` is full barcode; extend to short_code.
- **Storage/canonical:** Everywhere that writes to DB (cart scanned_barcodes, invoice item barcode FK, audit barcode) must remain canonical barcode.

---

## 5. Frontend – Display Changes

### 5.1 Search

| File | Line / area | Status |
|------|-------------|--------|
| **Search.tsx** | 577, 602 | Done: `item.short_code \|\| item.barcode \|\| 'N/A'` for barcode result labels. |
| **Search.tsx** | 246, 258, 270–271 | Optional: placeholder/tab wording "SKU / Barcode" or "Short code". |

### 5.2 POS (POS.tsx)

| File | Line / area | Status |
|------|-------------|--------|
| **POS.tsx** | Status line "SKU: …" | Done: `searchedBarcodeStatus` state type includes `short_code?: string`; set from barcode-check response (`response.data.matched_barcode`); display uses `searchedBarcodeStatus.short_code \|\| searchedBarcodeStatus.barcode`. |
| **POS.tsx** | Product search result, cart | Backend sends `matched_barcode` (short_code when set); cart uses `scanned_barcodes_display` when API provides it; remove-SKU still uses `scanned_barcodes`. |
| **POS.tsx** | Error text | Uses matched_barcode; optional label tweak. |

### 5.3 POS Repair (POSRepair.tsx)

| File | Line / area | Status |
|------|-------------|--------|
| **POSRepair.tsx** | Status line "SKU: …" | Done: same as POS—state has `short_code`, set from API, display `short_code \|\| barcode`. |
| **POSRepair.tsx** | Cart scanned barcodes | Done: uses `scanned_barcodes_display` when API provides it. |

### 5.4 Invoices

| File | Line / area | Status |
|------|-------------|--------|
| **InvoiceEdit.tsx** | matched_barcode for add-item | No change; display uses same (short_code when set by backend). |
| **InvoiceDetail.tsx** | Copy/export, table, "SKU: …" | Done: uses `item.barcode_value` from API, which is now short_code when available (backend serializer). |

### 5.5 Products

| File | Line / area | Status |
|------|-------------|--------|
| **ProductDetail.tsx** | Barcode table | Done: `b.short_code \|\| b.barcode`. |
| **Products.tsx** | Expanded row, barcode list, "Change Barcode Tag" modal | Done: `short_code \|\| barcode` for display; cart uses `scanned_barcodes_display` when present. |
| **Products.tsx** | Print label, bulk actions | Labels: full barcode for scanning; bulk: display uses short_code when present, API keeps barcode/id as required. |

### 5.6 Replacement / returns / credit notes

| File | Path | Status |
|------|------|--------|
| **CreditNoteReplacement.tsx** | `pages/replacement/` | Done: "Short code: ${item.barcode_value}"; bulk skipped list shows short_code when present. |
| **CreditNoteShowcase.tsx** | `pages/credit-notes/` | Uses `item.barcode_value` (API now returns short_code when available); "Barcodes: …" shows that value. |
| **ReplaceProduct.tsx** | `pages/replacement/` | Done: "Short code: ${item.barcode_value}". |
| **ReturnToStock.tsx** | `pages/replacement/` | Done: "Short code: ${item.barcode_value}". |
| **ReplacementModal.tsx** | `pages/pos/` | Uses `item.barcode_value` (display value from API); label "Barcode:" could be "Short code:" for consistency (optional). |

### 5.7 Repair (Repairs.tsx)

| File | Status |
|------|--------|
| **Repairs.tsx** | `repair.barcode` is the **Repair** model (not catalog Barcode). No short_code unless added to Repair model. Left as-is. |

### 5.8 History (History.tsx)

| File | Status |
|------|--------|
| **History.tsx** | Backend stores full barcode. Optional: add `barcode_display` in activity log API and use it here. |

### 5.9 Layout and BarcodeScanner

| File | Status |
|------|--------|
| **Layout.tsx**, **BarcodeScanner.tsx** | No barcode string displayed; optional toast with short_code in Layout. |

### 5.10 Purchases

| File | Status |
|------|--------|
| **Purchases.tsx**, **VendorPurchases.tsx**, **PurchaseDetail.tsx** | No barcode value display; no change. |

---

## 6. Frontend – Deep Dive (All Usages)

### 6.1 Files that reference barcode / short_code / barcode_value / matched_barcode

| File | Usage type | Status |
|------|------------|--------|
| **Search.tsx** | Barcode result labels | Done: short_code \|\| barcode \|\| 'N/A' |
| **POS.tsx** | Status line, cart display, matched_barcode | Done: searchedBarcodeStatus has short_code; cart uses scanned_barcodes_display; validation canonical |
| **POSRepair.tsx** | Same as POS | Done |
| **InvoiceEdit.tsx** | matched_barcode for add | No change; keep validation |
| **InvoiceDetail.tsx** | barcode_value in tables, copy, PDF | Done: API sends barcode_value as short_code when available |
| **ProductDetail.tsx** | Barcode table | Done: short_code \|\| barcode |
| **Products.tsx** | Barcode list, expand row, tag modal, cart | Done: short_code \|\| barcode; scanned_barcodes_display when present |
| **CreditNoteReplacement.tsx**, **ReplaceProduct.tsx**, **ReturnToStock.tsx** | barcode_value display | Done: "Short code: …"; API sends display value |
| **CreditNoteShowcase.tsx** (credit-notes/), **ReplacementModal.tsx** (pos/) | barcode_value from API | Use item.barcode_value (now display value); optional label "Short code" in ReplacementModal |
| **Repairs.tsx** | repair.barcode (Repair model) | No catalog short_code; as-is |
| **History.tsx** | log.barcode | Optional: barcode_display from API |
| **Layout.tsx**, **BarcodeScanner.tsx**, **lib/api.ts**, **ProductForm.tsx** | No display / payloads | No change |

---

## 7. Validation (Keep As-Is or Extend)

- **POS / POSRepair / InvoiceEdit:** Keep using `productsApi.byBarcode(...)`; backend already accepts barcode or short_code. When adding to cart/invoice, keep sending `canonical_barcode` (or `matched_barcode` where backend expects it). Duplicate checks and "already in cart" logic must use the same values as the API (canonical in `scanned_barcodes`).
- **Remove-SKU:** Continue to call remove-SKU with the **canonical** barcode from `scanned_barcodes` (not the display string). After adding `scanned_barcodes_display`, display comes from that; the value passed to remove-SKU stays from `scanned_barcodes`.
- **Replacements / credit notes:** Matching and validation that use `barcode_value` should keep using the same field; only the **display** of that value should prefer short_code when the API provides it.
- **Backend:** Extend the two lookups in `pos/views.py` (~3813, ~3997) to accept short_code via `Q(barcode=...) | Q(short_code=...)`. All other validation already uses barcode or both.

---

## 8. Checklist and Implementation Order

1. **Backend** ✅ Implemented
   - [x] Add display value for invoice/return items: `InvoiceItemSerializer.barcode_value` and `ReturnItemSerializer.get_barcode_value` return short_code or barcode.
   - [x] Add `scanned_barcodes_display` to `CartItemSerializer`.
   - [x] In `pos/views.py`, fix lookup at ~3813 (invoice item search) and ~3997 (replacement create) to accept short_code via `Q(barcode=...) | Q(short_code=...)`.
   - [ ] (Optional) Add `barcode_display` to audit log serializer for History UI.
2. **Frontend** ✅ Implemented
   - [x] Search: use `item.short_code || item.barcode || 'N/A'` for barcode result labels.
   - [x] POS / POSRepair: use `scanned_barcodes_display` for cart when API provides it; remove-SKU still uses canonical barcode.
   - [x] Invoice detail: `barcode_value` from API is now short_code when available (backend change).
   - [x] Product detail: barcode table column `b.short_code || b.barcode`.
   - [x] Products list: expanded row and barcode modal `short_code || barcode`.
   - [x] Credit note / replacement / return UIs: use `item.barcode_value` from API (now short_code when available).
   - [ ] (Optional) History: use barcode_display from API if added.
3. **Testing** ✅
   - [x] `test_add_by_short_code_stores_canonical_barcode_in_cart` and all `CartBarcodeConsistencyTests` pass.
   - [x] Added `test_cart_item_serializer_includes_scanned_barcodes_display` and `test_invoice_item_barcode_value_prefers_short_code_for_display`.
   - [ ] Manually verify display in Search, POS cart, Invoice detail, Products, and replacement flows.

---

*Last updated: Implementation complete per checklist. POS/POSRepair `searchedBarcodeStatus` type includes `short_code` and is set from barcode-check API; doc aligned with codebase paths and status.*
