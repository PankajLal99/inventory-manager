import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartTab, UserCarts } from '../types';

const STORAGE_KEY_PREFIX = 'pos_carts_';

function getStorageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}${username}`;
}

export async function loadUserCarts(username: string): Promise<UserCarts | null> {
  try {
    const data = await AsyncStorage.getItem(getStorageKey(username));
    if (!data) return null;
    const parsed = JSON.parse(data) as UserCarts;
    parsed.username = username;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveUserCarts(userCarts: UserCarts): Promise<void> {
  try {
    await AsyncStorage.setItem(
      getStorageKey(userCarts.username),
      JSON.stringify(userCarts),
    );
  } catch {
    // silently fail
  }
}

export async function addCartTab(username: string, cart: CartTab): Promise<void> {
  const userCarts = (await loadUserCarts(username)) || {
    username,
    tabs: [],
    activeTabId: null,
  };
  const existingIndex = userCarts.tabs.findIndex((t) => t.id === cart.id);
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
  await saveUserCarts(userCarts);
}

export async function updateCartTab(
  username: string,
  cartId: number,
  updates: Partial<CartTab>,
): Promise<void> {
  const userCarts = await loadUserCarts(username);
  if (!userCarts) return;
  const idx = userCarts.tabs.findIndex((t) => t.id === cartId);
  if (idx >= 0) {
    userCarts.tabs[idx] = {
      ...userCarts.tabs[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await saveUserCarts(userCarts);
  }
}

export async function removeCartTab(
  username: string,
  cartId: number,
): Promise<number | null> {
  const userCarts = await loadUserCarts(username);
  if (!userCarts) return null;
  userCarts.tabs = userCarts.tabs.filter((t) => t.id !== cartId);
  if (userCarts.activeTabId === cartId) {
    userCarts.activeTabId =
      userCarts.tabs.length > 0
        ? userCarts.tabs[userCarts.tabs.length - 1].id
        : null;
  }
  await saveUserCarts(userCarts);
  return userCarts.activeTabId;
}

export async function setActiveTab(username: string, cartId: number): Promise<void> {
  const userCarts = await loadUserCarts(username);
  if (!userCarts) return;
  userCarts.activeTabId = cartId;
  await saveUserCarts(userCarts);
}

export async function getActiveTabId(username: string): Promise<number | null> {
  const userCarts = await loadUserCarts(username);
  return userCarts?.activeTabId ?? null;
}

export async function getUserTabs(username: string): Promise<CartTab[]> {
  const userCarts = await loadUserCarts(username);
  return userCarts?.tabs ?? [];
}

export async function clearUserCarts(username: string): Promise<void> {
  await AsyncStorage.removeItem(getStorageKey(username));
}
