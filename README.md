# Inventory Management System with POS

A complete inventory management system with Point of Sale (POS) functionality, built with Django REST Framework backend and React + TypeScript frontend.

## Features

- **Product & Inventory Management**: Multi-location inventory, batches, stock adjustments, transfers
- **POS System**: Barcode scanning, cart management, invoices, payments, returns, exchanges
- **Purchasing**: Purchase orders, GRNs, direct purchases
- **Pricing**: Price lists, bulk price updates, promotions
- **Parties**: Customers, customer groups, suppliers
- **Reports**: Sales, inventory, purchase reports
- **Multi-role Access**: Role-based permissions and access control

## Tech Stack

### Backend
- Django 5
- Django REST Framework
- JWT Authentication (djangorestframework-simplejwt)
- SQLite3 (development)

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Lucide Icons
- React Router
- React Query (TanStack Query)
- Axios

## 🚀 Quick Start (First Time)

### One-Command Setup
```bash
chmod +x setup.sh
./setup.sh
```

This automatically:
- ✅ Creates virtual environment
- ✅ Installs dependencies
- ✅ Creates database and all tables
- ✅ Sets up user groups

### Start the Server
```bash
./start.sh
```

That's it! The server starts automatically at `http://localhost:8765`

The startup script handles everything - checks database, runs migrations if needed, and starts the server.

### Manual Setup (If Needed)

If you prefer manual setup:

1. Create virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set up database:
```bash
python3 manage.py migrate
```

4. Create superuser (optional):
```bash
python3 manage.py createsuperuser
```

5. Start server:
```bash
python3 manage.py runserver 8765
```

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file (optional, defaults to localhost:8765):
```env
VITE_API_URL=http://localhost:8765/api/v1
```

4. Run development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

**Note:** The backend runs on port 8765 by default. Make sure to start it with:
```bash
python manage.py runserver 8765
```

## API Endpoints

All API endpoints are prefixed with `/api/v1/`

### Authentication
- `POST /api/v1/auth/login/` - Login
- `POST /api/v1/auth/refresh/` - Refresh token
- `GET /api/v1/auth/me/` - Current user

### Products
- `GET /api/v1/products/` - List products
- `POST /api/v1/products/` - Create product
- `GET /api/v1/products/{id}/` - Get product
- `PATCH /api/v1/products/{id}/` - Update product
- `GET /api/v1/products/{id}/variants/` - Get variants
- `GET /api/v1/products/{id}/barcodes/` - Get barcodes
- `GET /api/v1/barcodes/by-barcode/{barcode}/` - Get product by barcode

### Inventory
- `GET /api/v1/stock/` - List stock
- `GET /api/v1/stock/low/` - Low stock items
- `GET /api/v1/stock/out-of-stock/` - Out of stock items
- `POST /api/v1/stock-adjustments/` - Create adjustment
- `POST /api/v1/stock-transfers/` - Create transfer

### POS
- `POST /api/v1/pos/carts/` - Create cart
- `GET /api/v1/pos/carts/{id}/` - Get cart
- `POST /api/v1/pos/carts/{id}/items/` - Add item to cart
- `POST /api/v1/pos/carts/{id}/checkout/` - Checkout cart
- `GET /api/v1/pos/invoices/` - List invoices

### Customers
- `GET /api/v1/customers/` - List customers
- `POST /api/v1/customers/` - Create customer

### Purchasing
- `GET /api/v1/purchase-orders/` - List purchase orders
- `POST /api/v1/purchase-orders/` - Create purchase order
- `GET /api/v1/grns/` - List GRNs
- `POST /api/v1/grns/` - Create GRN

### Pricing
- `GET /api/v1/price-lists/` - List price lists
- `GET /api/v1/promotions/` - List promotions
- `POST /api/v1/pricing/bulk-update/preview/` - Preview bulk update

See `INSTRUCTIONS.md` for complete API documentation.

## Project Structure

```
inventory-manager/
├── backend/              # Django backend
│   ├── core/            # Auth, users, roles, settings
│   ├── locations/       # Stores, warehouses
│   ├── catalog/         # Products, categories, brands
│   ├── inventory/       # Stock, adjustments, transfers
│   ├── parties/         # Customers, suppliers
│   ├── purchasing/      # POs, GRNs
│   ├── pricing/         # Price lists, promotions
│   ├── pos/             # Carts, invoices, payments
│   ├── reports/         # Reporting endpoints
│   └── backups/         # Backup/restore
├── frontend/            # React frontend
│   ├── src/
│   │   ├── pages/       # Page components
│   │   ├── components/  # Reusable components
│   │   ├── lib/         # API client, auth
│   │   └── types/        # TypeScript types
└── requirements.txt     # Python dependencies
```

## Development

### Running Tests

#### Backend Tests
```bash
# Run all tests
python manage.py test

# Run tests for specific module
python manage.py test backend.catalog
python manage.py test backend.pos
python manage.py test backend.purchasing

# Run tests with coverage
coverage run --source='.' manage.py test
coverage report
coverage html  # Generates HTML report in htmlcov/

# Run tests with verbose output
python manage.py test --verbosity=2
```

#### Frontend Tests
```bash
cd frontend
npm test
```

### Building for Production
```bash
# Frontend
cd frontend
npm run build
```

## License

MIT

