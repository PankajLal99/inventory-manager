import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ShoppingCart, Users } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { toast } from '../../lib/toast';
import type { CalendarEmployee, CalendarResponse, Employee, Paginated, SalaryBookSettings } from './types';
import {
  AdminMonthGrid,
  CalendarLegend,
  CalendarRefreshButton,
  CalendarSummaryStrip,
  EmployeeMonthGrid,
  MonthNav,
  type CalendarDayClick,
} from './components/AttendanceCalendar';
import ManualAttendanceDialog, {
  type ManualAttendanceTarget,
} from './components/ManualAttendanceDialog';
import AddAmountDialog, { type AddAmountTarget } from './components/AddAmountDialog';
import TakenHistoryByDate from './components/TakenHistoryByDate';
import { apiError, cyclePeriodLabel, periodContaining, toTimeInput } from './utils';

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const hasExplicitMonth = params.has('year') || params.has('month');
  const employeeId = params.get('employee') ? Number(params.get('employee')) : undefined;
  const [search, setSearch] = useState('');
  const [manualTarget, setManualTarget] = useState<ManualAttendanceTarget | null>(null);
  const [amountTarget, setAmountTarget] = useState<AddAmountTarget | null>(null);
  const today = useMemo(() => new Date(), []);

  const employeesQuery = useQuery({
    queryKey: ['salary-book', 'employees', 'ACTIVE'],
    queryFn: async () =>
      (await salaryBookApi.employees.list({ status: 'ACTIVE', page_size: 100 })).data as Paginated<Employee>,
  });

  // Employee calendar without year/month → open salary period (new cycle = cleared Taken / salary).
  const openPeriod = useMemo(() => {
    if (!employeeId || hasExplicitMonth) return null;
    const emp = employeesQuery.data?.results.find((e) => e.id === employeeId);
    if (!emp) return null;
    return periodContaining(emp.salary_cycle_start_day, today);
  }, [employeeId, hasExplicitMonth, employeesQuery.data, today]);

  const year = hasExplicitMonth
    ? Number(params.get('year')) || today.getFullYear()
    : openPeriod?.year ?? (!employeeId ? today.getFullYear() : undefined);
  const month = hasExplicitMonth
    ? Number(params.get('month')) || today.getMonth() + 1
    : openPeriod?.month ?? (!employeeId ? today.getMonth() + 1 : undefined);

  const setMonth = (nextYear: number, nextMonth: number) => {
    const next = new URLSearchParams(params);
    next.set('year', String(nextYear));
    next.set('month', String(nextMonth));
    setParams(next);
  };

  const setEmployee = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) {
      next.set('employee', id);
      // Re-resolve open cycle for the selected employee.
      next.delete('year');
      next.delete('month');
    } else {
      next.delete('employee');
      next.delete('year');
      next.delete('month');
    }
    setParams(next);
  };

  const settingsQuery = useQuery({
    queryKey: ['salary-book', 'settings'],
    queryFn: async () => (await salaryBookApi.settings.get()).data as SalaryBookSettings,
  });

  const calendarQuery = useQuery({
    queryKey: ['salary-book', 'calendar', year, month, employeeId],
    enabled: year != null && month != null,
    queryFn: async () =>
      (await salaryBookApi.calendar({ year, month, employee: employeeId })).data as CalendarResponse,
  });

  const selectedEmployee = useMemo(
    () => calendarQuery.data?.employees[0],
    [calendarQuery.data]
  );

  const filteredEmployees = useMemo(() => {
    const data = calendarQuery.data;
    const rows = data?.employees || [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (emp) =>
            emp.name.toLowerCase().includes(q) ||
            emp.employee_id.toLowerCase().includes(q)
        )
      : rows;

    // In the current month, unmarked-for-today stay on top; marked sink below.
    const todayIso = data?.today;
    if (!todayIso || !data) return filtered;
    if (year != null && month != null && (data.year !== year || data.month !== month)) {
      return filtered;
    }
    const [ty, tm] = todayIso.split('-').map(Number);
    if (ty !== data.year || tm !== data.month) return filtered;
    const dayKey = String(Number(todayIso.slice(8, 10)));
    return [...filtered].sort((a, b) => {
      const aStatus = a.days[dayKey]?.status;
      const bStatus = b.days[dayKey]?.status;
      const aMarked = Boolean(aStatus && aStatus !== 'BEFORE_JOINING');
      const bMarked = Boolean(bStatus && bStatus !== 'BEFORE_JOINING');
      if (aMarked !== bMarked) return aMarked ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [calendarQuery.data, search, year, month]);

  const searchMatches = useMemo(() => {
    const rows = employeesQuery.data?.results || [];
    const q = search.trim().toLowerCase();
    if (!q || q.length < 1) return [];
    return rows
      .filter(
        (emp) =>
          emp.name.toLowerCase().includes(q) ||
          emp.employee_id.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [employeesQuery.data, search]);

  const selectedEmployeeDetails = useMemo(
    () => employeesQuery.data?.results.find((e) => e.id === manualTarget?.employeeId),
    [employeesQuery.data, manualTarget?.employeeId]
  );

  const invalidateCalendar = async () => {
    await queryClient.invalidateQueries({ queryKey: ['salary-book', 'calendar'] });
    await queryClient.invalidateQueries({ queryKey: ['salary-book', 'salaries'] });
  };

  const manualMutation = useMutation({
    mutationFn: async ({
      target,
      checkIn,
      checkOut,
      status,
    }: {
      target: ManualAttendanceTarget;
      checkIn: string;
      checkOut: string;
      status: string;
    }) => {
      const timed = status === 'PRESENT' || status === 'HALF_DAY';
      if (target.attendanceId) {
        const payload: Record<string, unknown> = { status };
        if (timed) {
          payload.check_in_time = checkIn;
          payload.check_out_time = checkOut;
        }
        return salaryBookApi.attendance.update(target.attendanceId, payload);
      }
      return salaryBookApi.attendance.create({
        employee: target.employeeId,
        date: target.date,
        status,
        ...(timed
          ? { check_in_time: checkIn, check_out_time: checkOut }
          : {}),
      });
    },
    onSuccess: async () => {
      toast('Attendance saved', 'success');
      setManualTarget(null);
      await invalidateCalendar();
    },
    onError: (err) => toast(apiError(err, 'Unable to save attendance.'), 'error'),
  });

  const amountMutation = useMutation({
    mutationFn: async (payload: {
      employee: number;
      date: string;
      reason: string;
      remarks: string;
      splits: Array<{ amount: string; payment_mode: 'CASH' | 'UPI' }>;
    }) => {
      const results = [];
      for (const split of payload.splits) {
        const res = await salaryBookApi.advances.create({
          employee: payload.employee,
          date: payload.date,
          amount: split.amount,
          reason: payload.reason,
          remarks: payload.remarks,
          payment_mode: split.payment_mode,
        });
        results.push(res);
      }
      return results;
    },
    onSuccess: async (_data, variables) => {
      const n = variables.splits.length;
      toast(n > 1 ? 'Cash + UPI amounts added to Taken' : 'Amount added to Taken', 'success');
      setAmountTarget(null);
      await invalidateCalendar();
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'advances'] });
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'taken-history'] });
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'emp-adv-ledger'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to save amount.'), 'error'),
  });

  const openManual = (payload: CalendarDayClick) => {
    setManualTarget({
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      date: payload.date,
      attendanceId: payload.cell?.id,
      existingCheckIn: payload.cell?.check_in_time || undefined,
      existingCheckOut: payload.cell?.check_out_time || undefined,
      existingStatus: payload.cell?.status || undefined,
    });
  };

  const openAddAmount = (emp: CalendarEmployee) => {
    setAmountTarget({ employeeId: emp.id, employeeName: emp.name });
  };

  if (year == null || month == null || calendarQuery.isLoading) {
    return <LoadingState message="Loading calendar..." />;
  }
  if (calendarQuery.isError || !calendarQuery.data) {
    return <ErrorState message="Unable to load calendar." onRetry={() => calendarQuery.refetch()} />;
  }

  const data = calendarQuery.data;
  const isEmployee = data.view === 'employee' && selectedEmployee;
  const defaultCheckIn =
    toTimeInput(manualTarget?.existingCheckIn) ||
    toTimeInput(selectedEmployeeDetails?.effective_check_in) ||
    toTimeInput(settingsQuery.data?.default_check_in) ||
    '09:00';
  const defaultCheckOut =
    toTimeInput(manualTarget?.existingCheckOut) ||
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
              : 'Each month sits in its own row. Open an employee to change month.'}
          </p>
          {isEmployee && selectedEmployee?.period_start && selectedEmployee?.period_end_marker ? (
            <p className="text-xs sm:text-sm text-emerald-800 mt-1 font-medium">
              Salary cycle:{' '}
              {cyclePeriodLabel(
                selectedEmployee.period_start,
                selectedEmployee.period_end_marker,
                selectedEmployee.salary_cycle_start_day,
              )}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/pos"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-white border border-emerald-200 text-emerald-800 font-medium text-sm"
          >
            <ShoppingCart className="h-4 w-4" />
            POS
          </a>
          <CalendarRefreshButton
            fetching={calendarQuery.isFetching}
            updatedAt={calendarQuery.dataUpdatedAt}
            onRefresh={() => {
              void calendarQuery.refetch();
              void employeesQuery.refetch();
            }}
          />
          {isEmployee ? (
            <MonthNav year={data.year} month={data.month} onChange={setMonth} />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => {
            setEmployee('');
            setSearch('');
          }}
          className={`min-h-11 px-4 rounded-xl text-sm font-medium ${
            !employeeId ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-700'
          }`}
        >
          All employees
        </button>
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              setSearch(value);
              // Stay on the all-employees calendar; search only filters rows.
              if (employeeId) setEmployee('');
            }}
            placeholder="Search employee..."
            className="w-full min-h-11 pl-9 pr-3 rounded-xl border border-gray-300 bg-white"
            autoComplete="off"
          />
          {search.trim() && searchMatches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-emerald-100 bg-white shadow-lg overflow-hidden">
              {searchMatches.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-emerald-50 border-b border-emerald-50 last:border-0"
                  onClick={() => {
                    setSearch(emp.name);
                    if (employeeId) setEmployee('');
                  }}
                >
                  <span className="font-medium text-gray-900">{emp.name}</span>
                  <span className="text-gray-400 ml-2">{emp.employee_id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.today_kpis ? (
        <CalendarSummaryStrip today={data.today_kpis} kpis={data.kpis} />
      ) : null}
      <CalendarLegend />

      {(isEmployee ? [selectedEmployee] : filteredEmployees).length === 0 && (
        <EmptyState icon={Users} title="No employees to show." />
      )}

      {isEmployee ? (
        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-6 lg:space-y-0">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openAddAmount(selectedEmployee)}
                className="inline-flex items-center gap-1 min-h-10 px-3 rounded-full border border-emerald-500 text-emerald-800 text-sm font-semibold"
              >
                + Add Amount
              </button>
            </div>
            <EmployeeMonthGrid
              year={data.year}
              month={data.month}
              daysInMonth={data.days_in_month}
              today={data.today}
              employee={selectedEmployee}
              onDayClick={openManual}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2">
                <div className="text-xs text-emerald-800/80">Salary Generated</div>
                <div className="text-sm font-semibold text-emerald-950 tabular-nums">
                  ₹{Number(selectedEmployee.salary_generated || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="rounded-xl bg-sky-50 border border-sky-100 px-3 py-2">
                <div className="text-xs text-sky-800/80">Taken</div>
                <div className="text-sm font-semibold text-sky-950 tabular-nums">
                  ₹{Number(selectedEmployee.taken || 0).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
            <TakenHistoryByDate
              employeeId={selectedEmployee.id}
              employeeName={selectedEmployee.name}
              year={data.year}
              month={data.month}
            />
          </div>
          <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-2 text-sm">
            <h2 className="font-semibold text-gray-900">
              {(selectedEmployee.salary_cycle_start_day || 1) > 1 ? 'This cycle' : 'This month'}
            </h2>
            {(selectedEmployee.salary_cycle_start_day || 1) > 1 &&
            selectedEmployee.period_start &&
            selectedEmployee.period_end_marker ? (
              <p className="text-xs text-emerald-800 pb-1">
                {cyclePeriodLabel(
                  selectedEmployee.period_start,
                  selectedEmployee.period_end_marker,
                  selectedEmployee.salary_cycle_start_day,
                )}
              </p>
            ) : null}
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
          employees={filteredEmployees}
          onDayClick={openManual}
          onAddAmount={openAddAmount}
        />
      )}

      <ManualAttendanceDialog
        target={manualTarget}
        loading={manualMutation.isPending}
        defaultCheckIn={defaultCheckIn}
        defaultCheckOut={defaultCheckOut}
        onClose={() => setManualTarget(null)}
        onSave={({ checkIn, checkOut, status }) => {
          if (!manualTarget) return;
          manualMutation.mutate({ target: manualTarget, checkIn, checkOut, status });
        }}
      />

      <AddAmountDialog
        target={amountTarget}
        loading={amountMutation.isPending}
        onClose={() => setAmountTarget(null)}
        onSave={(payload) => amountMutation.mutate(payload)}
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
