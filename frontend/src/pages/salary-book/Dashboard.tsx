import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import {
  formatDurationMinutes,
  formatINR,
  formatLateLabel,
  formatTime,
  methodLabel,
  monthLabel,
  statusLabel,
} from './utils';
import {
  ClipboardCheck,
  UserPlus,
  BookOpen,
  CalendarDays,
  Radio,
  LogIn,
  LogOut,
  Clock3,
  Wallet,
} from 'lucide-react';
import type { Attendance, DashboardLiveUnmarked, DashboardResponse, SalaryRecord } from './types';
import { FilterChips, KpiCard, PageHeader, SalaryButton, SalaryCard, StatusBadge } from './ui';
import { cx } from './ui/tokens';

const LIVE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'PRESENT', label: 'Present' },
  { key: 'HALF_DAY', label: 'Half Day' },
  { key: 'ABSENT', label: 'Absent' },
  { key: 'PAID_LEAVE', label: 'Paid Leave' },
  { key: 'UNPAID_LEAVE', label: 'Unpaid' },
  { key: 'HOLIDAY', label: 'Holiday' },
  { key: 'UNMARKED', label: 'Not marked' },
  { key: 'LATE', label: 'Late' },
] as const;

export default function SalaryBookDashboard() {
  const [filter, setFilter] = useState<(typeof LIVE_FILTERS)[number]['key']>('ALL');
  const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['salary-book', 'dashboard'],
    queryFn: async () => (await salaryBookApi.dashboard()).data as DashboardResponse,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const salariesQuery = useQuery({
    queryKey: ['salary-book', 'salaries', data?.month.year, data?.month.month, 'dashboard'],
    enabled: Boolean(data?.month),
    queryFn: async () =>
      (
        await salaryBookApi.salaries.list({
          year: data!.month.year,
          month: data!.month.month,
        })
      ).data as { results: SalaryRecord[] },
  });

  const lateCount = useMemo(
    () => data?.live.marked.filter((row) => row.is_late).length ?? 0,
    [data]
  );

  const paymentCounts = useMemo(() => {
    const rows = salariesQuery.data?.results || [];
    return {
      paid: rows.filter((r) => r.payment_status === 'PAID').length,
      partial: rows.filter((r) => r.payment_status === 'PARTIALLY_PAID').length,
      pending: rows.filter((r) => r.payment_status === 'PENDING' || !r.payment_status).length,
    };
  }, [salariesQuery.data]);

  const liveItems = useMemo(() => {
    if (!data?.live) return [];
    const marked = data.live.marked.map((row) => ({ kind: 'marked' as const, row }));
    const unmarked = data.live.unmarked.map((row) => ({ kind: 'unmarked' as const, row }));
    if (filter === 'ALL') return [...unmarked, ...marked];
    if (filter === 'UNMARKED') return unmarked;
    if (filter === 'LATE') return marked.filter((item) => item.row.is_late);
    return marked.filter((item) => item.row.status === filter);
  }, [data, filter]);

  if (isLoading) return <LoadingState message="Loading dashboard..." />;
  if (isError || !data) {
    return <ErrorState message="Unable to load dashboard." onRetry={() => refetch()} />;
  }

  const today = data.today_attendance;
  const month = data.month;
  const todayLabel = new Date(`${data.today}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

  const todayCards: Array<{
    label: string;
    value: number;
    filter: (typeof LIVE_FILTERS)[number]['key'];
    tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  }> = [
    { label: 'Present', value: today.present, filter: 'PRESENT', tone: 'success' },
    { label: 'Out', value: today.out ?? 0, filter: 'PRESENT' },
    { label: 'Absent', value: today.absent, filter: 'ABSENT', tone: 'danger' },
    { label: 'Half Day', value: today.half_day ?? 0, filter: 'HALF_DAY', tone: 'warning' },
    { label: 'Paid Leave', value: today.paid_leave, filter: 'PAID_LEAVE', tone: 'info' },
    { label: 'Unpaid', value: today.unpaid_leave, filter: 'UNPAID_LEAVE', tone: 'warning' },
    { label: 'Holiday', value: today.holiday ?? 0, filter: 'HOLIDAY' },
    { label: 'Not marked', value: today.unmarked ?? 0, filter: 'UNMARKED', tone: 'danger' },
    { label: 'Late today', value: lateCount, filter: 'LATE', tone: 'warning' },
  ];

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        title={data.greeting}
        subtitle={`${todayLabel} · today’s attendance`}
        actions={
          <Link
            to="/salary-book/calendar"
            className="hidden lg:inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-700 font-medium text-sm hover:bg-slate-50"
          >
            <CalendarDays className="h-4 w-4" />
            Open calendar
          </Link>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2 sm:gap-3">
        {todayCards.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={card.value}
            tone={card.tone}
            active={filter === card.filter && card.label !== 'Out'}
            onClick={() => setFilter(card.filter)}
          />
        ))}
      </div>

      <div data-tutorial="dash-live">
        <LiveAttendanceList
          filter={filter}
          onFilter={setFilter}
          items={liveItems}
          updatedAt={dataUpdatedAt}
          fetching={isFetching}
          onRefresh={() => refetch()}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Employees"
          value={month.total_employees}
          to="/salary-book/employees"
          hint={monthLabel(month.year, month.month)}
        />
        <KpiCard
          label="Monthly payroll"
          value={formatINR(month.monthly_payroll)}
          to="/salary-book/salaries"
        />
        <KpiCard
          label="Advances"
          value={formatINR(month.advances)}
          to="/salary-book/advances"
          tone="info"
        />
        <KpiCard
          label="Salary pending"
          value={formatINR(month.salary_pending)}
          to="/salary-book/salaries"
          tone="warning"
          hint={
            salariesQuery.data
              ? `${paymentCounts.pending} pending · ${paymentCounts.partial} partial · ${paymentCounts.paid} paid`
              : undefined
          }
        />
      </div>

      <div data-tutorial="dash-actions" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <Action to="/salary-book/attendance" icon={ClipboardCheck} label="Mark attendance" primary />
        <Action to="/salary-book/calendar" icon={CalendarDays} label="Calendar" />
        <Action to="/salary-book/employees/new" icon={UserPlus} label="Add employee" />
        <Action to="/salary-book/advances" icon={Wallet} label="Record advance" />
        <Action to="/salary-book/salaries" icon={BookOpen} label="Salary Book" />
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
    <SalaryCard>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Radio className={cx('h-4 w-4', fetching ? 'text-emerald-500 animate-pulse' : 'text-emerald-700')} />
          <h2 className="font-semibold text-slate-900">Live timetable</h2>
        </div>
        <SalaryButton variant="ghost" size="sm" onClick={onRefresh}>
          Updated{' '}
          {updatedAt
            ? new Date(updatedAt).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            : '—'}
          {' · '}
          Refresh
        </SalaryButton>
      </div>
      <FilterChips chips={LIVE_FILTERS} value={filter} onChange={onFilter} />
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">No one in this list yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) =>
            item.kind === 'unmarked' ? (
              <li
                key={`u-${item.row.id}`}
                className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{item.row.name}</div>
                  <div className="text-xs text-slate-500">{item.row.employee_id}</div>
                </div>
                <StatusBadge status="UNMARKED" label="Not marked" />
              </li>
            ) : (
              <LiveMarkedRow key={item.row.id} row={item.row} />
            )
          )}
        </ul>
      )}
    </SalaryCard>
  );
}

function LiveMarkedRow({ row }: { row: Attendance }) {
  const late = Boolean(row.is_late && row.minutes_late);
  const worked =
    formatDurationMinutes(row.worked_minutes) ||
    (Number(row.worked_hours) > 0 ? `${row.worked_hours}h` : '');
  const method = methodLabel(row.attendance_method);

  return (
    <li className={cx('rounded-xl border px-3 py-2.5', late ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">{row.employee_name}</div>
          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{row.employee_code}</span>
            {method ? <span className="text-emerald-800">· {method}</span> : null}
            {row.rule_penalty_applied ? <span className="text-red-700">· Penalty</span> : null}
          </div>
        </div>
        <StatusBadge status={row.status} label={statusLabel(row.status)} />
      </div>

      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <TimeChip icon={LogIn} label="In" value={row.check_in_time ? formatTime(row.check_in_time) : '—'} tone={row.check_in_time ? 'emerald' : 'muted'} />
        <TimeChip icon={LogOut} label="Out" value={row.check_out_time ? formatTime(row.check_out_time) : '—'} tone={row.check_out_time ? 'emerald' : 'muted'} />
        <TimeChip icon={Clock3} label="Worked" value={worked || '—'} tone={worked ? 'slate' : 'muted'} />
        <TimeChip
          icon={Clock3}
          label="Late"
          value={late ? formatLateLabel(row.minutes_late).replace(/^Late\s/, '') : 'On time'}
          tone={late ? 'amber' : 'emerald'}
        />
      </div>
    </li>
  );
}

function TimeChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  tone: 'emerald' | 'amber' | 'slate' | 'muted';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-100'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-950 border-amber-200'
        : tone === 'slate'
          ? 'bg-slate-50 text-slate-800 border-slate-100'
          : 'bg-slate-50 text-slate-500 border-slate-100';

  return (
    <div className={`rounded-lg border px-2.5 py-2 ${toneClass}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Action({
  to,
  icon: Icon,
  label,
  primary,
}: {
  to: string;
  icon: typeof ClipboardCheck;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cx(
        'flex items-center justify-center gap-2 w-full min-h-12 rounded-xl font-medium text-sm',
        primary
          ? 'bg-emerald-700 text-white hover:bg-emerald-800'
          : 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
