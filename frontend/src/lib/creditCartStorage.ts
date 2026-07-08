/**
 * Credit Cart Storage — separate from POS carts (pos_carts_*).
 */

export interface CreditCartTab {
  id: number;
  cartNumber: string;
  storeId: number;
  customerId?: number | null;
  customerName?: string | null;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
  /** When true, cart is frozen (no edits); user can open a new cart. */
  locked?: boolean;
}

export interface UserCreditCarts {
  username: string;
  tabs: CreditCartTab[];
  activeTabId: number | null;
}

const STORAGE_KEY_PREFIX = 'credit_carts_';

function getStorageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}${username}`;
}

export function loadUserCreditCarts(username: string): UserCreditCarts | null {
  try {
    const data = localStorage.getItem(getStorageKey(username));
    if (!data) return null;
    const parsed = JSON.parse(data) as UserCreditCarts;
    parsed.username = username;
    return parsed;
  } catch {
    return null;
  }
}

export function saveUserCreditCarts(userCarts: UserCreditCarts): void {
  try {
    localStorage.setItem(getStorageKey(userCarts.username), JSON.stringify(userCarts));
  } catch (error) {
    console.error('Error saving credit carts:', error);
  }
}

export function addCreditCartTab(username: string, cart: CreditCartTab): void {
  const userCarts = loadUserCreditCarts(username) || {
    username,
    tabs: [],
    activeTabId: null,
  };

  const existingIndex = userCarts.tabs.findIndex((tab) => tab.id === cart.id);
  if (existingIndex >= 0) {
    const existing = userCarts.tabs[existingIndex];
    userCarts.tabs[existingIndex] = {
      ...cart,
      locked: cart.locked ?? existing.locked,
      updatedAt: new Date().toISOString(),
    };
  } else {
    userCarts.tabs.push(cart);
  }

  userCarts.activeTabId = cart.id;
  saveUserCreditCarts(userCarts);
}

export function updateCreditCartTab(
  username: string,
  cartId: number,
  updates: Partial<CreditCartTab>
): void {
  const userCarts = loadUserCreditCarts(username);
  if (!userCarts) return;

  const tabIndex = userCarts.tabs.findIndex((tab) => tab.id === cartId);
  if (tabIndex >= 0) {
    userCarts.tabs[tabIndex] = {
      ...userCarts.tabs[tabIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    saveUserCreditCarts(userCarts);
  }
}

export function removeCreditCartTab(username: string, cartId: number): number | null {
  const userCarts = loadUserCreditCarts(username);
  if (!userCarts) return null;

  userCarts.tabs = userCarts.tabs.filter((tab) => tab.id !== cartId);

  if (userCarts.activeTabId === cartId) {
    userCarts.activeTabId =
      userCarts.tabs.length > 0 ? userCarts.tabs[userCarts.tabs.length - 1].id : null;
  }

  saveUserCreditCarts(userCarts);
  return userCarts.activeTabId;
}

export function setActiveCreditTab(username: string, cartId: number): void {
  const userCarts = loadUserCreditCarts(username);
  if (!userCarts) return;
  if (userCarts.tabs.some((tab) => tab.id === cartId)) {
    userCarts.activeTabId = cartId;
    saveUserCreditCarts(userCarts);
  }
}

export function getActiveCreditTabId(username: string): number | null {
  return loadUserCreditCarts(username)?.activeTabId || null;
}

export function getUserCreditTabs(username: string): CreditCartTab[] {
  return loadUserCreditCarts(username)?.tabs || [];
}

export function clearUserCreditCarts(username: string): void {
  localStorage.removeItem(getStorageKey(username));
}
