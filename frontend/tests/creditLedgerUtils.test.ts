import { describe, it, expect } from 'vitest'
import {
  compareLedgerStatementRows,
  ledgerEventTimeMs,
} from '../src/pages/credit/creditLedgerUtils'

describe('ledgerEventTimeMs', () => {
  it('reads 10/06/2026 as 10 June, not 6 October', () => {
    const june = ledgerEventTimeMs('10/06/2026 2:36 PM')
    const july = ledgerEventTimeMs('28/07/2026 11:28 PM')
    expect(june).toBe(new Date(2026, 5, 10, 14, 36).getTime())
    expect(july).toBe(new Date(2026, 6, 28, 23, 28).getTime())
    expect(june).toBeLessThan(july)
  })

  it('prefers event_at_ms over date strings', () => {
    expect(
      ledgerEventTimeMs({
        event_at_ms: 1000,
        created_at: '10/06/2026 2:36 PM',
      })
    ).toBe(1000)
  })
})

describe('compareLedgerStatementRows', () => {
  it('sorts Date + Particulars by event datetime, including Opening Balance', () => {
    const rows = [
      { id: 3, particulars: 'Opening Balance', created_at: '28/07/2026 11:28 PM' },
      { id: 1, particulars: 'Dr Sales', created_at: '10/06/2026 2:36 PM' },
      { id: 4, particulars: 'Dr Sales', created_at: '29/07/2026 5:23 PM' },
      { id: 2, particulars: 'Dr Sales', created_at: '19/06/2026 7:16 PM' },
      { id: 5, particulars: 'Cr UPI', created_at: '29/07/2026 10:00 PM' },
    ]
    const sorted = [...rows].sort(compareLedgerStatementRows).map((r) => r.particulars)
    expect(sorted).toEqual([
      'Dr Sales',
      'Dr Sales',
      'Opening Balance',
      'Dr Sales',
      'Cr UPI',
    ])
  })
})
