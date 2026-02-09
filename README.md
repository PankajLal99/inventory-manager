# MT-IMS (Inventory Management System)

A comprehensive Django-based inventory management system with real-time stock tracking, multi-location support, point-of-sale capabilities, and detailed reporting.

## Table of Contents

1. [Architecture](#architecture)
2. [Tech Stack](#tech-stack)
3. [Backend Applications](#backend-applications)
4. [Database Models](#database-models)
5. [API Endpoints](#api-endpoints)
6. [Frontend Integration](#frontend-integration)
7. [Key Features](#key-features)
8. [Installation & Setup](#installation--setup)
9. [Environment Configuration](#environment-configuration)
10. [Performance Optimizations](#performance-optimizations)
11. [Limitations & Future Enhancements](#limitations--future-enhancements)

## Architecture

MT-IMS is a **monolithic Django application** with a React frontend. The system follows a modular architecture with separate Django apps for different business domains:

```
Frontend (React + Redux)
    ↓ (HTTP/REST)
Django REST API
    ↓
PostgreSQL Database
    ↓
Azure Blob Storage (Media/Labels)
```

### Components:

- **Frontend**: React with TypeScript, Redux for state management, Tailwind CSS for styling
- **Backend**: Django 5.2.8 with Django REST Framework
- **Database**: PostgreSQL relational database
- **Storage**: Azure Blob Storage for barcode labels and media
- **Web Server**: Nginx for production
- **Caching**: Django-Redis (optional)

## Tech Stack

### Backend Technologies

**Dependencies**:

- Django==5.2.8
- djangorestframework==3.16.1
- djangorestframework-simplejwt==5.5.1
- django-cors-headers==4.9.0
- django-filter==24.3
- coverage==7.5.1
- factory-boy==3.3.0
- Pillow==10.4.0
- python-barcode==0.15.1
- requests>=2.31.0
- python-dotenv>=1.0.0
- azure-storage-blob>=12.19.0
- django-redis>=5.4.0
- psycopg2-binary>=2.9.0,<2.10.0

### Frontend Technologies

**Dependencies**:

- @tailwindcss/postcss
- @tanstack/react-query
- axios
- date-fns
- express
- html5-qrcode
- jspdf
- jspdf-autotable
- lucide-react
- react
- react-dom
- react-router-dom
- xlsx

### Infrastructure

- **Web Server**: Nginx
- **Container**: Docker (optional)
- **Cloud**: AWS/Azure
- **Testing**: Coverage.py, pytest, factory-boy

## Backend Applications

### CATALOG App

**Purpose**: Product catalog, categories, brands, barcodes, and barcode label generation

**Models**: Category, Brand, TaxRate, Product, ProductVariant, Barcode

**Serializers**: CategorySerializer, BrandSerializer, TaxRateSerializer, ProductVariantSerializer, BarcodeSerializer, ProductComponentSerializer, ProductSerializer

### CONFIG App

**Purpose**: Business logic and operations

### CORE App

**Purpose**: Authentication, user management, system settings, and audit logging

**Models**: User, Setting, AuditLog

**Serializers**: UserSerializer, UserCreateSerializer, SettingSerializer, AuditLogSerializer

**Admin**: UserAdmin, SettingAdmin, AuditLogAdmin

### INVENTORY App

**Purpose**: Stock management, inventory tracking, adjustments, and transfers

**Models**: Stock, StockBatch, StockAdjustment, StockTransfer, StockTransferItem

**Serializers**: StockSerializer, StockBatchSerializer, StockAdjustmentSerializer, StockTransferItemSerializer, StockTransferSerializer

**Admin**: StockAdmin, StockBatchAdmin, StockAdjustmentAdmin, StockTransferItemInline, StockTransferAdmin

### LOCATIONS App

**Purpose**: Store and warehouse location management

**Models**: Store, Warehouse

**Serializers**: StoreSerializer, WarehouseSerializer

**Admin**: StoreAdmin, WarehouseAdmin

### PARTIES App

**Purpose**: Customer and supplier relationship management with ledgers

**Models**: CustomerGroup, Customer, Supplier, LedgerEntry, PersonalCustomer, PersonalLedgerEntry, InternalCustomer, InternalLedgerEntry

**Serializers**: CustomerGroupSerializer, CustomerSerializer, SupplierSerializer, LedgerEntrySerializer, PersonalCustomerSerializer, PersonalLedgerEntrySerializer, InternalCustomerSerializer, InternalLedgerEntrySerializer

**Admin**: CustomerGroupAdmin, CustomerAdmin, SupplierAdmin, LedgerEntryAdmin, PersonalCustomerAdmin, PersonalLedgerEntryAdmin, InternalCustomerAdmin, InternalLedgerEntryAdmin

### POS App

**Purpose**: Point-of-sale operations, invoices, returns, and replacements

**Models**: POSSession, Cart, CartItem, Invoice, Repair, InvoiceItem

**Views/ViewSets**: repair_invoices_list, find_repair_invoice_by_barcode, update_repair_status, generate_repair_label

### PRICING App

**Purpose**: Price list management and promotional pricing

**Models**: PriceList, PriceListItem, BulkPriceUpdateLog, Promotion

**Serializers**: PriceListItemSerializer, PriceListSerializer, BulkPriceUpdateLogSerializer, PromotionSerializer

**Views/ViewSets**: price_list_list_create, price_list_detail, price_list_items, bulk_price_update_preview, bulk_price_update_commit, promotion_list_create, promotion_detail, promotion_validate, bulk_price_update_log_list, bulk_price_update_log_detail

**Admin**: PriceListItemInline, PriceListAdmin, BulkPriceUpdateLogAdmin, PromotionAdmin

### PURCHASING App

**Purpose**: Purchase order management and vendor tracking

**Models**: Purchase, PurchaseItem

**Views/ViewSets**: purchase_list_create, purchase_detail

**Admin**: PurchaseItemInline, PurchaseAdmin

### REPORTS App

**Purpose**: Business analytics and reporting

## Database Models

The system uses Django ORM with interconnected models:

### Product Management

- Product → ProductVariant → Barcode
- Category → Product
- Brand → Product

### Inventory Flow

- Stock ← StockAdjustment, StockTransfer
- Stock ← Purchase, Invoice

### Party Management

- Customer ← LedgerEntry, Invoice, Return
- Supplier ← Purchase

### POS Operations

- Invoice ← Cart, InvoiceItem, Payment
- Return ← CreditNote
- Replacement ← Defective Product

## API Endpoints

All endpoints are prefixed with `/api/v1/` and require JWT authentication unless noted.

**Total Endpoints**: 153

### CATALOG Endpoints

| Path                                             | View                              |
| ------------------------------------------------ | --------------------------------- |
| `/api/v1/categories/`                            | category_list_create              |
| `/api/v1/categories/<int:pk>/`                   | category_detail                   |
| `/api/v1/brands/`                                | brand_list_create                 |
| `/api/v1/brands/<int:pk>/`                       | brand_detail                      |
| `/api/v1/tax-rates/`                             | tax_rate_list_create              |
| `/api/v1/tax-rates/<int:pk>/`                    | tax_rate_detail                   |
| `/api/v1/products/`                              | product_list_wrapper              |
| `/api/v1/products/<int:pk>/`                     | product_detail                    |
| `/api/v1/products/<int:pk>/variants/`            | product_variants                  |
| `/api/v1/products/<int:pk>/barcodes/`            | product_barcodes                  |
| `/api/v1/products/<int:pk>/components/`          | product_components                |
| `/api/v1/products/backfill-barcodes/`            | product_backfill_barcodes         |
| `/api/v1/products/generate-label/`               | product_generate_label            |
| `/api/v1/products/<int:pk>/generate-labels/`     | product_generate_labels           |
| `/api/v1/products/<int:pk>/labels/`              | product_get_labels                |
| `/api/v1/products/<int:pk>/labels-status/`       | product_labels_status             |
| `/api/v1/products/<int:pk>/regenerate-labels/`   | product_regenerate_labels         |
| `/api/v1/variants/`                              | product_variant_list_create       |
| `/api/v1/variants/<int:pk>/`                     | product_variant_detail            |
| `/api/v1/barcodes/`                              | barcode_list_create               |
| `/api/v1/barcodes/<int:pk>/`                     | barcode_detail                    |
| `/api/v1/barcodes/by-barcode/`                   | barcode_by_barcode                |
| `/api/v1/barcodes/by-barcode/<str:barcode>/`     | barcode_by_barcode                |
| `/api/v1/barcodes/<int:barcode_id>/update-tag/`  | update_barcode_tag                |
| `/api/v1/barcodes/bulk-update-tags/`             | bulk_update_barcode_tags          |
| `/api/v1/data-validation/check/`                 | data_validation_check             |
| `/api/v1/defective-products/move-out/`           | defective_product_move_out        |
| `/api/v1/defective-products/move-outs/`          | defective_product_move_out_list   |
| `/api/v1/defective-products/move-outs/<int:pk>/` | defective_product_move_out_detail |

### CONFIG Endpoints

| Path              | View |
| ----------------- | ---- |
| `/api/v1/admin/`  | urls |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |
| `/api/v1/api/v1/` |      |

### CORE Endpoints

| Path                           | View                |
| ------------------------------ | ------------------- |
| `/api/v1/auth/register/`       | register            |
| `/api/v1/auth/login/`          |                     |
| `/api/v1/auth/refresh/`        |                     |
| `/api/v1/auth/me/`             | user_me             |
| `/api/v1/users/`               | user_list_create    |
| `/api/v1/users/<int:pk>/`      | user_detail         |
| `/api/v1/settings/`            | setting_list_create |
| `/api/v1/settings/<int:pk>/`   | setting_detail      |
| `/api/v1/audit-logs/`          | audit_log_list      |
| `/api/v1/audit-logs/<int:pk>/` | audit_log_detail    |
| `/api/v1/search/`              | global_search       |

### INVENTORY Endpoints

| Path                                  | View                         |
| ------------------------------------- | ---------------------------- |
| `/api/v1/stock/`                      | optimized_stock_list         |
| `/api/v1/stock/<int:pk>/`             | stock_detail                 |
| `/api/v1/stock/low/`                  | optimized_stock_low          |
| `/api/v1/stock/out-of-stock/`         | optimized_stock_out_of_stock |
| `/api/v1/stock/batches/`              | stock_batch_list             |
| `/api/v1/stock/batches/<int:pk>/`     | stock_batch_detail           |
| `/api/v1/stock-adjustments/`          | stock_adjustment_list_create |
| `/api/v1/stock-adjustments/<int:pk>/` | stock_adjustment_detail      |
| `/api/v1/stock-transfers/`            | stock_transfer_list_create   |
| `/api/v1/stock-transfers/<int:pk>/`   | stock_transfer_detail        |

### LOCATIONS Endpoints

| Path                           | View                  |
| ------------------------------ | --------------------- |
| `/api/v1/stores/`              | store_list_create     |
| `/api/v1/stores/<int:pk>/`     | store_detail          |
| `/api/v1/warehouses/`          | warehouse_list_create |
| `/api/v1/warehouses/<int:pk>/` | warehouse_detail      |

### PARTIES Endpoints

| Path                                                   | View                              |
| ------------------------------------------------------ | --------------------------------- |
| `/api/v1/customer-groups/`                             | customer_group_list_create        |
| `/api/v1/customer-groups/<int:pk>/`                    | customer_group_detail             |
| `/api/v1/customers/`                                   | customer_list_create              |
| `/api/v1/customers/<int:pk>/`                          | customer_detail                   |
| `/api/v1/customers/<int:pk>/balance/`                  | customer_balance                  |
| `/api/v1/customers/<int:pk>/adjust-credit/`            | customer_adjust_credit            |
| `/api/v1/suppliers/`                                   | supplier_list_create              |
| `/api/v1/suppliers/<int:pk>/`                          | supplier_detail                   |
| `/api/v1/ledger/entries/`                              | ledger_entry_list_create          |
| `/api/v1/ledger/summary/`                              | ledger_summary                    |
| `/api/v1/ledger/customers/<int:customer_id>/`          | ledger_customer_detail            |
| `/api/v1/personal-customers/`                          | personal_customer_list_create     |
| `/api/v1/personal-customers/<int:pk>/`                 | personal_customer_detail          |
| `/api/v1/personal-ledger/entries/`                     | personal_ledger_entry_list_create |
| `/api/v1/personal-ledger/summary/`                     | personal_ledger_summary           |
| `/api/v1/personal-ledger/customers/<int:customer_id>/` | personal_ledger_customer_detail   |
| `/api/v1/internal-customers/`                          | internal_customer_list_create     |
| `/api/v1/internal-customers/<int:pk>/`                 | internal_customer_detail          |
| `/api/v1/internal-ledger/entries/`                     | internal_ledger_entry_list_create |
| `/api/v1/internal-ledger/summary/`                     | internal_ledger_summary           |
| `/api/v1/internal-ledger/customers/<int:customer_id>/` | internal_ledger_customer_detail   |

### POS Endpoints

| Path                                                           | View                           |
| -------------------------------------------------------------- | ------------------------------ |
| `/api/v1/pos/sessions/`                                        | pos_session_list_create        |
| `/api/v1/pos/sessions/<int:pk>/`                               | pos_session_detail             |
| `/api/v1/pos/sessions/<int:pk>/close/`                         | pos_session_close              |
| `/api/v1/pos/carts/`                                           | cart_list_create               |
| `/api/v1/pos/carts/<int:pk>/`                                  | cart_detail                    |
| `/api/v1/pos/carts/<int:pk>/items/`                            | cart_items                     |
| `/api/v1/pos/carts/<int:pk>/items/<int:item_id>/`              | cart_item_update               |
| `/api/v1/pos/carts/<int:pk>/items/<int:item_id>/remove-sku/`   | cart_item_remove_sku           |
| `/api/v1/pos/carts/<int:pk>/hold/`                             | cart_hold                      |
| `/api/v1/pos/carts/<int:pk>/unhold/`                           | cart_unhold                    |
| `/api/v1/pos/carts/<int:pk>/checkout/`                         | cart_checkout                  |
| `/api/v1/pos/invoices/`                                        | invoice_list_create            |
| `/api/v1/pos/invoices/<int:pk>/`                               | invoice_detail                 |
| `/api/v1/pos/invoices/<int:pk>/items/`                         | invoice_items                  |
| `/api/v1/pos/invoices/<int:pk>/items/<int:item_id>/`           | invoice_item_detail            |
| `/api/v1/pos/invoices/<int:pk>/payments/`                      | invoice_payments               |
| `/api/v1/pos/invoices/<int:pk>/void/`                          | invoice_void                   |
| `/api/v1/pos/invoices/<int:pk>/checkout/`                      | invoice_checkout               |
| `/api/v1/pos/invoices/<int:pk>/edit/`                          | invoice_edit                   |
| `/api/v1/pos/invoices/<int:pk>/update/`                        | invoice_update                 |
| `/api/v1/pos/invoices/<int:pk>/mark-credit/`                   | invoice_mark_credit            |
| `/api/v1/pos/invoices/<int:pk>/return/`                        | invoice_return                 |
| `/api/v1/pos/invoices/<int:pk>/exchange/`                      | invoice_exchange               |
| `/api/v1/returns/`                                             | return_list_create             |
| `/api/v1/returns/<int:pk>/`                                    | return_detail                  |
| `/api/v1/returns/<int:pk>/credit-note/`                        | return_credit_note             |
| `/api/v1/returns/<int:pk>/refund/`                             | return_refund                  |
| `/api/v1/credit-notes/`                                        | credit_note_list               |
| `/api/v1/credit-notes/<int:pk>/`                               | credit_note_detail             |
| `/api/v1/pos/replacement/check/`                               | replacement_check              |
| `/api/v1/pos/replacement/create/`                              | replacement_create             |
| `/api/v1/pos/replacement/barcode/<int:barcode_id>/update-tag/` | replacement_update_tag         |
| `/api/v1/pos/replacement/replace/`                             | replacement_replace            |
| `/api/v1/pos/replacement/return/`                              | replacement_return             |
| `/api/v1/pos/replacement/defective/`                           | replacement_defective          |
| `/api/v1/pos/replacement/find-invoice/`                        | find_invoice_by_barcode        |
| `/api/v1/pos/replacement/search-invoices/`                     | search_invoices_by_number      |
| `/api/v1/pos/replacement/<int:invoice_id>/process/`            | process_replacement            |
| `/api/v1/pos/replacement/<int:invoice_id>/credit-note/`        | replacement_credit_note        |
| `/api/v1/pos/repair/invoices/`                                 | repair_invoices_list           |
| `/api/v1/pos/repair/invoices/find-by-barcode/`                 | find_repair_invoice_by_barcode |
| `/api/v1/pos/invoices/<int:pk>/update-repair-status/`          | update_repair_status           |
| `/api/v1/pos/invoices/<int:pk>/generate-repair-label/`         | generate_repair_label          |

### PRICING Endpoints

| Path                                   | View                         |
| -------------------------------------- | ---------------------------- |
| `/api/v1/price-lists/`                 | price_list_list_create       |
| `/api/v1/price-lists/<int:pk>/`        | price_list_detail            |
| `/api/v1/price-lists/<int:pk>/items/`  | price_list_items             |
| `/api/v1/promotions/`                  | promotion_list_create        |
| `/api/v1/promotions/<int:pk>/`         | promotion_detail             |
| `/api/v1/promotions/validate/`         | promotion_validate           |
| `/api/v1/pricing/bulk-update/preview/` | bulk_price_update_preview    |
| `/api/v1/pricing/bulk-update/commit/`  | bulk_price_update_commit     |
| `/api/v1/pricing/change-log/`          | bulk_price_update_log_list   |
| `/api/v1/pricing/change-log/<int:pk>/` | bulk_price_update_log_detail |

### PURCHASING Endpoints

| Path                                                    | View                         |
| ------------------------------------------------------- | ---------------------------- |
| `/api/v1/purchases/`                                    | purchase_list_create         |
| `/api/v1/purchases/<int:pk>/`                           | purchase_detail              |
| `/api/v1/purchases/<int:pk>/items/`                     | purchase_items               |
| `/api/v1/purchases/<int:pk>/finalize/`                  | purchase_finalize            |
| `/api/v1/purchases/items/<int:item_id>/update-printed/` | purchase_item_update_printed |
| `/api/v1/vendor-purchases/`                             | vendor_purchases             |
| `/api/v1/vendor-purchases/<int:pk>/`                    | vendor_purchase_detail       |
| `/api/v1/vendor-purchases/<int:pk>/cancel/`             | vendor_purchase_cancel       |

### REPORTS Endpoints

| Path                                 | View                     |
| ------------------------------------ | ------------------------ |
| `/api/v1/reports/sales-summary/`     | sales_summary            |
| `/api/v1/reports/top-products/`      | top_products             |
| `/api/v1/reports/inventory-summary/` | inventory_summary        |
| `/api/v1/reports/revenue/`           | revenue_report           |
| `/api/v1/reports/customers/`         | customer_summary         |
| `/api/v1/reports/stock-ordering/`    | stock_ordering_report    |
| `/api/v1/reports/dashboard-kpis/`    | optimized_dashboard_kpis |

## Frontend Integration

### Authentication Flow

1. User registers/logs in via `/auth/register/` or `/auth/login/`
2. Backend returns JWT token
3. Frontend stores token and includes in all API requests
4. Automatic token refresh on expiry

### React Architecture

- Component-based UI with TypeScript
- Redux for global state management
- Tailwind CSS for styling
- Vite for fast development and builds

### Main Features

- Product catalog browsing
- Real-time inventory tracking
- POS transaction processing
- Customer management
- Sales reporting and analytics

## Frontend Pages & API Integration

### Authentication Pages

#### Login.tsx

**Purpose**: User login and session management
**API Calls**:

- `POST /api/v1/auth/login/` - Authenticate user with credentials
- `GET /api/v1/auth/me/` - Fetch current user profile
- `POST /api/v1/auth/refresh/` - Refresh JWT token on expiry

#### Register.tsx

**Purpose**: New user registration and account creation
**API Calls**:

- `POST /api/v1/auth/register/` - Create new user account
- `POST /api/v1/auth/login/` - Auto-login after registration
- `GET /api/v1/settings/` - Fetch system configuration settings

### Dashboard & Analytics

#### Dashboard.tsx

**Purpose**: Main KPI dashboard with sales, inventory, and financial metrics
**API Calls**:

- `GET /api/v1/reports/dashboard-kpis/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` - Fetch KPI metrics with date range
- `GET /api/v1/reports/sales-summary/?date_from=&date_to=` - Daily/period sales summary
- `GET /api/v1/reports/revenue/?date_from=&date_to=` - Revenue breakdown
- `GET /api/v1/stock/low/` - Low stock alerts
- `GET /api/v1/stock/out-of-stock/` - Out of stock products

#### Reports.tsx

**Purpose**: Comprehensive business analytics and reporting
**API Calls**:

- `GET /api/v1/reports/sales-summary/` - Sales performance metrics
- `GET /api/v1/reports/top-products/?limit=10` - Top selling products
- `GET /api/v1/reports/inventory-summary/` - Inventory valuation report
- `GET /api/v1/reports/revenue/` - Revenue analysis by period
- `GET /api/v1/reports/customers/` - Customer purchase statistics
- `GET /api/v1/reports/stock-ordering/` - Stock reorder recommendations

### Product Management

#### Products.tsx

**Purpose**: Product catalog listing, filtering, and batch operations
**API Calls**:

- `GET /api/v1/products/?search=query&category=id&brand=id&page=1` - List products with filters
- `POST /api/v1/products/` - Create new product
- `GET /api/v1/categories/` - Fetch product categories
- `GET /api/v1/brands/` - Fetch product brands
- `GET /api/v1/stock/?product_id=id` - Product stock levels
- `POST /api/v1/products/<id>/generate-labels/` - Generate barcode labels
- `GET /api/v1/products/<id>/labels-status/` - Check label generation status
- `DELETE /api/v1/products/<id>/` - Delete product

#### ProductForm.tsx

**Purpose**: Create/edit product details, variants, and attributes
**API Calls**:

- `POST /api/v1/products/` - Create new product
- `PUT /api/v1/products/<id>/` - Update product details
- `POST /api/v1/variants/` - Add product variants (sizes/colors)
- `PUT /api/v1/variants/<id>/` - Update variant
- `GET /api/v1/tax-rates/` - Fetch tax rate options

#### ProductDetail.tsx

**Purpose**: View detailed product information, variants, and barcodes
**API Calls**:

- `GET /api/v1/products/<id>/` - Get product details
- `GET /api/v1/products/<id>/variants/` - List product variants
- `GET /api/v1/products/<id>/barcodes/` - List barcodes for product
- `GET /api/v1/stock/?product_id=<id>` - Get stock by location
- `GET /api/v1/products/<id>/labels/` - Download generated labels

### Inventory Management

#### Products.tsx (Inventory Tab)

**Purpose**: Stock tracking, low stock monitoring, out of stock alerts
**API Calls**:

- `GET /api/v1/stock/` - List all stock records
- `GET /api/v1/stock/low/` - Filter low stock items (query_limit param)
- `GET /api/v1/stock/out-of-stock/` - Filter out-of-stock items
- `GET /api/v1/stock/batches/` - View stock batches with expiry
- `POST /api/v1/stock-adjustments/` - Create stock adjustment (add/remove)
- `POST /api/v1/stock-transfers/` - Transfer stock between locations

### Point of Sale (POS)

#### POS.tsx

**Purpose**: Fast checkout, basket management, and invoice creation
**API Calls**:

- `POST /api/v1/pos/sessions/` - Create new POS session
- `GET /api/v1/pos/sessions/<id>/` - Get current session details
- `POST /api/v1/pos/carts/` - Create new cart for transaction
- `POST /api/v1/pos/carts/<id>/items/` - Add item to cart
- `PUT /api/v1/pos/carts/<id>/items/<item_id>/` - Update cart item quantity
- `DELETE /api/v1/pos/carts/<id>/items/<item_id>/remove-sku/` - Remove item from cart
- `POST /api/v1/pos/carts/<id>/hold/` - Hold cart for later
- `POST /api/v1/pos/carts/<id>/unhold/` - Recall held cart
- `POST /api/v1/pos/carts/<id>/checkout/` - Complete transaction
- `GET /api/v1/barcodes/by-barcode/<barcode>/` - Lookup product by barcode
- `POST /api/v1/pos/sessions/<id>/close/` - Close POS session

#### Invoices.tsx

**Purpose**: Invoice history, search, and management
**API Calls**:

- `GET /api/v1/pos/invoices/?search=number&page=1` - List invoices with pagination
- `GET /api/v1/pos/invoices/<id>/` - Get invoice details
- `GET /api/v1/pos/invoices/<id>/items/` - Get line items
- `POST /api/v1/pos/invoices/<id>/void/` - Void invoice
- `POST /api/v1/pos/invoices/<id>/return/` - Return items from invoice
- `POST /api/v1/pos/invoices/<id>/exchange/` - Exchange items

#### Replacement.tsx

**Purpose**: Product replacement and warranty management
**API Calls**:

- `POST /api/v1/pos/replacement/check/` - Check if product eligible for replacement
- `POST /api/v1/pos/replacement/find-invoice/` - Find original invoice by barcode
- `POST /api/v1/pos/replacement/replace/` - Process replacement
- `POST /api/v1/pos/replacement/<invoice_id>/process/` - Complete replacement
- `POST /api/v1/pos/replacement/defective/` - Mark as defective product

#### Repairs.tsx

**Purpose**: Repair ticket management and tracking
**API Calls**:

- `GET /api/v1/pos/repair/invoices/` - List repair tickets
- `POST /api/v1/pos/repair/invoices/find-by-barcode/` - Find repair by barcode
- `PUT /api/v1/pos/invoices/<id>/update-repair-status/` - Update repair status
- `POST /api/v1/pos/invoices/<id>/generate-repair-label/` - Generate repair label

#### CreditNotes.tsx

**Purpose**: Credit note tracking and refund management
**API Calls**:

- `GET /api/v1/credit-notes/` - List all credit notes
- `GET /api/v1/credit-notes/<id>/` - Get credit note details
- `POST /api/v1/returns/<id>/credit-note/` - Generate credit note from return

### Customer Management

#### Customers.tsx

**Purpose**: B2B customer management, groups, and credit tracking
**API Calls**:

- `GET /api/v1/customers/?search=query&group=id&page=1` - List customers with filters
- `POST /api/v1/customers/` - Create new customer
- `GET /api/v1/customer-groups/` - Fetch customer groups
- `GET /api/v1/customers/<id>/balance/` - Get customer credit balance
- `POST /api/v1/customers/<id>/adjust-credit/` - Add/remove credit

#### PersonalCustomers.tsx

**Purpose**: Personal/retail customer tracking and profiles
**API Calls**:

- `GET /api/v1/personal-customers/?page=1` - List personal customers
- `POST /api/v1/personal-customers/` - Create personal customer
- `GET /api/v1/personal-customers/<id>/` - Get customer details

#### Vendors.tsx

**Purpose**: Supplier/vendor management and purchase tracking
**API Calls**:

- `GET /api/v1/suppliers/?search=query&page=1` - List suppliers
- `POST /api/v1/suppliers/` - Create new supplier
- `GET /api/v1/vendors/` - Get vendor-specific data
- `GET /api/v1/vendor-purchases/?vendor=id` - Supplier purchase history

### Financial Management

#### Ledger.tsx (B2B Customer Ledger)

**Purpose**: Customer financial ledger and transaction history
**API Calls**:

- `GET /api/v1/ledger/entries/?customer=id` - Get customer ledger entries
- `GET /api/v1/ledger/summary/` - Ledger summary with totals
- `GET /api/v1/ledger/customers/<customer_id>/` - Individual customer ledger

#### PersonalLedger.tsx

**Purpose**: Personal customer credit/debit tracking
**API Calls**:

- `GET /api/v1/personal-ledger/entries/?customer=id` - Personal customer transactions
- `GET /api/v1/personal-ledger/summary/` - Summary statistics
- `GET /api/v1/personal-ledger/customers/<customer_id>/` - Customer personal ledger

#### InternalLedger.tsx

**Purpose**: Internal party (head office, franchise) ledger management
**API Calls**:

- `GET /api/v1/internal-ledger/entries/?party=id` - Internal party transactions
- `GET /api/v1/internal-ledger/summary/` - Summary data
- `GET /api/v1/internal-ledger/customers/<party_id>/` - Individual party ledger

### Pricing & Promotions

#### Pricing.tsx

**Purpose**: Price list management and bulk price updates
**API Calls**:

- `GET /api/v1/price-lists/?page=1` - List active price lists
- `POST /api/v1/price-lists/` - Create new price list
- `GET /api/v1/price-lists/<id>/items/` - Get price list items
- `POST /api/v1/pricing/bulk-update/preview/` - Preview bulk price changes
- `POST /api/v1/pricing/bulk-update/commit/` - Apply bulk price updates
- `GET /api/v1/pricing/change-log/` - View price change history
- `POST /api/v1/promotions/` - Create promotional pricing
- `GET /api/v1/promotions/<id>/validate/` - Validate promotion rules

### Stores & Locations

#### Stores.tsx

**Purpose**: Multi-location management (stores, branches, warehouses)
**API Calls**:

- `GET /api/v1/stores/` - List all store locations
- `POST /api/v1/stores/` - Create new store
- `PUT /api/v1/stores/<id>/` - Update store details
- `GET /api/v1/warehouses/` - List warehouses
- `POST /api/v1/warehouses/` - Create warehouse
- `GET /api/v1/stock/?store=<store_id>` - Store-specific inventory

### Purchasing

#### Purchases.tsx

**Purpose**: Purchase order management and vendor tracking
**API Calls**:

- `GET /api/v1/purchases/?vendor=id&status=pending&page=1` - List purchase orders
- `POST /api/v1/purchases/` - Create new purchase order
- `GET /api/v1/purchases/<id>/` - Get PO details
- `GET /api/v1/purchases/<id>/items/` - Get line items
- `POST /api/v1/purchases/<id>/finalize/` - Mark PO complete
- `PUT /api/v1/purchases/items/<item_id>/update-printed/` - Mark item as printed

#### VendorPurchases.tsx

**Purpose**: Vendor-specific purchase history and analytics
**API Calls**:

- `GET /api/v1/vendor-purchases/?vendor=id&status=&page=1` - Vendor purchase list
- `GET /api/v1/vendor-purchases/<id>/` - Vendor purchase details
- `POST /api/v1/vendor-purchases/<id>/cancel/` - Cancel vendor order

### Search & Other Utilities

#### Search.tsx

**Purpose**: Global search across products, customers, invoices
**API Calls**:

- `GET /api/v1/search/?q=query&type=product|customer|invoice` - Global search
- `GET /api/v1/barcodes/by-barcode/?q=barcode_value` - Barcode lookup
- `GET /api/v1/products/?search=query` - Product search with filters

#### DefectiveMoveOuts.tsx

**Purpose**: Manage defective products and removal tracking
**API Calls**:

- `POST /api/v1/defective-products/move-out/` - Record defective product removal
- `GET /api/v1/defective-products/move-outs/` - List defective product records
- `GET /api/v1/defective-products/move-outs/<id>/` - Get defective product details

#### History.tsx

**Purpose**: Audit trail and transaction history
**API Calls**:

- `GET /api/v1/audit-logs/?user=id&action=&date_from=&page=1` - User action history
- `GET /api/v1/audit-logs/<id>/` - Audit log details

## Backend View Functions & Their Purposes

All backend functions are defined in `backend/*/views.py` files. Here's a detailed breakdown by app:

### CORE App Functions

**Authentication & User Management**:

- `register()` - Create new user account with email validation
- `login()` - Authenticate user and return JWT token
- `refresh()` - Refresh expired JWT token
- `user_me()` - Return current authenticated user profile

**User Management**:

- `user_list_create()` - GET: List all users (admin only) | POST: Create new user
- `user_detail()` - GET: User details | PUT: Update user | PATCH: Partial update | DELETE: Remove user

**Settings Management**:

- `setting_list_create()` - GET: Fetch system configuration settings | POST: Create setting
- `setting_detail()` - GET/PUT/PATCH/DELETE individual settings

**Audit & Logging**:

- `audit_log_list()` - GET: Retrieve audit trail with filters (user, action, date range)
- `audit_log_detail()` - GET: View specific audit log entry
- `global_search()` - Search across products, customers, invoices with query parameter

### CATALOG App Functions

**Category Management**:

- `category_list_create()` - GET: List all product categories | POST: Create new category
- `category_detail()` - GET/PUT/PATCH/DELETE category (modify category name/description)

**Brand Management**:

- `brand_list_create()` - GET: List all brands | POST: Create brand
- `brand_detail()` - GET/PUT/PATCH/DELETE brand details

**Tax Rate Management**:

- `tax_rate_list_create()` - GET: List tax rates | POST: Create tax rate
- `tax_rate_detail()` - GET/PUT/PATCH/DELETE tax rate

**Product Catalog**:

- `product_list_wrapper()` - GET: List products with advanced filtering (category, brand, stock status, tags, pagination) | POST: Create product
- `product_detail()` - GET: Full product details with variants and stock | PUT: Update product | DELETE: Archive product
- `product_variants()` - GET: List all variants for product
- `product_barcodes()` - GET: List all barcodes for product and their status
- `product_components()` - GET: List component products (BOM - Bill of Materials)

**Variant Management**:

- `product_variant_list_create()` - GET: List all variants | POST: Create new variant (size, color, etc.)
- `product_variant_detail()` - GET/PUT/PATCH/DELETE variant

**Barcode & Label Generation**:

- `product_generate_label()` - POST: Generate single label (returns ZPL format for printer)
- `product_generate_labels()` - POST: Generate all labels for product to Azure Blob Storage
- `product_get_labels()` - GET: Download generated label files (returns SAS URLs)
- `product_labels_status()` - GET: Check if labels are generated, generating, or failed
- `product_regenerate_labels()` - POST: Regenerate labels for product (clear cache and recreate)
- `product_backfill_barcodes()` - POST: Auto-generate missing barcodes for products

**Barcode Lookup & Management**:

- `barcode_list_create()` - GET: List all barcodes | POST: Create barcode manually
- `barcode_detail()` - GET/PUT/PATCH/DELETE barcode record
- `barcode_by_barcode()` - GET: Smart lookup by barcode string (searches product SKU, variant codes, exact barcode)
  - Returns: barcode data, product info, stock status, sold status (if sold in POS)
- `update_barcode_tag()` - POST: Update barcode tag (fresh/sold/defective/discarded)
- `bulk_update_barcode_tags()` - POST: Batch tag updates for multiple barcodes

**Validation & Utility**:

- `data_validation_check()` - POST: Validate product data integrity (missing barcodes, stock inconsistencies)
- `defective_product_move_out()` - POST: Record defective product removal with reason and notes
- `defective_product_move_out_list()` - GET: List defective product records with filters
- `defective_product_move_out_detail()` - GET/DELETE defective product record

**Helper Functions** (internal, not exposed):

- `is_likely_sku()` - Identify if search term matches SKU pattern
- `generate_single_label()` - Format ZPL code for barcode printer
- `get_barcode_status_message()` - Return human-readable barcode status
- `check_barcode_sold_status()` - Determine if barcode was sold in invoice
- `build_barcode_response()` - Construct detailed barcode response with all metadata

### INVENTORY App Functions

**Stock Management**:

- `optimized_stock_list()` - GET: List stock with optimized queries (includes product, variant, location)
- `stock_detail()` - GET: View individual stock record with history
- `optimized_stock_low()` - GET: List items below reorder level (query_limit parameter)
- `optimized_stock_out_of_stock()` - GET: Filter completely out-of-stock items

**Stock Batches** (for expiry tracking):

- `stock_batch_list()` - GET: List batches with expiry dates | POST: Create batch
- `stock_batch_detail()` - GET/PUT/PATCH/DELETE batch record

**Stock Adjustments** (manual inventory corrections):

- `stock_adjustment_list_create()` - GET: List adjustments (in/out/correction) | POST: Create adjustment
  - Parameters: adjustment_type (in/out/correction), product, quantity, reason, notes
- `stock_adjustment_detail()` - GET/DELETE adjustment

**Stock Transfers** (inter-location transfers):

- `stock_transfer_list_create()` - GET: List transfers | POST: Create transfer between locations
- `stock_transfer_detail()` - GET/DELETE transfer record

### LOCATIONS App Functions

**Store Management**:

- `store_list_create()` - GET: List all store locations | POST: Create new store
- `store_detail()` - GET/PUT/PATCH/DELETE store (update address, phone, manager)

**Warehouse Management**:

- `warehouse_list_create()` - GET: List warehouses | POST: Create warehouse
- `warehouse_detail()` - GET/PUT/PATCH/DELETE warehouse details

### PARTIES App Functions

**Customer Management** (B2B):

- `customer_list_create()` - GET: List customers with filters | POST: Create customer
- `customer_detail()` - GET/PUT/PATCH/DELETE customer
- `customer_balance()` - GET: Current credit balance and summary
- `customer_adjust_credit()` - POST: Add/remove credit (manual adjustment)

**Customer Groups**:

- `customer_group_list_create()` - GET: List customer groups | POST: Create group
- `customer_group_detail()` - GET/PUT/PATCH/DELETE group

**Personal Customers** (retail/walk-in):

- `personal_customer_list_create()` - GET: List personal customers | POST: Create
- `personal_customer_detail()` - GET/PUT/PATCH/DELETE personal customer

**Suppliers/Vendors**:

- `supplier_list_create()` - GET: List suppliers | POST: Create supplier
- `supplier_detail()` - GET/PUT/PATCH/DELETE supplier

**Financial Ledgers** (Customer Account):

- `ledger_entry_list_create()` - GET: Customer transactions (debit/credit) | POST: Create entry
- `ledger_summary()` - GET: Total debit, credit, balance by customer/group
- `ledger_customer_detail()` - GET: Individual customer's complete ledger history

**Personal Ledger** (Personal customer credit):

- `personal_ledger_entry_list_create()` - GET: Personal customer transactions | POST: Create
- `personal_ledger_summary()` - GET: Personal customer balance summary
- `personal_ledger_customer_detail()` - GET: Customer personal transaction history

**Internal Ledger** (Head office/franchise):

- `internal_ledger_entry_list_create()` - GET: Internal party transactions | POST: Create
- `internal_ledger_summary()` - GET: Internal party summary
- `internal_ledger_customer_detail()` - GET: Internal party ledger history

### POS App Functions

**POS Session Management**:

- `pos_session_list_create()` - GET: List sessions | POST: Start new POS session
- `pos_session_detail()` - GET: View session details and totals
- `pos_session_close()` - POST: Close session and reconcile cash

**Cart Management**:

- `cart_list_create()` - GET: List carts | POST: Create new cart for transaction
- `cart_detail()` - GET: Cart contents and totals
- `cart_items()` - GET: Line items in cart | POST: Add item to cart
- `cart_item_update()` - PUT: Update item quantity or price
- `cart_item_remove_sku()` - DELETE: Remove item from cart
- `cart_hold()` - POST: Pause transaction and save cart
- `cart_unhold()` - POST: Resume held cart
- `cart_checkout()` - POST: Complete sale and create invoice

**Invoice Management**:

- `invoice_list_create()` - GET: List invoices with search/filter | POST: Create invoice
- `invoice_detail()` - GET: Invoice full details with items and payments
- `invoice_items()` - GET: Line items | POST: Add item to existing invoice
- `invoice_item_detail()` - GET/PUT/PATCH/DELETE line item
- `invoice_payments()` - GET: Payment methods used
- `invoice_void()` - POST: Cancel invoice (full reversal)
- `invoice_edit()` - POST: Re-open invoice for editing
- `invoice_update()` - PUT: Update invoice details
- `invoice_mark_credit()` - POST: Mark invoice as credit sale
- `invoice_return()` - POST: Create return/refund from invoice
- `invoice_exchange()` - POST: Exchange items from invoice

**Returns & Credit Notes**:

- `return_list_create()` - GET: List returns | POST: Create return
- `return_detail()` - GET/DELETE return
- `return_credit_note()` - POST: Generate credit note from return
- `return_refund()` - POST: Process refund for return
- `credit_note_list()` - GET: List credit notes
- `credit_note_detail()` - GET: Credit note details

**Replacement Management**:

- `replacement_check()` - POST: Verify product eligible for replacement
- `replacement_create()` - POST: Initiate replacement process
- `replacement_update_tag()` - POST: Update barcode tag during replacement
- `replacement_replace()` - POST: Issue replacement product
- `replacement_return()` - POST: Process returned item in replacement
- `replacement_defective()` - POST: Mark as defective in replacement flow
- `find_invoice_by_barcode()` - GET: Find invoice using product barcode
- `search_invoices_by_number()` - GET: Search invoices by invoice number
- `process_replacement()` - POST: Complete replacement transaction
- `replacement_credit_note()` - POST: Generate credit for replacement

**Repair Management**:

- `repair_invoices_list()` - GET: List repair tickets with status
- `find_repair_invoice_by_barcode()` - GET: Find repair using barcode
- `update_repair_status()` - PUT: Change repair status (in-progress/complete/failed)
- `generate_repair_label()` - POST: Create repair job label for printing

### PRICING App Functions

**Price List Management**:

- `price_list_list_create()` - GET: List active price lists | POST: Create new price list
- `price_list_detail()` - GET: Price list details | PUT: Update name/description
- `price_list_items()` - GET: Items in price list | POST: Add item pricing

**Bulk Price Updates**:

- `bulk_price_update_preview()` - POST: Preview price changes (percentage/fixed amount increase)
- `bulk_price_update_commit()` - POST: Apply approved price updates
- `bulk_price_update_log_list()` - GET: History of bulk updates
- `bulk_price_update_log_detail()` - GET: Specific bulk update details

**Promotions**:

- `promotion_list_create()` - GET: List promotions | POST: Create promotion rule
- `promotion_detail()` - GET/PUT/PATCH/DELETE promotion
- `promotion_validate()` - POST: Validate promotion eligibility for product

### PURCHASING App Functions

**Purchase Orders**:

- `purchase_list_create()` - GET: List purchase orders with status | POST: Create new PO
- `purchase_detail()` - GET: PO details | PUT: Update PO
- `purchase_items()` - GET: Line items in PO | POST: Add item
- `purchase_finalize()` - POST: Mark PO complete and receive inventory
- `purchase_item_update_printed()` - PUT: Mark item as printed on label

**Vendor Purchases**:

- `vendor_purchases()` - GET: List all vendor purchase orders with filters
- `vendor_purchase_detail()` - GET: Individual vendor PO details
- `vendor_purchase_cancel()` - POST: Cancel vendor PO

### REPORTS App Functions

**Reporting & Analytics**:

- `sales_summary()` - GET: Daily/period sales totals by payment method (cash/credit/online)
- `top_products()` - GET: Top N selling products by quantity or revenue
- `inventory_summary()` - GET: Total inventory value, items count, by category
- `revenue_report()` - GET: Revenue breakdown by period, payment type, customer group
- `customer_summary()` - GET: Customer statistics (top customers, purchase frequency)
- `stock_ordering_report()` - GET: Reorder recommendations based on consumption rate
- `optimized_dashboard_kpis()` - GET: All KPIs with comparisons
  - Parameters: date_from, date_to
  - Returns: Sales, profit, cash flow, inventory metrics with day-over-day/period comparisons

### Inventory Management

✅ Real-time stock tracking across multiple locations
✅ Stock batches with expiry tracking
✅ Automated low stock alerts
✅ Stock adjustments and transfers
✅ Barcode-based control

### Point-of-Sale (POS)

✅ Fast checkout with barcode scanning
✅ Multiple payment methods
✅ Hold/recall cart functionality
✅ Returns and exchanges
✅ Invoice generation

### Product Management

✅ Multi-variant products
✅ Barcode generation and printing
✅ Azure Blob Storage integration
✅ Tax rate management
✅ Defective product tracking

### Pricing & Promotions

✅ Multiple price lists
✅ Promotional rules
✅ Bulk price updates
✅ Price change history

### Financial Management

✅ Customer credit tracking
✅ B2B customer ledgers
✅ Personal customer tracking
✅ Credit note generation

### Reporting & Analytics

✅ Sales summaries
✅ Top products analysis
✅ Revenue reporting
✅ Customer analytics
✅ Inventory valuation
✅ Stock reorder recommendations

### Multi-Location Support

✅ Multiple stores/branches
✅ Multiple warehouses
✅ Location-specific inventory
✅ Stock transfers between locations

## Installation & Setup

### Prerequisites

- Python 3.9+
- PostgreSQL 12+
- Node.js 16+
- Git

### Backend Setup

```bash
# Clone repository
git clone <repo-url>
cd inventory-manager

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Start development server
python manage.py runserver
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Environment Configuration

Create `.env` file in project root:

```
# Django Settings
SECRET_KEY=your-secret-key-here
DEBUG=False
ALLOWED_HOSTS=localhost,127.0.0.1,your-domain.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/inventory_db

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=your-connection-string
AZURE_STORAGE_CONTAINER_NAME=barcode-labels

# Redis (optional)
REDIS_URL=redis://localhost:6379/0

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# JWT
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=1
```

## Performance Optimizations

### Database Query Optimization

- Select_related() and prefetch_related() for efficient queries
- Database indexing on frequently queried fields
- Query result caching

### Caching Strategy

- Product catalog: 24 hours
- Stock levels: 1 hour
- Price lists: 6 hours
- Reports data: 30 minutes

### Barcode Label Generation

- Batch processing with Azure Blob Storage
- Asynchronous label generation
- SAS token generation for secure downloads

## Limitations & Future Enhancements

### Current Limitations

1. No OAuth 2.0 integration (JWT only)
2. Single-tenant only
3. No WebSocket support for real-time updates
4. No native mobile apps
5. English language only
6. No integrated payment processing
7. Email notifications not implemented
8. SMS notifications not implemented
9. Limited advanced analytics
10. Basic user roles/permissions

### Planned Enhancements

- OAuth 2.0 and social login
- Multi-tenant architecture
- WebSocket real-time updates
- Native mobile apps (iOS/Android)
- Internationalization (i18n)
- Payment gateway integration
- Email and SMS notifications
- Advanced analytics with ML
- Supplier portal
- Customer loyalty programs
- Advanced barcode scanning
- Swagger/OpenAPI docs
- GraphQL API
- Microservices migration
- Kubernetes deployment

---

**Last Updated**: February 8, 2026
**Version**: 1.0.0
**License**: Proprietary (Manish Traders)
