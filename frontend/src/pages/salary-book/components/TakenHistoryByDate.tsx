import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salaryBookApi } from '../../../lib/api';
import LoadingState from '../../../components/ui/LoadingState';
import { formatDate, formatINR } from '../utils';
import type { Paginated, SalaryAdvance } from '../types';
import EmployeeAdvanceLedger from './EmployeeAdvanceLedger';

function entryLabel(row: SalaryAdvance) {
  if (row.source === 'MTSHOP') {
    return `MT Shop${row.reason ? ` — ${row.reason}` : ''}`.trim();
  }
  return row.reason || 'Advance / Taken';
}

function statusLabel(status: string) {
  if (status === 'VOID') return 'Voided';
  if (status === 'PAID') return 'Settled';
  return 'Outstanding';
}

function InvoiceLink({ row }: { row: SalaryAdvance }) {
  const number = row.source_invoice_number?.trim();
  if (!number) return null;
  if (row.source_invoice_id) {
    return (
      <a
        href={`/invoices/${row.source_invoice_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-700 font-medium underline-offset-2 hover:underline"
      >
        {number}
      </a>
    );
  }
  return <span className="text-gray-600">{number}</span>;
}

export default function TakenHistoryByDate({
  employeeId,
  employeeName,
  year,
  month,
}: {
  employeeId: number;
  employeeName?: string;
  year: number;
  month: number;
}) {
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['salary-book', 'taken-history', employeeId, year, month],
    queryFn: async () =>
      (await salaryBookApi.employees.advances(employeeId, {
        year,
        month,
        page_size: 500,
      })).data as Paginated<SalaryAdvance>,
  });

  const groups = useMemo(() => {
    const rows = listQuery.data?.results || [];
    const map = new Map<string, { date: string; rows: SalaryAdvance[]; dayTotal: number }>();
    for (const row of rows) {
      const key = row.date;
      const existing = map.get(key) || { date: key, rows: [], dayTotal: 0 };
      existing.rows.push(row);
      if (row.status !== 'VOID') {
        existing.dayTotal += Number(row.amount || 0);
      }
      map.set(key, existing);
    }
    // Newest date first for history reading
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [listQuery.data?.results]);

  const periodNote =
    listQuery.data?.period_start && listQuery.data?.period_end_marker
      ? `${formatDate(listQuery.data.period_start)} → ${formatDate(listQuery.data.period_end_marker)}`
      : null;

  return (
    <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-emerald-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">Taken history</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Advances &amp; MT Shop / repair hisab for this cycle
            {periodNote ? ` · ${periodNote}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLedgerOpen(true)}
          className="text-sm font-medium text-emerald-800 min-h-9 px-3 rounded-lg border border-emerald-200 hover:bg-emerald-50"
        >
          Full ledger / PDF
        </button>
      </div>

      {listQuery.isLoading && (
        <div className="p-4">
          <LoadingState message="Loading taken history..." />
        </div>
      )}

      {!listQuery.isLoading && groups.length === 0 && (
        <p className="text-sm text-gray-500 px-4 py-6 text-center">No taken entries in this period.</p>
      )}

      {groups.length > 0 && (
        <div className="divide-y divide-emerald-50 max-h-[28rem] overflow-y-auto">
          {groups.map((group) => (
            <div key={group.date} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-gray-900">{formatDate(group.date)}</div>
                <div className="text-sm font-semibold text-sky-900 tabular-nums">
                  {formatINR(group.dayTotal)}
                </div>
              </div>
              <ul className="space-y-2">
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    className={`flex justify-between gap-3 text-sm ${
                      row.status === 'VOID' ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div
                        className={`font-medium text-gray-800 truncate ${
                          row.status === 'VOID' ? 'line-through' : ''
                        }`}
                      >
                        {entryLabel(row)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-1">
                        <span>{statusLabel(row.status)}</span>
                        {row.source_invoice_number ? (
                          <>
                            <span>·</span>
                            <InvoiceLink row={row} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 tabular-nums font-medium ${
                        row.status === 'PAID'
                          ? 'text-emerald-700'
                          : row.status === 'VOID'
                            ? 'text-gray-400 line-through'
                            : 'text-gray-900'
                      }`}
                    >
                      {formatINR(row.amount)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {(listQuery.data?.total_active || listQuery.data?.total_paid) && groups.length > 0 && (
        <div className="bg-emerald-50/80 px-4 py-2.5 grid grid-cols-2 gap-2 text-sm font-semibold border-t border-emerald-100">
          <div className="flex justify-between gap-2">
            <span className="text-gray-600 font-medium">Outstanding</span>
            <span className="text-amber-800 tabular-nums">
              {formatINR(listQuery.data?.total_active || '0')}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-600 font-medium">Settled</span>
            <span className="text-emerald-700 tabular-nums">
              {formatINR(listQuery.data?.total_paid || '0')}
            </span>
          </div>
        </div>
      )}

      {ledgerOpen && (
        <EmployeeAdvanceLedger
          employeeId={employeeId}
          employeeName={employeeName}
          year={year}
          month={month}
          onClose={() => setLedgerOpen(false)}
        />
      )}
    </div>
  );
}
