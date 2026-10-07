import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { apiError, formatINR, formatDate, statusLabel, toTimeInput } from './utils';
import type { AttendanceRule, CalendarResponse, Employee, LeaveRecord, Paginated, SalaryAdvance, SalaryRecord } from './types';
import { useState } from 'react';
import { CalendarLegend, EmployeeMonthGrid, KpiStrip, MonthNav } from './components/AttendanceCalendar';
import ConfirmDialog from './components/ConfirmDialog';
import { toast } from '../../lib/toast';

type Tab = 'profile' | 'attendance' | 'leaves' | 'advances' | 'salaries';

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
      <div className="bg-white rounded-xl border border-emerald-100 p-5 text-center lg:text-left lg:flex lg:items-center lg:gap-5">
        <div className="mx-auto lg:mx-0 h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center text-2xl font-semibold text-emerald-800 shrink-0">
          {data.name.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="mt-3 lg:mt-0 text-xl font-bold text-gray-900">{data.name}</h1>
          <p className="text-sm text-gray-500">{data.employee_id}</p>
          <p className={`text-sm mt-1 ${data.status === 'ACTIVE' ? 'text-emerald-700' : 'text-gray-500'}`}>
            {data.status === 'ACTIVE' ? 'Active' : 'Inactive'}
          </p>
        </div>
        <div className="mt-4 lg:mt-0 flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            to={`/salary-book/employees/${data.id}/edit`}
            className="flex items-center justify-center min-h-12 px-5 rounded-xl bg-emerald-600 text-white font-medium"
          >
            Edit Employee
          </Link>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex items-center justify-center min-h-12 px-5 rounded-xl border border-red-200 text-red-700 bg-white font-medium"
          >
            Delete
          </button>
        </div>
      </div>

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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          ['profile', 'Profile'],
          ['attendance', 'Attendance'],
          ['leaves', 'Leaves'],
          ['advances', 'Advances'],
          ['salaries', 'Salary'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-2 rounded-full text-sm whitespace-nowrap min-h-10 ${
              tab === key ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="bg-white rounded-xl border border-emerald-100 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <Field label="Mobile" value={data.mobile} />
          <Field label="Blood Group" value={data.blood_group || '—'} />
          <Field label="Designation" value={data.designation || '—'} />
          <Field label="Department" value={data.department || '—'} />
          <Field label="Monthly Salary" value={formatINR(data.monthly_salary)} />
          <Field label="Check-in" value={toTimeInput(data.effective_check_in) || '—'} />
          <Field label="Check-out" value={toTimeInput(data.effective_check_out) || '—'} />
          <Field label="Scheduled hours" value={data.scheduled_hours ? `${data.scheduled_hours} h` : '—'} />
          <Field label="Per-day rate" value={formatINR(data.daily_rate_preview)} />
          <Field label="Per-hour rate" value={formatINR(data.hourly_rate_preview)} />
          <Field label="Joined" value={formatDate(data.date_of_joining)} />
          <Field label="Address" value={data.address || '—'} />
          <Field
            label="MT Shop ledger"
            value={
              data.mtshop_customer_name
                ? `${data.mtshop_customer_name}${data.mtshop_customer_phone ? ` · ${data.mtshop_customer_phone}` : ''}`
                : 'Not linked'
            }
          />
        </div>
      )}
      {tab === 'profile' && <EmployeeRules employeeId={empId} />}
      {tab === 'attendance' && <AttendanceHistory employeeId={empId} />}
      {tab === 'leaves' && <LeaveHistory employeeId={empId} />}
      {tab === 'advances' && <AdvanceHistory employeeId={empId} />}
      {tab === 'salaries' && <SalaryHistory employeeId={empId} />}
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
    <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-2">
      <h2 className="font-semibold text-gray-900">Attendance rules</h2>
      {data.map((rule) => (
        <div key={rule.id} className="text-sm">
          Late ≥ {rule.late_threshold_minutes} min for {rule.consecutive_late_days} consecutive days
          {' · '}
          {rule.is_active ? 'Active' : 'Inactive'}
        </div>
      ))}
    </div>
  );
}

function AttendanceHistory({ employeeId }: { employeeId: number }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'calendar', year, month, employeeId],
    queryFn: async () =>
      (await salaryBookApi.calendar({ year, month, employee: employeeId })).data as CalendarResponse,
  });
  if (isLoading) return <LoadingState message="Loading attendance..." />;
  const emp = data?.employees[0];
  if (!emp) return <p className="text-sm text-gray-500">No attendance records found.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
        <Link
          to={`/salary-book/calendar?employee=${employeeId}&year=${year}&month=${month}`}
          className="text-sm text-emerald-800 font-medium"
        >
          Open full calendar
        </Link>
      </div>
      {data && <KpiStrip kpis={data.kpis} compact />}
      <CalendarLegend />
      <EmployeeMonthGrid
        year={year}
        month={month}
        daysInMonth={data?.days_in_month || 31}
        today={data?.today || ''}
        employee={emp}
      />
    </div>
  );
}

function LeaveHistory({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'emp-leave', employeeId],
    queryFn: async () => (await salaryBookApi.employees.leaves(employeeId)).data as Paginated<LeaveRecord>,
  });
  if (isLoading) return <LoadingState message="Loading leaves..." />;
  if (!data?.results.length) return <p className="text-sm text-gray-500">No leave records found.</p>;
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

function AdvanceHistory({ employeeId }: { employeeId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'emp-adv', employeeId],
    queryFn: async () => (await salaryBookApi.employees.advances(employeeId)).data as Paginated<SalaryAdvance>,
  });
  const paidMutation = useMutation({
    mutationFn: async (id: number) => salaryBookApi.advances.markPaid(id),
    onSuccess: async () => {
      toast('Advance marked as paid', 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to mark advance as paid.'), 'error'),
  });
  if (isLoading) return <LoadingState message="Loading advances..." />;
  if (!data?.results.length) return <p className="text-sm text-gray-500">No salary advances recorded.</p>;
  return (
    <div className="space-y-2">
      {data.results.map((row) => (
        <div key={row.id} className="bg-white rounded-xl border border-gray-100 p-3 flex justify-between gap-3">
          <div>
            <div className="font-medium">{formatDate(row.date)}</div>
            <div className="text-sm text-gray-600">
              {row.source === 'MTSHOP' ? 'MT Shop' : ''}
              {row.source === 'MTSHOP' && row.reason ? ' · ' : ''}
              {row.reason || row.status}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {row.status === 'PAID' ? 'Paid' : row.status === 'VOID' ? 'Voided' : 'Active'}
            </div>
            {row.status === 'ACTIVE' && (
              <button
                type="button"
                className="mt-1 text-sm text-emerald-700"
                onClick={() => paidMutation.mutate(row.id)}
              >
                Mark paid
              </button>
            )}
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
  );
}

function SalaryHistory({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'emp-sal', employeeId],
    queryFn: async () => (await salaryBookApi.employees.salaries(employeeId)).data as Paginated<SalaryRecord>,
  });
  if (isLoading) return <LoadingState message="Loading salary history..." />;
  if (!data?.results.length) return <p className="text-sm text-gray-500">No salary records yet.</p>;
  return (
    <div className="space-y-2">
      {data.results.map((row) => (
        <Link key={row.id} to={`/salary-book/salaries/${row.id}`} className="block bg-white rounded-xl border border-gray-100 p-3">
          <div className="font-medium">{row.month}/{row.year}</div>
          <div className="text-sm text-gray-600">
            Net {formatINR(row.net_salary)} · {statusLabel(row.payment_status)}
          </div>
        </Link>
      ))}
    </div>
  );
}
