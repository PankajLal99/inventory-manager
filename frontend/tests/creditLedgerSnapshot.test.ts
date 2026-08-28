import { describe, it, expect } from 'vitest'
import {
  buildCreditLedgerSnapshotPageHtmlList,
  chunkLedgerRowsByDays,
  chunkLedgerRowsForExport,
  ledgerExportSplitExplain,
  ledgerSnapshotPageCount,
} from '../src/pages/credit/creditLedgerSnapshot'

function row(id: number, date: string) {
  return { id, created_at: `${date}T12:00:00` }
}

describe('chunkLedgerRowsByDays', () => {
  it('returns one empty page when there are no rows', () => {
    expect(chunkLedgerRowsByDays([])).toEqual([[]])
  })

  it('keeps entries within 15 days on one page', () => {
    const rows = [row(1, '2026-08-11'), row(2, '2026-07-28')]
    expect(chunkLedgerRowsByDays(rows, 15)).toHaveLength(1)
  })

  it('starts a new page after 15 calendar days', () => {
    const rows = [row(1, '2026-08-11'), row(2, '2026-07-27')]
    const pages = chunkLedgerRowsByDays(rows, 15)
    expect(pages).toHaveLength(2)
    expect(pages[0].map((r) => r.id)).toEqual([2])
    expect(pages[1].map((r) => r.id)).toEqual([1])
  })

  it('puts the oldest 15-day window first (latest at the end)', () => {
    const rows = [
      row(1, '2026-08-11'),
      row(2, '2026-08-01'),
      row(3, '2026-07-20'),
      row(4, '2026-07-05'),
    ]
    const pages = chunkLedgerRowsByDays(rows, 15)
    expect(pages[0].map((r) => r.id)).toEqual([4])
    expect(pages[1].map((r) => r.id)).toEqual([3, 2])
    expect(pages[2].map((r) => r.id)).toEqual([1])
  })
})

describe('chunkLedgerRowsForExport', () => {
  it('splits by a custom row count', () => {
    const rows = [row(1, '2026-08-11'), row(2, '2026-08-10'), row(3, '2026-08-09'), row(4, '2026-08-08')]
    const split = { useRows: true, useDays: false, rowsPerPage: 2, daysPerPage: 15 }
    const pages = chunkLedgerRowsForExport(rows, split)
    expect(pages).toHaveLength(2)
    expect(pages[0].map((r) => r.id)).toEqual([4, 3])
    expect(pages[1].map((r) => r.id)).toEqual([2, 1])
    expect(ledgerSnapshotPageCount(rows, split)).toBe(2)
  })

  it('splits by a custom day window from each page start', () => {
    const rows = [row(1, '2026-08-11'), row(2, '2026-08-10'), row(3, '2026-08-05')]
    const pages = chunkLedgerRowsForExport(rows, {
      useRows: false,
      useDays: true,
      rowsPerPage: 40,
      daysPerPage: 2,
    })
    // Aug 5 is its own 2-day page; Aug 10–11 fit on the next page.
    expect(pages.map((part) => part.map((r) => r.id))).toEqual([[3], [2, 1]])
  })

  it('keeps 3 far-apart rows on 1 image when rows take priority over days', () => {
    const rows = [row(1, '2026-07-24'), row(2, '2026-08-08'), row(3, '2026-08-11')]
    const split = { useRows: true, useDays: true, rowsPerPage: 15, daysPerPage: 10 }
    expect(ledgerSnapshotPageCount(rows, split)).toBe(1)
    const explain = ledgerExportSplitExplain(rows, split)
    expect(explain).toContain('1 image')
    expect(explain).toContain('Rows (15) take priority over days (10)')
  })

  it('still splits by days when rows is off', () => {
    const rows = [
      row(1, '2026-08-01'),
      row(2, '2026-08-05'),
      row(3, '2026-08-12'),
      row(4, '2026-08-20'),
    ]
    const pages = chunkLedgerRowsForExport(rows, {
      useRows: false,
      useDays: true,
      rowsPerPage: 15,
      daysPerPage: 10,
    })
    expect(pages.map((part) => part.map((r) => r.id))).toEqual([[1, 2], [3, 4]])
  })

  it('still splits a busy 10-day window at 15 rows', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, '2026-08-01'))
    const pages = chunkLedgerRowsForExport(rows, {
      useRows: true,
      useDays: true,
      rowsPerPage: 15,
      daysPerPage: 10,
    })
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(15)
    expect(pages[1]).toHaveLength(5)
  })

  it('makes 25 images when 25 rows are 1 per day', () => {
    const rows = Array.from({ length: 25 }, (_, i) => {
      const d = new Date(2026, 7, 11)
      d.setDate(d.getDate() - i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return row(i + 1, iso)
    })
    const pages = chunkLedgerRowsForExport(rows, {
      useRows: true,
      useDays: true,
      rowsPerPage: 1,
      daysPerPage: 1,
    })
    expect(pages).toHaveLength(25)
    expect(pages.every((part) => part.length === 1)).toBe(true)
  })
})

describe('buildCreditLedgerSnapshotPageHtmlList', () => {
  it('prepends balance brought forward on continued pages', () => {
    const statement = {
      customer: { name: 'Test Customer' },
      opening_balance: '0',
      opening_side: 'Dr',
      closing_balance: '300',
      closing_side: 'Dr',
      total_debit: '500',
      total_credit: '200',
      rows: [
        {
          id: 1,
          created_at: '2026-08-01T10:00:00',
          particulars: 'Dr Sales',
          debit: '100',
          credit: '0',
          running_balance: '100',
          balance_side: 'Dr',
        },
        {
          id: 2,
          created_at: '2026-08-02T10:00:00',
          particulars: 'Dr Sales',
          debit: '200',
          credit: '0',
          running_balance: '300',
          balance_side: 'Dr',
        },
        {
          id: 3,
          created_at: '2026-08-03T10:00:00',
          particulars: 'Cr UPI',
          debit: '0',
          credit: '50',
          running_balance: '250',
          balance_side: 'Dr',
        },
      ],
    }
    const pages = buildCreditLedgerSnapshotPageHtmlList(statement, {
      useRows: true,
      useDays: false,
      rowsPerPage: 2,
      daysPerPage: 15,
    })
    expect(pages).toHaveLength(2)
    expect(pages[0]).not.toContain('Balance Carried Forward')
    expect(pages[1]).toContain('Balance Carried Forward')
    expect(pages[1]).toContain('300.00 Dr')
  })
})
