/**
 * Cart Storage Utility
 * Manages multiple carts in localStorage, keyed by username
 */

export interface CartTab {
  id: number;
  cartNumber: string;
  storeId: number;
  customerId?: number | null;
  customerName?: string | null; // Store customer name for display
  invoiceType: 'cash' | 'upi' | 'pending' | 'mixed' | 'credit';
  itemCount?: number; // Store item count for display
  createdAt: string;
  updatedAt: string;
  /** UI-only: when true, cart is frozen (no edits); user can open a new cart. */
  locked?: boolean;
}

export interface UserCarts {
  username: string;
  tabs: CartTab[];
  activeTabId: number | null;
}

const STORAGE_KEY_PREFIX = 'pos_carts_';

/**
 * Get storage key for a username
 */
function getStorageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}${username}`;
}

/**
 * Get current username from auth
 */
function getUsername(): string | null {
  try {
    // Try to get username from localStorage token or auth module
    // For now, we'll need to pass it explicitly or get it from auth
    const token = localStorage.getItem('access_token');
    if (!token) return null;
    
    // Decode JWT token to get username (simple base64 decode)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.username || null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Load carts for a user from localStorage
 */
export function loadUserCarts(username: string): UserCarts | null {
  try {
    const storageKey = getStorageKey(username);
    const data = localStorage.getItem(storageKey);
    if (!data) return null;
    
    const parsed = JSON.parse(data) as UserCarts;
    // Ensure username matches
    parsed.username = username;
    return parsed;
  } catch (error) {
    console.error('Error loading user carts:', error);
    return null;
  }
}

/**
 * Save carts for a user to localStorage
 */
export function saveUserCarts(userCarts: UserCarts): void {
  try {
    const storageKey = getStorageKey(userCarts.username);
    localStorage.setItem(storageKey, JSON.stringify(userCarts));
  } catch (error) {
    console.error('Error saving user carts:', error);
  }
}

/**
 * Add a new cart tab
 */
export function addCartTab(username: string, cart: CartTab): void {
  const userCarts = loadUserCarts(username) || {
    username,
    tabs: [],
    activeTabId: null,
  };
  
  // Check if cart already exists
  const existingIndex = userCarts.tabs.findIndex(tab => tab.id === cart.id);
  if (existingIndex >= 0) {
    // Update existing tab but preserve UI-only state (e.g. locked) if not provided
    const existing = userCarts.tabs[existingIndex];
    userCarts.tabs[existingIndex] = {
      ...cart,
      locked: cart.locked ?? existing.locked,
      updatedAt: new Date().toISOString(),
    };
  } else {
    // Add new tab
    userCarts.tabs.push(cart);
  }
  
  // Set as active tab
  userCarts.activeTabId = cart.id;
  
  saveUserCarts(userCarts);
}

/**
 * Update an existing cart tab
 */
export function updateCartTab(username: string, cartId: number, updates: Partial<CartTab>): void {
  const userCarts = loadUserCarts(username);
  if (!userCarts) return;
  
  const tabIndex = userCarts.tabs.findIndex(tab => tab.id === cartId);
  if (tabIndex >= 0) {
    userCarts.tabs[tabIndex] = {
      ...userCarts.tabs[tabIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    saveUserCarts(userCarts);
  }
}

/**
 * Remove a cart tab
 */
export function removeCartTab(username: string, cartId: number): number | null {
  const userCarts = loadUserCarts(username);
  if (!userCarts) return null;
  
  userCarts.tabs = userCarts.tabs.filter(tab => tab.id !== cartId);
  
  // If removed tab was active, switch to another tab
  if (userCarts.activeTabId === cartId) {
    userCarts.activeTabId = userCarts.tabs.length > 0 ? userCarts.tabs[userCarts.tabs.length - 1].id : null;
  }
  
  saveUserCarts(userCarts);
  return userCarts.activeTabId;
}

/**
 * Set active tab
 */
export function setActiveTab(username: string, cartId: number): void {
  const userCarts = loadUserCarts(username);
  if (!userCarts) return;
  
  // Verify cart exists
  if (userCarts.tabs.some(tab => tab.id === cartId)) {
    userCarts.activeTabId = cartId;
    saveUserCarts(userCarts);
  }
}

/**
 * Get active tab ID
 */
export function getActiveTabId(username: string): number | null {
  const userCarts = loadUserCarts(username);
  return userCarts?.activeTabId || null;
}

/**
 * Get all tabs for a user
 */
export function getUserTabs(username: string): CartTab[] {
  const userCarts = loadUserCarts(username);
  return userCarts?.tabs || [];
}

/**
 * Clear all carts for a user (on logout)
 */
export function clearUserCarts(username: string): void {
  const storageKey = getStorageKey(username);
  localStorage.removeItem(storageKey);
  localStorage.removeItem(getTradeInStorageKey(username));
}

const TRADE_IN_STORAGE_KEY_PREFIX = 'pos_trade_ins_';

function getTradeInStorageKey(username: string): string {
  return `${TRADE_IN_STORAGE_KEY_PREFIX}${username}`;
}

/** Per-cart trade-in / exchange lines (POS). Keys are cart ids as strings. */
export type StoredTradeInsByCart = Record<string, unknown[]>;

/**
 * Load trade-in lines keyed by cart id for a user.
 */
export function loadTradeInsByCart(username: string): Record<number, unknown[]> {
  try {
    const raw = localStorage.getItem(getTradeInStorageKey(username));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTradeInsByCart;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<number, unknown[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key);
      if (!Number.isFinite(id) || !Array.isArray(value)) continue;
      out[id] = value;
    }
    return out;
  } catch (error) {
    console.error('Error loading POS trade-ins:', error);
    return {};
  }
}

/**
 * Persist trade-in lines keyed by cart id. Empty carts are omitted.
 */
export function saveTradeInsByCart(username: string, byCart: Record<number, unknown[]>): void {
  try {
    const serializable: StoredTradeInsByCart = {};
    for (const [key, lines] of Object.entries(byCart)) {
      if (Array.isArray(lines) && lines.length > 0) {
        serializable[String(key)] = lines;
      }
    }
    const storageKey = getTradeInStorageKey(username);
    if (Object.keys(serializable).length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(serializable));
    }
  } catch (error) {
    console.error('Error saving POS trade-ins:', error);
  }
}

/**
 * Drop trade-in state for one cart (checkout / discard).
 */
export function clearStoredTradeInsForCart(username: string, cartId: number): void {
  const current = loadTradeInsByCart(username);
  if (!(cartId in current)) return;
  delete current[cartId];
  saveTradeInsByCart(username, current);
}

/**
 * Keep only trade-ins for cart ids that still exist (after sync / prune).
 */
export function pruneStoredTradeIns(username: string, validCartIds: number[]): void {
  const current = loadTradeInsByCart(username);
  const valid = new Set(validCartIds);
  let changed = false;
  for (const id of Object.keys(current).map(Number)) {
    if (!valid.has(id)) {
      delete current[id];
      changed = true;
    }
  }
  if (changed) saveTradeInsByCart(username, current);
}

/**
 * Get username from token (helper function)
 */
export function getUsernameFromToken(): string | null {
  return getUsername();
}

