import type { User } from './auth';

/** Effective permission codenames from `GET /auth/me/` — mirror `backend/core/access.py`. */
export const P = {
  SUPER_METRICS: 'feature.super_metrics',
  POS_ADMIN: 'feature.pos_admin',
  POS_RETAIL_LANE: 'feature.pos_retail_lane',
  POS_WHOLESALE: 'feature.pos_wholesale',
  POS_WHOLESALE_ADMIN: 'feature.pos_wholesale_admin',
  INVOICE_ADMIN_STORES: 'feature.invoice_admin_stores',
  INVOICE_RESTRICTED: 'feature.invoice_restricted',
  INVOICE_HIDE_CASH_CHECKOUT: 'feature.invoice_hide_cash_checkout',
  RETAIL_CATALOG_RESTRICTED: 'feature.retail_catalog_restricted',
  LEDGER_ADMIN: 'feature.ledger_admin',
  STORE_MANAGEMENT: 'feature.store_management',
  PAYMENTS_EXTENDED: 'feature.payments_extended_columns',
  DISCARD_INVOICE_EDIT_CARTS: 'feature.discard_invoice_edit_carts',
  ROLE_MANAGEMENT: 'feature.role_management',
} as const;

function normalizedGroups(user: User | null | undefined): Set<string> {
  return new Set((user?.groups || []).map((g) => String(g || '').trim().toLowerCase()));
}

export function hasAdminSuperBypass(user: User | null | undefined): boolean {
  const groups = normalizedGroups(user);
  return groups.has('admin') && groups.has('super');
}

export function hasPermission(
  user: User | null | undefined,
  codename: string,
  legacy: () => boolean
): boolean {
  // Group-first priority: explicit Admin + Super bypass.
  if (hasAdminSuperBypass(user)) return true;
  if (user?.is_superuser || user?.is_staff) return true;
  const p = user?.permissions;
  if (Array.isArray(p)) return p.includes(codename);
  return legacy();
}

export function hasNavPermission(user: User | null | undefined, navCodename: string): boolean {
  return hasPermission(user, navCodename, () => false);
}

export function isPosAdminContext(user: User | null | undefined): boolean {
  return hasPermission(user, P.POS_ADMIN, () => Boolean(user?.is_admin || user?.is_superuser || user?.is_staff));
}

export function isPosRetailLane(user: User | null | undefined): boolean {
  return hasPermission(user, P.POS_RETAIL_LANE, () => false);
}

export function isPosWholesaleLane(user: User | null | undefined): boolean {
  if (hasAdminSuperBypass(user)) return false;
  return hasPermission(user, P.POS_WHOLESALE, () => false);
}

export function isPosWholesaleAdmin(user: User | null | undefined): boolean {
  return hasPermission(user, P.POS_WHOLESALE_ADMIN, () => false);
}

export function isPosWholesaleStaffOnly(user: User | null | undefined): boolean {
  return isPosWholesaleLane(user) && !isPosWholesaleAdmin(user);
}

export function isInvoiceAdminStores(user: User | null | undefined): boolean {
  return hasPermission(user, P.INVOICE_ADMIN_STORES, () => false);
}

export function canSeeSuperMetrics(user: User | null | undefined): boolean {
  return hasPermission(user, P.SUPER_METRICS, () => false);
}

export function isInvoiceRestrictedUser(user: User | null | undefined): boolean {
  if (hasAdminSuperBypass(user)) return false;
  return hasPermission(user, P.INVOICE_RESTRICTED, () => false);
}

export function hasInvoiceHideCashCheckout(user: User | null | undefined): boolean {
  if (hasAdminSuperBypass(user)) return false;
  return hasPermission(user, P.INVOICE_HIDE_CASH_CHECKOUT, () => false);
}

export function isRetailCatalogRestricted(user: User | null | undefined): boolean {
  if (hasAdminSuperBypass(user)) return false;
  return hasPermission(user, P.RETAIL_CATALOG_RESTRICTED, () => false);
}

export function isLedgerAdminContext(user: User | null | undefined): boolean {
  return hasPermission(user, P.LEDGER_ADMIN, () => Boolean(user?.is_admin || user?.is_superuser || user?.is_staff));
}

export function isStoreManagementAdmin(user: User | null | undefined): boolean {
  return hasPermission(user, P.STORE_MANAGEMENT, () => Boolean(user?.is_admin || user?.is_staff || user?.is_superuser));
}

export function hasPaymentsExtendedColumns(user: User | null | undefined): boolean {
  return hasPermission(user, P.PAYMENTS_EXTENDED, () => false);
}

export function canDiscardInvoiceEditCarts(user: User | null | undefined): boolean {
  return hasPermission(user, P.DISCARD_INVOICE_EDIT_CARTS, () => false);
}

export function canManageRoles(user: User | null | undefined): boolean {
  return hasPermission(user, P.ROLE_MANAGEMENT, () => false);
}
