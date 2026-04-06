import { authApi } from './api';

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
  /** Preferred shop (same as `store` when set); assign in Django Admin. */
  default_store?: {
    id: number;
    name: string;
    code: string;
    shop_type: string;
  } | null;
  /** If non-empty, user is limited to these shops (plus group rules). */
  assigned_stores?: {
    id: number;
    name: string;
    code: string;
    shop_type: string;
  }[];
  /** Effective menu/API feature keys from groups + per-shop roles (`GET /auth/me/`). */
  permissions?: string[];
  retailer?: {
    id: number;
    code: string;
    name: string;
  } | null;
  can_access_dashboard?: boolean;
  can_access_reports?: boolean;
  can_access_customers?: boolean;
  can_access_ledger?: boolean;
  can_access_history?: boolean;
  is_admin?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
}

let currentUser: User | null = null;

export const auth = {
  register: async (data: any) => {
    const response = await authApi.register(data);
    const { access, refresh } = response.data;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    await auth.loadUser();
    return response.data;
  },

  login: async (username: string, password: string) => {
    const response = await authApi.login(username, password);
    const { access, refresh } = response.data;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    await auth.loadUser();
    return response.data;
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('retailer_code');
    currentUser = null;
  },

  loadUser: async () => {
    try {
      const response = await authApi.me();
      currentUser = response.data;
      const rc = currentUser?.retailer?.code;
      if (rc) {
        localStorage.setItem('retailer_code', rc);
      } else {
        localStorage.removeItem('retailer_code');
      }
      return currentUser;
    } catch (error) {
      currentUser = null;
      throw error;
    }
  },

  getUser: () => currentUser,

  isAuthenticated: () => {
    return !!localStorage.getItem('access_token');
  },
};

