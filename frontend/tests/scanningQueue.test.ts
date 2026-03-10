import { describe, it, expect } from 'vitest'
import { parseBarcodesFromInput, looksLikeBarcode } from '../src/lib/scanningQueue'

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
    expect(parseBarcodesFromInput('code1\ncode2')).toEqual(['code1', 'code2'])
  })

  it('splits by pipe', () => {
    expect(parseBarcodesFromInput('A|B|C')).toEqual(['A', 'B', 'C'])
    expect(parseBarcodesFromInput('x|y')).toEqual(['x', 'y'])
  })

  it('splits by mixed newlines and pipes', () => {
    expect(parseBarcodesFromInput('a\nb|c\nd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('trims each segment', () => {
    expect(parseBarcodesFromInput('  a  \n  b  \n  c  ')).toEqual(['a', 'b', 'c'])
    expect(parseBarcodesFromInput(' x | y ')).toEqual(['x', 'y'])
  })

  it('filters out empty segments after trim', () => {
    expect(parseBarcodesFromInput('a\n\nb\n\nc')).toEqual(['a', 'b', 'c'])
    expect(parseBarcodesFromInput('a||b')).toEqual(['a', 'b'])
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

  it('returns true for 3-char strings that contain hyphen or underscore', () => {
    expect(looksLikeBarcode('a-b')).toBe(true)
    expect(looksLikeBarcode('x_y')).toBe(true)
  })

  it('returns false for 3-char plain alphanumeric (ambiguous with search)', () => {
    expect(looksLikeBarcode('abc')).toBe(false) // no - or _, length 3
    expect(looksLikeBarcode('123')).toBe(false)
  })
})
