/** Paths that use the isolated credit session (separate tokens from main POS). */
export const CREDIT_APP_PATH_PREFIXES = [
  '/pos-credit',
  '/pos-credit-return',
  '/credit-invoices',
  '/credit-returns',
  '/credit-ledger',
] as const;

export type AuthScope = 'main' | 'credit';

export function isCreditAppPath(pathname: string): boolean {
  return CREDIT_APP_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function getAuthScopeForPath(pathname?: string): AuthScope {
  if (typeof window === 'undefined' && !pathname) return 'main';
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  return isCreditAppPath(path) ? 'credit' : 'main';
}
