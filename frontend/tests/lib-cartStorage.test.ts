import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadUserCarts,
  saveUserCarts,
  addCartTab,
  updateCartTab,
  removeCartTab,
  setActiveTab,
  getActiveTabId,
  getUserTabs,
  clearUserCarts,
  type UserCarts,
  type CartTab,
} from '../src/lib/cartStorage'

const username = 'testuser'

function mockCartTab(overrides: Partial<CartTab> = {}): CartTab {
  return {
    id: 1,
    cartNumber: '1',
    storeId: 10,
    customerId: null,
    customerName: null,
    invoiceType: 'cash',
    itemCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('cartStorage', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
      clear: () => {
        storage = {}
      },
      length: 0,
      key: () => null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('loadUserCarts and saveUserCarts', () => {
    it('returns null when no data stored', () => {
      expect(loadUserCarts(username)).toBe(null)
    })

    it('round-trips UserCarts', () => {
      const data: UserCarts = {
        username,
        tabs: [mockCartTab({ id: 1 }), mockCartTab({ id: 2, cartNumber: '2' })],
        activeTabId: 2,
      }
      saveUserCarts(data)
      const loaded = loadUserCarts(username)
      expect(loaded).not.toBe(null)
      expect(loaded!.username).toBe(username)
      expect(loaded!.tabs).toHaveLength(2)
      expect(loaded!.activeTabId).toBe(2)
    })
  })

  describe('addCartTab', () => {
    it('adds first tab and sets active', () => {
      const cart = mockCartTab({ id: 101, cartNumber: '1' })
      addCartTab(username, cart)
      expect(getUserTabs(username)).toHaveLength(1)
      expect(getActiveTabId(username)).toBe(101)
    })

    it('adds second tab and sets it active', () => {
      addCartTab(username, mockCartTab({ id: 1 }))
      addCartTab(username, mockCartTab({ id: 2, cartNumber: '2' }))
      expect(getUserTabs(username)).toHaveLength(2)
      expect(getActiveTabId(username)).toBe(2)
    })

    it('updates existing tab when same id', () => {
      addCartTab(username, mockCartTab({ id: 1, cartNumber: '1', itemCount: 0 }))
      addCartTab(username, mockCartTab({ id: 1, cartNumber: '1', itemCount: 3 }))
      expect(getUserTabs(username)).toHaveLength(1)
      expect(getUserTabs(username)[0].itemCount).toBe(3)
    })
  })

  describe('updateCartTab', () => {
    it('updates tab when it exists', () => {
      addCartTab(username, mockCartTab({ id: 1, itemCount: 0 }))
      updateCartTab(username, 1, { itemCount: 5 })
      expect(getUserTabs(username)[0].itemCount).toBe(5)
    })

    it('does nothing when user has no carts', () => {
      updateCartTab(username, 1, { itemCount: 5 })
      expect(loadUserCarts(username)).toBe(null)
    })

    it('does nothing when cart id not found', () => {
      addCartTab(username, mockCartTab({ id: 1 }))
      updateCartTab(username, 999, { itemCount: 5 })
      expect(getUserTabs(username)[0].itemCount).toBe(0)
    })
  })

  describe('removeCartTab', () => {
    it('removes tab and returns new active id', () => {
      addCartTab(username, mockCartTab({ id: 1 }))
      addCartTab(username, mockCartTab({ id: 2, cartNumber: '2' }))
      const newActive = removeCartTab(username, 2)
      expect(getUserTabs(username)).toHaveLength(1)
      expect(getUserTabs(username)[0].id).toBe(1)
      expect(newActive).toBe(1)
    })

    it('returns null when last tab removed', () => {
      addCartTab(username, mockCartTab({ id: 1 }))
      const newActive = removeCartTab(username, 1)
      expect(getUserTabs(username)).toHaveLength(0)
      expect(newActive).toBe(null)
    })

    it('returns null when user has no carts', () => {
      expect(removeCartTab(username, 1)).toBe(null)
    })
  })

  describe('setActiveTab and getActiveTabId', () => {
    it('sets and returns active tab id', () => {
      addCartTab(username, mockCartTab({ id: 1 }))
      addCartTab(username, mockCartTab({ id: 2, cartNumber: '2' }))
      setActiveTab(username, 1)
      expect(getActiveTabId(username)).toBe(1)
    })

    it('does not set active if cart id does not exist', () => {
      addCartTab(username, mockCartTab({ id: 1 }))
      setActiveTab(username, 99)
      expect(getActiveTabId(username)).toBe(1)
    })
  })

  describe('getUserTabs', () => {
    it('returns empty array when no carts', () => {
      expect(getUserTabs(username)).toEqual([])
    })
  })

  describe('clearUserCarts', () => {
    it('removes all data for user', () => {
      addCartTab(username, mockCartTab({ id: 1 }))
      clearUserCarts(username)
      expect(loadUserCarts(username)).toBe(null)
      expect(getUserTabs(username)).toEqual([])
    })
  })
})
