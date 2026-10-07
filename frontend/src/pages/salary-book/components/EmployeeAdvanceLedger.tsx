import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salaryBookApi } from '../../../lib/api';
import LoadingState from '../../../components/ui/LoadingState';
import ErrorState from '../../../components/ui/ErrorState';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { toast } from '../../../lib/toast';
import { apiError, formatDate, formatINR } from '../utils';
import type { Paginated, SalaryAdvance } from '../types';
import SalaryBookSheet from './SalaryBookSheet';

function statusLabel(status: string) {
  if (status === 'VOID') return 'Voided';
  if (status === 'PAID') return 'Paid';
  return 'Active';
}

function entryLabel(row: SalaryAdvance) {
  if (row.source === 'MTSHOP') {
    const inv = row.source_invoice_number ? ` · ${row.source_invoice_number}` : '';
    return `MT Shop${inv}${row.reason ? ` — ${row.reason}` : ''}`;
  }
  return row.reason || 'Advance';
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

  const params = useMemo(() => {
    const p: Record<string, number> = { page_size: 100 };
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
        total_active?: string;
        total_paid?: string;
      },
  });

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

  const titleName = listQuery.data?.employee_name || employeeName || 'Employee';
  const period =
    year && month ? ` · ${String(month).padStart(2, '0')}/${year}` : '';

  return (
    <SalaryBookSheet onClose={onClose}>
      <div className="space-y-4">
        <div>
          <h2 className="font-semibold text-lg">Advance ledger</h2>
          <p className="text-sm text-gray-500">
            {titleName}{period}
          </p>
        </div>

        {listQuery.isLoading && <LoadingState message="Loading entries..." />}
        {listQuery.isError && <ErrorState onRetry={() => listQuery.refetch()} />}

        {!listQuery.isLoading && (listQuery.data?.results.length ?? 0) === 0 && (
          <p className="text-sm text-gray-500">No advance entries for this period.</p>
        )}

        {(listQuery.data?.results.length ?? 0) > 0 && (
          <div className="border border-emerald-100 rounded-xl overflow-hidden">
            <div className="bg-emerald-50 px-3 py-2 grid grid-cols-[1fr_auto_auto] gap-2 text-xs font-medium text-gray-600">
              <span>Entry</span>
              <span className="text-right w-24">Debit</span>
              <span className="text-right w-24">Paid</span>
            </div>
            <div className="divide-y divide-emerald-50 max-h-[50vh] overflow-y-auto">
              {listQuery.data?.results.map((row) => {
                const isPaid = row.status === 'PAID';
                const isVoid = row.status === 'VOID';
                const isActive = row.status === 'ACTIVE';
                return (
                  <div key={row.id} className={`px-3 py-3 text-sm ${isVoid ? 'opacity-50' : ''}`}>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-start">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{entryLabel(row)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {formatDate(row.date)} · {statusLabel(row.status)}
                          {row.source === 'MTSHOP' ? ' · MT Shop' : ''}
                        </div>
                        {isActive && (
                          <button
                            type="button"
                            className="mt-1 text-sm text-emerald-700"
                            onClick={() => setPayRow(row)}
                          >
                            Mark paid
                          </button>
                        )}
                      </div>
                      <div className={`text-right w-24 font-medium ${isActive ? 'text-gray-900' : 'text-gray-300'}`}>
                        {isActive || isVoid ? formatINR(row.amount) : '—'}
                      </div>
                      <div className={`text-right w-24 font-medium ${isPaid ? 'text-emerald-700' : 'text-gray-300'}`}>
                        {isPaid ? formatINR(row.amount) : '—'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="bg-emerald-50/70 px-3 py-2.5 grid grid-cols-2 gap-2 text-sm font-semibold">
              <div className="flex justify-between">
                <span className="text-gray-600 font-medium">Outstanding</span>
                <span>{formatINR(listQuery.data?.total_active || '0')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 font-medium">Paid</span>
                <span className="text-emerald-700">{formatINR(listQuery.data?.total_paid || '0')}</span>
              </div>
            </div>
          </div>
        )}

        <Button type="button" variant="outline" className="w-full min-h-11" onClick={onClose}>
          Close
        </Button>
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
