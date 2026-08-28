import { describe, it, expect } from 'vitest'
import { resolveExportPrices } from '../src/utils/exportProductsPdf'

describe('resolveExportPrices', () => {
  it('reads purchase and selling prices from supplier breakdown', () => {
    const prices = resolveExportPrices({
      purchase_price: null,
      selling_price: null,
      supplier_breakdown: [
        { purchase_price_value: 500, selling_price_value: 650 },
        { purchase_price_value: 665, selling_price_value: 0 },
      ],
    })

    expect(prices.purchasePrice).toBe(665)
    expect(prices.sellingPrice).toBe(650)
    expect(prices.effectiveSellingPrice).toBe(650)
    expect(prices.sellingFellBackToPurchase).toBe(false)
  })

  it('falls back to top-level product prices when breakdown is empty', () => {
    const prices = resolveExportPrices({
      purchase_price: 400,
      selling_price: 480,
      supplier_breakdown: [],
    })

    expect(prices.purchasePrice).toBe(400)
    expect(prices.sellingPrice).toBe(480)
    expect(prices.effectiveSellingPrice).toBe(480)
  })

  it('uses purchase price when selling is missing', () => {
    const prices = resolveExportPrices({
      purchase_price: 400,
      selling_price: null,
      supplier_breakdown: [{ purchase_price_value: 400, selling_price_value: 0 }],
    })

    expect(prices.purchasePrice).toBe(400)
    expect(prices.sellingPrice).toBeNull()
    expect(prices.effectiveSellingPrice).toBe(400)
    expect(prices.sellingFellBackToPurchase).toBe(true)
  })

  it('returns nulls for lite payloads that omit prices', () => {
    const prices = resolveExportPrices({
      purchase_price: null,
      selling_price: null,
      supplier_breakdown: [],
    })

    expect(prices.purchasePrice).toBeNull()
    expect(prices.sellingPrice).toBeNull()
    expect(prices.effectiveSellingPrice).toBeNull()
  })
})
