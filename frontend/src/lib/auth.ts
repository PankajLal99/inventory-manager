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
    currentUser = null;
  },

  loadUser: async () => {
    try {
      const response = await authApi.me();
      currentUser = response.data;
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

