import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { Users } from 'lucide-react';
import { toast } from '../../lib/toast';
import type { CalendarResponse, Employee, Paginated, SalaryBookSettings } from './types';
import {
  AdminMonthGrid,
  CalendarLegend,
  EmployeeMonthGrid,
  KpiStrip,
  MonthNav,
  type CalendarDayClick,
} from './components/AttendanceCalendar';
import ManualAttendanceDialog, {
  type ManualAttendanceTarget,
} from './components/ManualAttendanceDialog';
import { apiError, toTimeInput } from './utils';

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const now = new Date();
  const year = Number(params.get('year')) || now.getFullYear();
  const month = Number(params.get('month')) || now.getMonth() + 1;
  const employeeId = params.get('employee') ? Number(params.get('employee')) : undefined;
  const [manualTarget, setManualTarget] = useState<ManualAttendanceTarget | null>(null);

  const setMonth = (nextYear: number, nextMonth: number) => {
    const next = new URLSearchParams(params);
    next.set('year', String(nextYear));
    next.set('month', String(nextMonth));
    setParams(next);
  };

  const setEmployee = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('employee', id);
    else next.delete('employee');
    setParams(next);
  };

  const employeesQuery = useQuery({
    queryKey: ['salary-book', 'employees', 'ACTIVE'],
    queryFn: async () =>
      (await salaryBookApi.employees.list({ status: 'ACTIVE', page_size: 100 })).data as Paginated<Employee>,
  });

  const settingsQuery = useQuery({
    queryKey: ['salary-book', 'settings'],
    queryFn: async () => (await salaryBookApi.settings.get()).data as SalaryBookSettings,
  });

  const calendarQuery = useQuery({
    queryKey: ['salary-book', 'calendar', year, month, employeeId],
    queryFn: async () =>
      (await salaryBookApi.calendar({ year, month, employee: employeeId })).data as CalendarResponse,
  });

  const selectedEmployee = useMemo(
    () => calendarQuery.data?.employees[0],
    [calendarQuery.data]
  );

  const selectedEmployeeDetails = useMemo(
    () => employeesQuery.data?.results.find((e) => e.id === manualTarget?.employeeId),
    [employeesQuery.data, manualTarget?.employeeId]
  );

  const manualMutation = useMutation({
    mutationFn: async ({
      target,
      checkIn,
      checkOut,
    }: {
      target: ManualAttendanceTarget;
      checkIn: string;
      checkOut: string;
    }) =>
      salaryBookApi.attendance.create({
        employee: target.employeeId,
        date: target.date,
        status: 'PRESENT',
        check_in_time: checkIn,
        check_out_time: checkOut,
      }),
    onSuccess: async () => {
      toast('Attendance times saved', 'success');
      setManualTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'calendar'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to save attendance times.'), 'error'),
  });

  const openManual = (payload: CalendarDayClick) => {
    setManualTarget({
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      date: payload.date,
    });
  };

  if (calendarQuery.isLoading) return <LoadingState message="Loading calendar..." />;
  if (calendarQuery.isError || !calendarQuery.data) {
    return <ErrorState message="Unable to load calendar." onRetry={() => calendarQuery.refetch()} />;
  }

  const data = calendarQuery.data;
  const isEmployee = data.view === 'employee' && selectedEmployee;
  const defaultCheckIn =
    toTimeInput(selectedEmployeeDetails?.effective_check_in) ||
    toTimeInput(settingsQuery.data?.default_check_in) ||
    '09:00';
  const defaultCheckOut =
    toTimeInput(selectedEmployeeDetails?.effective_check_out) ||
    toTimeInput(settingsQuery.data?.default_check_out) ||
    '18:00';

  return (
    <div className="space-y-3 sm:space-y-4 lg:space-y-6" data-tutorial="cal-page">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 truncate">
            {isEmployee ? `${selectedEmployee.name}'s Calendar` : 'Employee Attendance'}
          </h1>
          <p className="text-xs sm:text-sm lg:text-base text-gray-500 mt-1">
            {isEmployee
              ? 'Tap a day for details. Unmarked days can get in/out times.'
              : 'Swipe days per employee, or open one for the month grid.'}
          </p>
        </div>
        <MonthNav year={year} month={month} onChange={setMonth} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => setEmployee('')}
          className={`min-h-11 px-4 rounded-xl text-sm font-medium ${
            !employeeId ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-700'
          }`}
        >
          All employees
        </button>
        <select
          className="min-h-11 w-full sm:w-auto sm:min-w-[14rem] rounded-xl border border-gray-300 bg-white px-3"
          value={employeeId || ''}
          onChange={(e) => setEmployee(e.target.value)}
        >
          <option value="">Select employee…</option>
          {employeesQuery.data?.results.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
      </div>

      <KpiStrip kpis={data.kpis} />
      <CalendarLegend />

      {data.employees.length === 0 && (
        <EmptyState icon={Users} title="No employees to show." />
      )}

      {isEmployee ? (
        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-6 lg:space-y-0">
          <EmployeeMonthGrid
            year={data.year}
            month={data.month}
            daysInMonth={data.days_in_month}
            today={data.today}
            employee={selectedEmployee}
            onDayClick={openManual}
          />
          <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-2 text-sm">
            <h2 className="font-semibold text-gray-900">This month</h2>
            <Row label="Present" value={selectedEmployee.counts.PRESENT} />
            <Row label="Absent" value={selectedEmployee.counts.ABSENT} />
            <Row label="Half Day" value={selectedEmployee.counts.HALF_DAY} />
            <Row label="Paid Leave" value={selectedEmployee.counts.PAID_LEAVE} />
            <Row label="Unpaid Leave" value={selectedEmployee.counts.UNPAID_LEAVE} />
            <Row label="Holiday" value={selectedEmployee.counts.HOLIDAY} />
            <Row label="Unmarked" value={selectedEmployee.counts.unmarked} />
            <Link
              to={`/salary-book/employees/${selectedEmployee.id}`}
              className="mt-3 flex items-center justify-center min-h-11 rounded-xl border border-emerald-200 text-emerald-800 font-medium"
            >
              Open profile
            </Link>
          </div>
        </div>
      ) : (
        <AdminMonthGrid
          year={data.year}
          month={data.month}
          daysInMonth={data.days_in_month}
          today={data.today}
          employees={data.employees}
          onDayClick={openManual}
        />
      )}

      <ManualAttendanceDialog
        target={manualTarget}
        loading={manualMutation.isPending}
        defaultCheckIn={defaultCheckIn}
        defaultCheckOut={defaultCheckOut}
        onClose={() => setManualTarget(null)}
        onSave={({ checkIn, checkOut }) => {
          if (!manualTarget) return;
          manualMutation.mutate({ target: manualTarget, checkIn, checkOut });
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
