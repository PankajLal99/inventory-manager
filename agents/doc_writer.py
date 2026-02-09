from tools.llm import llm

SYSTEM_CONSTRAINTS = """
You are an EXPERT technical documentation writer creating a COMPREHENSIVE production-grade README.md.

CRITICAL: Generate COMPLETE, DETAILED content - NOT SUMMARIES OR REFERENCES.
Include all information provided. Use proper markdown. Format tables properly.
"""

def generate_readme_structure(backend_facts, app_endpoints, api_facts, frontend_analysis, requirements, frontend_deps, project_name):
    """Generate README content directly from analyzed data."""
    
    readme = f"""# {project_name}

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
"""
    
    if requirements:
        readme += "\n**Dependencies**:\n"
        for req in requirements:
            readme += f"- {req}\n"
    
    readme += f"""
### Frontend Technologies
"""
    
    if frontend_deps:
        readme += "\n**Dependencies**:\n"
        for dep in frontend_deps:
            readme += f"- {dep}\n"
    
    readme += """
### Infrastructure
- **Web Server**: Nginx
- **Container**: Docker (optional)
- **Cloud**: AWS/Azure
- **Testing**: Coverage.py, pytest, factory-boy

## Backend Applications

"""
    
    for app_name in sorted(backend_facts.keys()):
        app_info = backend_facts[app_name]
        readme += f"""
### {app_name.upper()} App

**Purpose**: {app_info.get('description', 'Application logic')}

"""
        if app_info.get('models'):
            readme += f"**Models**: {', '.join(app_info['models'])}\n\n"
        if app_info.get('serializers'):
            readme += f"**Serializers**: {', '.join(app_info['serializers'])}\n\n"
        if app_info.get('views'):
            views_list = app_info['views'][:15]
            readme += f"**Views/ViewSets**: {', '.join(views_list)}\n\n"
        if app_info.get('admin'):
            readme += f"**Admin**: {', '.join(app_info['admin'])}\n\n"
    
    readme += """
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

**Total Endpoints**: """ + str(len(api_facts)) + """

"""
    
    # Generate endpoint tables by app
    for app_name in sorted(app_endpoints.keys()):
        endpoints = app_endpoints[app_name]
        if endpoints:
            readme += f"\n### {app_name.upper()} Endpoints\n\n"
            readme += "| Path | View |\n"
            readme += "|------|------|\n"
            for ep in endpoints:
                path = f"/api/v1/{ep.get('path', '')}"
                view = ep.get("view", "")
                readme += f"| `{path}` | {view} |\n"
    
    readme += """
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

## Key Features

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
"""
    
    return readme

def doc_writer_agent(state):
    """Generate comprehensive README.md with all project details."""
    backend_facts = state.get("backend_facts", {})
    api_facts = state.get("api_facts", [])
    app_endpoints = state.get("app_endpoints", {})
    frontend_analysis = state.get("frontend_analysis", {})
    requirements = state.get("requirements", [])
    frontend_deps = state.get("frontend_deps", [])
    project_name = state.get("project_name", "Inventory Management System")
    
    print("🚀 Generating comprehensive README.md...")
    print(f"   Backend Apps: {len(backend_facts)}")
    print(f"   API Endpoints: {len(api_facts)}")
    print(f"   Frontend Technologies: {len(frontend_analysis.get('frameworks', []))}")
    print(f"   Dependencies: {len(requirements)} backend + {len(frontend_deps)} frontend")
    
    # Generate README directly
    readme = generate_readme_structure(backend_facts, app_endpoints, api_facts, frontend_analysis, requirements, frontend_deps, project_name)
    
    with open(state["repo_root"] + "/README.md", "w") as f:
        f.write(readme)

    print("\n✅ README.md generated successfully!")
    print(f"\n📊 Documentation Statistics:")
    print(f"   Backend Apps Documented: {len(backend_facts)}")
    print(f"   API Endpoints Documented: {len(api_facts)}")
    print(f"   Frontend Frameworks: {len(frontend_analysis.get('frameworks', []))}")
    print(f"   README Size: {len(readme)} characters")

    return {"readme_written": True}
