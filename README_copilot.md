# MT-IMS (Manish Traders - Inventory Management System)

A comprehensive Django-based inventory and point-of-sale management system with real-time stock tracking, multi-location support, and detailed reporting capabilities.

---

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

---

## Architecture

The system is a **monolithic Django application** designed for retail inventory and POS management. It follows a modular architecture with separate Django apps for different business domains:

- **Backend**: Django REST Framework with PostgreSQL
- **Frontend**: React + Redux + TypeScript/JavaScript
- **Database**: PostgreSQL with relational models
- **Web Server**: Nginx (production)
- **Caching**: Redis (optional, for external services)
- **Storage**: Azure Blob Storage (for barcode labels and media)

```
Client (React Frontend)
    ↓ (HTTP/REST)
    ↓
Django REST API (Backend)
    ↓
PostgreSQL Database
    ↓
Azure Blob Storage (Media/Labels)
```

---

## Tech Stack

### Backend

- **Framework**: Django 5.2.8 + Django REST Framework 3.16.1
- **Authentication**: JWT (djangorestframework-simplejwt)
- **Database**: PostgreSQL (psycopg2-binary)
- **Caching**: Django-Redis (optional)
- **CORS**: django-cors-headers
- **Filtering**: django-filter
- **Barcode Generation**: python-barcode + Pillow
- **Azure Integration**: azure-storage-blob

### Frontend

- **Framework**: React (with Vite)
- **State Management**: Redux
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Build Tool**: Vite
- **HTTP Client**: (Integrated via API services)

### Infrastructure

- **Web Server**: Nginx
- **Container**: Docker (optional)
- **Testing**: Coverage.py, factory-boy

---

## Backend Applications

### 1. **Core App** (`backend/core/`)

**Purpose**: Authentication, user management, system settings, and audit logging

**Key Components**:

- User registration and authentication
- JWT token generation and refresh
- User profile management
- System settings/configuration
- Audit logging for compliance
- Global search functionality

**Models**:

- User
- AuditLog
- Setting

**API Endpoints** (Prefix: `/api/v1/`):

- Authentication & User Management
- Settings Management
- Audit Log Tracking

---

### 2. **Catalog App** (`backend/catalog/`)

**Purpose**: Product catalog, categories, brands, barcodes, and barcode label generation

**Key Components**:

- Product management with variants
- Category and brand management
- Tax rate configuration
- Barcode generation and management
- Barcode label printing (Azure integration)
- Product defective management

**Models**:

- Product
- ProductVariant
- Barcode
- Category
- Brand
- TaxRate
- DefectiveProductMoveOut

**Features**:

- 🚀 Optimized product listing
- Batch barcode generation
- Azure label service integration
- Defective product tracking

---

### 3. **Inventory App** (`backend/inventory/`)

**Purpose**: Stock management, inventory tracking, adjustments, and transfers

**Key Components**:

- Real-time stock levels
- Stock batches with expiry tracking
- Stock adjustments (add/remove)
- Stock transfers between locations
- Low stock and out-of-stock alerts

**Models**:

- Stock
- StockBatch
- StockAdjustment
- StockTransfer

**Features**:

- 🚀 Optimized stock queries (low, out-of-stock)
- Batch tracking for FIFO
- Multi-location stock management

---

### 4. **Locations App** (`backend/locations/`)

**Purpose**: Store and warehouse location management

**Key Components**:

- Store/branch management
- Warehouse location management
- Location-based inventory tracking

**Models**:

- Store
- Warehouse

---

### 5. **Parties App** (`backend/parties/`)

**Purpose**: Customer and supplier relationship management

**Key Components**:

- Customer group management
- Customer profile and credit management
- Supplier management
- Ledger entries (accounts receivable/payable)
- Personal customer tracking
- Internal customer/ledger management

**Models**:

- Customer
- CustomerGroup
- Supplier
- LedgerEntry
- PersonalCustomer
- PersonalLedgerEntry
- InternalCustomer
- InternalLedgerEntry

**Features**:

- Credit limit management
- Customer balance tracking
- Ledger summary reporting
- Separate ledgers for B2B, personal, and internal

---

### 6. **Purchasing App** (`backend/purchasing/`)

**Purpose**: Purchase order management and vendor tracking

**Key Components**:

- Purchase order creation and tracking
- Purchase finalization
- Vendor purchase orders (public, no auth)
- Purchase item tracking with print status

**Models**:

- Purchase
- PurchaseItem

---

### 7. **Pricing App** (`backend/pricing/`)

**Purpose**: Price list management and promotional pricing

**Key Components**:

- Price list creation and management
- Promotion management with validation
- Bulk price updates with preview and commit
- Price change history/audit log

**Models**:

- PriceList
- PriceListItem
- Promotion
- BulkPriceUpdate
- BulkPriceUpdateLog

**Features**:

- Preview bulk price changes before commit
- Audit trail for price modifications
- Promotional rule validation

---

### 8. **POS App** (`backend/pos/`)

**Purpose**: Point-of-sale operations, invoices, returns, and replacements

**Key Components**:

- POS session management
- Shopping cart management
- Invoice creation and processing
- Payment tracking
- Return and refund management
- Credit note generation
- Replacement/exchange processing
- Repair status tracking

**Models**:

- POSSession
- Cart
- CartItem
- Invoice
- InvoiceItem
- Payment
- Return
- CreditNote
- Replacement

**Features**:

- Hold/unhold carts for later processing
- Invoice void and editing
- Exchange and replacement workflows
- Repair tracking with status updates
- Credit note generation for returns

---

### 9. **Reports App** (`backend/reports/`)

**Purpose**: Business analytics and reporting

**Key Components**:

- Sales summary reporting
- Top products analysis
- Inventory summary
- Revenue reporting
- Customer analytics
- Stock ordering recommendations
- Dashboard KPIs

**Features**:

- 🚀 Optimized dashboard KPI queries
- Multi-dimensional reporting
- Sales and inventory trends

---

## Database Models

### Product Management

```
Product → ProductVariant
       → Barcode
       → StockBatch
       → LabelGeneration
Category → Product
Brand → Product
TaxRate → Product
```

### Inventory Flow

```
Stock ← StockAdjustment
      ← StockTransfer (from/to Warehouse)
      ← Purchase (inbound)
      ← Invoice (outbound)
```

### Party Management

```
Customer ← LedgerEntry
        ← Invoice
        ← Return
PersonalCustomer ← PersonalLedgerEntry
Supplier ← Purchase
```

### POS Operations

```
Invoice ← Cart
       ← InvoiceItem (with Product/Barcode)
       ← Payment
       ← Return
       ← Replacement
Replacement → CreditNote
```

---

## API Endpoints

All endpoints are prefixed with `/api/v1/` and require authentication (JWT token) unless otherwise noted.

### Authentication & Core (9 endpoints)

| Method | Path              | Description              | Auth Required |
| ------ | ----------------- | ------------------------ | ------------- |
| POST   | `/auth/register/` | User registration        | ❌ No         |
| POST   | `/auth/login/`    | Login (get JWT token)    | ❌ No         |
| POST   | `/auth/refresh/`  | Refresh JWT token        | ❌ No         |
| GET    | `/auth/me/`       | Get current user profile | ✅ Yes        |
| GET    | `/users/`         | List all users           | ✅ Yes        |
| POST   | `/users/`         | Create new user          | ✅ Yes        |
| GET    | `/users/{id}/`    | Get user details         | ✅ Yes        |
| PATCH  | `/users/{id}/`    | Update user              | ✅ Yes        |
| DELETE | `/users/{id}/`    | Delete user              | ✅ Yes        |

### Settings & Audit (6 endpoints)

| Method | Path              | Description            |
| ------ | ----------------- | ---------------------- |
| GET    | `/settings/`      | List system settings   |
| POST   | `/settings/`      | Create setting         |
| GET    | `/settings/{id}/` | Get setting detail     |
| PATCH  | `/settings/{id}/` | Update setting         |
| DELETE | `/settings/{id}/` | Delete setting         |
| GET    | `/audit-logs/`    | List audit log entries |

### Global Search (1 endpoint)

| Method | Path       | Description                   |
| ------ | ---------- | ----------------------------- |
| GET    | `/search/` | Global search across entities |

### Categories (4 endpoints)

| Method | Path                | Description          |
| ------ | ------------------- | -------------------- |
| GET    | `/categories/`      | List all categories  |
| POST   | `/categories/`      | Create category      |
| GET    | `/categories/{id}/` | Get category details |
| PATCH  | `/categories/{id}/` | Update category      |

### Brands (4 endpoints)

| Method | Path            | Description       |
| ------ | --------------- | ----------------- |
| GET    | `/brands/`      | List all brands   |
| POST   | `/brands/`      | Create brand      |
| GET    | `/brands/{id}/` | Get brand details |
| PATCH  | `/brands/{id}/` | Update brand      |

### Tax Rates (4 endpoints)

| Method | Path               | Description          |
| ------ | ------------------ | -------------------- |
| GET    | `/tax-rates/`      | List tax rates       |
| POST   | `/tax-rates/`      | Create tax rate      |
| GET    | `/tax-rates/{id}/` | Get tax rate details |
| PATCH  | `/tax-rates/{id}/` | Update tax rate      |

### Products (20 endpoints) 🚀 Optimized

| Method | Path                                | Description                   | Notes              |
| ------ | ----------------------------------- | ----------------------------- | ------------------ |
| GET    | `/products/`                        | List all products             | 🚀 Optimized query |
| POST   | `/products/`                        | Create product                |                    |
| GET    | `/products/{id}/`                   | Get product details           |                    |
| PATCH  | `/products/{id}/`                   | Update product                |                    |
| DELETE | `/products/{id}/`                   | Delete product                |                    |
| GET    | `/products/{id}/variants/`          | Get product variants          |                    |
| GET    | `/products/{id}/barcodes/`          | Get product barcodes          |                    |
| GET    | `/products/{id}/components/`        | Get product components        |                    |
| POST   | `/products/backfill-barcodes/`      | Generate missing barcodes     |                    |
| POST   | `/products/generate-label/`         | Generate single label         | Azure integration  |
| POST   | `/products/{id}/generate-labels/`   | Generate multiple labels      |                    |
| GET    | `/products/{id}/labels/`            | Get generated labels          |                    |
| GET    | `/products/{id}/labels-status/`     | Check label generation status |                    |
| POST   | `/products/{id}/regenerate-labels/` | Regenerate labels             |                    |

### Product Variants (4 endpoints)

| Method | Path              | Description         |
| ------ | ----------------- | ------------------- |
| GET    | `/variants/`      | List all variants   |
| POST   | `/variants/`      | Create variant      |
| GET    | `/variants/{id}/` | Get variant details |
| PATCH  | `/variants/{id}/` | Update variant      |

### Barcodes (8 endpoints)

| Method | Path                              | Description                   | Notes |
| ------ | --------------------------------- | ----------------------------- | ----- |
| GET    | `/barcodes/`                      | List all barcodes             |       |
| POST   | `/barcodes/`                      | Create barcode                |       |
| GET    | `/barcodes/{id}/`                 | Get barcode details           |       |
| PATCH  | `/barcodes/{id}/`                 | Update barcode                |       |
| GET    | `/barcodes/by-barcode/`           | Find by barcode (query param) |       |
| GET    | `/barcodes/by-barcode/{barcode}/` | Find by barcode (path param)  |       |
| PATCH  | `/barcodes/{id}/update-tag/`      | Update barcode tag            |       |
| POST   | `/barcodes/bulk-update-tags/`     | Bulk update tags              |       |

### Data Validation (1 endpoint)

| Method | Path                      | Description             |
| ------ | ------------------------- | ----------------------- |
| POST   | `/data-validation/check/` | Validate data integrity |

### Defective Products (3 endpoints)

| Method | Path                                  | Description               |
| ------ | ------------------------------------- | ------------------------- |
| POST   | `/defective-products/move-out/`       | Move product to defective |
| GET    | `/defective-products/move-outs/`      | List defective move-outs  |
| GET    | `/defective-products/move-outs/{id}/` | Get move-out details      |

### Stock Management (8 endpoints) 🚀 Optimized

| Method | Path                       | Description             | Notes        |
| ------ | -------------------------- | ----------------------- | ------------ |
| GET    | `/stock/`                  | List stock levels       | 🚀 Optimized |
| GET    | `/stock/{id}/`             | Get stock details       |              |
| GET    | `/stock/low/`              | List low stock items    | 🚀 Optimized |
| GET    | `/stock/out-of-stock/`     | List out-of-stock items | 🚀 Optimized |
| GET    | `/stock/batches/`          | List stock batches      |              |
| GET    | `/stock/batches/{id}/`     | Get batch details       |              |
| POST   | `/stock-adjustments/`      | Create stock adjustment |              |
| GET    | `/stock-adjustments/{id}/` | Get adjustment details  |              |

### Stock Transfers (2 endpoints)

| Method | Path                     | Description          |
| ------ | ------------------------ | -------------------- |
| GET    | `/stock-transfers/`      | List transfers       |
| POST   | `/stock-transfers/`      | Create transfer      |
| GET    | `/stock-transfers/{id}/` | Get transfer details |

### Locations - Stores (4 endpoints)

| Method | Path            | Description       |
| ------ | --------------- | ----------------- |
| GET    | `/stores/`      | List stores       |
| POST   | `/stores/`      | Create store      |
| GET    | `/stores/{id}/` | Get store details |
| PATCH  | `/stores/{id}/` | Update store      |

### Locations - Warehouses (4 endpoints)

| Method | Path                | Description           |
| ------ | ------------------- | --------------------- |
| GET    | `/warehouses/`      | List warehouses       |
| POST   | `/warehouses/`      | Create warehouse      |
| GET    | `/warehouses/{id}/` | Get warehouse details |
| PATCH  | `/warehouses/{id}/` | Update warehouse      |

### Customer Groups (4 endpoints)

| Method | Path                     | Description          |
| ------ | ------------------------ | -------------------- |
| GET    | `/customer-groups/`      | List customer groups |
| POST   | `/customer-groups/`      | Create group         |
| GET    | `/customer-groups/{id}/` | Get group details    |
| PATCH  | `/customer-groups/{id}/` | Update group         |

### Customers (8 endpoints)

| Method | Path                             | Description          | Notes           |
| ------ | -------------------------------- | -------------------- | --------------- |
| GET    | `/customers/`                    | List customers       |                 |
| POST   | `/customers/`                    | Create customer      |                 |
| GET    | `/customers/{id}/`               | Get customer details |                 |
| PATCH  | `/customers/{id}/`               | Update customer      |                 |
| GET    | `/customers/{id}/balance/`       | Get customer balance | Credit tracking |
| POST   | `/customers/{id}/adjust-credit/` | Adjust credit limit  |                 |

### Suppliers (4 endpoints)

| Method | Path               | Description          |
| ------ | ------------------ | -------------------- |
| GET    | `/suppliers/`      | List suppliers       |
| POST   | `/suppliers/`      | Create supplier      |
| GET    | `/suppliers/{id}/` | Get supplier details |
| PATCH  | `/suppliers/{id}/` | Update supplier      |

### Ledger - B2B (6 endpoints)

| Method | Path                      | Description                |
| ------ | ------------------------- | -------------------------- |
| GET    | `/ledger/entries/`        | List ledger entries        |
| POST   | `/ledger/entries/`        | Create entry               |
| GET    | `/ledger/summary/`        | Get ledger summary         |
| GET    | `/ledger/customers/{id}/` | Get customer ledger detail |

### Personal Customers (6 endpoints)

| Method | Path                        | Description              |
| ------ | --------------------------- | ------------------------ |
| GET    | `/personal-customers/`      | List personal customers  |
| POST   | `/personal-customers/`      | Create personal customer |
| GET    | `/personal-customers/{id}/` | Get details              |
| PATCH  | `/personal-customers/{id}/` | Update personal customer |

### Personal Ledger (6 endpoints)

| Method | Path                               | Description                  |
| ------ | ---------------------------------- | ---------------------------- |
| GET    | `/personal-ledger/entries/`        | List personal ledger entries |
| POST   | `/personal-ledger/entries/`        | Create entry                 |
| GET    | `/personal-ledger/summary/`        | Get summary                  |
| GET    | `/personal-ledger/customers/{id}/` | Get customer detail          |

### Internal Customers (6 endpoints) - Admin Only

| Method | Path                        | Description              |
| ------ | --------------------------- | ------------------------ |
| GET    | `/internal-customers/`      | List internal customers  |
| POST   | `/internal-customers/`      | Create internal customer |
| GET    | `/internal-customers/{id}/` | Get details              |
| PATCH  | `/internal-customers/{id}/` | Update                   |

### Internal Ledger (6 endpoints) - Admin Only

| Method | Path                               | Description         |
| ------ | ---------------------------------- | ------------------- |
| GET    | `/internal-ledger/entries/`        | List entries        |
| POST   | `/internal-ledger/entries/`        | Create entry        |
| GET    | `/internal-ledger/summary/`        | Get summary         |
| GET    | `/internal-ledger/customers/{id}/` | Get customer detail |

### Purchases (7 endpoints)

| Method | Path                                    | Description            | Auth Required  |
| ------ | --------------------------------------- | ---------------------- | -------------- |
| GET    | `/purchases/`                           | List purchases         | ✅ Yes         |
| POST   | `/purchases/`                           | Create purchase        | ✅ Yes         |
| GET    | `/purchases/{id}/`                      | Get purchase details   | ✅ Yes         |
| GET    | `/purchases/{id}/items/`                | Get purchase items     | ✅ Yes         |
| POST   | `/purchases/{id}/finalize/`             | Finalize purchase      | ✅ Yes         |
| PATCH  | `/purchases/items/{id}/update-printed/` | Mark item printed      | ✅ Yes         |
| GET    | `/vendor-purchases/`                    | List vendor purchases  | ❌ No (Public) |
| POST   | `/vendor-purchases/`                    | Create vendor purchase | ❌ No (Public) |
| GET    | `/vendor-purchases/{id}/`               | Get vendor purchase    | ❌ No (Public) |
| POST   | `/vendor-purchases/{id}/cancel/`        | Cancel vendor purchase | ❌ No (Public) |

### Price Lists (6 endpoints)

| Method | Path                       | Description            |
| ------ | -------------------------- | ---------------------- |
| GET    | `/price-lists/`            | List price lists       |
| POST   | `/price-lists/`            | Create price list      |
| GET    | `/price-lists/{id}/`       | Get price list details |
| PATCH  | `/price-lists/{id}/`       | Update price list      |
| GET    | `/price-lists/{id}/items/` | Get price list items   |

### Promotions (3 endpoints)

| Method | Path                    | Description              |
| ------ | ----------------------- | ------------------------ |
| GET    | `/promotions/`          | List promotions          |
| POST   | `/promotions/`          | Create promotion         |
| GET    | `/promotions/{id}/`     | Get promotion details    |
| POST   | `/promotions/validate/` | Validate promotion rules |

### Bulk Price Updates (4 endpoints)

| Method | Path                            | Description              |
| ------ | ------------------------------- | ------------------------ |
| POST   | `/pricing/bulk-update/preview/` | Preview price changes    |
| POST   | `/pricing/bulk-update/commit/`  | Apply price changes      |
| GET    | `/pricing/change-log/`          | Get price change history |
| GET    | `/pricing/change-log/{id}/`     | Get change detail        |

### POS Sessions (3 endpoints)

| Method | Path                        | Description       |
| ------ | --------------------------- | ----------------- |
| GET    | `/pos/sessions/`            | List POS sessions |
| POST   | `/pos/sessions/`            | Create session    |
| POST   | `/pos/sessions/{id}/close/` | Close session     |

### Shopping Carts (9 endpoints)

| Method | Path                                          | Description      |
| ------ | --------------------------------------------- | ---------------- |
| GET    | `/pos/carts/`                                 | List carts       |
| POST   | `/pos/carts/`                                 | Create cart      |
| GET    | `/pos/carts/{id}/`                            | Get cart details |
| GET    | `/pos/carts/{id}/items/`                      | Get cart items   |
| PATCH  | `/pos/carts/{id}/items/{item_id}/`            | Update cart item |
| DELETE | `/pos/carts/{id}/items/{item_id}/remove-sku/` | Remove item SKU  |
| POST   | `/pos/carts/{id}/hold/`                       | Hold cart        |
| POST   | `/pos/carts/{id}/unhold/`                     | Unhold cart      |
| POST   | `/pos/carts/{id}/checkout/`                   | Checkout cart    |

### Invoices (19 endpoints)

| Method | Path                                        | Description           |
| ------ | ------------------------------------------- | --------------------- |
| GET    | `/pos/invoices/`                            | List invoices         |
| POST   | `/pos/invoices/`                            | Create invoice        |
| GET    | `/pos/invoices/{id}/`                       | Get invoice details   |
| GET    | `/pos/invoices/{id}/items/`                 | Get invoice items     |
| GET    | `/pos/invoices/{id}/items/{item_id}/`       | Get item detail       |
| GET    | `/pos/invoices/{id}/payments/`              | Get invoice payments  |
| POST   | `/pos/invoices/{id}/void/`                  | Void invoice          |
| POST   | `/pos/invoices/{id}/checkout/`              | Checkout invoice      |
| POST   | `/pos/invoices/{id}/edit/`                  | Edit invoice          |
| PATCH  | `/pos/invoices/{id}/update/`                | Update invoice        |
| POST   | `/pos/invoices/{id}/mark-credit/`           | Mark as credit        |
| POST   | `/pos/invoices/{id}/return/`                | Process return        |
| POST   | `/pos/invoices/{id}/exchange/`              | Process exchange      |
| POST   | `/pos/invoices/{id}/update-repair-status/`  | Update repair status  |
| POST   | `/pos/invoices/{id}/generate-repair-label/` | Generate repair label |

### Returns (4 endpoints)

| Method | Path                         | Description          |
| ------ | ---------------------------- | -------------------- |
| GET    | `/returns/`                  | List returns         |
| POST   | `/returns/`                  | Create return        |
| GET    | `/returns/{id}/`             | Get return details   |
| POST   | `/returns/{id}/credit-note/` | Generate credit note |

### Credit Notes (2 endpoints)

| Method | Path                  | Description             |
| ------ | --------------------- | ----------------------- |
| GET    | `/credit-notes/`      | List credit notes       |
| GET    | `/credit-notes/{id}/` | Get credit note details |

### Replacements (10 endpoints)

| Method | Path                                        | Description                   |
| ------ | ------------------------------------------- | ----------------------------- |
| POST   | `/pos/replacement/check/`                   | Check replacement eligibility |
| POST   | `/pos/replacement/create/`                  | Create replacement            |
| PATCH  | `/pos/replacement/barcode/{id}/update-tag/` | Update barcode tag            |
| POST   | `/pos/replacement/replace/`                 | Process replacement           |
| POST   | `/pos/replacement/return/`                  | Return replacement            |
| POST   | `/pos/replacement/defective/`               | Mark as defective             |
| POST   | `/pos/replacement/find-invoice/`            | Find invoice by barcode       |
| GET    | `/pos/replacement/search-invoices/`         | Search invoices               |
| POST   | `/pos/replacement/{id}/process/`            | Process replacement           |
| POST   | `/pos/replacement/{id}/credit-note/`        | Generate credit note          |

### Repair Management (4 endpoints)

| Method | Path                                    | Description          |
| ------ | --------------------------------------- | -------------------- |
| GET    | `/pos/repair/invoices/`                 | List repair invoices |
| GET    | `/pos/repair/invoices/find-by-barcode/` | Find by barcode      |

### Reports (7 endpoints) 🚀 Optimized

| Method | Path                          | Description                   | Notes        |
| ------ | ----------------------------- | ----------------------------- | ------------ |
| GET    | `/reports/sales-summary/`     | Sales summary report          |              |
| GET    | `/reports/top-products/`      | Top selling products          |              |
| GET    | `/reports/inventory-summary/` | Inventory overview            |              |
| GET    | `/reports/revenue/`           | Revenue report                |              |
| GET    | `/reports/customers/`         | Customer analytics            |              |
| GET    | `/reports/stock-ordering/`    | Stock reorder recommendations |              |
| GET    | `/reports/dashboard-kpis/`    | Dashboard KPIs                | 🚀 Optimized |

---

## Frontend Integration

The React frontend communicates with the Django backend through REST API calls. Key interaction patterns:

### Authentication Flow

1. User registers/logs in via `/auth/register/` or `/auth/login/`
2. Backend returns JWT token
3. Frontend stores token in localStorage/sessionStorage
4. All subsequent requests include token in `Authorization: Bearer <token>` header

### Data Fetching

```typescript
// Example: Fetch products
const fetchProducts = async () => {
  const response = await fetch("/api/v1/products/", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
};
```

### Main Frontend Screens/Features

1. **Dashboard**: Displays KPIs from `/reports/dashboard-kpis/`
2. **Products**: List/edit from `/products/` endpoints
3. **Inventory**: Track stock from `/stock/` endpoints
4. **POS**: Create invoices via `/pos/invoices/` and cart management
5. **Reports**: Various analytics from `/reports/` endpoints
6. **Customers**: Manage customers via `/customers/` endpoints
7. **Purchasing**: Create/track purchases via `/purchases/` endpoints

---

## Key Features

### Inventory Management

✅ Real-time stock tracking across multiple locations  
✅ Stock batches with expiry date tracking (FIFO)  
✅ Automated low stock alerts  
✅ Stock adjustments and transfers  
✅ Barcode-based inventory control

### Point-of-Sale (POS)

✅ Fast cart checkout with barcode scanning  
✅ Multiple payment methods  
✅ Hold/recall cart functionality  
✅ Invoice generation and management  
✅ Returns and exchanges processing

### Product Management

✅ Multi-variant products  
✅ Barcode generation and printing  
✅ Azure Blob Storage integration for labels  
✅ Tax rate management per product  
✅ Defective product tracking

### Pricing & Promotions

✅ Multiple price lists  
✅ Promotional rules and validation  
✅ Bulk price updates with preview  
✅ Price change history audit trail

### Financial Management

✅ Customer credit tracking  
✅ B2B customer ledgers  
✅ Personal customer tracking  
✅ Internal ledger (for staff/admin)  
✅ Credit note generation

### Reporting & Analytics

✅ Sales summary by period  
✅ Top products analysis  
✅ Revenue reporting  
✅ Customer spending analytics  
✅ Inventory valuation  
✅ Stock reorder recommendations  
✅ 🚀 Optimized dashboard KPI queries

### Multi-Location Support

✅ Multiple stores/branches  
✅ Multiple warehouses  
✅ Location-specific inventory  
✅ Stock transfers between locations

---

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
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Setup database
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Create test data (optional)
python manage.py shell < scripts/seed_data.py

# Run development server
python manage.py runserver
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

### Environment Variables

Create `.env` file in project root:

```
# Django Settings
SECRET_KEY=your-secret-key-here
DEBUG=False
ALLOWED_HOSTS=localhost,127.0.0.1,your-domain.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/inventory_db

# Azure Storage (for barcode labels)
AZURE_STORAGE_CONNECTION_STRING=your-connection-string
AZURE_STORAGE_CONTAINER_NAME=barcode-labels

# Redis (optional)
REDIS_URL=redis://localhost:6379/0

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

---

## Environment Configuration

### PostgreSQL Connection

```python
# settings.py
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'inventory_db',
        'USER': 'postgres',
        'PASSWORD': 'your_password',
        'HOST': 'localhost',
        'PORT': '5432',
    }
}
```

### Azure Blob Storage

```python
# settings.py
AZURE_STORAGE_ACCOUNT_NAME = 'your-account'
AZURE_STORAGE_ACCOUNT_KEY = 'your-key'
AZURE_STORAGE_CONTAINER_NAME = 'barcode-labels'
```

### JWT Configuration

```python
from datetime import timedelta

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ALGORITHM': 'HS256',
}
```

---

## Performance Optimizations

### Database Query Optimization (🚀 Marked Endpoints)

Several high-traffic endpoints have optimized views:

1. **Products List** (`/products/` GET)
   - Uses select_related() for categories, brands
   - Uses prefetch_related() for variants, barcodes
   - Database-level filtering

2. **Stock Queries** (`/stock/`, `/stock/low/`, `/stock/out-of-stock/`)
   - Optimized queries with annotations
   - Cached results using django-redis
   - Efficient filtering by location and status

3. **Dashboard KPIs** (`/reports/dashboard-kpis/`)
   - Aggregated queries with Count, Sum, Avg
   - Time-period filtering
   - Minimal database hits

### Caching Strategy

- Product catalog: 24 hours
- Stock levels: 1 hour
- Price lists: 6 hours
- Reports data: 30 minutes
- User session: 1 hour

### Barcode Label Generation

- Batch processing with Azure Blob Storage
- Asynchronous label generation
- SAS token generation for secure downloads

---

## Limitations & Future Enhancements

### Current Limitations

1. **Authentication**: No OAuth 2.0 integration (only JWT)
2. **Multi-tenancy**: System designed for single-tenant use
3. **Real-time Features**: No WebSocket support for live updates
4. **Mobile App**: No native mobile applications (only responsive web)
5. **Internationalization (i18n)**: Not implemented - English only
6. **Payment Gateway**: No integrated payment processing (cash/credit only)
7. **Email Notifications**: Not implemented
8. **SMS Notifications**: Not implemented
9. **Advanced Analytics**: Limited to basic reporting
10. **User Roles/Permissions**: Basic role system only

### Future Enhancements

- [ ] OAuth 2.0 and social login integration
- [ ] Multi-tenant support for franchise operations
- [ ] Real-time WebSocket updates for POS
- [ ] Native mobile apps (iOS/Android)
- [ ] i18n/l10n support for multiple languages
- [ ] Stripe/Razorpay payment gateway integration
- [ ] Email and SMS notification system
- [ ] Advanced analytics with machine learning
- [ ] Supplier portal for vendor management
- [ ] Customer portal for loyalty programs
- [ ] Advanced barcode scanning with image recognition
- [ ] Swagger/OpenAPI documentation
- [ ] GraphQL API alternative
- [ ] Microservices architecture migration
- [ ] Kubernetes deployment templates

### Testing

- Basic test coverage exists in most apps
- Coverage report: Run `coverage run -m pytest` then `coverage report`
- Continuous integration not yet set up

---

## Support & Documentation

For detailed API documentation, see the [API Reference](./docs/API.md).

For database schema, see [Database Schema](./docs/DATABASE_SCHEMA.md).

For deployment instructions, see [Deployment Guide](./PRODUCTION_DEPLOYMENT_CHECKLIST.md).

---

## License

This project is proprietary software for Manish Traders.

---

**Last Updated**: February 8, 2026  
**Version**: 1.0.0
