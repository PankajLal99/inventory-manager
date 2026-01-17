# Current Access Control Implementation

## Backend Implementation

### User Model (`backend/core/models.py`)
- **Extends**: `AbstractUser` (has Django's built-in `groups` field)
- **Groups**: Django's built-in `groups` ManyToMany field to `auth.Group`
- ✅ **Custom Role model removed** - Using Django groups only

### Django Groups (`backend/core/management/commands/create_user_groups.py`)
Groups created:
1. **Retail** - Retail shop staff (limited access: POS, Search, Invoices, Replacement, Products, Purchases)
2. **Wholesale** - Wholesale shop staff (limited access, no dashboard/reports)
3. **RetailAdmin** - Retail shop owner (Retail access + Dashboard, Reports)
4. **WholesaleAdmin** - Wholesale shop owner (full access except Django admin)
5. **Admin** - Full system access including Django admin

### Access Control Rules

#### Admin Group
- ✅ **Full access** to all pages and features
- All menu items visible

#### Retail Group
- ✅ **POS** (`/`)
- ✅ **Search** (`/search`)
- ✅ **Invoices** (`/invoices`)
- ✅ **Replacement** (`/replacement`)
- ✅ **Products** (`/products`)
- ✅ **Purchases** (`/purchases`)
- ❌ Dashboard, Customers, Ledger, Reports, History

#### RetailAdmin Group
- ✅ **All Retail access** (POS, Search, Invoices, Replacement, Products, Purchases)
- ✅ **Dashboard** (`/dashboard`)
- ✅ **Reports** (`/reports`)
- ✅ **Customers** (`/customers`)
- ❌ Ledger, History (Admin only)

### User API Endpoint (`backend/core/views.py` - `user_me`)
Returns:
```python
{
    'groups': ['Retail', 'RetailAdmin', 'Admin', ...],  # Django group names
    'is_admin': True/False,                              # Admin group or is_superuser/is_staff
    'can_access_dashboard': True/False,                  # Admin or RetailAdmin
    'can_access_reports': True/False,                    # Admin or RetailAdmin
    'can_access_customers': True/False,                 # Admin and RetailAdmin
    'can_access_ledger': True/False,                     # Admin only
    'can_access_history': True/False,                    # Admin only
    'is_staff': True/False,
    'is_superuser': True/False,
    # ... other user fields
}
```

**Access Logic:**
- `is_admin`: `'Admin' in groups` (group-based, not superuser/staff)
- `can_access_dashboard`: `'Admin' in groups or 'RetailAdmin' in groups`
- `can_access_reports`: `'Admin' in groups or 'RetailAdmin' in groups`
- `can_access_customers`: `'Admin' in groups or 'RetailAdmin' in groups`
- `can_access_ledger`: `'Admin' in groups` (Admin only)
- `can_access_history`: `'Admin' in groups` (Admin only)

### ✅ Changes Completed
1. ✅ **Role model removed** - Using Django groups only
2. ✅ **Token updated** - Now includes `groups` instead of custom `role`
3. ✅ **Role/Permission views removed** - No longer needed
4. ✅ **UserSerializer updated** - Removed `role` and `role_id` fields
5. ✅ **Migration created** - `0002_remove_role_and_permission_models.py`

---

## Frontend Implementation (`frontend/src/components/layout/Layout.tsx`)

### Current Access Control Logic
```typescript
const userGroups = user?.groups || [];  // Array of group names from backend
const isAdmin = Boolean(user?.is_admin);
const canAccessDashboard = user?.can_access_dashboard === true;
const canAccessReports = user?.can_access_reports === true;
const canAccessCustomers = user?.can_access_customers === true;
const canAccessLedger = user?.can_access_ledger === true;
const canAccessHistory = user?.can_access_history === true;

// Helper function to check access based on showFor value
const hasAccess = (showFor: string | string[] | ((user: any, groups: string[]) => boolean)): boolean => {
    if (typeof showFor === 'function') {
        return showFor(user, userGroups);
    }
    if (Array.isArray(showFor)) {
        // Show if user is in any of the specified groups
        return showFor.some(group => userGroups.includes(group));
    }
    // String values: 'all', 'admin', 'dashboard', 'reports', 'customers', 'ledger', 'history', or group name
    switch (showFor) {
        case 'all': return true;
        case 'admin': return isAdmin;
        case 'dashboard': return canAccessDashboard;
        case 'reports': return canAccessReports;
        case 'customers': return canAccessCustomers;
        case 'ledger': return canAccessLedger;
        case 'history': return canAccessHistory;
        default: return userGroups.includes(showFor);
    }
};
```

### Menu Items with `showFor` Property
```typescript
menuGroups = [
    {
        title: 'Core Operations',
        items: [
            { path: '/', label: 'POS', showFor: ['Admin', 'RetailAdmin', 'Retail'] },
            { path: '/dashboard', label: 'Dashboard', showFor: ['Admin', 'RetailAdmin'] },
            { path: '/search', label: 'Search', showFor: ['Admin', 'RetailAdmin', 'Retail'] },
        ],
    },
    {
        title: 'Sales & Transactions',
        items: [
            { path: '/invoices', label: 'Invoices', showFor: ['Admin', 'RetailAdmin', 'Retail'] },
            { path: '/customers', label: 'Customers', showFor: 'admin' },
            { path: '/replacement', label: 'Replacement', showFor: ['Admin', 'RetailAdmin', 'Retail'] },
        ],
    },
    {
        title: 'Inventory & Products',
        items: [
            { path: '/products', label: 'Products', showFor: ['Admin', 'RetailAdmin', 'Retail'] },
            { path: '/purchases', label: 'Purchases', showFor: ['Admin', 'RetailAdmin', 'Retail'] },
        ],
    },
    {
        title: 'Financial',
        items: [
            { path: '/ledger', label: 'Ledger', showFor: 'admin' },
        ],
    },
    {
        title: 'Administration',
        items: [
            { path: '/reports', label: 'Reports', showFor: ['Admin', 'RetailAdmin'] },
            { path: '/history', label: 'History', showFor: 'admin' },
        ],
    },
];
```

### Filtering Logic
```typescript
const filteredMenuGroups = menuGroups.map(group => ({
    ...group,
    items: group.items.filter(item => hasAccess(item.showFor)),
})).filter(group => group.items.length > 0);
```

### `showFor` Values Supported
- **String values:**
  - `'all'` - Everyone can see
  - `'admin'` - Only Admin group
  - `'dashboard'` - Admin or RetailAdmin
  - `'reports'` - Admin or RetailAdmin
  - `'customers'` - Only Admin
  - `'ledger'` - Only Admin
  - `'history'` - Only Admin
  - Group name (e.g., `'Retail'`, `'RetailAdmin'`) - Only that specific group
- **Array of groups:** `['Admin', 'RetailAdmin', 'Retail']` - Show if user is in any of these groups
- **Function:** `(user, groups) => boolean` - Custom logic

---

## Summary

### What Works
✅ Django groups are being used and returned in `user_me` endpoint
✅ Frontend receives groups and uses them for access control
✅ Basic filtering logic exists for dashboard/reports/admin

### ✅ Completed Changes
✅ Removed custom `Role` model (using Django groups only)
✅ Removed `role` field from User model
✅ Updated token to use groups instead of custom role
✅ Removed Role/Permission views/endpoints
✅ Updated UserSerializer to remove role fields
✅ Updated admin.py to remove Role/Permission admin
✅ Updated test_utils.py to remove Role/Permission factory methods
✅ Created migration to remove Role and Permission models

### ✅ Recent Enhancements Completed
- ✅ Enhanced `showFor` to support arrays of groups: `['Admin', 'RetailAdmin', 'Retail']`
- ✅ Added granular permissions: `can_access_customers`, `can_access_ledger`, `can_access_history`
- ✅ Implemented group-based access control for all menu items
- ✅ Updated access rules: Admin (all), RetailAdmin (Retail + Dashboard/Reports/Customers), Retail (limited)

### Potential Future Enhancements
- Add route-level protection based on groups (prevent direct URL access)
- Add more granular permissions per menu item if needed
- Support for Wholesale and WholesaleAdmin groups (similar to Retail)

---

## Implementation Status

### ✅ Backend Changes Completed
1. ✅ Removed `Role` model and custom `Permission` model (using Django's built-in Permission)
2. ✅ Removed `role` ForeignKey from User model
3. ✅ Updated token serializer to include groups instead of role
4. ✅ Removed Role/Permission views and serializers
5. ✅ Updated admin.py to remove Role/Permission admin
6. ✅ Updated test_utils.py to remove Role/Permission factory methods
7. ✅ Created migration `0002_remove_role_and_permission_models.py`

### Current Backend Implementation
- **Token**: Includes `groups` array instead of custom `role`
- **User API**: Returns `groups`, `can_access_dashboard`, `can_access_reports`, `is_admin` flags
- **Access Control**: Based on Django groups: `Retail`, `Wholesale`, `RetailAdmin`, `WholesaleAdmin`, `Admin`

### Frontend (Current)
- Uses `user?.groups` array from backend
- Uses `can_access_dashboard`, `can_access_reports`, `is_admin` flags
- Menu items filtered by `showFor`: `'all'`, `'dashboard'`, `'reports'`, `'admin'`

### Potential Frontend Enhancements
1. Enhance `showFor` to support:
   - String: `'all'`, `'dashboard'`, `'reports'`, `'admin'`
   - Array: `['Admin', 'RetailAdmin']` - show if user is in any of these groups
   - Function: `(user, groups) => boolean` - custom logic
2. Add route-level protection based on groups
3. Add more granular permissions per menu item

