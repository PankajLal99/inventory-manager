import {
  getProductNameColor,
  PRODUCT_NAME_COLOR_NON_PESTING,
  PRODUCT_NAME_COLOR_PESTING,
  formatNumber,
  formatAmountINR,
  amountForInput,
  canEditLedgerEntry,
  toLocalDateString,
  formatDateDDMMYYYY,
  formatDateOnlyDisplay,
  dateStringWithCurrentTimeISO,
  dateStringToLocalMidnightISO,
  getTodayDateString,
  getShiftedLocalDateString,
  getDateRangeByPreset,
  normalizeDateRange,
  getStockInfo,
} from '../../src/utils/formatting';

// ─── getProductNameColor ───────────────────────────────────────

describe('getProductNameColor', () => {
  it('returns red for NON PESTING products', () => {
    expect(getProductNameColor('WIRE NON PESTING 2.5MM')).toBe(PRODUCT_NAME_COLOR_NON_PESTING);
  });

  it('is case-insensitive', () => {
    expect(getProductNameColor('Wire non pesting 4mm')).toBe(PRODUCT_NAME_COLOR_NON_PESTING);
  });

  it('returns green for PESTING products (without NON prefix)', () => {
    expect(getProductNameColor('WIRE PESTING 2.5MM')).toBe(PRODUCT_NAME_COLOR_PESTING);
  });

  it('prioritizes NON PESTING over PESTING', () => {
    // "NON PESTING" contains "PESTING", but includes() for NON PESTING is checked first
    expect(getProductNameColor('NON PESTING WIRE')).toBe(PRODUCT_NAME_COLOR_NON_PESTING);
  });

  it('returns undefined for ordinary products', () => {
    expect(getProductNameColor('Regular Wire 2.5MM')).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(getProductNameColor(null)).toBeUndefined();
    expect(getProductNameColor(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getProductNameColor('')).toBeUndefined();
  });
});

// ─── formatNumber ──────────────────────────────────────────────

describe('formatNumber', () => {
  it('formats basic numbers', () => {
    expect(formatNumber(1234.567)).toMatch(/1[,.]?234\.57/);
  });

  it('handles string input', () => {
    expect(formatNumber('42.5')).toMatch(/42\.5/);
  });

  it('returns "0" for null/undefined/NaN', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber('abc')).toBe('0');
  });

  it('respects decimal places', () => {
    const result = formatNumber(1.23456, 4);
    expect(result).toMatch(/1\.2346/);
  });

  it('formats without commas when useCommas=false', () => {
    const result = formatNumber(12345.67, 2, false);
    expect(result).toBe('12345.67');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('handles negative numbers', () => {
    const result = formatNumber(-500);
    expect(result).toMatch(/-500/);
  });
});

// ─── formatAmountINR ───────────────────────────────────────────

describe('formatAmountINR', () => {
  it('formats amount with Indian locale', () => {
    // en-IN: 1,23,456.78
    const result = formatAmountINR(123456.78);
    expect(result).toMatch(/1.*23.*456/); // flexible for locale differences
  });

  it('returns "0" for null/undefined', () => {
    expect(formatAmountINR(null)).toBe('0');
    expect(formatAmountINR(undefined)).toBe('0');
  });

  it('returns "0" for NaN string', () => {
    expect(formatAmountINR('xyz')).toBe('0');
  });

  it('handles string input', () => {
    const result = formatAmountINR('1000');
    expect(result).toMatch(/1.*000/);
  });
});

// ─── amountForInput ────────────────────────────────────────────

describe('amountForInput', () => {
  it('returns empty string for null/undefined', () => {
    expect(amountForInput(null)).toBe('');
    expect(amountForInput(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(amountForInput('')).toBe('');
  });

  it('returns integer string for whole numbers', () => {
    expect(amountForInput(100)).toBe('100');
    expect(amountForInput(100.0)).toBe('100');
  });

  it('preserves decimals for fractional numbers', () => {
    expect(amountForInput(99.5)).toBe('99.5');
  });

  it('handles string input', () => {
    expect(amountForInput('250')).toBe('250');
    expect(amountForInput('250.75')).toBe('250.75');
  });

  it('returns empty for NaN string', () => {
    expect(amountForInput('abc')).toBe('');
  });
});

// ─── canEditLedgerEntry ────────────────────────────────────────

describe('canEditLedgerEntry', () => {
  it('returns true when entry has no invoice', () => {
    expect(canEditLedgerEntry({ invoice: null })).toBe(true);
    expect(canEditLedgerEntry({ invoice: undefined })).toBe(true);
    expect(canEditLedgerEntry({})).toBe(true);
  });

  it('returns false when entry has an invoice', () => {
    expect(canEditLedgerEntry({ invoice: 123 })).toBe(false);
  });
});

// ─── toLocalDateString ─────────────────────────────────────────

describe('toLocalDateString', () => {
  it('converts Date to YYYY-MM-DD', () => {
    const date = new Date(2025, 0, 15); // Jan 15, 2025
    expect(toLocalDateString(date)).toBe('2025-01-15');
  });

  it('parses YYYY-MM-DD string', () => {
    expect(toLocalDateString('2025-03-01')).toBe('2025-03-01');
  });

  it('returns empty for null/undefined', () => {
    expect(toLocalDateString(null)).toBe('');
    expect(toLocalDateString(undefined)).toBe('');
  });

  it('handles ISO string with time', () => {
    expect(toLocalDateString('2025-06-15T10:30:00Z')).toBe('2025-06-15');
  });
});

// ─── formatDateDDMMYYYY ────────────────────────────────────────

describe('formatDateDDMMYYYY', () => {
  it('formats date as DD/MM/YYYY', () => {
    expect(formatDateDDMMYYYY('2025-01-05')).toBe('05/01/2025');
  });

  it('formats Date object', () => {
    const date = new Date(2025, 11, 25); // Dec 25, 2025
    expect(formatDateDDMMYYYY(date)).toBe('25/12/2025');
  });

  it('returns empty for null', () => {
    expect(formatDateDDMMYYYY(null)).toBe('');
  });
});

// ─── formatDateOnlyDisplay ─────────────────────────────────────

describe('formatDateOnlyDisplay', () => {
  it('returns locale string for valid YYYY-MM-DD', () => {
    const result = formatDateOnlyDisplay('2025-01-15');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns empty for invalid format', () => {
    expect(formatDateOnlyDisplay('15-01-2025')).toBe('');
    expect(formatDateOnlyDisplay('2025-1-5')).toBe('');
  });

  it('returns empty for null/undefined', () => {
    expect(formatDateOnlyDisplay(null)).toBe('');
    expect(formatDateOnlyDisplay(undefined)).toBe('');
  });
});

// ─── dateStringWithCurrentTimeISO ──────────────────────────────

describe('dateStringWithCurrentTimeISO', () => {
  it('returns ISO string with current time for valid date', () => {
    const result = dateStringWithCurrentTimeISO('2025-07-04');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns empty for invalid date', () => {
    expect(dateStringWithCurrentTimeISO('')).toBe('');
    expect(dateStringWithCurrentTimeISO('invalid')).toBe('');
  });
});

// ─── dateStringToLocalMidnightISO ──────────────────────────────

describe('dateStringToLocalMidnightISO', () => {
  it('returns ISO string at midnight for valid date', () => {
    const result = dateStringToLocalMidnightISO('2025-07-04');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns empty for invalid date', () => {
    expect(dateStringToLocalMidnightISO('')).toBe('');
  });
});

// ─── getTodayDateString / getShiftedLocalDateString ────────────

describe('getTodayDateString', () => {
  it('returns today in YYYY-MM-DD format', () => {
    const ref = new Date(2025, 5, 15); // June 15, 2025
    expect(getTodayDateString(ref)).toBe('2025-06-15');
  });
});

describe('getShiftedLocalDateString', () => {
  it('shifts date by given days', () => {
    const ref = new Date(2025, 0, 10); // Jan 10
    expect(getShiftedLocalDateString(-3, ref)).toBe('2025-01-07');
    expect(getShiftedLocalDateString(5, ref)).toBe('2025-01-15');
  });

  it('handles month boundary', () => {
    const ref = new Date(2025, 0, 31); // Jan 31
    expect(getShiftedLocalDateString(1, ref)).toBe('2025-02-01');
  });
});

// ─── getDateRangeByPreset ──────────────────────────────────────

describe('getDateRangeByPreset', () => {
  const ref = new Date(2025, 5, 15); // June 15, 2025

  it('returns same day for one_day', () => {
    const result = getDateRangeByPreset('one_day', ref);
    expect(result.startDate).toBe('2025-06-15');
    expect(result.endDate).toBe('2025-06-15');
  });

  it('returns 7 day range for last_7_days', () => {
    const result = getDateRangeByPreset('last_7_days', ref);
    expect(result.startDate).toBe('2025-06-09');
    expect(result.endDate).toBe('2025-06-15');
  });

  it('returns 30 day range for last_30_days', () => {
    const result = getDateRangeByPreset('last_30_days', ref);
    expect(result.startDate).toBe('2025-05-17');
    expect(result.endDate).toBe('2025-06-15');
  });
});

// ─── normalizeDateRange ────────────────────────────────────────

describe('normalizeDateRange', () => {
  it('returns range as-is if already ordered', () => {
    const range = { startDate: '2025-01-01', endDate: '2025-01-31' };
    expect(normalizeDateRange(range)).toEqual(range);
  });

  it('swaps dates if inverted', () => {
    const range = { startDate: '2025-01-31', endDate: '2025-01-01' };
    expect(normalizeDateRange(range)).toEqual({ startDate: '2025-01-01', endDate: '2025-01-31' });
  });

  it('returns as-is if start or end is empty', () => {
    const range = { startDate: '', endDate: '2025-01-31' };
    expect(normalizeDateRange(range)).toEqual(range);
  });
});

// ─── getStockInfo ──────────────────────────────────────────────

describe('getStockInfo', () => {
  it('returns zero stock for custom products', () => {
    const product = { name: 'Other - Custom Item' };
    const info = getStockInfo(product);
    expect(info.available).toBe(0);
    expect(info.total).toBe(0);
    expect(info.isOutOfStock).toBe(false);
    expect(info.isLowStock).toBe(false);
  });

  it('calculates stock for normal products', () => {
    const product = {
      name: 'Regular Wire',
      available_quantity: 50,
      stock_quantity: 100,
      low_stock_threshold: 10,
    };
    const info = getStockInfo(product);
    expect(info.available).toBe(50);
    expect(info.total).toBe(100);
    expect(info.isOutOfStock).toBe(false);
    expect(info.isLowStock).toBe(false);
  });

  it('detects out of stock', () => {
    const product = {
      name: 'Wire',
      available_quantity: 0,
      stock_quantity: 100,
      low_stock_threshold: 10,
    };
    const info = getStockInfo(product);
    expect(info.isOutOfStock).toBe(true);
    expect(info.isLowStock).toBe(false);
  });

  it('detects low stock', () => {
    const product = {
      name: 'Wire',
      available_quantity: 5,
      stock_quantity: 100,
      low_stock_threshold: 10,
    };
    const info = getStockInfo(product);
    expect(info.isLowStock).toBe(true);
    expect(info.isOutOfStock).toBe(false);
  });

  it('handles string quantities', () => {
    const product = {
      name: 'Wire',
      available_quantity: '25',
      stock_quantity: '50',
      low_stock_threshold: '5',
    };
    const info = getStockInfo(product);
    expect(info.available).toBe(25);
    expect(info.total).toBe(50);
  });

  it('clamps negative available to 0', () => {
    const product = {
      name: 'Wire',
      available_quantity: -5,
      stock_quantity: 10,
    };
    const info = getStockInfo(product);
    expect(info.available).toBe(0);
    expect(info.isOutOfStock).toBe(true);
  });
});
