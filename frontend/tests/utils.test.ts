import { describe, it, expect } from 'vitest'
import {
  formatNumber,
  formatAmountINR,
  canEditLedgerEntry,
  getProductNameColor,
  amountForInput,
  toLocalDateString,
  formatDateMMDDYYYY,
  formatDateOnlyDisplay,
  dateStringWithCurrentTimeISO,
  dateStringToLocalMidnightISO,
  getStockInfo,
} from '../src/lib/utils'

describe('formatNumber', () => {
  it('returns "0" for null and undefined', () => {
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
  })

  it('returns "0" for NaN', () => {
    expect(formatNumber(NaN)).toBe('0')
    expect(formatNumber('not a number')).toBe('0')
  })

  it('formats integers with commas', () => {
    expect(formatNumber(1000)).toBe('1,000')
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('strips unnecessary trailing zeros', () => {
    expect(formatNumber(10.0)).toBe('10')
    expect(formatNumber(10.5)).toBe('10.5')
    expect(formatNumber(10.50)).toBe('10.5')
  })

  it('respects decimals option', () => {
    expect(formatNumber(10.1234, 2)).toBe('10.12')
    expect(formatNumber(10.1234, 0)).toBe('10')
  })

  it('accepts string numbers', () => {
    expect(formatNumber('1234.56')).toBe('1,234.56')
  })
})

describe('formatAmountINR', () => {
  it('returns "0" for null and undefined', () => {
    expect(formatAmountINR(null)).toBe('0')
    expect(formatAmountINR(undefined)).toBe('0')
  })

  it('returns "0" for NaN', () => {
    expect(formatAmountINR(NaN)).toBe('0')
    expect(formatAmountINR('not a number')).toBe('0')
  })

  it('formats with Indian numbering (lakhs/crore style)', () => {
    expect(formatAmountINR(1234567.89)).toBe('12,34,567.89')
    expect(formatAmountINR(12345678.9)).toBe('1,23,45,678.9')
  })

  it('formats integers without decimals when whole', () => {
    expect(formatAmountINR(100)).toBe('100')
    expect(formatAmountINR(1000)).toBe('1,000')
  })

  it('respects decimals option', () => {
    expect(formatAmountINR(10.1234, 2)).toBe('10.12')
    expect(formatAmountINR(10.1, 0)).toBe('10')
  })

  it('accepts string numbers', () => {
    expect(formatAmountINR('1234567.89')).toBe('12,34,567.89')
  })
})

describe('canEditLedgerEntry', () => {
  it('returns true when entry has no invoice', () => {
    expect(canEditLedgerEntry({})).toBe(true)
    expect(canEditLedgerEntry({ invoice: null })).toBe(true)
    expect(canEditLedgerEntry({ invoice: undefined })).toBe(true)
  })

  it('returns false when entry has an invoice', () => {
    expect(canEditLedgerEntry({ invoice: 1 })).toBe(false)
    expect(canEditLedgerEntry({ invoice: 42 })).toBe(false)
  })
})

describe('getProductNameColor', () => {
  it('returns undefined for null, undefined, or non-string', () => {
    expect(getProductNameColor(null)).toBeUndefined()
    expect(getProductNameColor(undefined)).toBeUndefined()
    expect(getProductNameColor(1 as any)).toBeUndefined()
  })

  it('returns red for names containing "NON PESTING"', () => {
    expect(getProductNameColor('NON PESTING')).toBe('#be1129')
    expect(getProductNameColor('Item NON PESTING type')).toBe('#be1129')
  })

  it('returns green for names containing "PESTING" but not "NON PESTING"', () => {
    expect(getProductNameColor('PESTING')).toBe('#418f28')
    expect(getProductNameColor('PESTING product')).toBe('#418f28')
  })

  it('prefers NON PESTING when both are present', () => {
    expect(getProductNameColor('NON PESTING PESTING')).toBe('#be1129')
  })

  it('returns undefined when neither pattern matches', () => {
    expect(getProductNameColor('Regular Product')).toBeUndefined()
  })
})

describe('amountForInput', () => {
  it('returns empty string for null, undefined, empty string', () => {
    expect(amountForInput(null)).toBe('')
    expect(amountForInput(undefined)).toBe('')
    expect(amountForInput('')).toBe('')
  })

  it('returns whole number without decimals when value is integer', () => {
    expect(amountForInput(100)).toBe('100')
    expect(amountForInput(0)).toBe('0')
  })

  it('preserves decimals when value has fraction', () => {
    expect(amountForInput(99.5)).toBe('99.5')
    expect(amountForInput(10.25)).toBe('10.25')
  })

  it('returns empty string for NaN', () => {
    expect(amountForInput('abc')).toBe('')
  })

  it('accepts string numbers', () => {
    expect(amountForInput('123.45')).toBe('123.45')
  })
})

describe('toLocalDateString', () => {
  it('returns empty string for null and undefined', () => {
    expect(toLocalDateString(null)).toBe('')
    expect(toLocalDateString(undefined)).toBe('')
  })

  it('parses YYYY-MM-DD string as local date', () => {
    expect(toLocalDateString('2025-02-25')).toBe('2025-02-25')
  })

  it('returns YYYY-MM-DD for Date object', () => {
    const d = new Date(2025, 0, 15) // Jan 15, 2025
    expect(toLocalDateString(d)).toBe('2025-01-15')
  })

  it('returns empty string for invalid date', () => {
    expect(toLocalDateString('not-a-date')).toBe('')
  })
})

describe('formatDateMMDDYYYY', () => {
  it('returns empty string for null and undefined', () => {
    expect(formatDateMMDDYYYY(null)).toBe('')
    expect(formatDateMMDDYYYY(undefined)).toBe('')
  })

  it('formats YYYY-MM-DD as MM/DD/YYYY', () => {
    expect(formatDateMMDDYYYY('2025-02-25')).toBe('02/25/2025')
  })

  it('formats Date object as MM/DD/YYYY', () => {
    const d = new Date(2025, 0, 15)
    expect(formatDateMMDDYYYY(d)).toBe('01/15/2025')
  })
})

describe('formatDateOnlyDisplay', () => {
  it('returns empty string for null, undefined, or invalid format', () => {
    expect(formatDateOnlyDisplay(null)).toBe('')
    expect(formatDateOnlyDisplay(undefined)).toBe('')
    expect(formatDateOnlyDisplay('')).toBe('')
    expect(formatDateOnlyDisplay('25-02-2025')).toBe('')
  })

  it('returns locale date string for valid YYYY-MM-DD', () => {
    const result = formatDateOnlyDisplay('2025-02-25')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })
})

describe('dateStringWithCurrentTimeISO', () => {
  it('returns empty string for invalid or empty date string', () => {
    expect(dateStringWithCurrentTimeISO('')).toBe('')
    expect(dateStringWithCurrentTimeISO('25-02-2025')).toBe('')
  })

  it('returns ISO string for valid YYYY-MM-DD', () => {
    const result = dateStringWithCurrentTimeISO('2025-02-25')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

describe('dateStringToLocalMidnightISO', () => {
  it('returns empty string for invalid or empty date string', () => {
    expect(dateStringToLocalMidnightISO('')).toBe('')
    expect(dateStringToLocalMidnightISO('invalid')).toBe('')
  })

  it('returns ISO string for valid YYYY-MM-DD', () => {
    const result = dateStringToLocalMidnightISO('2025-02-25')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('getStockInfo', () => {
  it('returns zero/not-out-of-stock for custom product (name starts with "Other -")', () => {
    const info = getStockInfo({ name: 'Other - Custom Item' })
    expect(info.available).toBe(0)
    expect(info.total).toBe(0)
    expect(info.isOutOfStock).toBe(false)
    expect(info.isLowStock).toBe(false)
  })

  it('returns available and total from product for non-custom product', () => {
    const info = getStockInfo({
      name: 'Normal Product',
      available_quantity: 10,
      stock_quantity: 12,
      low_stock_threshold: 5,
    })
    expect(info.available).toBe(10)
    expect(info.total).toBe(12)
    expect(info.isLowStock).toBe(false)
    expect(info.isOutOfStock).toBe(false)
  })

  it('marks out of stock when available_quantity <= 0', () => {
    const info = getStockInfo({
      name: 'Product',
      available_quantity: 0,
      stock_quantity: 0,
      low_stock_threshold: 5,
    })
    expect(info.isOutOfStock).toBe(true)
  })

  it('marks low stock when available <= threshold and available > 0', () => {
    const info = getStockInfo({
      name: 'Product',
      available_quantity: 3,
      stock_quantity: 10,
      low_stock_threshold: 5,
    })
    expect(info.isLowStock).toBe(true)
    expect(info.isOutOfStock).toBe(false)
  })
})
