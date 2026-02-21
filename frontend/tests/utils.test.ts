import { describe, it, expect } from 'vitest'
import { formatNumber, formatAmountINR, canEditLedgerEntry } from '../src/lib/utils'

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
