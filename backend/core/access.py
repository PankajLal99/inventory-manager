"""
Navigation / feature permission codenames and resolution from Django groups.

Store-scoped roles (UserStoreRole) add their Role.permissions on top of group-derived
permissions (union). Assign roles per user+shop in Django Admin.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.core.models import User

# All UI routes and feature gates — keep in sync with Layout.tsx `permission` fields.
ACCESS_PERMISSION_SEED: list[tuple[str, str, str]] = [
    ('nav.pos', 'POS', 'core'),
    ('nav.repair_register', 'New repair', 'core'),
    ('nav.search', 'Search', 'core'),
    ('nav.dashboard', 'Dashboard', 'core'),
    ('nav.invoices', 'Invoices', 'sales'),
    ('nav.credit_notes', 'Credit notes', 'sales'),
    ('nav.customers', 'Customers', 'sales'),
    ('nav.replacement', 'Replacement', 'sales'),
    ('nav.repairs', 'Repairs', 'sales'),
    ('nav.products', 'Products', 'inventory'),
    ('nav.stock_overview', 'Stock overview', 'inventory'),
    ('nav.stock_transfers', 'Stock transfers', 'inventory'),
    ('nav.purchases', 'Purchases', 'inventory'),
    ('nav.ledger', 'Ledger', 'financial'),
    ('nav.personal_ledger', 'Personal ledger', 'financial'),
    ('nav.internal_ledger', 'Internal / shop ledger', 'financial'),
    ('nav.payment_reminders', 'Payment reminders', 'financial'),
    ('nav.expenses', 'Expenses', 'financial'),
    ('nav.payments', 'Payments', 'financial'),
    ('nav.active_carts', 'Active carts', 'admin'),
    ('nav.vendors', 'Vendors', 'admin'),
    ('nav.reports', 'Reports', 'admin'),
    ('nav.history', 'History', 'admin'),
]

# Page-level gates (POS, invoices, ledger, etc.) — keep in sync with frontend `lib/access.ts` `P`.
FEATURE_PERMISSION_SEED: list[tuple[str, str, str]] = [
    ('feature.super_metrics', 'Super-only metrics & listings', 'feature'),
    ('feature.pos_admin', 'POS / repair global admin lane', 'feature'),
    ('feature.pos_retail_lane', 'POS retail lane (store selector)', 'feature'),
    ('feature.pos_wholesale', 'POS wholesale lane', 'feature'),
    ('feature.pos_wholesale_admin', 'POS wholesale admin (store selector)', 'feature'),
    ('feature.invoice_admin_stores', 'Invoices: all stores / admin store UI', 'feature'),
    ('feature.invoice_restricted', 'Invoice detail: restricted retail/wholesale editor', 'feature'),
    ('feature.invoice_hide_cash_checkout', 'Hide cash/UPI checkout options (wholesale)', 'feature'),
    ('feature.retail_catalog_restricted', 'Products/purchases: retail-only restrictions', 'feature'),
    ('feature.ledger_admin', 'Ledger: admin lane (substring Admin in group)', 'feature'),
    ('feature.store_management', 'Stores CRUD: admin / store admins', 'feature'),
    ('feature.payments_extended_columns', 'Payments: extended columns (non-Retail group)', 'feature'),
    ('feature.discard_invoice_edit_carts', 'Active carts: discard EDIT-* carts', 'feature'),
]


def _all_nav_codenames() -> set[str]:
    return {c for c, _, _ in ACCESS_PERMISSION_SEED}


def _groups_set(user_groups: list[str]) -> set[str]:
    return set(user_groups or [])


def permissions_from_django_groups(user_groups: list[str], user: User | None) -> set[str]:
    """
    Reproduce legacy Layout / user_me visibility as permission codenames.
    """
    g = _groups_set(user_groups)
    is_admin = 'Admin' in g
    is_retail_admin = 'RetailAdmin' in g
    is_retail = 'Retail' in g
    is_wholesale = 'Wholesale' in g
    is_wholesale_admin = 'WholesaleAdmin' in g
    is_repair = 'Repair' in g
    is_repair_admin = 'RepairAdmin' in g
    has_app = bool(
        is_admin
        or is_retail_admin
        or is_retail
        or is_wholesale
        or is_wholesale_admin
        or is_repair
        or is_repair_admin
    )

    perms: set[str] = set()

    if not has_app:
        if user and (user.is_superuser or user.is_staff):
            out = _all_nav_codenames()
            out.update(_feature_permissions_for_staff_no_app_groups())
            return out
        return perms

    # —— Core ——
    if is_admin or is_retail_admin or is_retail or is_wholesale_admin or is_wholesale:
        perms.add('nav.pos')
    if (
        is_admin
        or is_retail_admin
        or is_wholesale_admin
        or is_repair
        or is_retail
        or is_wholesale
    ):
        perms.add('nav.repair_register')
    if (
        is_admin
        or is_retail_admin
        or is_retail
        or is_wholesale_admin
        or is_wholesale
        or is_repair
        or 'Temp' in g
    ):
        perms.add('nav.search')
    if is_admin or is_retail_admin:
        perms.add('nav.dashboard')

    # —— Sales ——
    if is_admin or is_retail_admin or is_retail or is_wholesale_admin or is_wholesale:
        perms.add('nav.invoices')
    if is_admin or is_retail_admin or is_retail:
        perms.add('nav.credit_notes')
    if is_admin or is_retail_admin or is_wholesale_admin:
        perms.add('nav.customers')
    if is_admin or is_retail or is_retail_admin or is_wholesale_admin or is_wholesale:
        perms.add('nav.replacement')
    if (
        is_admin
        or is_retail_admin
        or is_wholesale_admin
        or is_repair
        or is_retail
        or is_wholesale
    ):
        perms.add('nav.repairs')

    # —— Inventory ——
    if (
        is_admin
        or is_retail_admin
        or is_retail
        or is_wholesale_admin
        or is_wholesale
        or is_repair
    ):
        perms.add('nav.products')
    if is_admin or is_retail_admin or is_retail or is_wholesale_admin or is_wholesale:
        perms.add('nav.stock_overview')
        perms.add('nav.stock_transfers')
        perms.add('nav.purchases')

    # —— Financial ——
    if is_admin or is_retail_admin or is_retail:
        perms.add('nav.ledger')
    if is_admin or is_retail_admin or is_wholesale_admin or is_repair or is_retail:
        perms.add('nav.internal_ledger')
    if is_admin or is_retail_admin or is_wholesale_admin:
        perms.add('nav.payment_reminders')
    if is_admin or is_retail_admin or is_wholesale_admin or 'Temp' in g or is_retail or is_wholesale:
        perms.add('nav.expenses')
    if is_admin or is_retail_admin or is_retail:
        perms.add('nav.payments')

    # —— Admin-only style (matches can_access_customers / history checks) ——
    can_admin_nav = is_admin or is_retail_admin or is_wholesale_admin or is_repair_admin
    if can_admin_nav:
        perms.add('nav.personal_ledger')
    if is_admin or is_retail_admin or is_retail or is_wholesale_admin or is_wholesale:
        perms.add('nav.active_carts')
    if is_admin or is_retail_admin or is_wholesale_admin:
        perms.add('nav.vendors')
        perms.add('nav.reports')
    # Legacy Layout used showFor 'admin' → can_access_customers (not can_access_history)
    if can_admin_nav:
        perms.add('nav.history')

    # —— Feature gates (page-level, mirrors frontend group checks) ——
    perms.update(_feature_permissions_from_groups(g, user))

    return perms


def _feature_permissions_for_staff_no_app_groups() -> set[str]:
    """Staff/superuser with no app group: nav already full; grant safe feature defaults."""
    return {
        'feature.pos_admin',
        'feature.ledger_admin',
        'feature.store_management',
        'feature.payments_extended_columns',
    }


def _feature_permissions_from_groups(g: set[str], user: User | None) -> set[str]:
    fp: set[str] = set()
    is_admin = 'Admin' in g
    is_retail_admin = 'RetailAdmin' in g
    is_retail = 'Retail' in g
    is_wholesale = 'Wholesale' in g
    is_wholesale_admin = 'WholesaleAdmin' in g

    if 'Super' in g:
        fp.add('feature.super_metrics')
    if (user and (user.is_superuser or user.is_staff)) or is_admin:
        fp.add('feature.pos_admin')
    if is_retail or is_retail_admin:
        fp.add('feature.pos_retail_lane')
    if is_wholesale or is_wholesale_admin:
        fp.add('feature.pos_wholesale')
    if is_wholesale_admin:
        fp.add('feature.pos_wholesale_admin')
    if any('Admin' in str(name) for name in g):
        fp.add('feature.invoice_admin_stores')
    if (is_retail or is_wholesale) and not is_admin and not is_retail_admin and not is_wholesale_admin:
        fp.add('feature.invoice_restricted')
    if is_wholesale or is_wholesale_admin:
        fp.add('feature.invoice_hide_cash_checkout')
    if is_retail and not is_admin and not is_retail_admin:
        fp.add('feature.retail_catalog_restricted')
    if (user and (user.is_superuser or user.is_staff)) or any('Admin' in str(name) for name in g):
        fp.add('feature.ledger_admin')
    if (user and (user.is_superuser or user.is_staff)) or is_admin or is_retail_admin or is_wholesale_admin:
        fp.add('feature.store_management')
    if 'Retail' not in g:
        fp.add('feature.payments_extended_columns')
    if 'Super' in g or is_admin:
        fp.add('feature.discard_invoice_edit_carts')
    return fp


def merge_store_role_permissions(user: User, base: set[str]) -> set[str]:
    """Union Role.permissions from UserStoreRole rows (respecting assigned_stores)."""
    from backend.core.models import UserStoreRole

    qs = UserStoreRole.objects.filter(user_id=user.pk).select_related('role').prefetch_related(
        'role__permissions'
    )
    if user.assigned_stores.exists():
        allowed = set(user.assigned_stores.values_list('id', flat=True))
        qs = qs.filter(store_id__in=allowed)

    extra: set[str] = set()
    for usr in qs:
        extra.update(p.codename for p in usr.role.permissions.all())
    return base | extra
