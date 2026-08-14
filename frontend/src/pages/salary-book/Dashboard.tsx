import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { formatINR, formatTime, monthLabel, statusLabel } from './utils';
import { ClipboardCheck, UserPlus, Wallet, BookOpen, CalendarDays, Radio } from 'lucide-react';
import type { Attendance, DashboardLiveUnmarked, DashboardResponse } from './types';

const LIVE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'PRESENT', label: 'Present' },
  { key: 'HALF_DAY', label: 'Half Day' },
  { key: 'ABSENT', label: 'Absent' },
  { key: 'PAID_LEAVE', label: 'Paid Leave' },
  { key: 'UNPAID_LEAVE', label: 'Unpaid' },
  { key: 'HOLIDAY', label: 'Holiday' },
  { key: 'UNMARKED', label: 'Not marked' },
] as const;

const STATUS_PILL: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800',
  HALF_DAY: 'bg-amber-100 text-amber-900',
  ABSENT: 'bg-red-100 text-red-800',
  PAID_LEAVE: 'bg-sky-100 text-sky-800',
  UNPAID_LEAVE: 'bg-orange-100 text-orange-800',
  HOLIDAY: 'bg-violet-100 text-violet-800',
  UNMARKED: 'bg-gray-100 text-gray-600',
};

export default function SalaryBookDashboard() {
  const [filter, setFilter] = useState<(typeof LIVE_FILTERS)[number]['key']>('ALL');
  const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['salary-book', 'dashboard'],
    queryFn: async () => (await salaryBookApi.dashboard()).data as DashboardResponse,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const liveItems = useMemo(() => {
    if (!data?.live) return [];
    const marked = data.live.marked.map((row) => ({ kind: 'marked' as const, row }));
    const unmarked = data.live.unmarked.map((row) => ({ kind: 'unmarked' as const, row }));
    if (filter === 'ALL') return [...marked, ...unmarked];
    if (filter === 'UNMARKED') return unmarked;
    return marked.filter((item) => item.row.status === filter);
  }, [data, filter]);

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

      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        {[
          { label: 'Present', value: today.present },
          { label: 'Absent', value: today.absent },
          { label: 'Half Day', value: today.half_day ?? 0 },
          { label: 'Paid Leave', value: today.paid_leave },
          { label: 'Unpaid', value: today.unpaid_leave },
          { label: 'Holiday', value: today.holiday ?? 0 },
          { label: 'Not marked', value: today.unmarked ?? 0 },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-emerald-100 p-4">
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className="text-3xl font-semibold text-gray-900 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      <LiveAttendanceList
        filter={filter}
        onFilter={setFilter}
        items={liveItems}
        updatedAt={dataUpdatedAt}
        fetching={isFetching}
        onRefresh={() => refetch()}
      />

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

function LiveAttendanceList({
  filter,
  onFilter,
  items,
  updatedAt,
  fetching,
  onRefresh,
}: {
  filter: (typeof LIVE_FILTERS)[number]['key'];
  onFilter: (key: (typeof LIVE_FILTERS)[number]['key']) => void;
  items: Array<{ kind: 'marked'; row: Attendance } | { kind: 'unmarked'; row: DashboardLiveUnmarked }>;
  updatedAt: number;
  fetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Radio className={`h-4 w-4 ${fetching ? 'text-emerald-500 animate-pulse' : 'text-emerald-700'}`} />
          <h2 className="font-semibold text-gray-900">Live check-ins</h2>
        </div>
        <button type="button" onClick={onRefresh} className="text-xs text-emerald-800 font-medium text-left">
          Updated {updatedAt ? new Date(updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
          {' · '}Refresh
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {LIVE_FILTERS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onFilter(chip.key)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap min-h-9 ${
              filter === chip.key ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-900'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">No one in this list yet.</p>
      ) : (
        <ul className="divide-y divide-emerald-50 mt-1">
          {items.map((item) =>
            item.kind === 'unmarked' ? (
              <li key={`u-${item.row.id}`} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{item.row.name}</div>
                  <div className="text-xs text-gray-500">{item.row.employee_id}</div>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_PILL.UNMARKED}`}>
                  Not marked
                </span>
              </li>
            ) : (
              <li key={item.row.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{item.row.employee_name}</div>
                  <div className="text-xs text-gray-500">{item.row.employee_code}</div>
                  <div className="text-sm text-gray-700 mt-1">
                    {item.row.check_in_time ? `In ${formatTime(item.row.check_in_time)}` : 'No check-in time'}
                    {item.row.check_out_time ? ` · Out ${formatTime(item.row.check_out_time)}` : ''}
                    {item.row.is_late && item.row.minutes_late ? ` · Late ${item.row.minutes_late}m` : ''}
                    {item.row.rule_penalty_applied ? ' · Penalty' : ''}
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${STATUS_PILL[item.row.status] || STATUS_PILL.UNMARKED}`}>
                  {statusLabel(item.row.status)}
                </span>
              </li>
            )
          )}
        </ul>
      )}
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
