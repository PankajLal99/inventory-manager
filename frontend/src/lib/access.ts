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
} as const;

export function hasPermission(
  user: User | null | undefined,
  codename: string,
  legacy: () => boolean
): boolean {
  const p = user?.permissions;
  if (Array.isArray(p) && p.length > 0) return p.includes(codename);
  return legacy();
}

export function isPosAdminContext(user: User | null | undefined): boolean {
  return hasPermission(user, P.POS_ADMIN, () =>
    Boolean(
      user?.is_admin ||
        user?.is_superuser ||
        user?.is_staff ||
        (user?.groups && user.groups.includes('Admin'))
    )
  );
}

export function isPosRetailLane(user: User | null | undefined): boolean {
  return hasPermission(user, P.POS_RETAIL_LANE, () => {
    const g = user?.groups || [];
    return g.includes('Retail') || g.includes('RetailAdmin');
  });
}

export function isPosWholesaleLane(user: User | null | undefined): boolean {
  return hasPermission(user, P.POS_WHOLESALE, () => {
    const g = user?.groups || [];
    return g.includes('Wholesale') || g.includes('WholesaleAdmin');
  });
}

export function isPosWholesaleAdmin(user: User | null | undefined): boolean {
  return hasPermission(user, P.POS_WHOLESALE_ADMIN, () =>
    Boolean(user?.groups && user.groups.includes('WholesaleAdmin'))
  );
}

export function isPosWholesaleStaffOnly(user: User | null | undefined): boolean {
  return isPosWholesaleLane(user) && !isPosWholesaleAdmin(user);
}

export function isInvoiceAdminStores(user: User | null | undefined): boolean {
  return hasPermission(user, P.INVOICE_ADMIN_STORES, () =>
    (user?.groups || []).some((x: string) => String(x).includes('Admin'))
  );
}

export function canSeeSuperMetrics(user: User | null | undefined): boolean {
  return hasPermission(user, P.SUPER_METRICS, () => (user?.groups || []).includes('Super'));
}

export function isInvoiceRestrictedUser(user: User | null | undefined): boolean {
  return hasPermission(user, P.INVOICE_RESTRICTED, () => {
    const g = user?.groups || [];
    return (
      (g.includes('Retail') || g.includes('Wholesale')) &&
      !g.includes('Admin') &&
      !g.includes('RetailAdmin') &&
      !g.includes('WholesaleAdmin')
    );
  });
}

export function hasInvoiceHideCashCheckout(user: User | null | undefined): boolean {
  return hasPermission(user, P.INVOICE_HIDE_CASH_CHECKOUT, () => {
    const g = user?.groups || [];
    return g.includes('Wholesale') || g.includes('WholesaleAdmin');
  });
}

export function isRetailCatalogRestricted(user: User | null | undefined): boolean {
  return hasPermission(user, P.RETAIL_CATALOG_RESTRICTED, () => {
    const g = user?.groups || [];
    return g.includes('Retail') && !g.includes('Admin') && !g.includes('RetailAdmin');
  });
}

export function isLedgerAdminContext(user: User | null | undefined): boolean {
  return hasPermission(user, P.LEDGER_ADMIN, () =>
    Boolean(
      user?.is_admin ||
        user?.is_superuser ||
        user?.is_staff ||
        (user?.groups || []).some((group: string) => group.includes('Admin'))
    )
  );
}

export function isStoreManagementAdmin(user: User | null | undefined): boolean {
  return hasPermission(user, P.STORE_MANAGEMENT, () => {
    const g = user?.groups || [];
    return Boolean(
      user?.is_admin ||
        user?.is_staff ||
        user?.is_superuser ||
        g.includes('Admin') ||
        g.includes('RetailAdmin') ||
        g.includes('WholesaleAdmin')
    );
  });
}

export function hasPaymentsExtendedColumns(user: User | null | undefined): boolean {
  return hasPermission(user, P.PAYMENTS_EXTENDED, () => !(user?.groups || []).includes('Retail'));
}

export function canDiscardInvoiceEditCarts(user: User | null | undefined): boolean {
  return hasPermission(user, P.DISCARD_INVOICE_EDIT_CARTS, () => {
    const g = user?.groups || [];
    return g.includes('Super') || g.includes('Admin');
  });
}
