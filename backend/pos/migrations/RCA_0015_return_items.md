# RCA: return_items.barcode_id does not exist

## What happens
- Error: `django.db.utils.ProgrammingError: column return_items.barcode_id does not exist`
- Occurs when loading or saving `ReturnItem` (e.g. in tests or app code that touches returns).

## Root cause

### 1. Initial schema (0001_initial)
- Table `return_items` is created with columns: `id`, `quantity`, `condition`, `refund_amount`, `invoice_item_id`, `return_obj_id` only.

### 2. Migration 0015 (returnitem_barcode_returnitem_product_and_more)
- Uses **only** `SeparateDatabaseAndState(state_operations=state_operations)`.
- **State:** Adds to Django’s migration state: `barcode`, `product`, `product_name`, `product_sku`, `variant`, and alters `invoice_item` to nullable. So Django believes the table has these columns.
- **Database:** No operations are run. So the real table is never altered.

### 3. Why it was written that way
- Comment in 0015: "The return_items table may already have barcode_id, product_id, etc. from a previous run."
- So the author assumed the columns might already exist (e.g. from a manual change or a removed migration) and chose to only update state to avoid duplicate ALTERs. That leaves any **fresh** database (new deploy, test DB) without these columns.

### 4. Conclusion
- **Missing in DB on fresh installs:** `barcode_id`, `product_id`, `product_name`, `product_sku`, `variant_id`, and `invoice_item_id` was never made nullable.
- **Safe fix:** Add a **new** migration that performs **only** database changes (no state change). Use idempotent logic (e.g. add column only if it does not exist) so it works both on fresh DBs and on DBs that already have the columns (e.g. after a manual fix).

### 5. Production / existing data
- **RCA:** Documentation only; no code or data changes.
- **Migration 0017:** Additive only (ADD COLUMN / ALTER COLUMN … DROP NOT NULL). No existing rows are updated or deleted. New columns are NULL or default for existing return_items. Safe to run in production with existing user data.
