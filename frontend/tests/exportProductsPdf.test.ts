import { describe, it, expect, vi } from 'vitest'

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>()
  const Original = actual.default as unknown as new (...args: unknown[]) => { save: (name?: string) => void }
  return {
    ...actual,
    default: function MockedJsPDF(this: unknown, ...args: unknown[]) {
      const doc = new Original(...args)
      doc.save = () => undefined
      return doc
    },
  }
})

import {
  resolveExportPrices,
  groupProductsForPdfPages,
  chunkRowsForTwoColumns,
  getPdfDensityStyles,
  resolvePdfOrientation,
  estimateRowsPerColumn,
  normalizeProductPdfDensity,
  normalizeProductPdfPageBreak,
  DEFAULT_PRODUCT_PDF_DENSITY,
  DEFAULT_PRODUCT_PDF_PAGE_BREAK,
  exportProductsToPdf,
} from '../src/utils/exportProductsPdf'

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

const sampleProducts = [
  { name: 'Alpha', brand_name: 'Nike', category_name: 'Shoes' },
  { name: 'Beta', brand_name: 'Adidas', category_name: 'Shoes' },
  { name: 'Gamma', brand_name: 'Nike', category_name: 'Apparel' },
  { name: 'Delta', brand_name: 'Adidas', category_name: 'Apparel' },
]

describe('product PDF layout settings', () => {
  it('defaults to compact and brand page breaks', () => {
    expect(DEFAULT_PRODUCT_PDF_DENSITY).toBe('compact')
    expect(DEFAULT_PRODUCT_PDF_PAGE_BREAK).toBe('brand')
    expect(normalizeProductPdfDensity('nope')).toBe('compact')
    expect(normalizeProductPdfPageBreak('nope')).toBe('brand')
  })

  it('uses tighter padding for compact than spacious', () => {
    const spacious = getPdfDensityStyles('spacious')
    const compact = getPdfDensityStyles('compact')
    const high = getPdfDensityStyles('high_compact')
    expect(compact.cellPadding).toBeLessThan(spacious.cellPadding)
    expect(high.cellPadding).toBeLessThan(compact.cellPadding)
    expect(high.overflow).toBe('ellipsize')
  })

  it('uses portrait for high compact with the default column count', () => {
    expect(resolvePdfOrientation(4, 'high_compact')).toBe('portrait')
    expect(resolvePdfOrientation(7, 'high_compact')).toBe('landscape')
    expect(resolvePdfOrientation(7, 'compact')).toBe('landscape')
    expect(resolvePdfOrientation(4, 'compact')).toBe('portrait')
  })
})

describe('groupProductsForPdfPages', () => {
  it('starts a section per brand by default grouping', () => {
    const sections = groupProductsForPdfPages(sampleProducts, 'brand')
    expect(sections.map((s) => s.key)).toEqual(['Adidas', 'Nike'])
    expect(sections[0].label).toBe('Brand: Adidas')
    expect(sections[0].products.map((p) => p.name)).toEqual(['Delta', 'Beta'])
    expect(sections[1].products.map((p) => p.name)).toEqual(['Gamma', 'Alpha'])
  })

  it('starts a section per category', () => {
    const sections = groupProductsForPdfPages(sampleProducts, 'category')
    expect(sections.map((s) => s.key)).toEqual(['Apparel', 'Shoes'])
    expect(sections[0].label).toBe('Category: Apparel')
  })

  it('keeps a single flowing section when page break is none', () => {
    const sections = groupProductsForPdfPages(sampleProducts, 'none')
    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBeNull()
    expect(sections[0].products.map((p) => p.name)).toEqual(['Delta', 'Gamma', 'Beta', 'Alpha'])
  })
})

describe('chunkRowsForTwoColumns', () => {
  it('fills the left column first, then the right', () => {
    const pages = chunkRowsForTwoColumns([1, 2, 3, 4, 5], 3)
    expect(pages).toEqual([
      { left: [1, 2, 3], right: [4, 5] },
    ])
  })

  it('continues onto another page when both columns are full', () => {
    const pages = chunkRowsForTwoColumns([1, 2, 3, 4, 5, 6, 7], 3)
    expect(pages).toEqual([
      { left: [1, 2, 3], right: [4, 5, 6] },
      { left: [7], right: [] },
    ])
  })

  it('treats invalid rows-per-column as 1', () => {
    expect(chunkRowsForTwoColumns(['a', 'b'], 0)).toEqual([
      { left: ['a'], right: ['b'] },
    ])
  })
})

describe('estimateRowsPerColumn', () => {
  it('fits more rows when padding is smaller', () => {
    const spacious = estimateRowsPerColumn({
      pageHeight: 297,
      startY: 26,
      bottomMargin: 14,
      fontSize: 8,
      cellPadding: 2,
    })
    const compact = estimateRowsPerColumn({
      pageHeight: 297,
      startY: 26,
      bottomMargin: 10,
      fontSize: 7,
      cellPadding: 0.7,
    })
    expect(compact).toBeGreaterThan(spacious)
    expect(spacious).toBeGreaterThan(10)
  })
})

describe('exportProductsToPdf', () => {
  it('builds spacious, compact, and high-compact PDFs without throwing', () => {
    const products = Array.from({ length: 40 }, (_, i) => ({
      name: `Product ${i + 1}`,
      brand_name: i < 20 ? 'Nike' : 'Adidas',
      category_name: i % 2 === 0 ? 'Shoes' : 'Apparel',
      sku: `SKU-${i + 1}`,
      stock_quantity: 5,
      available_quantity: 5,
    }))

    const columnIds = ['sr', 'name', 'brand', 'category'] as const

    expect(() =>
      exportProductsToPdf({
        products,
        columnIds: [...columnIds],
        density: 'compact',
        pageBreak: 'brand',
      })
    ).not.toThrow()

    expect(() =>
      exportProductsToPdf({
        products,
        columnIds: [...columnIds],
        density: 'high_compact',
        pageBreak: 'brand',
      })
    ).not.toThrow()

    expect(() =>
      exportProductsToPdf({
        products,
        columnIds: [...columnIds],
        density: 'spacious',
        pageBreak: 'none',
      })
    ).not.toThrow()
  })
})
