import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { toast } from '../../lib/toast';
import { apiError, formatDate, formatINR, monthLabel, statusLabel, todayISO } from './utils';
import ConfirmDialog from './components/ConfirmDialog';
import SalaryBookSheet from './components/SalaryBookSheet';
import EmployeeAdvanceLedger from './components/EmployeeAdvanceLedger';
import type { Paginated, SalaryAdvance, SalaryRecord } from './types';
import { PageHeader, SalaryButton, StatusBadge } from './ui';

type DetailTab = 'advances' | 'daily';

export default function SalaryDetails() {
  const { id } = useParams();
  const recordId = Number(id);
  const queryClient = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [confirm, setConfirm] = useState<'finalize' | 'reopen' | null>(null);
  const [voidPayment, setVoidPayment] = useState<number | null>(null);
  const [advLedgerOpen, setAdvLedgerOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('advances');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'salary', recordId],
    queryFn: async () => (await salaryBookApi.salaries.get(recordId)).data as SalaryRecord,
  });

  const finalize = useMutation({
    mutationFn: () => salaryBookApi.salaries.finalize(recordId),
    onSuccess: async () => {
      toast('Salary finalized', 'success');
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err), 'error'),
  });
  const reopen = useMutation({
    mutationFn: () => salaryBookApi.salaries.reopen(recordId),
    onSuccess: async () => {
      toast('Salary reopened', 'success');
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err), 'error'),
  });
  const pay = useMutation({
    mutationFn: (payload: Record<string, unknown>) => salaryBookApi.payments.create(payload),
    onSuccess: async () => {
      toast('Payment recorded', 'success');
      setPayOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err), 'error'),
  });
  const voidPay = useMutation({
    mutationFn: (pid: number) => salaryBookApi.payments.void(pid),
    onSuccess: async () => {
      toast('Payment voided', 'success');
      setVoidPayment(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err), 'error'),
  });

  const hasAdvances = Number(data?.total_advances || 0) > 0;

  useEffect(() => {
    if (!data) return;
    // When salary has advance deduction, open Advances tab by default (like daily breakdown).
    setDetailTab(Number(data.total_advances || 0) > 0 ? 'advances' : 'daily');
  }, [data?.id, data?.total_advances]);

  if (isLoading) return <LoadingState message="Loading salary details..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.employee_name}
        subtitle={`${data.employee_code} · ${monthLabel(data.year, data.month)}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={data.payment_status} />
            <StatusBadge status={data.status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Section title="Attendance">
        <Row label="Present" value={data.present_days} />
        <Row label="Absent" value={data.absent_days} />
        <Row label="Paid Leave" value={data.paid_leave_days} />
        <Row label="Unpaid Leave" value={data.unpaid_leave_days} />
        <Row label="Half Day" value={data.half_days} />
        <Row label="Unmarked" value={data.unmarked_days} />
      </Section>

      <Section title="Salary">
        <Row label="Gross Salary" value={formatINR(data.gross_salary)} />
        <Row label="Scheduled Hours" value={data.scheduled_hours ? `${data.scheduled_hours} h` : '—'} />
        <Row label="Daily Salary" value={formatINR(data.daily_salary)} />
        <Row label="Hourly Rate" value={formatINR(data.hourly_rate)} />
        <Row label="Earned Salary" value={formatINR(data.earned_salary)} />
        <Row label="Leave Deduction" value={formatINR(data.leave_deduction)} />
        <Row label="Other Deduction" value={formatINR(data.other_deductions)} />
        <Row label="Allowances" value={formatINR(data.allowances)} />
        <button
          type="button"
          className="w-full text-left"
          onClick={() => {
            setDetailTab('advances');
            setAdvLedgerOpen(true);
          }}
          title="View advance ledger"
        >
          <div className="flex justify-between">
            <span className="text-emerald-700">Advance</span>
            <span className="font-medium text-emerald-800 underline-offset-2 hover:underline">
              {formatINR(data.total_advances)}
            </span>
          </div>
        </button>
        <div className="flex justify-between font-semibold pt-2 border-t border-slate-100 tabular-nums">
          <span>Net Payable</span>
          <span>{formatINR(data.net_salary)}</span>
        </div>
      </Section>

      <Section title="Payment">
        <Row label="Paid" value={formatINR(data.total_paid)} />
        <Row label="Remaining" value={formatINR(data.remaining)} />
        <Row label="Status" value={statusLabel(data.payment_status)} />
        <div className="text-xs text-slate-500">{data.status === 'FINALIZED' ? 'Locked (finalized)' : 'Calculated (draft)'}</div>
        <div className="space-y-2 pt-2">
          {(data.payments || []).map((p) => (
            <div key={p.id} className="flex justify-between text-sm">
              <span>
                {formatDate(p.payment_date)} · {statusLabel(p.payment_mode)}
                {p.status === 'VOID' ? ' (void)' : ''}
              </span>
              <span>
                {formatINR(p.amount)}
                {p.status === 'ACTIVE' && (
                  <button type="button" className="ml-2 text-red-600" onClick={() => setVoidPayment(p.id)}>
                    Void
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </Section>

      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-100">
          <button
            type="button"
            onClick={() => setDetailTab('advances')}
            className={`flex-1 min-h-11 px-4 text-sm font-semibold ${
              detailTab === 'advances'
                ? 'bg-emerald-50 text-emerald-900 border-b-2 border-emerald-600'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Advances{hasAdvances ? ` · ${formatINR(data.total_advances)}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setDetailTab('daily')}
            className={`flex-1 min-h-11 px-4 text-sm font-semibold ${
              detailTab === 'daily'
                ? 'bg-emerald-50 text-emerald-900 border-b-2 border-emerald-600'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Daily breakdown
          </button>
        </div>
        <div className="p-4">
          {detailTab === 'advances' ? (
            <AdvancesPanel
              employeeId={data.employee}
              employeeName={data.employee_name}
              year={data.year}
              month={data.month}
              totalAdvances={data.total_advances}
              onOpenLedger={() => setAdvLedgerOpen(true)}
            />
          ) : (
            <DailyBreakdownTable breakdown={data.breakdown} />
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
      <SalaryButton size="lg" className="w-full lg:w-auto px-6" onClick={() => setPayOpen(true)}>
        Record payment
      </SalaryButton>
      {data.status === 'DRAFT' ? (
        <SalaryButton size="lg" variant="outline" className="w-full lg:w-auto px-6" onClick={() => setConfirm('finalize')}>
          Finalize salary
        </SalaryButton>
      ) : (
        <SalaryButton size="lg" variant="secondary" className="w-full lg:w-auto px-6" onClick={() => setConfirm('reopen')}>
          Reopen salary
        </SalaryButton>
      )}
      </div>

      {payOpen && (
        <PaymentForm
          remaining={data.remaining}
          loading={pay.isPending}
          onClose={() => setPayOpen(false)}
          onSave={(payload) => pay.mutate({ ...payload, salary_record: recordId })}
        />
      )}
      <ConfirmDialog
        open={confirm === 'finalize'}
        title="Finalize monthly salary?"
        message="Calculation will be locked until you reopen it."
        confirmLabel="Finalize"
        loading={finalize.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => finalize.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'reopen'}
        title="Reopen salary?"
        message="Attendance and advances will affect this month again."
        confirmLabel="Reopen"
        loading={reopen.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => reopen.mutate()}
      />
      <ConfirmDialog
        open={voidPayment !== null}
        title="Cancel payment?"
        message="This payment will be voided, not deleted."
        confirmLabel="Void"
        danger
        loading={voidPay.isPending}
        onCancel={() => setVoidPayment(null)}
        onConfirm={() => voidPayment && voidPay.mutate(voidPayment)}
      />
      {advLedgerOpen && (
        <EmployeeAdvanceLedger
          employeeId={data.employee}
          employeeName={data.employee_name}
          year={data.year}
          month={data.month}
          onClose={() => setAdvLedgerOpen(false)}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="font-semibold mb-2">{title}</h2>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function advanceLabel(row: SalaryAdvance) {
  if (row.source === 'MTSHOP') {
    return `MT Shop${row.reason ? ` — ${row.reason}` : ''}`.trim();
  }
  return row.reason || 'Advance';
}

function AdvancesPanel({
  employeeId,
  employeeName,
  year,
  month,
  totalAdvances,
  onOpenLedger,
}: {
  employeeId: number;
  employeeName: string;
  year: number;
  month: number;
  totalAdvances: string;
  onOpenLedger: () => void;
}) {
  const listQuery = useQuery({
    queryKey: ['salary-book', 'salary-detail-advances', employeeId, year, month],
    queryFn: async () =>
      (await salaryBookApi.employees.advances(employeeId, {
        year,
        month,
        page_size: 500,
      })).data as Paginated<SalaryAdvance>,
  });

  const rows = useMemo(() => {
    // Active advances drive the salary deduction; show paid/void too for full hisab.
    return listQuery.data?.results || [];
  }, [listQuery.data?.results]);

  const activeRows = rows.filter((r) => r.status === 'ACTIVE');
  const activeTotal = activeRows.reduce((s, r) => s + Number(r.amount || 0), 0);

  if (listQuery.isLoading) {
    return <LoadingState message="Loading advances..." />;
  }

  if (!rows.length) {
    return (
      <div className="text-sm text-gray-500 space-y-2">
        <p>No advance entries in this salary cycle.</p>
        {Number(totalAdvances) > 0 ? (
          <p className="text-amber-800">
            Record shows {formatINR(totalAdvances)} deducted — refresh or reopen salary if ledger was updated.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-sm text-gray-600">
          Active advances deducted from this month:{' '}
          <span className="font-semibold text-amber-900 tabular-nums">{formatINR(activeTotal)}</span>
          {listQuery.data?.period_start && listQuery.data?.period_end_marker ? (
            <span className="text-xs text-gray-500">
              {' '}
              · {formatDate(listQuery.data.period_start)} → {formatDate(listQuery.data.period_end_marker)}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onOpenLedger}
          className="text-sm font-medium text-emerald-800 min-h-9 px-3 rounded-lg border border-emerald-200 hover:bg-emerald-50"
        >
          Full ledger / PDF
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-3">Date</th>
              <th className="py-1 pr-3">Particulars</th>
              <th className="py-1 pr-3">Invoice</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-t border-emerald-50 ${row.status === 'VOID' ? 'opacity-50' : ''}`}
              >
                <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(row.date)}</td>
                <td className={`py-1.5 pr-3 ${row.status === 'VOID' ? 'line-through' : ''}`}>
                  {advanceLabel(row)}
                </td>
                <td className="py-1.5 pr-3">
                  {row.source_invoice_id && row.source_invoice_number ? (
                    <a
                      href={`/invoices/${row.source_invoice_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 font-medium underline-offset-2 hover:underline"
                    >
                      {row.source_invoice_number}
                    </a>
                  ) : (
                    row.source_invoice_number || '—'
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  {row.status === 'ACTIVE'
                    ? 'Deducted'
                    : row.status === 'PAID'
                      ? 'Settled'
                      : 'Voided'}
                </td>
                <td
                  className={`py-1.5 pr-3 text-right tabular-nums font-medium ${
                    row.status === 'ACTIVE' ? 'text-amber-900' : 'text-gray-700'
                  }`}
                >
                  {formatINR(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Only <span className="font-medium">Deducted (Active)</span> rows reduce net salary for{' '}
        {employeeName}.
      </p>
    </div>
  );
}

function DailyBreakdownTable({ breakdown }: { breakdown: Record<string, unknown> }) {
  const rows = (breakdown?.daily_breakdown || []) as Array<{
    date: string;
    status: string | null;
    worked_hours: string;
    payable_hours: string;
    day_credit: string;
    minutes_late: number;
    rule_penalty_applied: boolean;
  }>;
  if (!rows.length) {
    return <p className="text-sm text-gray-500">No daily breakdown for this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1 pr-3">Date</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1 pr-3">Worked</th>
            <th className="py-1 pr-3">Payable</th>
            <th className="py-1 pr-3">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-t border-emerald-50">
              <td className="py-1 pr-3">{formatDate(row.date)}</td>
              <td className="py-1 pr-3">
                {row.status ? statusLabel(row.status) : 'Unmarked'}
                {row.rule_penalty_applied ? ' · Penalty' : ''}
                {row.minutes_late ? ` · Late ${row.minutes_late}m` : ''}
              </td>
              <td className="py-1 pr-3">{row.worked_hours}h</td>
              <td className="py-1 pr-3">{row.payable_hours}h</td>
              <td className="py-1 pr-3">{formatINR(row.day_credit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentForm({
  remaining,
  loading,
  onClose,
  onSave,
}: {
  remaining: string;
  loading: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [amount, setAmount] = useState(remaining);
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState('CASH');
  const [reference, setReference] = useState('');

  return (
    <SalaryBookSheet onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ amount, payment_date: date, payment_mode: mode, reference_number: reference });
        }}
        className="space-y-3"
      >
        <h2 className="font-semibold text-lg">Record Payment</h2>
        <Input label="Amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Payment Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Select label="Payment Mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="CASH">Cash</option>
          <option value="BANK_TRANSFER">Bank Transfer</option>
          <option value="UPI">UPI</option>
          <option value="OTHER">Other</option>
        </Select>
        <Input label="Reference Number" value={reference} onChange={(e) => setReference(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <SalaryButton type="button" variant="secondary" size="lg" onClick={onClose}>Cancel</SalaryButton>
          <SalaryButton type="submit" size="lg" loading={loading}>Save</SalaryButton>
        </div>
      </form>
    </SalaryBookSheet>
  );
}
