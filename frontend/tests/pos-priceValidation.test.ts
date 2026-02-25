import { describe, it, expect } from 'vitest'
import {
  getMinPrice,
  getPriceValidationError,
  getEffectivePrice,
  allItemsHavePrices,
  type CartItemLike,
} from '../src/pages/pos/priceValidation'

const item = (overrides: Partial<CartItemLike> = {}): CartItemLike => ({
  id: 1,
  manual_unit_price: 100,
  product_selling_price: null,
  product_purchase_price: 50,
  product_can_go_below_purchase_price: false,
  ...overrides,
})

describe('getMinPrice', () => {
  it('custom product: uses product_purchase_price from item (API sends cart item purchase_price)', () => {
    expect(getMinPrice(item({ product_selling_price: null, product_purchase_price: 50 }))).toEqual({
      minPrice: 50,
      priceType: 'purchase price',
    })
  })

  it('uses selling price when set and > 0', () => {
    expect(getMinPrice(item({ product_selling_price: 120, product_purchase_price: 50 }))).toEqual({
      minPrice: 120,
      priceType: 'selling price',
    })
  })

  it('uses purchase price when selling price is null', () => {
    expect(getMinPrice(item({ product_selling_price: null, product_purchase_price: 80 }))).toEqual({
      minPrice: 80,
      priceType: 'purchase price',
    })
  })

  it('uses purchase price when selling price is 0', () => {
    expect(getMinPrice(item({ product_selling_price: 0, product_purchase_price: 80 }))).toEqual({
      minPrice: 80,
      priceType: 'purchase price',
    })
  })

  it('returns 0 and purchase price type when both are 0 or missing', () => {
    expect(getMinPrice(item({ product_selling_price: null, product_purchase_price: 0 }))).toEqual({
      minPrice: 0,
      priceType: 'purchase price',
    })
    expect(getMinPrice(item({ product_selling_price: null, product_purchase_price: undefined }))).toEqual({
      minPrice: 0,
      priceType: 'purchase price',
    })
  })

  it('handles string numeric values', () => {
    expect(getMinPrice(item({ product_selling_price: '99.5', product_purchase_price: '40' }))).toEqual({
      minPrice: 99.5,
      priceType: 'selling price',
    })
  })
})

describe('getPriceValidationError', () => {
  it('returns null for pending invoice type', () => {
    expect(
      getPriceValidationError(10, item({ product_purchase_price: 100, product_can_go_below_purchase_price: false }), 'pending')
    ).toBe(null)
  })

  it('returns null when can_go_below_purchase_price is true', () => {
    expect(
      getPriceValidationError(10, item({ product_purchase_price: 100, product_can_go_below_purchase_price: true }), 'cash')
    ).toBe(null)
  })

  it('returns error when price is below min and can_go_below is false (cash)', () => {
    const err = getPriceValidationError(
      40,
      item({ product_purchase_price: 100, product_can_go_below_purchase_price: false }),
      'cash'
    )
    expect(err).toContain('Price cannot be less than')
    expect(err).toContain('purchase price')
    expect(err).toContain('100')
  })

  it('returns error when price is below selling price and can_go_below is false', () => {
    const err = getPriceValidationError(
      80,
      item({
        product_selling_price: 150,
        product_purchase_price: 50,
        product_can_go_below_purchase_price: false,
      }),
      'upi'
    )
    expect(err).toContain('selling price')
    expect(err).toContain('150')
  })

  it('returns null when price equals min', () => {
    expect(
      getPriceValidationError(100, item({ product_purchase_price: 100, product_can_go_below_purchase_price: false }), 'cash')
    ).toBe(null)
  })

  it('returns null when price is above min', () => {
    expect(
      getPriceValidationError(150, item({ product_purchase_price: 100, product_can_go_below_purchase_price: false }), 'mixed')
    ).toBe(null)
  })

  it('returns null when minPrice is 0 (cannot validate)', () => {
    expect(
      getPriceValidationError(0, item({ product_purchase_price: 0, product_can_go_below_purchase_price: false }), 'cash')
    ).toBe(null)
  })

  it('custom product: selling price equal to purchase price (e.g. 50 vs 50) is valid', () => {
    expect(
      getPriceValidationError(
        50,
        item({ product_purchase_price: 50, product_can_go_below_purchase_price: false }),
        'cash'
      )
    ).toBe(null)
  })

  it('custom product: selling below purchase when can_go_below false gives error', () => {
    const err = getPriceValidationError(
      40,
      item({ product_purchase_price: 50, product_can_go_below_purchase_price: false }),
      'cash'
    )
    expect(err).toContain('purchase price')
    expect(err).toContain('50')
  })
})

describe('getEffectivePrice', () => {
  it('uses editing price when provided and non-empty', () => {
    expect(getEffectivePrice(item({ manual_unit_price: 100 }), '200')).toBe(200)
    expect(getEffectivePrice(item({ manual_unit_price: 100 }), '99.5')).toBe(99.5)
  })

  it('uses manual_unit_price when editing not provided', () => {
    expect(getEffectivePrice(item({ manual_unit_price: 100 }))).toBe(100)
    expect(getEffectivePrice(item({ manual_unit_price: 99.5 }))).toBe(99.5)
  })

  it('returns 0 when editing is empty string', () => {
    expect(getEffectivePrice(item({ manual_unit_price: 100 }), '')).toBe(0)
  })

  it('returns 0 when manual_unit_price is null/undefined/empty', () => {
    expect(getEffectivePrice(item({ manual_unit_price: null }))).toBe(0)
    expect(getEffectivePrice(item({ manual_unit_price: undefined }))).toBe(0)
    expect(getEffectivePrice(item({ manual_unit_price: '' }))).toBe(0)
  })

  it('handles string manual_unit_price', () => {
    expect(getEffectivePrice(item({ manual_unit_price: '123.45' }))).toBe(123.45)
  })

  it('returns 0 for NaN editing value', () => {
    expect(getEffectivePrice(item({ manual_unit_price: 100 }), 'abc')).toBe(0)
  })

  it('partial input (e.g. "5" while typing "50") returns that number for validation', () => {
    expect(getEffectivePrice(item({ manual_unit_price: 0 }), '5')).toBe(5)
    expect(getEffectivePrice(item({ manual_unit_price: 100 }), '50')).toBe(50)
  })
})

describe('allItemsHavePrices', () => {
  it('returns true for pending invoice type', () => {
    expect(allItemsHavePrices([item({ manual_unit_price: 0 })], {}, 'pending')).toBe(true)
  })

  it('returns true for empty items', () => {
    expect(allItemsHavePrices([], {}, 'cash')).toBe(true)
  })

  it('returns false when any item has zero effective price (cash)', () => {
    expect(
      allItemsHavePrices(
        [item({ id: 1, manual_unit_price: 100 }), item({ id: 2, manual_unit_price: 0 })],
        {},
        'cash'
      )
    ).toBe(false)
  })

  it('returns true when all items have positive price', () => {
    expect(
      allItemsHavePrices(
        [item({ id: 1, manual_unit_price: 100 }), item({ id: 2, manual_unit_price: 50 })],
        {},
        'cash'
      )
    ).toBe(true)
  })

  it('uses editing price when present', () => {
    expect(
      allItemsHavePrices(
        [item({ id: 1, manual_unit_price: 0 })],
        { 1: '100' },
        'cash'
      )
    ).toBe(true)
  })

  it('editing empty string counts as 0', () => {
    expect(
      allItemsHavePrices(
        [item({ id: 1, manual_unit_price: 100 })],
        { 1: '' },
        'cash'
      )
    ).toBe(false)
  })
})
