/** Paths that use the isolated credit session (separate tokens from main POS). */
export const CREDIT_APP_PATH_PREFIXES = [
  '/pos-credit',
  '/pos-credit-return',
  '/credit-invoices',
  '/credit-returns',
  '/credit-ledger',
] as const;

export const SALARY_BOOK_PATH_PREFIX = '/salary-book';

export type AuthScope = 'main' | 'credit' | 'salary_book';

export function isCreditAppPath(pathname: string): boolean {
  return CREDIT_APP_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isSalaryBookPath(pathname: string): boolean {
  return pathname === SALARY_BOOK_PATH_PREFIX || pathname.startsWith(`${SALARY_BOOK_PATH_PREFIX}/`);
}

export function getAuthScopeForPath(pathname?: string): AuthScope {
  if (typeof window === 'undefined' && !pathname) return 'main';
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  if (isSalaryBookPath(path)) return 'salary_book';
  if (isCreditAppPath(path)) return 'credit';
  return 'main';
}

export function getLoginPathForScope(scope: AuthScope): string {
  if (scope === 'salary_book') return '/salary-book/login';
  if (scope === 'credit') return '/credit-login';
  return '/login';
}
