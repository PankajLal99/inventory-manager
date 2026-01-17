# Replacement Module - Complete Functionality & Flow Documentation

## Overview
The Replacement Module allows customers to return items from completed invoices. When items are selected for replacement, they are marked as "unknown" (indicating they're back in store but not yet re-added to inventory), and the invoice is updated accordingly.

---

## Frontend Components

### `frontend/src/pages/replacement/Replacement.tsx`
**Main replacement page component** - Provides UI for searching invoices, selecting items to replace, and processing replacements.

**Key Functionality:**
- **Search Invoices**: Search by barcode, SKU, or partial invoice number (with dropdown suggestions)
- **Barcode Scanner**: Camera-based barcode scanning for quick item lookup
- **Invoice Selection**: Display invoice details and all items with available quantities
- **Item Selection**: Checkbox-based selection with quantity adjustment controls
- **Auto-selection**: Automatically selects matching items when searching by barcode/SKU
- **Replacement Processing**: Submits selected items for replacement processing
- **Validation**: Ensures at least one item is selected before processing

---

## Backend API Endpoints

### 1. `POST /pos/replacement/search-invoices/`
**Search invoices by partial invoice number** - Returns list of matching invoices for dropdown display.

**Functionality:**
- Searches invoices by partial invoice number (case-insensitive)
- Excludes void, draft, pending, and defective invoices
- Returns up to 10 most recent matching invoices
- Includes invoice details: number, customer, store, date, items

**What it affects:**
- No database changes - read-only search operation

---

### 2. `POST /pos/replacement/find-invoice/`
**Find invoice by barcode/SKU or invoice number** - Returns full invoice with all items for replacement.

**Functionality:**
- Finds invoice by barcode (for tracked products), SKU (for non-tracked), or invoice number
- Validates invoice is not void, draft, or pending (only completed invoices eligible)
- Validates barcode has 'sold' tag (only sold items can be replaced)
- Returns complete invoice with all items and their available quantities
- For tracked products: searches by barcode with 'sold' tag
- For non-tracked products: searches by product SKU or variant SKU

**What it affects:**
- No database changes - read-only lookup operation
- Validates eligibility but doesn't modify data

---

### 3. `POST /pos/replacement/{invoice_id}/process/`
**Process replacement** - Marks selected items as unknown and updates invoice accordingly.

**Functionality:**
- Validates invoice is not void, draft, or pending
- Processes multiple items in a single transaction
- For each item:
  - Validates quantity doesn't exceed available quantity (quantity - replaced_quantity)
  - Validates barcode has 'sold' tag (strict validation)
  - Marks barcode as 'unknown' (for tracked products) or product barcode as 'unknown' (for non-tracked when all quantity replaced)
  - Updates invoice item's replaced_quantity, replaced_at, replaced_by
  - If full replacement: deletes invoice item
  - If partial replacement: reduces quantity, proportionally adjusts discount/tax, recalculates line_total
- Recalculates invoice totals (subtotal, total, due_amount)
- Creates audit logs for all barcode tag changes

**What it affects:**
- **Barcode Tag**: Changes from 'sold' → 'unknown' (indicates item is back in store)
- **Invoice Item Quantity**: Reduced by replacement quantity (or deleted if fully replaced)
- **Invoice Item replaced_quantity**: Incremented by replacement quantity
- **Invoice Item replaced_at**: Set to current timestamp
- **Invoice Item replaced_by**: Set to current user
- **Invoice Item line_total**: Recalculated for remaining quantity
- **Invoice Item discount_amount**: Proportionally reduced for remaining quantity
- **Invoice Item tax_amount**: Proportionally reduced for remaining quantity
- **Invoice Totals**: Recalculated (subtotal, total, due_amount)
- **Audit Logs**: Created for each barcode tag change

**Important Notes:**
- Inventory is NOT updated at this stage (items marked as 'unknown', not added back to stock)
- Items must be manually marked as 'returned' or 'defective' later from Products page
- Only items with 'sold' tag can be replaced (strict validation)

---

### 4. `POST /pos/replacement/check/`
**Check if product/barcode is replaceable** - Searches by SKU in invoice items to verify item was sold.

**Functionality:**
- Checks if a product/barcode was sold (exists in invoice items)
- Searches invoice items by barcode, SKU, or product ID
- Returns replaceability status and invoice/item information
- Finds most recent invoice containing the item

**What it affects:**
- No database changes - read-only check operation

---

### 5. `POST /pos/replacement/create/`
**Create replacement entry (legacy)** - Marks single barcode as UNKNOWN without updating inventory.

**Functionality:**
- Marks a single barcode as 'unknown'
- Creates audit log entry
- Does not update inventory or invoice items

**What it affects:**
- **Barcode Tag**: Changes from current tag → 'unknown'
- **Audit Logs**: Created for tag change

---

### 6. `POST /pos/replacement/barcode/{barcode_id}/update-tag/`
**Update barcode tag after replacement** - Changes tag from 'unknown' to 'returned' or 'defective' and handles inventory.

**Functionality:**
- Updates barcode tag from 'unknown' to 'returned' or 'defective'
- If 'returned': Adds product back to inventory (increments stock quantity)
- If 'defective': Does not update inventory (item is defective, not resellable)
- Creates audit log entry

**What it affects:**
- **Barcode Tag**: Changes from 'unknown' → 'returned' or 'defective'
- **Stock Quantity**: Incremented by 1 if tag is 'returned' (for tracked products)
- **Audit Logs**: Created for tag change

---

### 7. `POST /pos/replacement/replace/`
**Replace sold item with another item** - Updates invoice item with new product and handles inventory.

**Functionality:**
- Replaces an invoice item's product with a different product
- Updates invoice item: product, barcode, unit_price, line_total
- Returns old barcode to inventory (marks as 'new')
- Adds new barcode to invoice (marks as 'sold')
- Updates stock quantities accordingly
- Recalculates invoice totals

**What it affects:**
- **Old Barcode Tag**: Changes from 'sold' → 'new'
- **New Barcode Tag**: Changes from 'new' → 'sold'
- **Invoice Item**: Product, barcode, unit_price, line_total updated
- **Stock (Old Product)**: Incremented by 1
- **Stock (New Product)**: Decremented by 1
- **Invoice Totals**: Recalculated

---

### 8. `POST /pos/replacement/return/`
**Return item for refund** - Marks item as returned and adds back to inventory.

**Functionality:**
- Marks barcode as 'returned'
- Reduces invoice item quantity (or deletes if fully returned)
- Adds product back to inventory (increments stock)
- Recalculates invoice totals
- Creates audit log

**What it affects:**
- **Barcode Tag**: Changes to 'returned'
- **Invoice Item Quantity**: Reduced by return quantity (or deleted)
- **Stock Quantity**: Incremented by return quantity
- **Invoice Totals**: Recalculated

---

### 9. `POST /pos/replacement/defective/`
**Mark item as defective** - Marks item as defective without adding back to inventory.

**Functionality:**
- Marks barcode as 'defective'
- Reduces invoice item quantity (or deletes if fully defective)
- Does NOT add back to inventory (defective items are not resellable)
- Recalculates invoice totals
- Creates audit log

**What it affects:**
- **Barcode Tag**: Changes to 'defective'
- **Invoice Item Quantity**: Reduced by defective quantity (or deleted)
- **Invoice Totals**: Recalculated
- **Stock Quantity**: NOT updated (defective items stay out of inventory)

---

## Complete Replacement Flow

### Step 1: Search for Invoice
**User Action**: Enters barcode, SKU, or invoice number in search field

**Backend Process**:
- `find_invoice_by_barcode()` searches for invoice
- Validates invoice is completed (not void/draft/pending)
- Validates barcode has 'sold' tag
- Returns invoice with all items

**Result**: Invoice displayed with all items and available quantities

---

### Step 2: Select Items to Replace
**User Action**: Checks items and adjusts quantities

**Frontend Process**:
- Tracks selected items and quantities in state
- Validates quantities don't exceed available_quantity
- Shows summary of selected items

**Result**: Items ready for replacement processing

---

### Step 3: Process Replacement
**User Action**: Clicks "Process Replacement" button

**Backend Process** (`process_replacement()`):
1. **Validation**:
   - Invoice is not void/draft/pending
   - Each item has valid quantity
   - Quantity doesn't exceed available quantity
   - Barcode has 'sold' tag

2. **For Each Selected Item**:
   - **Tracked Products**:
     - Mark barcode tag: 'sold' → 'unknown'
     - Update invoice item: increment replaced_quantity, set replaced_at, replaced_by
   - **Non-tracked Products**:
     - If all quantity replaced: mark product barcode as 'unknown'
     - Update invoice item: increment replaced_quantity, set replaced_at, replaced_by

3. **Invoice Item Update**:
   - **Full Replacement** (replaced_quantity >= original_quantity):
     - Delete invoice item completely
   - **Partial Replacement** (replaced_quantity < original_quantity):
     - Reduce quantity: `quantity = original_quantity - replaced_quantity`
     - Proportionally adjust discount: `discount_amount = original_discount * (remaining_qty / original_qty)`
     - Proportionally adjust tax: `tax_amount = original_tax * (remaining_qty / original_qty)`
     - Recalculate line_total: `line_total = remaining_qty * unit_price - discount_amount + tax_amount`

4. **Invoice Totals Recalculation**:
   - `subtotal = sum(all item line_totals)`
   - `total = subtotal - discount_amount + tax_amount`
   - `due_amount = total - paid_amount`

5. **Audit Logging**:
   - Creates audit log for each barcode tag change
   - Records: old tag, new tag, invoice info, quantity, user

**Result**: 
- Items marked as 'unknown' (back in store, not in inventory)
- Invoice updated with reduced quantities or deleted items
- Invoice totals recalculated
- Audit logs created

---

### Step 4: Post-Replacement Actions (Later)
**User Action**: From Products page, marks 'unknown' items as 'returned' or 'defective'

**Backend Process** (`replacement_update_tag()` or `update_barcode_tag()`):
- **If 'returned'**:
  - Tag: 'unknown' → 'returned'
  - Stock: Incremented by 1 (item back in inventory, resellable)
- **If 'defective'**:
  - Tag: 'unknown' → 'defective'
  - Stock: NOT updated (item not resellable)

**Result**: 
- Items properly categorized and inventory updated if returned

---

## Data Model Changes

### InvoiceItem Model Fields
- `replaced_quantity`: Tracks how much of this item has been replaced (default: 0)
- `replaced_at`: Timestamp when replacement occurred (null initially)
- `replaced_by`: User who processed the replacement (null initially)

### Barcode Model Tag States
- `new`: Item in inventory, available for sale
- `sold`: Item sold (in invoice)
- `unknown`: Item returned but not yet categorized (replacement stage)
- `returned`: Item returned and back in inventory (resellable)
- `defective`: Item returned but defective (not resellable)

### Invoice Calculations
- `available_quantity = quantity - replaced_quantity` (calculated field in serializer)
- Invoice totals recalculated after each replacement

---

## Key Business Rules

1. **Eligibility**: Only items from completed invoices (not void/draft/pending) can be replaced
2. **Barcode Validation**: Only barcodes with 'sold' tag can be replaced (strict validation)
3. **Quantity Validation**: Replacement quantity cannot exceed available quantity
4. **Inventory Update**: Inventory is NOT updated during replacement (items marked as 'unknown')
5. **Post-Processing**: Items must be manually marked as 'returned' or 'defective' to update inventory
6. **Partial Replacement**: Supports partial replacement with proportional discount/tax adjustment
7. **Full Replacement**: Fully replaced items are deleted from invoice
8. **Transaction Safety**: All replacements processed in database transaction (atomic)

---

## API Response Examples

### Find Invoice Response
```json
{
  "invoice": {
    "id": 123,
    "invoice_number": "INV-2024-001",
    "customer_name": "John Doe",
    "store_name": "Main Store",
    "created_at": "2024-01-15T10:30:00Z",
    "items": [
      {
        "id": 456,
        "product_name": "Product A",
        "product_sku": "SKU-001",
        "quantity": "2.000",
        "available_quantity": 2.0,
        "barcode_value": "1234567890",
        "barcode_id": 789
      }
    ]
  },
  "found_by": "barcode",
  "search_value": "1234567890"
}
```

### Process Replacement Response
```json
{
  "message": "Replacement processed successfully",
  "invoice": { /* updated invoice */ },
  "replaced_items": [
    {
      "item_id": 456,
      "barcode_id": 789,
      "barcode": "1234567890",
      "quantity": "1.000",
      "tag_updated": true,
      "action": "reduced",
      "remaining_quantity": "1.000"
    }
  ]
}
```

---

## Error Handling

### Common Errors
1. **Invoice not found**: No invoice found with provided barcode/SKU/invoice number
2. **Invalid invoice state**: Invoice is void, draft, or pending (not eligible)
3. **Invalid barcode tag**: Barcode doesn't have 'sold' tag (not eligible)
4. **Quantity exceeded**: Replacement quantity exceeds available quantity
5. **No items selected**: User didn't select any items for replacement

### Validation Functions
- `validate_barcode_for_replacement()`: Ensures barcode has 'sold' tag
- Quantity validation: Ensures replacement quantity <= available quantity
- Invoice state validation: Ensures invoice is completed

---

## Integration Points

### Frontend Integration
- Uses React Query for API calls and caching
- Invalidates product, invoice, and cart queries after replacement
- Shows toast notifications for success/error states
- Auto-focuses search input after reset

### Backend Integration
- Uses Django transactions for atomic operations
- Creates audit logs for all changes
- Integrates with stock management system (for post-replacement actions)
- Updates invoice totals using shared `update_invoice_totals()` function

---

## Future Enhancements (Potential)
- Bulk replacement processing
- Replacement history tracking
- Automatic inventory update options
- Replacement reports and analytics
- Email notifications for replacements
