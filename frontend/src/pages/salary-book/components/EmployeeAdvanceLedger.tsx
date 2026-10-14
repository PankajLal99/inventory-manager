import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Printer } from 'lucide-react';
import { salaryBookApi } from '../../../lib/api';
import LoadingState from '../../../components/ui/LoadingState';
import ErrorState from '../../../components/ui/ErrorState';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { toast } from '../../../lib/toast';
import { apiError, formatDate, formatINR } from '../utils';
import type { Paginated, SalaryAdvance } from '../types';
import ConfirmDialog from './ConfirmDialog';
import SalaryBookSheet from './SalaryBookSheet';
import {
  buildSalaryLedgerRows,
  exportSalaryLedgerPdf,
  printSalaryLedger,
} from './salaryLedgerExport';

function statusLabel(status: string) {
  if (status === 'VOID') return 'Voided';
  if (status === 'PAID') return 'Paid';
  return 'Active';
}

function entryLabel(row: SalaryAdvance) {
  if (row.source === 'MTSHOP') {
    return `MT Shop${row.reason ? ` — ${row.reason}` : ''}`;
  }
  return row.reason || 'Advance';
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
        onClick={(e) => e.stopPropagation()}
      >
        {number}
      </a>
    );
  }
  return <span className="text-gray-600">{number}</span>;
}

function modeLabel(mode?: string) {
  if (mode === 'CASH') return 'Cash';
  if (mode === 'UPI') return 'UPI';
  return '';
}

export default function EmployeeAdvanceLedger({
  employeeId,
  employeeName,
  year,
  month,
  onClose,
}: {
  employeeId: number;
  employeeName?: string;
  year?: number;
  month?: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [payRow, setPayRow] = useState<SalaryAdvance | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    row: SalaryAdvance;
    kind: 'void' | 'unvoid' | 'unpaid';
  } | null>(null);

  const params = useMemo(() => {
    const p: Record<string, number> = { page_size: 500 };
    if (year && month) {
      p.year = year;
      p.month = month;
    }
    return p;
  }, [year, month]);

  const listQuery = useQuery({
    queryKey: ['salary-book', 'emp-adv-ledger', employeeId, year, month],
    queryFn: async () =>
      (await salaryBookApi.employees.advances(employeeId, params)).data as Paginated<SalaryAdvance> & {
        employee_name?: string;
        employee_code?: string;
        total_active?: string;
        total_paid?: string;
        period_start?: string | null;
        period_end_marker?: string | null;
      },
  });

  const ledgerRows = useMemo(
    () => buildSalaryLedgerRows(listQuery.data?.results || []),
    [listQuery.data?.results],
  );

  const periodLabel = useMemo(() => {
    const start = listQuery.data?.period_start;
    const end = listQuery.data?.period_end_marker;
    if (start && end) return `${formatDate(start)} → ${formatDate(end)}`;
    if (year && month) return `${String(month).padStart(2, '0')}/${year}`;
    return 'All periods';
  }, [listQuery.data?.period_start, listQuery.data?.period_end_marker, year, month]);

  const exportMeta = useMemo(
    () => ({
      employeeName: listQuery.data?.employee_name || employeeName || 'Employee',
      employeeCode: listQuery.data?.employee_code,
      periodLabel,
      totalActive: listQuery.data?.total_active || '0',
      totalPaid: listQuery.data?.total_paid || '0',
    }),
    [listQuery.data, employeeName, periodLabel],
  );

  const handlePdf = () => {
    const rows = listQuery.data?.results || [];
    if (!rows.length) {
      toast('No ledger entries to export.', 'error');
      return;
    }
    exportSalaryLedgerPdf(rows, exportMeta);
    toast('PDF downloaded', 'success');
  };

  const handlePrint = () => {
    const rows = listQuery.data?.results || [];
    if (!rows.length) {
      toast('No ledger entries to print.', 'error');
      return;
    }
    printSalaryLedger(rows, exportMeta);
  };

  const paidMutation = useMutation({
    mutationFn: async ({ id, amount, remarks }: { id: number; amount: string; remarks?: string }) =>
      salaryBookApi.advances.markPaid(id, { amount, remarks }),
    onSuccess: async (res) => {
      toast(
        res.data?.partial ? 'Partial payment recorded' : 'Advance marked as paid',
        'success',
      );
      setPayRow(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to mark advance as paid.'), 'error'),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, kind }: { id: number; kind: 'void' | 'unvoid' | 'unpaid' }) => {
      if (kind === 'void') return salaryBookApi.advances.void(id);
      if (kind === 'unvoid') return salaryBookApi.advances.unvoid(id);
      return salaryBookApi.advances.markUnpaid(id);
    },
    onSuccess: async (_res, vars) => {
      toast(
        vars.kind === 'void'
          ? 'Advance voided'
          : vars.kind === 'unvoid'
            ? 'Advance restored'
            : 'Advance marked unpaid',
        'success',
      );
      setConfirmAction(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err, vars) =>
      toast(
        apiError(
          err,
          vars.kind === 'void'
            ? 'Unable to void advance.'
            : vars.kind === 'unvoid'
              ? 'Unable to restore advance.'
              : 'Unable to mark advance unpaid.',
        ),
        'error',
      ),
  });

  const resetMutation = useMutation({
    mutationFn: async ({ amount, remarks }: { amount: string; remarks: string }) =>
      salaryBookApi.employees.resetOpeningAdvances(employeeId, { amount, remarks }),
    onSuccess: async (res) => {
      const opening = res.data?.opening;
      toast(
        opening
          ? `Cleared history · opening ${formatINR(opening.amount)}`
          : 'All advances cleared',
        'success',
      );
      setResetOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to reset advances.'), 'error'),
  });

  const titleName = exportMeta.employeeName;
  const rows = listQuery.data?.results || [];

  return (
    <SalaryBookSheet onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-lg">Salary ledger</h2>
            <p className="text-sm text-gray-500">
              {titleName}
              {listQuery.data?.employee_code ? ` · ${listQuery.data.employee_code}` : ''}
            </p>
            <p className="text-xs text-emerald-800 font-medium mt-0.5">{periodLabel}</p>
            <p className="text-xs text-gray-500 mt-1">
              Ledger hisab — Taken (Dr), Settled (Cr), running balance. PDF / Print for employee copy.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              className="min-h-10 gap-1.5"
              disabled={!rows.length}
              onClick={handlePrint}
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <Button
              type="button"
              className="min-h-10 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              disabled={!rows.length}
              onClick={handlePdf}
            >
              <FileDown className="h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>

        {listQuery.isLoading && <LoadingState message="Loading ledger..." />}
        {listQuery.isError && <ErrorState onRetry={() => listQuery.refetch()} />}

        {!listQuery.isLoading && rows.length === 0 && (
          <p className="text-sm text-gray-500">No ledger entries for this period.</p>
        )}

        {rows.length > 0 && (
          <div className="border border-emerald-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[50vh]">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-emerald-50 text-xs font-medium text-gray-600 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Particulars</th>
                    <th className="text-left px-3 py-2">Invoice</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">Taken (Dr)</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">Settled (Cr)</th>
                    <th className="text-right px-3 py-2">Balance</th>
                    <th className="text-left px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-50">
                  {rows.map((row, idx) => {
                    const isPaid = row.status === 'PAID';
                    const isVoid = row.status === 'VOID';
                    const isActive = row.status === 'ACTIVE';
                    const line = ledgerRows[idx];
                    return (
                      <tr key={row.id} className={isVoid ? 'opacity-50' : ''}>
                        <td className="px-3 py-2.5 whitespace-nowrap align-top">
                          {formatDate(row.date)}
                        </td>
                        <td className="px-3 py-2.5 align-top min-w-0">
                          <div className={`font-medium text-gray-900 ${isVoid ? 'line-through' : ''}`}>
                            {entryLabel(row)}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {statusLabel(row.status)}
                            {row.source === 'MTSHOP' ? ' · MT Shop' : ''}
                            {modeLabel(row.payment_mode) ? ` · ${modeLabel(row.payment_mode)}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <InvoiceLink row={row} />
                          {!row.source_invoice_number ? (
                            <span className="text-gray-300">—</span>
                          ) : null}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right tabular-nums align-top ${
                            isVoid ? 'line-through text-gray-400' : 'text-red-700'
                          }`}
                        >
                          {line?.debit ? formatINR(line.debit) : '—'}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right tabular-nums align-top ${
                            line?.credit ? 'text-emerald-700' : 'text-gray-300'
                          }`}
                        >
                          {line?.credit ? formatINR(line.credit) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium align-top">
                          {formatINR(line?.balance ?? 0)}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex flex-col gap-1 items-start">
                            {isActive && (
                              <>
                                <button
                                  type="button"
                                  className="text-sm font-medium text-emerald-700"
                                  onClick={() => setPayRow(row)}
                                >
                                  Mark paid
                                </button>
                                <button
                                  type="button"
                                  className="text-sm font-medium text-red-600"
                                  onClick={() => setConfirmAction({ row, kind: 'void' })}
                                >
                                  Void
                                </button>
                              </>
                            )}
                            {isPaid && (
                              <button
                                type="button"
                                className="text-sm font-medium text-amber-700"
                                onClick={() => setConfirmAction({ row, kind: 'unpaid' })}
                              >
                                Mark unpaid
                              </button>
                            )}
                            {isVoid && (
                              <button
                                type="button"
                                className="text-sm font-medium text-emerald-700"
                                onClick={() => setConfirmAction({ row, kind: 'unvoid' })}
                              >
                                Unvoid
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bg-emerald-50/70 px-3 py-2.5 grid grid-cols-2 gap-2 text-sm font-semibold">
              <div className="flex justify-between">
                <span className="text-gray-600 font-medium">Outstanding</span>
                <span className="text-amber-800">{formatINR(listQuery.data?.total_active || '0')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 font-medium">Settled / Paid</span>
                <span className="text-emerald-700">{formatINR(listQuery.data?.total_paid || '0')}</span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full min-h-11 border-amber-200 text-amber-900 hover:bg-amber-50"
            onClick={() => setResetOpen(true)}
          >
            Clear & set opening
          </Button>
          <Button type="button" variant="outline" className="w-full min-h-11" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {payRow && (
        <MarkPaidForm
          row={payRow}
          loading={paidMutation.isPending}
          onClose={() => setPayRow(null)}
          onSave={(payload) =>
            paidMutation.mutate({ id: payRow.id, amount: payload.amount, remarks: payload.remarks })
          }
        />
      )}
      {resetOpen && (
        <ResetOpeningForm
          loading={resetMutation.isPending}
          currentOutstanding={listQuery.data?.total_active || '0'}
          onClose={() => setResetOpen(false)}
          onSave={(payload) => resetMutation.mutate(payload)}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction?.kind === 'void'
            ? 'Void advance?'
            : confirmAction?.kind === 'unvoid'
              ? 'Restore advance?'
              : 'Mark unpaid?'
        }
        message={
          confirmAction
            ? confirmAction.kind === 'void'
              ? `${formatINR(confirmAction.row.amount)} · ${entryLabel(confirmAction.row)} will be voided.`
              : confirmAction.kind === 'unvoid'
                ? `${formatINR(confirmAction.row.amount)} · ${entryLabel(confirmAction.row)} will become active again.`
                : `${formatINR(confirmAction.row.amount)} · ${entryLabel(confirmAction.row)} will return to outstanding.`
            : ''
        }
        confirmLabel={
          confirmAction?.kind === 'void'
            ? 'Void'
            : confirmAction?.kind === 'unvoid'
              ? 'Unvoid'
              : 'Mark unpaid'
        }
        danger={confirmAction?.kind === 'void'}
        loading={statusMutation.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() =>
          confirmAction &&
          statusMutation.mutate({ id: confirmAction.row.id, kind: confirmAction.kind })
        }
      />
    </SalaryBookSheet>
  );
}

function MarkPaidForm({
  row,
  loading,
  onClose,
  onSave,
}: {
  row: SalaryAdvance;
  loading: boolean;
  onClose: () => void;
  onSave: (payload: { amount: string; remarks: string }) => void;
}) {
  const [amount, setAmount] = useState(String(row.amount));
  const [remarks, setRemarks] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center p-0 lg:p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <form
        className="relative bg-white w-full max-w-md rounded-t-2xl lg:rounded-2xl p-5 shadow-xl space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ amount, remarks });
        }}
      >
        <h3 className="font-semibold text-lg">Mark paid</h3>
        <p className="text-sm text-gray-600">
          Outstanding {formatINR(row.amount)}. Enter a smaller amount to pay only part of it.
        </p>
        <Input
          label="Paid amount"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Textarea
          label="Remarks"
          rows={2}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Optional note"
        />
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-12 bg-emerald-600 hover:bg-emerald-700" loading={loading}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

function ResetOpeningForm({
  loading,
  currentOutstanding,
  onClose,
  onSave,
}: {
  loading: boolean;
  currentOutstanding: string;
  onClose: () => void;
  onSave: (payload: { amount: string; remarks: string }) => void;
}) {
  const [amount, setAmount] = useState(String(currentOutstanding || '0'));
  const [remarks, setRemarks] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center p-0 lg:p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <form
        className="relative bg-white w-full max-w-md rounded-t-2xl lg:rounded-2xl p-5 shadow-xl space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ amount, remarks });
        }}
      >
        <h3 className="font-semibold text-lg">Clear & set opening</h3>
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Deletes all advance entries for this employee permanently. Then creates one outstanding
          “Opening balance” that salary will still deduct. Use 0 to clear only.
        </p>
        <Input
          label="Opening amount"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Textarea
          label="Remarks"
          rows={2}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Optional note"
        />
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-12 bg-amber-700 hover:bg-amber-800" loading={loading}>
            Clear & set
          </Button>
        </div>
      </form>
    </div>
  );
}
