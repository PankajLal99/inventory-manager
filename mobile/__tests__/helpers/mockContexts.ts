// Shared mock for contexts used across screen tests
jest.mock('../../src/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: jest.fn(() => ({
    user: {
      id: 1,
      username: 'admin',
      email: 'admin@test.com',
      first_name: 'Admin',
      last_name: 'User',
      is_admin: true,
      can_access_dashboard: true,
      can_access_reports: true,
      can_access_customers: true,
      can_access_ledger: true,
      can_access_history: true,
      store: { id: 1, name: 'Main Store', shop_type: 'retail' },
    },
    isAuthenticated: true,
    isLoading: false,
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    loadUser: jest.fn(),
  })),
  AuthProvider: ({ children }) => children,
}));

jest.mock('../../src/contexts/ToastContext', () => ({
  __esModule: true,
  useToast: jest.fn(() => ({
    toast: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  })),
  ToastProvider: ({ children }) => children,
  toast: jest.fn(),
}));

module.exports = {};
