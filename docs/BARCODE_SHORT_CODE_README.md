# Barcode vs Short Code: Display and Validation Analysis

This document captures where **barcodes** are shown on the UI and where **validation** happens, and what must change to **show short_code instead of barcode** on the UI while keeping storage and validation correct.

**Model reference** (`backend/catalog/models.py`):

- `Barcode.barcode` — full unique barcode (e.g. with date).
- `Barcode.short_code` — short identifier without date (e.g. `FRAM-0001`), optional, unique.

**Principle:** Storage and cart/invoice logic must keep using the **canonical barcode**. Only **display** should prefer short_code when available.

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

| Location | Current | Change |
|----------|---------|--------|
| **`pos/serializers.py` – `InvoiceItemSerializer`** | `barcode_value = source='barcode.barcode'` | Prefer short_code for display: e.g. add `SerializerMethodField` returning `obj.barcode.short_code or obj.barcode.barcode` (or new field `barcode_display`), and use that for UI. |
| **`pos/serializers.py` – `ReturnItemSerializer.get_barcode_value`** | Returns `obj.barcode.barcode` (or from invoice_item) | Return `short_code or barcode` for display. |
| **`catalog/serializers.py` – `BarcodeSerializer`** | Exposes both `barcode` and `short_code` | No change; frontend should prefer `short_code` when present. |
| **Cart item scanned barcodes** | `CartItemSerializer` exposes `scanned_barcodes` (list of canonical barcode strings only) | Add optional field e.g. `scanned_barcodes_display`: for each value in `scanned_barcodes`, resolve `Barcode` and add `barcode.short_code or barcode.barcode`. Frontend displays this when present; remove-SKU and validation continue to use `scanned_barcodes`. |

### 3.2 Lookup by barcode value (accept short_code everywhere)

These flows currently use `Barcode.objects.get(barcode=barcode_value)` and do **not** accept short_code. They should use `Q(barcode=...) | Q(short_code=...)` so that when the frontend (or API client) sends short_code, lookup still works:

| File | Line (approx) | Context | Change |
|------|----------------|--------|--------|
| **`pos/views.py`** | ~3813 | Invoice item search: find product by `barcode_value` | Use `Barcode.objects.filter(Q(barcode=barcode_value) \| Q(short_code=barcode_value)).first()` (or equivalent) and handle multiple/None. |
| **`pos/views.py`** | ~3997 | Replacement create: mark barcode as unknown by `barcode_value` | Same: resolve by barcode or short_code. |

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

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **Search.tsx** | 577, 602 | `item.barcode \|\| item.short_code \|\| 'N/A'` | Use `item.short_code \|\| item.barcode \|\| 'N/A'` so short_code is shown when present. |
| **Search.tsx** | 246, 258, 270–271 | Placeholder / tab labels "barcodes", "Scan barcode" | Optional: wording like "SKU / Barcode" or "Short code" for clarity. |

### 5.2 POS (POS.tsx)

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **POS.tsx** | 3592–3594, 3382–3384 | "SKU: {searchedBarcodeStatus.barcode}" | Prefer short_code if API adds it: e.g. `searchedBarcodeStatus.short_code \|\| searchedBarcodeStatus.barcode`. |
| **POS.tsx** | 3813–3847 | Product search result: "Barcode: …", matching by short_code/barcode | matched_barcode is already short_code when set by backend; prefer short_code in list display. |
| **POS.tsx** | 4298–4301 | Cart: `scannedBarcodes.map((barcode) => … {barcode})` | After backend adds `scanned_barcodes_display`, use that for display; remove-SKU still uses value from `scanned_barcodes`. |
| **POS.tsx** | 3289–3290, 3736–3737 | Error text "SKU: ${…matched_barcode \|\| searchValue}" | Already uses matched_barcode; optional label tweak. |

### 5.3 POS Repair (POSRepair.tsx)

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **POSRepair.tsx** | 3382–3384, 3522–3529, 3610–3637 | Status line "SKU: …", product barcode display | Same as POS: use short_code when available. |
| **POSRepair.tsx** | 4027 | Cart scanned barcodes | Use `scanned_barcodes_display` when API provides it. |

### 5.4 Invoices

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **InvoiceEdit.tsx** | 126, 204, 344, 455 | Uses matched_barcode for add-item | Keep; display can use same (already short_code when set). |
| **InvoiceDetail.tsx** | 2015, 2069, 2160, 2738, 3078 | Copy/export: `barcode: item.barcode_value \|\| ...` | Use display field from API (short_code when available). |
| **InvoiceDetail.tsx** | 2044, 2112, 2216, 2964, 3297 | Table/card: `barcodeItem.barcode` | Use `barcodeItem.short_code \|\| barcodeItem.barcode` (when API includes short_code or display field). |
| **InvoiceDetail.tsx** | 3760 | "SKU: {item.barcode_value \|\| ...}" | Use display field so it shows short_code when available. |

### 5.5 Products

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **ProductDetail.tsx** | 297 | Barcode table: `{b.barcode}` | Use `b.short_code \|\| b.barcode`. |
| **Products.tsx** | 1846 | Expanded row: `{barcode.barcode}` | Use `barcode.short_code \|\| barcode.barcode`. |
| **Products.tsx** | 3189, 3256 | Barcode list and "Change Barcode Tag" modal | Use `short_code \|\| barcode` for display. |
| **Products.tsx** | 890–891, 916 | Print single label | Labels may need to stay full barcode for scanning; confirm. If label text should show short_code, use it there. |
| **Products.tsx** | 1478, 2051 | Bulk actions: `b.barcode \|\| b` | If for display only, use short_code when present; if for API, keep sending barcode/id as required. |

### 5.6 Replacement / returns / credit notes

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **CreditNoteReplacement.tsx** | 638 | "Barcode: ${item.barcode_value}" | Use display value (short_code when available) from API. |
| **CreditNoteShowcase.tsx** | 92, 191, 311, 485–487 | `g.barcodes` from item.barcode_value, "Barcodes: …" | Use display value from API. |
| **ReplaceProduct.tsx** | 752 | "Barcode: ${item.barcode_value}" | Same. |
| **ReturnToStock.tsx** | 477 | Same | Same. |
| **ReplacementModal.tsx** | 263 | Same | Same. |

### 5.7 Repair (Repairs.tsx)

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **Repairs.tsx** | 494 | `selectedInvoice.repair.barcode` | Repair barcode is a **different model** (Repair.barcode), not catalog Barcode. No short_code unless you add it to Repair. Leave as-is or add Repair.short_code later. |

### 5.8 History (History.tsx)

| File | Line / area | Current | Change |
|------|-------------|--------|--------|
| **History.tsx** | 144, 495–497, 623–627 | Filter by `log.barcode`, display `log.barcode` | Backend stores full barcode. Either backend adds `barcode_display` in activity log API or frontend keeps showing `log.barcode`. |

### 5.9 Layout and BarcodeScanner

| File | Role | Change |
|------|------|--------|
| **Layout.tsx** | Global barcode scan → byBarcode → navigate to product | No barcode string displayed in Layout; optional: if you add a "Found product" toast, use short_code there. |
| **BarcodeScanner.tsx** | Calls `onScan(barcode)` with scanned string | No display of barcode; no change. |

### 5.10 Purchases

| File | Role | Change |
|------|------|--------|
| **Purchases.tsx**, **VendorPurchases.tsx** | Comments about barcodes being created; sold count message | No barcode string display; no change. |
| **PurchaseDetail.tsx** | Image scaling for barcode lines | No barcode value display; no change. |

---

## 6. Frontend – Deep Dive (All Usages)

### 6.1 Files that reference barcode / short_code / barcode_value / matched_barcode

| File | Usage type | Action |
|------|------------|--------|
| **Search.tsx** | Display barcode/short_code in results; handleBarcodeScan; tabs/placeholder | Prefer short_code in labels; keep API/validation |
| **POS.tsx** | Heavy: barcode input, cart scanned_barcodes display, matched_barcode, canonical_barcode, errors, product list display | Display: short_code / scanned_barcodes_display; validation: keep canonical |
| **POSRepair.tsx** | Same pattern as POS | Same |
| **InvoiceEdit.tsx** | matched_barcode for add; barcode_available checks | Display only if any; keep validation |
| **InvoiceDetail.tsx** | barcode_value in tables, copy, PDF, "SKU: …" | Use display field / short_code |
| **ProductDetail.tsx** | Barcode table column | short_code \|\| barcode |
| **Products.tsx** | Barcode list, expand row, tag modal, print label, bulk actions, barcodeCount | Display: short_code \|\| barcode; API: keep barcode/id where required |
| **CreditNoteReplacement.tsx**, **CreditNoteShowcase.tsx** | barcode_value display | Use display value |
| **ReplaceProduct.tsx**, **ReturnToStock.tsx**, **ReplacementModal.tsx** | barcode_value display; barcode_available | Display value; keep validation |
| **Repairs.tsx** | repair.barcode (Repair model), search by repair_barcode | No catalog short_code; optional Repair.short_code later |
| **History.tsx** | log.barcode filter and display | Optional: use barcode_display from API |
| **Layout.tsx** | byBarcode on global scan | No display; optional toast with short_code |
| **BarcodeScanner.tsx** | onScan(barcode) | No display |
| **lib/api.ts** | byBarcode, removeSku(barcode), repair findByBarcode | No display; keep payloads as-is |
| **ProductForm.tsx** | Invalidate product-barcodes query | No display |

---

## 7. Validation (Keep As-Is or Extend)

- **POS / POSRepair / InvoiceEdit:** Keep using `productsApi.byBarcode(...)`; backend already accepts barcode or short_code. When adding to cart/invoice, keep sending `canonical_barcode` (or `matched_barcode` where backend expects it). Duplicate checks and "already in cart" logic must use the same values as the API (canonical in `scanned_barcodes`).
- **Remove-SKU:** Continue to call remove-SKU with the **canonical** barcode from `scanned_barcodes` (not the display string). After adding `scanned_barcodes_display`, display comes from that; the value passed to remove-SKU stays from `scanned_barcodes`.
- **Replacements / credit notes:** Matching and validation that use `barcode_value` should keep using the same field; only the **display** of that value should prefer short_code when the API provides it.
- **Backend:** Extend the two lookups in `pos/views.py` (~3813, ~3997) to accept short_code via `Q(barcode=...) | Q(short_code=...)`. All other validation already uses barcode or both.

---

## 8. Checklist and Implementation Order

1. **Backend**
   - [ ] Add display value for invoice/return items (e.g. `barcode_value` = short_code or barcode, or new `barcode_display`).
   - [ ] Add `scanned_barcodes_display` to `CartItemSerializer` (resolve each scanned barcode to short_code or barcode).
   - [ ] In `pos/views.py`, fix lookup at ~3813 (invoice item search by barcode_value) to accept short_code.
   - [ ] In `pos/views.py`, fix lookup at ~3997 (replacement create by barcode_value) to accept short_code.
   - [ ] (Optional) Add `barcode_display` to audit log serializer for History UI.
2. **Frontend**
   - [ ] Search: use `item.short_code || item.barcode || 'N/A'` for barcode result labels.
   - [ ] POS / POSRepair: use short_code for status line and product row when available; use `scanned_barcodes_display` for cart when API provides it.
   - [ ] Invoice detail: use display field / short_code for tables, copy, PDF, and "SKU: …".
   - [ ] Product detail: barcode table column `b.short_code || b.barcode`.
   - [ ] Products list: expanded row and barcode modal `short_code || barcode`.
   - [ ] Credit note / replacement / return UIs: use display value from API.
   - [ ] (Optional) History: use barcode_display from API if added.
3. **Testing**
   - [ ] Ensure existing tests (e.g. `test_add_by_short_code_stores_canonical_barcode_in_cart`) still pass.
   - [ ] Add or adjust tests for new lookups (barcode_value as short_code) in pos/views.
   - [ ] Manually verify display in Search, POS cart, Invoice detail, Products, and replacement flows.

---

*Last updated: incremental and deep-dive analysis of backend and frontend codebases.*
