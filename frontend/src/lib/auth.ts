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
/** Coalesce concurrent / StrictMode duplicate `loadUser` calls into one `/auth/me/` request. */
let loadUserInFlight: Promise<User | null> | null = null;

export const auth = {
  register: async (data: any) => {
    const response = await authApi.register(data);
    const { access, refresh } = response.data;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    await auth.loadUser({ force: true });
    return response.data;
  },

  login: async (username: string, password: string) => {
    const response = await authApi.login(username, password);
    const { access, refresh } = response.data;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    await auth.loadUser({ force: true });
    return response.data;
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    currentUser = null;
    loadUserInFlight = null;
  },

  /**
   * Fetch current user from `/auth/me/`.
   * - Concurrent callers share one HTTP request.
   * - If we already have `currentUser` and `force` is false, returns cached user (avoids StrictMode double-fetch).
   * - Pass `{ force: true }` after profile changes when you need a fresh server read.
   */
  loadUser: async (options?: { force?: boolean }) => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      currentUser = null;
      return null;
    }
    if (!options?.force && currentUser) {
      return currentUser;
    }
    if (loadUserInFlight) {
      return loadUserInFlight;
    }
    loadUserInFlight = (async () => {
      try {
        const response = await authApi.me();
        if (!localStorage.getItem('access_token')) {
          currentUser = null;
          return null;
        }
        currentUser = response.data;
        return currentUser;
      } catch (error) {
        currentUser = null;
        throw error;
      } finally {
        loadUserInFlight = null;
      }
    })();
    return loadUserInFlight;
  },

  getUser: () => currentUser,

  isAuthenticated: () => {
    return !!localStorage.getItem('access_token');
  },
};

