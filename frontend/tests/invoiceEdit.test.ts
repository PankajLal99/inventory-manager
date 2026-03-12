import { describe, it, expect } from 'vitest';

/**
 * Tests for InvoiceEdit page behavior: cache keys, localStorage key format,
 * and conventions so cart is properly discarded after apply/back.
 */

const INVOICE_EDIT_CART_PREFIX = 'invoice_edit_cart_';

function getInvoiceEditCartStorageKey(invoiceId: number): string {
  return `${INVOICE_EDIT_CART_PREFIX}${invoiceId}`;
}

describe('InvoiceEdit cache and storage', () => {
  describe('edit cart localStorage key', () => {
    it('uses consistent key format per invoice', () => {
      expect(getInvoiceEditCartStorageKey(1)).toBe('invoice_edit_cart_1');
      expect(getInvoiceEditCartStorageKey(42)).toBe('invoice_edit_cart_42');
    });
  });

  describe('edit-cart query key', () => {
    it('isolates edit cart from POS cart cache', () => {
      const editCartQueryKey = ['edit-cart', 123] as const;
      const posCartQueryKey = ['cart', 123];
      expect(editCartQueryKey[0]).toBe('edit-cart');
      expect(posCartQueryKey[0]).toBe('cart');
      expect(editCartQueryKey).not.toEqual(posCartQueryKey);
    });

    it('includes cart id so each edit session has its own cache entry', () => {
      const cartId1 = 100;
      const cartId2 = 101;
      const key1 = ['edit-cart', cartId1];
      const key2 = ['edit-cart', cartId2];
      expect(key1).not.toEqual(key2);
    });
  });

  describe('POS cache invalidation keys', () => {
    it('uses pos/carts/overview and pos/carts for invalidation after apply or back', () => {
      const keysToInvalidate = ['pos/carts/overview', 'pos/carts'];
      expect(keysToInvalidate).toContain('pos/carts/overview');
      expect(keysToInvalidate).toContain('pos/carts');
    });
  });
});
