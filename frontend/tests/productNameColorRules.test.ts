import { describe, it, expect } from 'vitest'
import {
  PRODUCT_NAME_COLOR_NON_PESTING,
  PRODUCT_NAME_COLOR_PESTING,
  resolveProductNameSuperColor,
  resolveProductNameColor,
  resolveCustomWholeLineColor,
  buildProductNameSegments,
  formatProductNameHtml,
  normalizeCustomKeywordRules,
  type ProductNameColorRule,
} from '../src/lib/productNameColorRules'

describe('resolveProductNameSuperColor', () => {
  it('returns undefined for null, undefined, or non-string', () => {
    expect(resolveProductNameSuperColor(null)).toBeUndefined()
    expect(resolveProductNameSuperColor(undefined)).toBeUndefined()
    expect(resolveProductNameSuperColor(1 as any)).toBeUndefined()
  })

  it('returns red/green for NON PESTING / PESTING (whole line)', () => {
    expect(resolveProductNameSuperColor('NON PESTING')).toBe(PRODUCT_NAME_COLOR_NON_PESTING)
    expect(resolveProductNameSuperColor('PESTING')).toBe(PRODUCT_NAME_COLOR_PESTING)
    expect(resolveProductNameSuperColor('NON PESTING PESTING')).toBe(PRODUCT_NAME_COLOR_NON_PESTING)
    expect(resolveProductNameSuperColor('Regular Product')).toBeUndefined()
  })
})

describe('resolveProductNameColor', () => {
  it('prefers custom whole_line rules over super rules', () => {
    const rules: ProductNameColorRule[] = [
      { id: 'vip', keyword: 'VIP', color: '#2563eb', scope: 'whole_line' },
    ]
    expect(resolveCustomWholeLineColor('VIP PESTING item', rules)).toBe('#2563eb')
    expect(resolveProductNameSuperColor('VIP PESTING item')).toBe(PRODUCT_NAME_COLOR_PESTING)
    expect(buildProductNameSegments('VIP PESTING item', rules)).toEqual([
      { text: 'VIP PESTING item', color: '#2563eb' },
    ])
  })

  it('falls back to super rules when no whole_line custom rule matches', () => {
    expect(resolveProductNameColor('PESTING item')).toBe(PRODUCT_NAME_COLOR_PESTING)
  })
})

describe('buildProductNameSegments', () => {
  const keywordRules: ProductNameColorRule[] = [
    { id: 'imported', keyword: 'IMPORTED', color: '#2563eb', scope: 'keyword' },
  ]

  it('colors only the keyword when scope is keyword', () => {
    const segments = buildProductNameSegments('IMPORTED fresh tomato', keywordRules)
    expect(segments).toEqual([
      { text: 'IMPORTED', color: '#2563eb' },
      { text: ' fresh tomato' },
    ])
  })

  it('applies super line color to non-keyword text when both apply', () => {
    const segments = buildProductNameSegments('IMPORTED PESTING tomato', keywordRules)
    expect(segments).toEqual([
      { text: 'IMPORTED', color: '#2563eb' },
      { text: ' PESTING tomato', color: PRODUCT_NAME_COLOR_PESTING },
    ])
  })

  it('uses whole-line super color when no custom keyword matches', () => {
    expect(buildProductNameSegments('NON PESTING item')).toEqual([
      { text: 'NON PESTING item', color: PRODUCT_NAME_COLOR_NON_PESTING },
    ])
  })

  it('whole_line custom rule bypasses super rules', () => {
    const rules: ProductNameColorRule[] = [
      { id: 'special', keyword: 'SPECIAL', color: '#111111', scope: 'whole_line' },
    ]
    expect(buildProductNameSegments('SPECIAL NON PESTING', rules)).toEqual([
      { text: 'SPECIAL NON PESTING', color: '#111111' },
    ])
  })
})

describe('formatProductNameHtml', () => {
  it('wraps super and keyword segments', () => {
    const html = formatProductNameHtml('IMPORTED PESTING', [
      { id: 'i', keyword: 'IMPORTED', color: '#2563eb', scope: 'keyword' },
    ])
    expect(html).toContain('style="color:#2563eb"')
    expect(html).toContain('style="color:#418f28"')
  })

  it('escapes HTML in product names', () => {
    expect(formatProductNameHtml('<script>')).toBe('&lt;script&gt;')
  })
})

describe('normalizeCustomKeywordRules', () => {
  it('drops super keywords and invalid colors', () => {
    const rules = normalizeCustomKeywordRules([
      { id: '1', keyword: 'PESTING', color: '#418f28' },
      { id: '2', keyword: 'SPECIAL', color: 'bad' },
      { id: '3', keyword: 'SPECIAL', color: '#111111' },
    ])
    expect(rules).toEqual([{ id: '3', keyword: 'SPECIAL', color: '#111111', scope: 'keyword' }])
  })

  it('preserves whole_line scope', () => {
    const rules = normalizeCustomKeywordRules([
      { id: '1', keyword: 'VIP', color: '#2563eb', scope: 'whole_line' },
    ])
    expect(rules[0].scope).toBe('whole_line')
  })
})
