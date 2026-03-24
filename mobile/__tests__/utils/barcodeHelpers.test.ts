import { parseBarcodesFromInput, looksLikeBarcode } from '../../src/utils/barcodeHelpers';

// ─── parseBarcodesFromInput ────────────────────────────────────

describe('parseBarcodesFromInput', () => {
  it('splits by newlines', () => {
    expect(parseBarcodesFromInput('ABC123\nDEF456\nGHI789')).toEqual([
      'ABC123',
      'DEF456',
      'GHI789',
    ]);
  });

  it('splits by pipe character', () => {
    expect(parseBarcodesFromInput('ABC123|DEF456|GHI789')).toEqual([
      'ABC123',
      'DEF456',
      'GHI789',
    ]);
  });

  it('trims whitespace', () => {
    expect(parseBarcodesFromInput('  ABC123  \n  DEF456  ')).toEqual([
      'ABC123',
      'DEF456',
    ]);
  });

  it('filters empty segments', () => {
    expect(parseBarcodesFromInput('ABC123\n\n\nDEF456')).toEqual([
      'ABC123',
      'DEF456',
    ]);
  });

  it('returns empty array for empty/null input', () => {
    expect(parseBarcodesFromInput('')).toEqual([]);
    expect(parseBarcodesFromInput(null as any)).toEqual([]);
    expect(parseBarcodesFromInput(undefined as any)).toEqual([]);
  });

  it('handles single barcode', () => {
    expect(parseBarcodesFromInput('SINGLE123')).toEqual(['SINGLE123']);
  });

  it('handles mixed delimiters', () => {
    expect(parseBarcodesFromInput('A1|B2\nC3')).toEqual(['A1', 'B2', 'C3']);
  });
});

// ─── looksLikeBarcode ──────────────────────────────────────────

describe('looksLikeBarcode', () => {
  it('returns true for typical barcode strings', () => {
    expect(looksLikeBarcode('ABC12345')).toBe(true);
    expect(looksLikeBarcode('1234567890')).toBe(true);
    expect(looksLikeBarcode('SKU-001')).toBe(true);
    expect(looksLikeBarcode('ITEM_123')).toBe(true);
  });

  it('returns false for short strings (< 3 chars)', () => {
    expect(looksLikeBarcode('AB')).toBe(false);
    expect(looksLikeBarcode('A')).toBe(false);
    expect(looksLikeBarcode('')).toBe(false);
  });

  it('returns false for strings with spaces (free-text search)', () => {
    expect(looksLikeBarcode('search term')).toBe(false);
    expect(looksLikeBarcode('wire 2.5mm')).toBe(false);
  });

  it('returns false for strings with special characters', () => {
    expect(looksLikeBarcode('abc@def')).toBe(false);
    expect(looksLikeBarcode('abc.def')).toBe(false);
  });

  it('returns true for 3-char strings with dash/underscore', () => {
    expect(looksLikeBarcode('A-B')).toBe(true);
    expect(looksLikeBarcode('A_B')).toBe(true);
  });

  it('returns false for 3-char strings without dash/underscore', () => {
    expect(looksLikeBarcode('ABC')).toBe(false);
  });

  it('returns true for 4+ char alphanumeric strings', () => {
    expect(looksLikeBarcode('ABCD')).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(looksLikeBarcode(null as any)).toBe(false);
    expect(looksLikeBarcode(undefined as any)).toBe(false);
  });
});
