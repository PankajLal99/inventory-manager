import { authApi } from './api';
import {
  getAuthScopeForPath,
  type AuthScope,
} from './authPaths';

export type { AuthScope } from './authPaths';
export { getAuthScopeForPath, isCreditAppPath, CREDIT_APP_PATH_PREFIXES } from './authPaths';

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
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

const MAIN_ACCESS = 'access_token';
const MAIN_REFRESH = 'refresh_token';
const CREDIT_ACCESS = 'credit_access_token';
const CREDIT_REFRESH = 'credit_refresh_token';

function accessKey(scope: AuthScope) {
  return scope === 'credit' ? CREDIT_ACCESS : MAIN_ACCESS;
}

function refreshKey(scope: AuthScope) {
  return scope === 'credit' ? CREDIT_REFRESH : MAIN_REFRESH;
}

let mainUser: User | null = null;
let creditUser: User | null = null;

export const auth = {
  register: async (data: any) => {
    const response = await authApi.register(data);
    const { access, refresh } = response.data;
    localStorage.setItem(MAIN_ACCESS, access);
    localStorage.setItem(MAIN_REFRESH, refresh);
    await auth.loadUser('main');
    return response.data;
  },

  /**
   * Log into main and/or credit independently.
   * creditPortal:true → credit tokens only (main session untouched).
   * otherwise → main tokens only (credit session untouched).
   */
  login: async (username: string, password: string, options?: { creditPortal?: boolean }) => {
    const response = await authApi.login(username, password);
    const { access, refresh } = response.data;
    const scope: AuthScope = options?.creditPortal ? 'credit' : 'main';
    localStorage.setItem(accessKey(scope), access);
    localStorage.setItem(refreshKey(scope), refresh);
    await auth.loadUser(scope);
    return response.data;
  },

  /** Log out only one portal so the other can stay signed in. */
  logout: (scope?: AuthScope) => {
    const active = scope ?? getAuthScopeForPath();
    localStorage.removeItem(accessKey(active));
    localStorage.removeItem(refreshKey(active));
    if (active === 'credit') creditUser = null;
    else mainUser = null;
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
    if (scope === 'credit') creditUser = null;
    else mainUser = null;
  },

  /** True when the current URL is a credit-app path (uses credit tokens). */
  isCreditPortalSession: (pathname?: string) => getAuthScopeForPath(pathname) === 'credit',

  getLoginPath: (pathname?: string) =>
    getAuthScopeForPath(pathname) === 'credit' ? '/credit-login' : '/login',

  loadUser: async (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    try {
      const token = localStorage.getItem(accessKey(s));
      if (!token) {
        if (s === 'credit') creditUser = null;
        else mainUser = null;
        throw new Error('Not authenticated');
      }
      const response = await authApi.me(s);
      if (s === 'credit') creditUser = response.data;
      else mainUser = response.data;
      return response.data as User;
    } catch (error) {
      if (s === 'credit') creditUser = null;
      else mainUser = null;
      throw error;
    }
  },

  getUser: (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    return s === 'credit' ? creditUser : mainUser;
  },

  isAuthenticated: (scope?: AuthScope) => {
    const s = scope ?? getAuthScopeForPath();
    return !!localStorage.getItem(accessKey(s));
  },

  isMainAuthenticated: () => !!localStorage.getItem(MAIN_ACCESS),
  isCreditAuthenticated: () => !!localStorage.getItem(CREDIT_ACCESS),
};
