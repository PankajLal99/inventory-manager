import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadUserCarts,
  saveUserCarts,
  addCartTab,
  updateCartTab,
  removeCartTab,
  setActiveTab,
  getActiveTabId,
  clearUserCarts,
} from '../../src/utils/cartStorage';
import type { CartTab, UserCarts } from '../../src/types';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

const makeCart = (id: number, overrides?: Partial<CartTab>): CartTab => ({
  id,
  cartNumber: `Cart-${id}`,
  storeId: 1,
  invoiceType: 'cash',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeUserCarts = (carts: CartTab[], activeTabId: number | null = null): UserCarts => ({
  username: 'testuser',
  tabs: carts,
  activeTabId,
});

// ─── loadUserCarts ─────────────────────────────────────────────

describe('loadUserCarts', () => {
  it('returns null when no data stored', async () => {
    mockGetItem.mockResolvedValue(null);
    const result = await loadUserCarts('testuser');
    expect(result).toBeNull();
    expect(mockGetItem).toHaveBeenCalledWith('pos_carts_testuser');
  });

  it('parses stored JSON and sets username', async () => {
    const data = makeUserCarts([makeCart(1)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(data));
    const result = await loadUserCarts('testuser');
    expect(result).not.toBeNull();
    expect(result!.username).toBe('testuser');
    expect(result!.tabs).toHaveLength(1);
  });

  it('returns null on parse error', async () => {
    mockGetItem.mockResolvedValue('invalid json');
    const result = await loadUserCarts('testuser');
    expect(result).toBeNull();
  });
});

// ─── saveUserCarts ─────────────────────────────────────────────

describe('saveUserCarts', () => {
  it('saves JSON to AsyncStorage', async () => {
    const data = makeUserCarts([makeCart(1)], 1);
    await saveUserCarts(data);
    expect(mockSetItem).toHaveBeenCalledWith(
      'pos_carts_testuser',
      JSON.stringify(data),
    );
  });

  it('silently fails on error', async () => {
    mockSetItem.mockRejectedValue(new Error('storage error'));
    const data = makeUserCarts([], null);
    await expect(saveUserCarts(data)).resolves.toBeUndefined();
  });
});

// ─── addCartTab ────────────────────────────────────────────────

describe('addCartTab', () => {
  it('adds new cart when none exist', async () => {
    mockGetItem.mockResolvedValue(null);
    const cart = makeCart(1);
    await addCartTab('testuser', cart);
    expect(mockSetItem).toHaveBeenCalled();
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved.tabs).toHaveLength(1);
    expect(saved.activeTabId).toBe(1);
  });

  it('updates existing cart by id', async () => {
    const existing = makeUserCarts([makeCart(1)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    const updatedCart = makeCart(1, { cartNumber: 'Cart-Updated' });
    await addCartTab('testuser', updatedCart);
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved.tabs).toHaveLength(1);
    expect(saved.tabs[0].cartNumber).toBe('Cart-Updated');
  });

  it('appends new cart to existing tabs', async () => {
    const existing = makeUserCarts([makeCart(1)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    const newCart = makeCart(2);
    await addCartTab('testuser', newCart);
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved.tabs).toHaveLength(2);
    expect(saved.activeTabId).toBe(2);
  });
});

// ─── updateCartTab ─────────────────────────────────────────────

describe('updateCartTab', () => {
  it('updates specific fields of a cart', async () => {
    const existing = makeUserCarts([makeCart(1)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    await updateCartTab('testuser', 1, { cartNumber: 'Updated' });
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved.tabs[0].cartNumber).toBe('Updated');
  });

  it('does nothing when user has no carts', async () => {
    mockGetItem.mockResolvedValue(null);
    await updateCartTab('testuser', 1, { cartNumber: 'Updated' });
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('does nothing when cart id not found', async () => {
    const existing = makeUserCarts([makeCart(1)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    await updateCartTab('testuser', 999, { cartNumber: 'Updated' });
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

// ─── removeCartTab ─────────────────────────────────────────────

describe('removeCartTab', () => {
  it('removes cart and returns new active tab id', async () => {
    const existing = makeUserCarts([makeCart(1), makeCart(2)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    const newActiveId = await removeCartTab('testuser', 1);
    expect(newActiveId).toBe(2);
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved.tabs).toHaveLength(1);
  });

  it('returns null when removing last cart', async () => {
    const existing = makeUserCarts([makeCart(1)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    const newActiveId = await removeCartTab('testuser', 1);
    expect(newActiveId).toBeNull();
  });

  it('returns null when no carts stored', async () => {
    mockGetItem.mockResolvedValue(null);
    const result = await removeCartTab('testuser', 1);
    expect(result).toBeNull();
  });
});

// ─── setActiveTab ──────────────────────────────────────────────

describe('setActiveTab', () => {
  it('sets the active tab id', async () => {
    const existing = makeUserCarts([makeCart(1), makeCart(2)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    await setActiveTab('testuser', 2);
    const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
    expect(saved.activeTabId).toBe(2);
  });
});

// ─── getActiveTabId ────────────────────────────────────────────

describe('getActiveTabId', () => {
  it('returns active tab id', async () => {
    const existing = makeUserCarts([makeCart(1)], 1);
    mockGetItem.mockResolvedValue(JSON.stringify(existing));
    const result = await getActiveTabId('testuser');
    expect(result).toBe(1);
  });

  it('returns null when no carts', async () => {
    mockGetItem.mockResolvedValue(null);
    const result = await getActiveTabId('testuser');
    expect(result).toBeNull();
  });
});

// ─── clearUserCarts ────────────────────────────────────────────

describe('clearUserCarts', () => {
  it('removes storage key for the user', async () => {
    await clearUserCarts('testuser');
    expect(mockRemoveItem).toHaveBeenCalledWith('pos_carts_testuser');
  });
});
