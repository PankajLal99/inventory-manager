import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { formatINR, monthLabel } from './utils';
import { ClipboardCheck, UserPlus, Wallet, BookOpen, CalendarDays } from 'lucide-react';

export default function SalaryBookDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'dashboard'],
    queryFn: async () => (await salaryBookApi.dashboard()).data,
  });

  if (isLoading) return <LoadingState message="Loading dashboard..." />;
  if (isError || !data) {
    return <ErrorState message="Unable to load dashboard." onRetry={() => refetch()} />;
  }

  const today = data.today_attendance;
  const month = data.month;

  return (
    <div className="space-y-5 lg:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-2">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{data.greeting}</h1>
          <p className="text-sm text-gray-500 mt-1">Today's Attendance</p>
        </div>
        <Link
          to="/salary-book/calendar"
          className="hidden lg:inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-white border border-emerald-200 text-emerald-800 font-medium"
        >
          <CalendarDays className="h-4 w-4" />
          Open calendar
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: 'Present', value: today.present },
          { label: 'Absent', value: today.absent },
          { label: 'Half Day', value: today.half_day ?? 0 },
          { label: 'Paid Leave', value: today.paid_leave },
          { label: 'Unpaid', value: today.unpaid_leave },
          { label: 'Holiday', value: today.holiday ?? 0 },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-emerald-100 p-4">
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className="text-3xl font-semibold text-gray-900 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
        <div className="bg-white rounded-xl border border-emerald-100 p-4 lg:p-6 space-y-2">
          <h2 className="font-semibold text-gray-900">{monthLabel(month.year, month.month)}</h2>
          <Row label="Total Employees" value={String(month.total_employees)} />
          <Row label="Monthly Payroll" value={formatINR(month.monthly_payroll)} />
          <Row label="Advances" value={formatINR(month.advances)} />
          <Row label="Salary Pending" value={formatINR(month.salary_pending)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          <Action to="/salary-book/attendance" icon={ClipboardCheck} label="Mark Attendance" />
          <Action to="/salary-book/calendar" icon={CalendarDays} label="Attendance Calendar" />
          <Action to="/salary-book/employees/new" icon={UserPlus} label="Add Employee" />
          <Action to="/salary-book/advances" icon={Wallet} label="Add Advance" />
          <Action to="/salary-book/salaries" icon={BookOpen} label="Salary Book" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function Action({ to, icon: Icon, label }: { to: string; icon: typeof ClipboardCheck; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-center gap-2 w-full min-h-12 rounded-xl bg-emerald-600 text-white font-medium lg:bg-white lg:text-emerald-900 lg:border lg:border-emerald-200 lg:hover:bg-emerald-50"
    >
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}
