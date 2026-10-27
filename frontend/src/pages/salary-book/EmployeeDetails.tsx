import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Umbrella, Wallet, BookOpen } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { apiError, formatINR, formatDate, formatTime, formatTime12, monthLabel, periodContaining, statusLabel } from './utils';
import type { Attendance, AttendanceRule, CalendarResponse, Employee, LeaveRecord, Paginated, SalaryAdvance, SalaryRecord } from './types';
import { useEffect, useMemo, useState } from 'react';
import { MonthNav } from './components/AttendanceCalendar';
import ConfirmDialog from './components/ConfirmDialog';
import EmployeeAdvanceLedger from './components/EmployeeAdvanceLedger';
import SalaryInvoice from './components/SalaryInvoice';
import { toast } from '../../lib/toast';
import { FilterChips, SalaryButton, SalaryCard, StatusBadge } from './ui';

type Tab = 'profile' | 'history' | 'attendance' | 'leaves' | 'advances' | 'salaries';

export default function EmployeeDetails() {
  const { id } = useParams();
  const empId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('profile');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'employee', empId],
    queryFn: async () => (await salaryBookApi.employees.get(empId)).data as Employee,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => salaryBookApi.employees.delete(empId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
      toast('Employee removed from Salary Book', 'success');
      navigate('/salary-book/employees');
    },
    onError: (err) => toast(apiError(err, 'Unable to delete employee.'), 'error'),
  });

  if (isLoading) return <LoadingState message="Loading employee..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <SalaryCard className="text-center lg:text-left lg:flex lg:items-center lg:gap-5">
        <div className="mx-auto lg:mx-0 h-16 w-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-xl font-semibold text-emerald-800 shrink-0">
          {data.name.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="mt-3 lg:mt-0 text-xl font-semibold text-slate-900">{data.name}</h1>
          <p className="text-sm text-slate-500">
            {data.employee_id}
            {data.designation ? ` · ${data.designation}` : ''}
          </p>
          <div className="mt-2">
            <StatusBadge status={data.status} />
          </div>
        </div>
        <div className="mt-4 lg:mt-0 flex flex-col sm:flex-row gap-2 justify-center">
          <SalaryButton onClick={() => setTab('attendance')}>Salary invoice</SalaryButton>
          <Link
            to={`/salary-book/employees/${data.id}/edit`}
            className="inline-flex items-center justify-center min-h-11 px-4 rounded-xl border border-emerald-200 bg-white text-emerald-800 font-medium text-sm hover:bg-emerald-50"
          >
            Edit
          </Link>
          <SalaryButton variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>
            Delete
          </SalaryButton>
        </div>
      </SalaryCard>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete employee from Salary Book?"
        message={`${data.name} and their Salary Book attendance, leaves, advances, and salary records will be removed. This does not affect anything outside Salary Book.`}
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />

      <FilterChips
        chips={[
          { key: 'profile', label: 'Profile' },
          { key: 'history', label: 'Attendance' },
          { key: 'attendance', label: 'Invoice' },
          { key: 'leaves', label: 'Leaves' },
          { key: 'advances', label: 'Advances' },
          { key: 'salaries', label: 'Salary' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'profile' && (
        <SalaryCard className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <Field label="Mobile" value={data.mobile} />
          <Field label="Blood Group" value={data.blood_group || '—'} />
          <Field label="Designation" value={data.designation || '—'} />
          <Field label="Department" value={data.department || '—'} />
          <Field label="Monthly Salary" value={formatINR(data.monthly_salary)} />
          <Field label="Check-in" value={formatTime12(data.effective_check_in) || '—'} />
          <Field label="Check-out" value={formatTime12(data.effective_check_out) || '—'} />
          <Field
            label="Check-in buffer"
            value={
              data.check_in_buffer_minutes
                ? `${data.check_in_buffer_minutes} min (on time until then)`
                : '0 min (exact check-in)'
            }
          />
          <Field label="Scheduled hours" value={data.scheduled_hours ? `${data.scheduled_hours} h` : '—'} />
          <Field label="Per-day rate" value={formatINR(data.daily_rate_preview)} />
          <Field label="Per-hour rate" value={formatINR(data.hourly_rate_preview)} />
          <Field
            label="Overall late cut"
            value={
              data.overall_late_penalty_enabled
                ? `On · ${data.overall_late_half_days ?? 5} late days = half day, ${data.overall_late_full_days ?? 6} = full day`
                : 'Off'
            }
          />
          <Field label="Start Date" value={formatDate(data.date_of_joining)} />
          <Field
            label="Salary cycle day"
            value={
              data.salary_cycle_start_day && data.salary_cycle_start_day > 1
                ? `Joining day ${data.salary_cycle_start_day}th → next ${data.salary_cycle_start_day}th`
                : '1st (calendar month)'
            }
          />
          <Field label="Address" value={data.address || '—'} />
          <Field
            label="MT Shop ledger"
            value={
              data.mtshop_customer_name
                ? `${data.mtshop_customer_name}${data.mtshop_customer_phone ? ` · ${data.mtshop_customer_phone}` : ''}`
                : 'Not linked'
            }
          />
        </SalaryCard>
      )}
      {tab === 'profile' && <EmployeeRules employeeId={empId} />}
      {tab === 'history' && <PunchHistory employeeId={empId} />}
      {tab === 'attendance' && (
        <AttendanceHistory
          key={`${empId}-${data.date_of_joining}-${data.salary_cycle_start_day || 1}`}
          employeeId={empId}
          cycleDay={data.salary_cycle_start_day}
          profile={data}
        />
      )}
      {tab === 'leaves' && <LeaveHistory employeeId={empId} />}
      {tab === 'advances' && (
        <AdvanceHistory employeeId={empId} employeeName={data.name} />
      )}
      {tab === 'salaries' && <SalaryHistory employeeId={empId} employeeName={data.name} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className="font-medium text-gray-900">{value}</div>
    </div>
  );
}

function EmployeeRules({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'rules', employeeId],
    queryFn: async () =>
      (await salaryBookApi.employees.attendanceRules.list(employeeId)).data as AttendanceRule[],
  });
  if (isLoading) return null;
  if (!data?.length) return null;
  return (
    <SalaryCard className="space-y-2">
      <h2 className="font-semibold text-gray-900">Attendance rules</h2>
      {data.map((rule) => (
        <div key={rule.id} className="text-sm">
          Late ≥ {rule.late_threshold_minutes} min for {rule.consecutive_late_days} consecutive days
          {' · '}
          {rule.is_active ? 'Active' : 'Inactive'}
        </div>
      ))}
    </SalaryCard>
  );
}

function PunchHistory({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'emp-attendance', employeeId],
    queryFn: async () =>
      (await salaryBookApi.employees.attendance(employeeId, { page_size: 50 })).data as Paginated<Attendance>,
  });
  if (isLoading) return <LoadingState message="Loading attendance..." />;
  if (!data?.results.length) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No attendance yet."
        message="Mark attendance from the Attendance page or calendar."
      />
    );
  }
  return (
    <div className="space-y-2">
      {data.results.map((row) => (
        <SalaryCard key={row.id} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium text-slate-900">{formatDate(row.date)}</div>
            <div className="text-sm text-slate-500">
              {row.check_in_time ? `In ${formatTime(row.check_in_time)}` : 'No in'}
              {' · '}
              {row.check_out_time ? `Out ${formatTime(row.check_out_time)}` : 'No out'}
            </div>
          </div>
          <StatusBadge status={row.status} />
        </SalaryCard>
      ))}
    </div>
  );
}

function AttendanceHistory({
  employeeId,
  cycleDay,
  profile,
}: {
  employeeId: number;
  cycleDay?: number;
  profile: Employee;
}) {
  const open = useMemo(() => periodContaining(cycleDay), [cycleDay]);
  const [year, setYear] = useState(open.year);
  const [month, setMonth] = useState(open.month);
  // When joining/cycle day changes, jump to the new open salary period.
  useEffect(() => {
    setYear(open.year);
    setMonth(open.month);
  }, [open.year, open.month]);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['salary-book', 'calendar', year, month, employeeId],
    queryFn: async () =>
      (await salaryBookApi.calendar({ year, month, employee: employeeId })).data as CalendarResponse,
  });
  if (isLoading) return <LoadingState message="Loading attendance..." />;
  // Avoid rendering a prior month's strip under the newly selected year/month.
  if (isFetching && data && (data.year !== year || data.month !== month)) {
    return <LoadingState message="Loading attendance..." />;
  }
  const emp = data?.employees[0];
  if (!emp || !data) {
    return <EmptyState icon={CalendarDays} title="No attendance records found." />;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <MonthNav year={data.year} month={data.month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
        <Link
          to={`/salary-book/calendar?employee=${employeeId}&year=${data.year}&month=${data.month}`}
          className="text-sm text-emerald-800 font-medium"
        >
          Open full calendar
        </Link>
      </div>
      <SalaryInvoice profile={profile} employee={emp} today={data.today} />
    </div>
  );
}

function LeaveHistory({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'emp-leave', employeeId],
    queryFn: async () => (await salaryBookApi.employees.leaves(employeeId)).data as Paginated<LeaveRecord>,
  });
  if (isLoading) return <LoadingState message="Loading leaves..." />;
  if (!data?.results.length) return <EmptyState icon={Umbrella} title="No leave records found." />;
  return (
    <div className="space-y-2">
      {data.results.map((row) => (
        <div key={row.id} className="bg-white rounded-xl border border-gray-100 p-3">
          <div className="font-medium">{row.leave_type === 'PAID' ? 'Paid Leave' : 'Unpaid Leave'}</div>
          <div className="text-sm text-gray-600">
            {formatDate(row.start_date)} – {formatDate(row.end_date)} · {row.days} days
          </div>
        </div>
      ))}
    </div>
  );
}

function AdvanceHistory({ employeeId, employeeName }: { employeeId: number; employeeName: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'emp-adv', employeeId],
    queryFn: async () => (await salaryBookApi.employees.advances(employeeId)).data as Paginated<SalaryAdvance>,
  });
  if (isLoading) return <LoadingState message="Loading advances..." />;
  if (!data?.results.length) return <EmptyState icon={Wallet} title="No salary advances recorded." />;
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="w-full min-h-11 rounded-xl border border-emerald-200 text-emerald-800 font-medium"
        onClick={() => setOpen(true)}
      >
        Open salary ledger
      </button>
      <div className="space-y-2">
        {data.results.slice(0, 8).map((row) => (
          <div key={row.id} className="bg-white rounded-xl border border-gray-100 p-3 flex justify-between gap-3">
            <div>
              <div className="font-medium">{formatDate(row.date)}</div>
              <div className="text-sm text-gray-600">
                {row.source === 'MTSHOP' ? 'MT Shop' : ''}
                {row.source === 'MTSHOP' && row.reason ? ' · ' : ''}
                {row.reason || row.status}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-1">
                <span>
                  {row.status === 'PAID' ? 'Paid' : row.status === 'VOID' ? 'Voided' : 'Active'}
                </span>
                {row.source_invoice_number ? (
                  row.source_invoice_id ? (
                    <a
                      href={`/invoices/${row.source_invoice_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 font-medium underline-offset-2 hover:underline"
                    >
                      · {row.source_invoice_number}
                    </a>
                  ) : (
                    <span>· {row.source_invoice_number}</span>
                  )
                ) : null}
              </div>
            </div>
            <div className="font-semibold">{formatINR(row.amount)}</div>
          </div>
        ))}
        {data.total_active && (
          <div className="flex justify-between px-1 pt-2 font-semibold">
            <span>Total active</span>
            <span>{formatINR(data.total_active)}</span>
          </div>
        )}
      </div>
      {open && (
        <EmployeeAdvanceLedger
          employeeId={employeeId}
          employeeName={employeeName}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SalaryHistory({
  employeeId,
  employeeName,
}: {
  employeeId: number;
  employeeName: string;
}) {
  const queryClient = useQueryClient();
  const [settleTarget, setSettleTarget] = useState<{ year: number; month: number } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'emp-sal', employeeId],
    queryFn: async () => (await salaryBookApi.employees.salaries(employeeId)).data as Paginated<SalaryRecord>,
  });
  const settle = useMutation({
    mutationFn: async (target: { year: number; month: number }) =>
      (
        await salaryBookApi.employees.settleMonth(employeeId, {
          year: target.year,
          month: target.month,
          payment_mode: 'CASH',
        })
      ).data,
    onSuccess: async (res, target) => {
      setSettleTarget(null);
      if (res?.already_settled) {
        toast(`${monthLabel(target.year, target.month)} is already settled`, 'success');
      } else {
        const adv = Number(res?.advances_marked_paid || 0);
        toast(
          adv > 0
            ? `Settled ${monthLabel(target.year, target.month)} · ${adv} advance(s) cleared`
            : `Settled ${monthLabel(target.year, target.month)}`,
          'success',
        );
      }
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to settle this month.'), 'error'),
  });
  if (isLoading) return <LoadingState message="Loading salary history..." />;
  if (!data?.results.length) return <EmptyState icon={BookOpen} title="No salary records yet." />;
  return (
    <div className="space-y-2">
      {data.results.map((row) => {
        const settled = row.status === 'FINALIZED' && row.payment_status === 'PAID';
        return (
          <div
            key={row.id}
            className="bg-white rounded-xl border border-gray-100 p-3 flex flex-wrap items-center gap-3 justify-between"
          >
            <Link to={`/salary-book/salaries/${row.id}`} className="min-w-0 flex-1">
              <div className="font-medium">{monthLabel(row.year, row.month)}</div>
              <div className="text-sm text-gray-600">
                Net {formatINR(row.net_salary)} · {statusLabel(row.payment_status)}
                {row.status === 'FINALIZED' ? ' · Finalized' : ''}
              </div>
            </Link>
            <button
              type="button"
              disabled={settled || settle.isPending}
              onClick={() => setSettleTarget({ year: row.year, month: row.month })}
              className={`shrink-0 min-h-10 px-3 rounded-xl text-sm font-semibold ${
                settled
                  ? 'bg-gray-100 text-gray-400 cursor-default'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {settled ? 'Settled' : 'Settle'}
            </button>
          </div>
        );
      })}
      <ConfirmDialog
        open={settleTarget !== null}
        title={
          settleTarget
            ? `Settle ${monthLabel(settleTarget.year, settleTarget.month)}?`
            : 'Settle month?'
        }
        message={`This will clear active advances for ${employeeName}'s cycle, pay any remaining salary, and finalize the month as settled.`}
        confirmLabel="Settle"
        loading={settle.isPending}
        onCancel={() => setSettleTarget(null)}
        onConfirm={() => settleTarget && settle.mutate(settleTarget)}
      />
    </div>
  );
}
