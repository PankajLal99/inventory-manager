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
  invoiceType: 'cash' | 'upi' | 'pending' | 'mixed';
  itemCount?: number; // Store item count for display
  createdAt: string;
  updatedAt: string;
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
    // Update existing tab
    userCarts.tabs[existingIndex] = cart;
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
}

/**
 * Get username from token (helper function)
 */
export function getUsernameFromToken(): string | null {
  return getUsername();
}

