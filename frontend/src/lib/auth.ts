import { authApi, salaryBookApi } from './api';
import {
  getAuthScopeForPath,
  getLoginPathForScope,
  type AuthScope,
} from './authPaths';

export type { AuthScope } from './authPaths';
export {
  getAuthScopeForPath,
  isCreditAppPath,
  isSalaryBookPath,
  CREDIT_APP_PATH_PREFIXES,
} from './authPaths';

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  date_joined?: string;
  role?: {
    id: number;
    name: string;
  };
  groups?: string[];
  store?: {
    id: number;
    name: string;
    shop_type: string;
  };
  can_access_dashboard?: boolean;
  can_access_reports?: boolean;
  can_access_customers?: boolean;
  can_access_ledger?: boolean;
  can_access_history?: boolean;
  is_admin?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
}

const KEYS: Record<AuthScope, { access: string; refresh: string }> = {
  main: { access: 'access_token', refresh: 'refresh_token' },
  credit: { access: 'credit_access_token', refresh: 'credit_refresh_token' },
  salary_book: { access: 'salary_book_access_token', refresh: 'salary_book_refresh_token' },
};

function accessKey(scope: AuthScope) {
  return KEYS[scope].access;
}

function refreshKey(scope: AuthScope) {
  return KEYS[scope].refresh;
}

let mainUser: User | null = null;
let creditUser: User | null = null;
let salaryBookUser: User | null = null;

function getSlot(scope: AuthScope): User | null {
  if (scope === 'credit') return creditUser;
  if (scope === 'salary_book') return salaryBookUser;
  return mainUser;
}

function setSlot(scope: AuthScope, user: User | null) {
  if (scope === 'credit') creditUser = user;
  else if (scope === 'salary_book') salaryBookUser = user;
  else mainUser = user;
}

export const auth = {
  register: async (data: any) => {
    const response = await authApi.register(data);
    const { access, refresh } = response.data;
    localStorage.setItem(KEYS.main.access, access);
    localStorage.setItem(KEYS.main.refresh, refresh);
    await auth.loadUser('main');
    return response.data;
  },

  /**
   * Log into main, credit, or salary book independently.
   */
  login: async (
    username: string,
    password: string,
    options?: { creditPortal?: boolean; salaryBook?: boolean }
  ) => {
    const scope: AuthScope = options?.salaryBook
      ? 'salary_book'
      : options?.creditPortal
        ? 'credit'
        : 'main';
    const response = options?.salaryBook
      ? await salaryBookApi.login(username, password)
      : await authApi.login(username, password);
    const { access, refresh } = response.data;
    localStorage.setItem(accessKey(scope), access);
    localStorage.setItem(refreshKey(scope), refresh);
    await auth.loadUser(scope);
    return response.data;
  },

  logout: (scope?: AuthScope) => {
    const active = scope ?? getAuthScopeForPath();
    localStorage.removeItem(accessKey(active));
    localStorage.removeItem(refreshKey(active));
    setSlot(active, null);
  },

  getAccessToken: (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    return localStorage.getItem(accessKey(s));
  },

  getRefreshToken: (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    return localStorage.getItem(refreshKey(s));
  },

  setAccessToken: (token: string, scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    localStorage.setItem(accessKey(s), token);
  },

  clearSessionTokens: (scope: AuthScope) => {
    localStorage.removeItem(accessKey(scope));
    localStorage.removeItem(refreshKey(scope));
    setSlot(scope, null);
  },

  isCreditPortalSession: (pathname?: string) => getAuthScopeForPath(pathname) === 'credit',

  getLoginPath: (pathname?: string) => getLoginPathForScope(getAuthScopeForPath(pathname)),

  loadUser: async (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    try {
      let token = localStorage.getItem(accessKey(s));
      if (!token && s === 'salary_book' && localStorage.getItem(refreshKey(s))) {
        await auth.keepSalaryBookSessionAlive();
        token = localStorage.getItem(accessKey(s));
      }
      if (!token) {
        setSlot(s, null);
        throw new Error('Not authenticated');
      }
      const response = s === 'salary_book' ? await salaryBookApi.me() : await authApi.me(s);
      setSlot(s, response.data);
      return response.data as User;
    } catch (error) {
      setSlot(s, null);
      throw error;
    }
  },

  getUser: (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    return getSlot(s);
  },

  setUser: (user: User | null, scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    setSlot(s, user);
  },

  isAuthenticated: (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    return !!localStorage.getItem(accessKey(s));
  },

  isMainAuthenticated: () => !!localStorage.getItem(KEYS.main.access),
  isCreditAuthenticated: () => !!localStorage.getItem(KEYS.credit.access),
  isSalaryBookAuthenticated: () =>
    !!localStorage.getItem(KEYS.salary_book.access) ||
    !!localStorage.getItem(KEYS.salary_book.refresh),

  /**
   * Keep Salary Book signed in. Call while the app is open.
   * Session ends on logout or when the account password changes.
   */
  keepSalaryBookSessionAlive: async () => {
    const refresh = localStorage.getItem(KEYS.salary_book.refresh);
    if (!refresh) throw new Error('Not authenticated');
    const response = await salaryBookApi.refresh(refresh);
    const { access, refresh: nextRefresh } = response.data;
    localStorage.setItem(KEYS.salary_book.access, access);
    if (nextRefresh) localStorage.setItem(KEYS.salary_book.refresh, nextRefresh);
    return response.data;
  },

  promoteMainSessionToCredit: async () => {
    const access = localStorage.getItem(KEYS.main.access);
    const refresh = localStorage.getItem(KEYS.main.refresh);
    if (!access) {
      throw new Error('Not authenticated');
    }
    localStorage.setItem(KEYS.credit.access, access);
    if (refresh) localStorage.setItem(KEYS.credit.refresh, refresh);
    localStorage.removeItem(KEYS.main.access);
    localStorage.removeItem(KEYS.main.refresh);
    mainUser = null;
    return auth.loadUser('credit');
  },
};
