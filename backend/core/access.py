"""
Navigation / feature permission codenames.

SaaS model: app access is role-driven via Role + UserStoreRole. Django groups may
still exist for admin/platform workflows, but they should not encode tenant app ACLs.
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
    ('nav.role_management', 'Role management', 'admin'),
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
    ('feature.role_management', 'Manage roles and page visibility from app UI', 'feature'),
]


def _all_nav_codenames() -> set[str]:
    return {c for c, _, _ in ACCESS_PERMISSION_SEED}


def permissions_from_django_groups(user_groups: list[str], user: User | None) -> set[str]:
    """
    SaaS mode: do not derive app permissions from static Django group names.
    Permissions should come from Role/UserStoreRole assignments.
    Keep staff/superuser fallback for platform operations.
    """
    if user and (user.is_superuser or user.is_staff):
        return _all_nav_codenames() | {c for c, _, _ in FEATURE_PERMISSION_SEED}
    # Legacy fallback: keep existing group-based behavior for non-migrated users.
    groups = {g.lower() for g in (user_groups or [])}
    perms: set[str] = set()
    has_admin = any('admin' in g for g in groups)
    has_retail = 'retail' in groups
    has_retail_admin = 'retailadmin' in groups

    if has_admin:
        perms.update({'feature.ledger_admin', 'feature.store_management', 'nav.payments'})
    if has_retail_admin:
        perms.update({'feature.store_management', 'nav.payments'})
    if has_retail:
        perms.add('nav.payments')

    return perms


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
