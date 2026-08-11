import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { Users } from 'lucide-react';
import type { CalendarResponse, Employee, Paginated } from './types';
import {
  AdminMonthGrid,
  CalendarLegend,
  EmployeeMonthGrid,
  KpiStrip,
  MonthNav,
} from './components/AttendanceCalendar';

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const now = new Date();
  const year = Number(params.get('year')) || now.getFullYear();
  const month = Number(params.get('month')) || now.getMonth() + 1;
  const employeeId = params.get('employee') ? Number(params.get('employee')) : undefined;

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

  const calendarQuery = useQuery({
    queryKey: ['salary-book', 'calendar', year, month, employeeId],
    queryFn: async () =>
      (await salaryBookApi.calendar({ year, month, employee: employeeId })).data as CalendarResponse,
  });

  const selectedEmployee = useMemo(
    () => calendarQuery.data?.employees[0],
    [calendarQuery.data]
  );

  if (calendarQuery.isLoading) return <LoadingState message="Loading calendar..." />;
  if (calendarQuery.isError || !calendarQuery.data) {
    return <ErrorState message="Unable to load calendar." onRetry={() => calendarQuery.refetch()} />;
  }

  const data = calendarQuery.data;
  const isEmployee = data.view === 'employee' && selectedEmployee;

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">
            {isEmployee ? `${selectedEmployee.name}'s Calendar` : 'Attendance Calendar'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isEmployee
              ? 'Personal month view with attendance summary.'
              : 'All employees for this month, with team KPIs.'}
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
          className="min-h-11 rounded-xl border border-gray-300 bg-white px-3"
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
        />
      )}
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
