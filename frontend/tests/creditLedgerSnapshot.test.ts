import { describe, it, expect } from 'vitest'
import {
  chunkLedgerRowsForExport,
  ledgerSnapshotPageCount,
} from '../src/pages/credit/creditLedgerSnapshot'

function row(id: number, date: string) {
  return { id, created_at: `${date}T12:00:00` }
}

describe('chunkLedgerRowsForExport', () => {
  it('splits by rows', () => {
    const rows = [row(1, '2026-08-11'), row(2, '2026-08-10'), row(3, '2026-08-09'), row(4, '2026-08-08')]
    const split = { useRows: true, useDays: false, rowsPerPage: 2, daysPerPage: 15 }
    expect(chunkLedgerRowsForExport(rows, split)).toHaveLength(2)
    expect(ledgerSnapshotPageCount(rows, split)).toBe(2)
  })

  it('makes 25 images for 25 daily rows at 1 day and 1 row', () => {
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
  })
})
