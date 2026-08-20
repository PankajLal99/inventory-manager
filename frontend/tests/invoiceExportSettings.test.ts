import { describe, it, expect } from 'vitest'
import {
  chunkInvoiceRowsForExport,
  invoiceExportSplitExplain,
  invoiceSnapshotPageCount,
  normalizeInvoiceExportSplit,
} from '../src/pages/invoices/invoiceExportSettings'

describe('normalizeInvoiceExportSplit', () => {
  it('defaults to 25 rows per page', () => {
    expect(normalizeInvoiceExportSplit({})).toEqual({ rowsPerPage: 25 })
  })

  it('clamps out-of-range values', () => {
    expect(normalizeInvoiceExportSplit({ rowsPerPage: 0 }).rowsPerPage).toBe(1)
    expect(normalizeInvoiceExportSplit({ rowsPerPage: 999 }).rowsPerPage).toBe(200)
  })
})

describe('chunkInvoiceRowsForExport', () => {
  it('keeps 25 rows on one page by default', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i + 1)
    expect(chunkInvoiceRowsForExport(rows, 25)).toHaveLength(1)
  })

  it('splits invoices over 25 rows', () => {
    const rows = Array.from({ length: 26 }, (_, i) => i + 1)
    const pages = chunkInvoiceRowsForExport(rows, 25)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(25)
    expect(pages[1]).toEqual([26])
  })

  it('uses a custom row count', () => {
    const rows = [1, 2, 3, 4, 5]
    const pages = chunkInvoiceRowsForExport(rows, 2)
    expect(pages).toEqual([[1, 2], [3, 4], [5]])
    expect(invoiceSnapshotPageCount(rows.length, 2)).toBe(3)
  })
})

describe('invoiceExportSplitExplain', () => {
  it('explains a single image', () => {
    expect(invoiceExportSplitExplain(10, 25)).toContain('1 image')
  })

  it('explains multi-page copy buttons', () => {
    const text = invoiceExportSplitExplain(60, 25)
    expect(text).toContain('3 images')
    expect(text).toContain('Copy 1')
    expect(text).toContain('Copy 3')
  })
})
