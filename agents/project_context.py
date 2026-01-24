PROJECT_CONTEXT = """
Project Overview:
This is an Inventory Management System with a Django backend and a React (Vite) frontend.

Backend Structure (Django):
- Root: backend/
- Config: backend/config/ (settings, urls, wsgi)
- Core Apps:
  - backend.core: User authentication (Custom User), Base models.
  - backend.locations: Warehouse/Location management.
  - backend.catalog: Product catalog, Categories, Brands.
  - backend.inventory: Stock levels, Moves, Adjustments.
  - backend.parties: Suppliers, Customers.
  - backend.purchasing: Purchase Orders, Receiving.
  - backend.pricing: Price lists, Margins.
  - backend.pos: Point of Sale features.
  - backend.reports: Reporting and Analytics.
- Key Technologies:
  - Django REST Framework (DRF) for APIs.
  - SimpleJWT for Authentication.
  - PostgreSQL (Production) / SQLite or Postgres (Dev).
  - Azure Storage for Media files.
  - Redis for Caching (optional).

Frontend Structure (React + Vite):
- Root: frontend/
- Source: frontend/src/
- Key Directories:
  - components/: Reusable UI components.
  - pages/: Route components (likely matching backend apps).
  - lib/: Utility libraries.
  - utils/: Helper functions.
- Key Technologies:
  - React 18+ (Hooks, Functional Components).
  - TypeScript.
  - Vite for build tooling.
  - TailwindCSS for styling.
  - React Query (@tanstack/react-query) for data fetching.
  - Axios for HTTP requests.
  - React Router DOM for navigation.
  - Lucide React for icons.
  - AWS Amplify for deployment (implied by scripts).

Workflow:
- The backend provides a REST API at /api/v1/.
- The frontend consumes these APIs.
- Authentication is via JWT Access/Refresh tokens.
"""
