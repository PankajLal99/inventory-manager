import {
  getMinPrice,
  getPriceValidationError,
  getEffectivePrice,
  allItemsHavePrices,
} from '../../src/utils/priceValidation';
import type { CartItemLike } from '../../src/types';

// ─── getMinPrice ───────────────────────────────────────────────

describe('getMinPrice', () => {
  it('returns selling price when available', () => {
    const item: CartItemLike = {
      id: 1,
      product_selling_price: 500,
      product_purchase_price: 300,
    };
    const result = getMinPrice(item);
    expect(result.minPrice).toBe(500);
    expect(result.priceType).toBe('selling price');
  });

  it('falls back to purchase price when selling price is zero', () => {
    const item: CartItemLike = {
      id: 1,
      product_selling_price: 0,
      product_purchase_price: 300,
    };
    const result = getMinPrice(item);
    expect(result.minPrice).toBe(300);
    expect(result.priceType).toBe('purchase price');
  });

  it('falls back to purchase price when selling price is null', () => {
    const item: CartItemLike = {
      id: 1,
      product_selling_price: null,
      product_purchase_price: 200,
    };
    const result = getMinPrice(item);
    expect(result.minPrice).toBe(200);
    expect(result.priceType).toBe('purchase price');
  });

  it('handles string prices', () => {
    const item: CartItemLike = {
      id: 1,
      product_selling_price: '450',
      product_purchase_price: '300',
    };
    const result = getMinPrice(item);
    expect(result.minPrice).toBe(450);
    expect(result.priceType).toBe('selling price');
  });

  it('returns 0 purchase price when both are null', () => {
    const item: CartItemLike = {
      id: 1,
      product_selling_price: null,
      product_purchase_price: null,
    };
    const result = getMinPrice(item);
    expect(result.minPrice).toBe(0);
    expect(result.priceType).toBe('purchase price');
  });
});

// ─── getPriceValidationError ───────────────────────────────────

describe('getPriceValidationError', () => {
  const baseItem: CartItemLike = {
    id: 1,
    product_selling_price: 500,
    product_purchase_price: 300,
    product_can_go_below_purchase_price: false,
  };

  it('returns null for pending invoices', () => {
    expect(getPriceValidationError(100, baseItem, 'pending')).toBeNull();
  });

  it('returns null when can_go_below_purchase_price is true', () => {
    const item = { ...baseItem, product_can_go_below_purchase_price: true };
    expect(getPriceValidationError(100, item, 'cash')).toBeNull();
  });

  it('returns null when price is at or above min', () => {
    expect(getPriceValidationError(500, baseItem, 'cash')).toBeNull();
    expect(getPriceValidationError(600, baseItem, 'cash')).toBeNull();
  });

  it('returns error message when price is below min', () => {
    const result = getPriceValidationError(400, baseItem, 'cash');
    expect(result).toContain('Price cannot be less than');
    expect(result).toContain('selling price');
  });

  it('returns null when minPrice is 0', () => {
    const item: CartItemLike = {
      id: 1,
      product_selling_price: null,
      product_purchase_price: 0,
    };
    expect(getPriceValidationError(0, item, 'cash')).toBeNull();
  });
});

// ─── getEffectivePrice ─────────────────────────────────────────

describe('getEffectivePrice', () => {
  it('uses editingPrice when provided', () => {
    const item: CartItemLike = { id: 1, manual_unit_price: 500 };
    expect(getEffectivePrice(item, '300')).toBe(300);
  });

  it('returns 0 for empty editingPrice', () => {
    const item: CartItemLike = { id: 1, manual_unit_price: 500 };
    expect(getEffectivePrice(item, '')).toBe(0);
  });

  it('returns 0 for NaN editingPrice', () => {
    const item: CartItemLike = { id: 1, manual_unit_price: 500 };
    expect(getEffectivePrice(item, 'abc')).toBe(0);
  });

  it('uses manual_unit_price when editingPrice not provided', () => {
    const item: CartItemLike = { id: 1, manual_unit_price: 450 };
    expect(getEffectivePrice(item)).toBe(450);
  });

  it('handles string manual_unit_price', () => {
    const item: CartItemLike = { id: 1, manual_unit_price: '350.5' };
    expect(getEffectivePrice(item)).toBe(350.5);
  });

  it('returns 0 when manual_unit_price is null', () => {
    const item: CartItemLike = { id: 1, manual_unit_price: null };
    expect(getEffectivePrice(item)).toBe(0);
  });

  it('returns 0 when manual_unit_price is empty string', () => {
    const item: CartItemLike = { id: 1, manual_unit_price: '' };
    expect(getEffectivePrice(item)).toBe(0);
  });
});

// ─── allItemsHavePrices ────────────────────────────────────────

describe('allItemsHavePrices', () => {
  it('returns true for pending invoices', () => {
    expect(allItemsHavePrices([], {}, 'pending')).toBe(true);
  });

  it('returns true for empty items array', () => {
    expect(allItemsHavePrices([], {}, 'cash')).toBe(true);
  });

  it('returns true when all items have prices', () => {
    const items: CartItemLike[] = [
      { id: 1, manual_unit_price: 100 },
      { id: 2, manual_unit_price: 200 },
    ];
    expect(allItemsHavePrices(items, {}, 'cash')).toBe(true);
  });

  it('returns false when an item has no price', () => {
    const items: CartItemLike[] = [
      { id: 1, manual_unit_price: 100 },
      { id: 2, manual_unit_price: null },
    ];
    expect(allItemsHavePrices(items, {}, 'cash')).toBe(false);
  });

  it('uses editingManualPrice over item price', () => {
    const items: CartItemLike[] = [
      { id: 1, manual_unit_price: null },
    ];
    expect(allItemsHavePrices(items, { 1: '500' }, 'cash')).toBe(true);
  });

  it('returns false when editingManualPrice is empty string', () => {
    const items: CartItemLike[] = [
      { id: 1, manual_unit_price: 100 },
    ];
    expect(allItemsHavePrices(items, { 1: '' }, 'cash')).toBe(false);
  });
});
