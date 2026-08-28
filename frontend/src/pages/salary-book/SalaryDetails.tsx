import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { toast } from '../../lib/toast';
import { apiError, formatDate, formatINR, monthLabel, statusLabel, todayISO } from './utils';
import ConfirmDialog from './components/ConfirmDialog';
import SalaryBookSheet from './components/SalaryBookSheet';
import type { SalaryRecord } from './types';

export default function SalaryDetails() {
  const { id } = useParams();
  const recordId = Number(id);
  const queryClient = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [confirm, setConfirm] = useState<'finalize' | 'reopen' | null>(null);
  const [voidPayment, setVoidPayment] = useState<number | null>(null);

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

  if (isLoading) return <LoadingState message="Loading salary details..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">{data.employee_name}</h1>
        <p className="text-sm text-gray-500">{data.employee_code}</p>
        <p className="text-sm text-gray-700 mt-1">{monthLabel(data.year, data.month)}</p>
      </div>

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
        <Row label="Advance" value={formatINR(data.total_advances)} />
        <div className="flex justify-between font-semibold pt-2 border-t">
          <span>Net Payable</span>
          <span>{formatINR(data.net_salary)}</span>
        </div>
      </Section>

      <Section title="Payment">
        <Row label="Paid" value={formatINR(data.total_paid)} />
        <Row label="Remaining" value={formatINR(data.remaining)} />
        <Row label="Status" value={statusLabel(data.payment_status)} />
        <div className="text-xs text-gray-500">{data.status === 'FINALIZED' ? 'Finalized' : 'Draft'}</div>
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

      <DailyBreakdown breakdown={data.breakdown} />

      <div className="flex flex-col lg:flex-row gap-3">
      <Button className="w-full lg:w-auto min-h-12 px-6 bg-emerald-600 hover:bg-emerald-700" onClick={() => setPayOpen(true)}>
        Record Payment
      </Button>
      {data.status === 'DRAFT' ? (
        <Button className="w-full lg:w-auto min-h-12 px-6" variant="outline" onClick={() => setConfirm('finalize')}>
          Finalize Salary
        </Button>
      ) : (
        <Button className="w-full lg:w-auto min-h-12 px-6" variant="outline" onClick={() => setConfirm('reopen')}>
          Reopen Salary
        </Button>
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
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-4">
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

function DailyBreakdown({ breakdown }: { breakdown: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const rows = (breakdown?.daily_breakdown || []) as Array<{
    date: string;
    status: string | null;
    worked_hours: string;
    payable_hours: string;
    day_credit: string;
    minutes_late: number;
    rule_penalty_applied: boolean;
  }>;
  if (!rows.length) return null;
  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-4">
      <button type="button" className="font-semibold w-full text-left" onClick={() => setOpen((v) => !v)}>
        Daily breakdown {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
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
      )}
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
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="min-h-12 bg-emerald-600 hover:bg-emerald-700" loading={loading}>Save</Button>
        </div>
      </form>
    </SalaryBookSheet>
  );
}
