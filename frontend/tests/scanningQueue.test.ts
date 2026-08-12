import { describe, it, expect } from 'vitest'
import {
  parseBarcodesFromInput,
  looksLikeBarcode,
  isBarcodeAlreadyOnInvoiceItems,
  normalizeBarcodeKey,
  sanitizeScannedBarcode,
} from '../src/lib/scanningQueue'

describe('parseBarcodesFromInput', () => {
  it('returns empty array for empty or whitespace-only input', () => {
    expect(parseBarcodesFromInput('')).toEqual([])
    expect(parseBarcodesFromInput('   ')).toEqual([])
    expect(parseBarcodesFromInput('\n\n')).toEqual([])
    expect(parseBarcodesFromInput('  \n  \n  ')).toEqual([])
  })

  it('returns single barcode when no separators', () => {
    expect(parseBarcodesFromInput('123456789')).toEqual(['123456789'])
    expect(parseBarcodesFromInput('  ABC-123  ')).toEqual(['ABC-123'])
  })

  it('splits by newlines', () => {
    expect(parseBarcodesFromInput('A\nB\nC')).toEqual(['A', 'B', 'C'])
    expect(parseBarcodesFromInput('code1\ncode2')).toEqual(['CODE1', 'CODE2'])
  })

  it('splits by pipe', () => {
    expect(parseBarcodesFromInput('A|B|C')).toEqual(['A', 'B', 'C'])
    expect(parseBarcodesFromInput('x|y')).toEqual(['X', 'Y'])
  })

  it('splits by mixed newlines and pipes', () => {
    expect(parseBarcodesFromInput('a\nb|c\nd')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('trims each segment', () => {
    expect(parseBarcodesFromInput('  a  \n  b  \n  c  ')).toEqual(['A', 'B', 'C'])
    expect(parseBarcodesFromInput(' x | y ')).toEqual(['X', 'Y'])
  })

  it('strips scanner-inserted spaces inside a barcode', () => {
    expect(parseBarcodesFromInput('ON/ -0185')).toEqual(['ON/-0185'])
    expect(parseBarcodesFromInput('  ON/ -0185  \nABC- 1')).toEqual(['ON/-0185', 'ABC-1'])
  })

  it('filters out empty segments after trim', () => {
    expect(parseBarcodesFromInput('a\n\nb\n\nc')).toEqual(['A', 'B', 'C'])
    expect(parseBarcodesFromInput('a||b')).toEqual(['A', 'B'])
  })

  it('handles null/undefined by returning empty array', () => {
    expect(parseBarcodesFromInput(null as any)).toEqual([])
    expect(parseBarcodesFromInput(undefined as any)).toEqual([])
  })
})

describe('looksLikeBarcode', () => {
  it('returns false for empty or too short input', () => {
    expect(looksLikeBarcode('')).toBe(false)
    expect(looksLikeBarcode('ab')).toBe(false)
    expect(looksLikeBarcode('12')).toBe(false)
  })

  it('returns false for input with spaces or special chars', () => {
    expect(looksLikeBarcode('abc def')).toBe(false)
    expect(looksLikeBarcode('product name')).toBe(false)
    expect(looksLikeBarcode('sku: 123')).toBe(false)
  })

  it('returns true for typical barcode-like strings (alphanumeric, hyphens, underscores)', () => {
    expect(looksLikeBarcode('1234567890123')).toBe(true)
    expect(looksLikeBarcode('ABC-123-XYZ')).toBe(true)
    expect(looksLikeBarcode('CODE_123')).toBe(true)
    expect(looksLikeBarcode('abcd')).toBe(true) // length >= 4
  })

  it('returns true for barcodes that include a slash', () => {
    expect(looksLikeBarcode('ON/-0185')).toBe(true)
    expect(looksLikeBarcode('ON/ -0185')).toBe(true)
  })

  it('returns true for 3-char strings that contain hyphen or underscore', () => {
    expect(looksLikeBarcode('a-b')).toBe(true)
    expect(looksLikeBarcode('x_y')).toBe(true)
  })

  it('returns false for 3-char plain alphanumeric (ambiguous with search)', () => {
    expect(looksLikeBarcode('abc')).toBe(false) // no - or _, length 3
    expect(looksLikeBarcode('123')).toBe(false)
  })
})

describe('sanitizeScannedBarcode', () => {
  it('strips scanner spaces and uppercases', () => {
    expect(sanitizeScannedBarcode('ON/ -0185')).toBe('ON/-0185')
    expect(sanitizeScannedBarcode('  on/-0185  ')).toBe('ON/-0185')
    expect(sanitizeScannedBarcode('ABC-\t0001')).toBe('ABC-0001')
  })

  it('returns empty string for blank input', () => {
    expect(sanitizeScannedBarcode('')).toBe('')
    expect(sanitizeScannedBarcode('   ')).toBe('')
  })
})

describe('normalizeBarcodeKey', () => {
  it('trims and uppercases barcode values', () => {
    expect(normalizeBarcodeKey('  sc-1  ')).toBe('SC-1')
  })

  it('treats scanner-inserted spaces as the same key', () => {
    expect(normalizeBarcodeKey('ON/ -0185')).toBe('ON/-0185')
    expect(normalizeBarcodeKey('ON/-0185')).toBe('ON/-0185')
  })
})

describe('isBarcodeAlreadyOnInvoiceItems', () => {
  it('detects duplicate by barcode_id', () => {
    const items = [{ barcode_id: 42, barcode_value: 'SC-1' }]
    expect(isBarcodeAlreadyOnInvoiceItems('sc-1', items, { barcode_id: 42 })).toBe(true)
  })

  it('detects duplicate by short code on line', () => {
    const items = [{ barcode_value: 'SC-INV' }]
    expect(isBarcodeAlreadyOnInvoiceItems('sc-inv', items)).toBe(true)
  })

  it('returns false when barcode is not on invoice', () => {
    const items = [{ barcode_value: 'OTHER-1', barcode_id: 9 }]
    expect(isBarcodeAlreadyOnInvoiceItems('NEW-1', items, { barcode_id: 10 })).toBe(false)
  })

  it('does not treat shared product_sku as duplicate barcode', () => {
    const items = [{ barcode_value: 'BC-001', barcode_id: 1, product_sku: 'SHARED-SKU' }]
    expect(isBarcodeAlreadyOnInvoiceItems('BC-002', items, { barcode_id: 2 })).toBe(false)
  })
})
