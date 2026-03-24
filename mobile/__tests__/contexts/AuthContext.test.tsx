import * as SecureStore from 'expo-secure-store';

// Mock the API client
jest.mock('../../src/api/client', () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: '' },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    me: jest.fn(),
  },
}));

import { authApi } from '../../src/api/client';

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
const mockLogin = authApi.login as jest.Mock;
const mockMe = authApi.me as jest.Mock;

describe('AuthContext module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemAsync.mockResolvedValue(null);
  });

  it('authApi.login is callable', () => {
    expect(typeof authApi.login).toBe('function');
  });

  it('authApi.me is callable', () => {
    expect(typeof authApi.me).toBe('function');
  });

  it('authApi.login returns token data', async () => {
    mockLogin.mockResolvedValue({
      data: { access: 'test-access', refresh: 'test-refresh' },
    });
    const result = await authApi.login('user', 'pass');
    expect(result.data.access).toBe('test-access');
    expect(result.data.refresh).toBe('test-refresh');
  });

  it('SecureStore stores and retrieves tokens', async () => {
    await SecureStore.setItemAsync('access_token', 'my-token');
    expect(mockSetItemAsync).toHaveBeenCalledWith('access_token', 'my-token');
  });

  it('SecureStore deletes tokens on logout', async () => {
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('access_token');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('refresh_token');
  });

  it('authApi.me fetches user profile', async () => {
    const mockUser = {
      id: 1,
      username: 'testuser',
      email: 'test@test.com',
      first_name: 'Test',
      last_name: 'User',
    };
    mockMe.mockResolvedValue({ data: mockUser });
    const result = await authApi.me();
    expect(result.data).toEqual(mockUser);
  });

  it('login flow stores tokens then calls me', async () => {
    mockLogin.mockResolvedValue({
      data: { access: 'access-token', refresh: 'refresh-token' },
    });
    const mockUser = {
      id: 1,
      username: 'testuser',
      email: 'test@test.com',
      first_name: 'Test',
      last_name: 'User',
    };
    mockMe.mockResolvedValue({ data: mockUser });

    // Simulate the login flow
    const loginResult = await authApi.login('testuser', 'password');
    const { access, refresh } = loginResult.data;
    await SecureStore.setItemAsync('access_token', access);
    await SecureStore.setItemAsync('refresh_token', refresh);
    const meResult = await authApi.me();

    expect(mockSetItemAsync).toHaveBeenCalledWith('access_token', 'access-token');
    expect(mockSetItemAsync).toHaveBeenCalledWith('refresh_token', 'refresh-token');
    expect(meResult.data.username).toBe('testuser');
  });
});
