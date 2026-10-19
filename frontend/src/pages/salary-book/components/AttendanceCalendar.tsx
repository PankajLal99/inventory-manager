import { useEffect, useState, type ReactNode } from 'react';
import { Briefcase, ChevronLeft, ChevronRight, Plus, RefreshCw, Umbrella, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatINR, formatTime, monthLabel, statusLabel } from '../utils';
import type { CalendarEmployee, CalendarKpis, CalendarTodayKpis, CalendarDayCell } from '../types';

export const STATUS_STYLE: Record<string, { bg: string; text: string; short: string }> = {
  PRESENT: { bg: 'bg-emerald-500', text: 'text-white', short: 'P' },
  HALF_DAY: { bg: 'bg-amber-400', text: 'text-amber-950', short: '½' },
  ABSENT: { bg: 'bg-red-500', text: 'text-white', short: 'A' },
  PAID_LEAVE: { bg: 'bg-sky-500', text: 'text-white', short: 'PL' },
  UNPAID_LEAVE: { bg: 'bg-orange-500', text: 'text-white', short: 'UL' },
  HOLIDAY: { bg: 'bg-violet-500', text: 'text-white', short: 'H' },
  BEFORE_JOINING: { bg: 'bg-gray-100', text: 'text-gray-300', short: '' },
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Single-letter headers for narrow month grids (Tue/Thu stay distinct as T/Th via short labels). */
const WEEKDAY_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isSunday(year: number, month: number, day: number) {
  return new Date(year, month - 1, day).getDay() === 0;
}

function weekdayShort(year: number, month: number, day: number) {
  return WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()];
}

function shortTime(iso: string | null | undefined) {
  if (!iso) return '';
  const formatted = formatTime(iso);
  // Drop am/pm suffix for compact grid cells (e.g. "09:05 am" → "9:05")
  return formatted.replace(/\s?(am|pm|AM|PM)/, '').replace(/^0/, '');
}

function cellTitle(cell: CalendarDayCell | undefined, iso: string) {
  if (!cell?.status || cell.status === 'BEFORE_JOINING') return iso;
  return [
    statusLabel(cell.status),
    cell.check_in_time ? `In ${formatTime(cell.check_in_time)}` : '',
    cell.check_out_time ? `Out ${formatTime(cell.check_out_time)}` : '',
    cell.is_late && cell.minutes_late ? `Late ${cell.minutes_late}m` : '',
    cell.is_early && cell.minutes_early ? `Early out ${cell.minutes_early}m` : '',
    cell.rule_penalty_applied ? 'Penalty' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function MonthNav({
  year,
  month,
  onChange,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}) {
  const prev = () => {
    if (month === 1) onChange(year - 1, 12);
    else onChange(year, month - 1);
  };
  const next = () => {
    if (month === 12) onChange(year + 1, 1);
    else onChange(year, month + 1);
  };
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="p-2 rounded-lg hover:bg-emerald-100 min-h-11 min-w-11" onClick={prev} aria-label="Previous month">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="min-w-[10rem] text-center font-semibold text-gray-900">{monthLabel(year, month)}</div>
      <button type="button" className="p-2 rounded-lg hover:bg-emerald-100 min-h-11 min-w-11" onClick={next} aria-label="Next month">
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

export function CalendarRefreshButton({
  onRefresh,
  fetching,
  updatedAt,
}: {
  onRefresh: () => void;
  fetching?: boolean;
  updatedAt?: number;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={fetching}
      className="inline-flex items-center gap-2 min-h-11 px-3 sm:px-4 rounded-xl bg-white border border-emerald-200 text-emerald-800 font-medium text-sm disabled:opacity-60"
      aria-label="Refresh calendar"
      title={
        updatedAt
          ? `Updated ${new Date(updatedAt).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}`
          : 'Refresh calendar'
      }
    >
      <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">Refresh</span>
    </button>
  );
}

export function KpiStrip({ kpis, compact }: { kpis: CalendarKpis; compact?: boolean }) {
  const cards = [
    { label: 'Present', value: kpis.present },
    { label: 'Absent', value: kpis.absent },
    { label: 'Half Day', value: kpis.half_day },
    { label: 'Paid Leave', value: kpis.paid_leave },
    { label: 'Unpaid', value: kpis.unpaid_leave },
    { label: 'Holiday', value: kpis.holiday },
    { label: 'Unmarked', value: kpis.unmarked },
    { label: 'Attendance', value: `${Number(kpis.attendance_rate).toFixed(1)}%` },
  ];
  return (
    <div
      className={`flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory sm:mx-0 sm:px-0 sm:pb-0 sm:overflow-visible sm:grid sm:grid-cols-4 ${
        compact ? 'lg:grid-cols-8' : 'lg:grid-cols-4 xl:grid-cols-8'
      } sm:gap-3`}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white rounded-xl border border-emerald-100 p-3 sm:p-4 shrink-0 w-[6.75rem] snap-start sm:w-auto sm:shrink"
        >
          <div className="text-[11px] sm:text-sm text-gray-500 leading-tight">{card.label}</div>
          <div className="text-lg sm:text-2xl font-semibold text-gray-900 mt-0.5 sm:mt-1 tabular-nums">
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Calendar header KPIs: today snapshot + month attendance rate (no duplicate present/absent). */
export function CalendarSummaryStrip({
  today,
  kpis,
}: {
  today: CalendarTodayKpis;
  kpis: CalendarKpis;
}) {
  const cards = [
    { label: 'Total Employees', value: today.total_employees },
    { label: 'Present Today', value: today.present },
    { label: 'Out Today', value: today.out ?? 0 },
    { label: 'Absent Today', value: today.absent },
    { label: 'Half Day Today', value: today.half_day },
    { label: 'Month Attendance', value: `${Number(kpis.attendance_rate).toFixed(1)}%` },
    { label: 'Unmarked (month)', value: kpis.unmarked },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 sm:gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-xl border border-emerald-100 p-3 sm:p-4">
          <div className="text-[11px] sm:text-sm text-gray-500 leading-tight">{card.label}</div>
          <div className="text-xl sm:text-2xl font-semibold text-gray-900 mt-0.5 tabular-nums">
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmployeeMoneyFooter({ emp }: { emp: CalendarEmployee }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 flex items-center gap-2 min-w-0">
        <Wallet className="h-4 w-4 text-emerald-700 shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] sm:text-xs text-emerald-800/80 leading-tight">Salary Generated</div>
          <div className="text-sm font-semibold text-emerald-950 tabular-nums truncate">
            {formatINR(emp.salary_generated || 0)}
          </div>
        </div>
      </div>
      <div className="rounded-xl bg-sky-50 border border-sky-100 px-3 py-2 flex items-center gap-2 min-w-0">
        <Briefcase className="h-4 w-4 text-sky-700 shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] sm:text-xs text-sky-800/80 leading-tight">Taken</div>
          <div className="text-sm font-semibold text-sky-950 tabular-nums truncate">
            {formatINR(emp.taken || 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendItems({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-2 text-xs sm:text-sm text-gray-600 ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-4 sm:h-5 overflow-hidden rounded-sm">
          <span className="bg-emerald-500 text-white px-1 text-[9px] sm:text-[10px] leading-4 sm:leading-5">IN</span>
          <span className="bg-sky-600 text-white px-1 text-[9px] sm:text-[10px] leading-4 sm:leading-5">OUT</span>
        </span>
        On time
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 sm:h-3.5 sm:w-3.5 rounded-sm bg-amber-400" />
        Late IN
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 sm:h-3.5 sm:w-3.5 rounded-sm bg-orange-500" />
        Early OUT
      </span>
      {Object.entries(STATUS_STYLE)
        .filter(([key]) => key !== 'BEFORE_JOINING' && key !== 'PRESENT')
        .map(([key, style]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 sm:h-3.5 sm:w-3.5 rounded-sm ${style.bg}`} />
            {statusLabel(key)}
          </span>
        ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 sm:h-3.5 sm:w-3.5 rounded-sm bg-gray-200 ring-1 ring-dashed ring-emerald-300" />
        Unmarked (tap)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs font-semibold text-rose-600">Sun</span>
        Weekly off
      </span>
      <span className="inline-flex items-center gap-1.5">L = Late</span>
      <span className="inline-flex items-center gap-1.5">P = Penalty</span>
    </div>
  );
}

export function CalendarLegend() {
  return (
    <>
      <details className="sm:hidden group rounded-xl border border-emerald-100 bg-white">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium text-gray-700 marker:content-none [&::-webkit-details-marker]:hidden">
          Legend
          <span className="text-gray-400 group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <div className="border-t border-emerald-50 px-3 py-3">
          <LegendItems />
        </div>
      </details>
      <LegendItems className="hidden sm:flex" />
    </>
  );
}

function hasPunchTimes(cell: CalendarDayCell | undefined) {
  return Boolean(cell?.check_in_time || cell?.check_out_time);
}

/** Days with no attendance record can receive manual in/out. */
export function isUnmarkedCalendarDay(cell: CalendarDayCell | undefined) {
  return !cell?.status;
}

/** Any past/today day except before-joining can be edited (times and/or status). */
export function canEditCalendarDayTimes(cell: CalendarDayCell | undefined) {
  if (!cell?.status) return true;
  return cell.status !== 'BEFORE_JOINING';
}

export type CalendarDayClick = {
  employeeId: number;
  employeeName: string;
  date: string;
  cell?: CalendarDayCell;
};

function InOutSplitCell({
  cell,
  isToday,
  compact,
}: {
  cell: CalendarDayCell;
  isToday: boolean;
  compact?: boolean;
}) {
  const lateIn = Boolean(cell.is_late);
  const earlyOut = Boolean(cell.is_early && cell.check_out_time);
  const inBg = lateIn ? 'bg-amber-400 text-amber-950' : 'bg-emerald-500 text-white';
  const outBg = !cell.check_out_time
    ? 'bg-slate-400 text-white'
    : earlyOut
      ? 'bg-orange-500 text-white'
      : 'bg-sky-600 text-white';

  // Compact (admin mobile strip): stack IN/OUT vertically so narrow columns stay readable.
  if (compact) {
    return (
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-lg min-h-[3.25rem] ${
          isToday ? 'ring-2 ring-emerald-700 ring-offset-1' : ''
        }`}
      >
        <div className={`flex flex-1 items-center justify-center px-0.5 py-0.5 ${inBg}`}>
          <span className="text-[10px] font-semibold leading-none tabular-nums">
            {shortTime(cell.check_in_time) || '—'}
          </span>
        </div>
        <div className={`flex flex-1 items-center justify-center px-0.5 py-0.5 ${outBg}`}>
          <span className="text-[10px] font-semibold leading-none tabular-nums">
            {shortTime(cell.check_out_time) || '—'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full w-full overflow-hidden rounded-lg min-h-[3.75rem] ${
        isToday ? 'ring-2 ring-emerald-700 ring-offset-1' : ''
      }`}
    >
      <div className={`flex flex-1 flex-col items-center justify-center px-1 py-1.5 ${inBg}`}>
        <span className="text-[10px] font-semibold uppercase leading-none tracking-wide opacity-90">IN</span>
        <span className="mt-1 text-sm font-semibold leading-none tabular-nums">
          {shortTime(cell.check_in_time) || '—'}
        </span>
      </div>
      <div className={`flex flex-1 flex-col items-center justify-center px-1 py-1.5 ${outBg}`}>
        <span className="text-[10px] font-semibold uppercase leading-none tracking-wide opacity-90">OUT</span>
        <span className="mt-1 text-sm font-semibold leading-none tabular-nums">
          {shortTime(cell.check_out_time) || '—'}
        </span>
      </div>
    </div>
  );
}

function DayStatusCell({
  year,
  month,
  day,
  cell,
  isToday,
  isPast,
  compact,
  clickable,
  onClick,
}: {
  year: number;
  month: number;
  day: number;
  cell: CalendarDayCell | undefined;
  isToday: boolean;
  isPast?: boolean;
  compact?: boolean;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const sunday = isSunday(year, month, day);
  const status = cell?.status;
  const marked = Boolean(status && status !== 'BEFORE_JOINING');
  const minH = compact ? 'min-h-[3.25rem]' : 'min-h-[3.75rem]';
  const interactive = Boolean(clickable && onClick);

  const wrap = (node: ReactNode, className = '') => {
    if (!interactive) return node;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick?.();
        }}
        className={`block h-full w-full text-left cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-lg ${className}`}
        aria-label={`${marked ? 'Edit' : 'Add'} attendance for day ${day}`}
      >
        {node}
      </button>
    );
  };

  // Sundays with no attendance show weekly-off label instead of a grey dash.
  if (sunday && !marked) {
    return wrap(
      <div
        className={`flex h-full w-full items-center justify-center rounded-lg bg-rose-50 px-0.5 ${minH} ${
          isToday ? 'ring-2 ring-emerald-500' : ''
        } ${interactive ? 'ring-1 ring-dashed ring-rose-200' : ''}`}
      >
        <span
          className={`font-semibold leading-tight text-rose-600 ${
            compact ? 'text-[10px]' : 'text-xs'
          }`}
        >
          {compact ? 'Sun' : 'Sunday'}
        </span>
      </div>
    );
  }

  if (hasPunchTimes(cell) && (status === 'PRESENT' || status === 'HALF_DAY' || !status)) {
    return wrap(
      <InOutSplitCell cell={cell!} isToday={isToday} compact={compact} />,
      interactive ? 'ring-1 ring-dashed ring-emerald-300' : ''
    );
  }

  if (!status || status === 'BEFORE_JOINING') {
    // Past unmarked weekdays look absent (red) so missed punches are obvious; today stays a dash.
    if (isPast && status !== 'BEFORE_JOINING') {
      return wrap(
        <div
          className={`flex h-full w-full flex-col items-center justify-center rounded-lg bg-red-500 text-white ${minH} ${
            interactive ? 'ring-1 ring-dashed ring-red-200 hover:opacity-90' : ''
          }`}
        >
          <span className={`font-bold leading-none ${compact ? 'text-sm' : 'text-base'}`}>A</span>
          {interactive && (
            <span className="mt-1 text-[9px] font-medium leading-none opacity-90">
              {compact ? 'Add' : 'Tap'}
            </span>
          )}
        </div>
      );
    }

    return wrap(
      <div
        className={`flex h-full w-full items-center justify-center rounded-lg bg-gray-100 text-gray-400 ${minH} ${
          isToday ? 'ring-2 ring-emerald-500' : ''
        } ${interactive ? 'ring-1 ring-dashed ring-emerald-300 hover:bg-emerald-50 hover:text-emerald-700' : ''}`}
      >
        <span className={`leading-none ${interactive ? (compact ? 'text-[10px] font-medium' : 'text-xs font-medium') : 'text-base'}`}>
          {interactive ? (compact ? 'Add' : '+ Add') : '-'}
        </span>
      </div>
    );
  }

  const style = STATUS_STYLE[status];
  return wrap(
    <div
      className={`flex h-full w-full flex-col items-center justify-center rounded-lg ${minH} ${style?.bg || 'bg-gray-100'} ${style?.text || 'text-gray-500'} ${
        isToday ? 'ring-2 ring-emerald-700 ring-offset-1' : ''
      } ${interactive ? 'ring-1 ring-dashed ring-white/50' : ''}`}
    >
      {status === 'HOLIDAY' ? (
        <Umbrella className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      ) : (
        <span className={`font-bold leading-none ${compact ? 'text-sm' : 'text-base'}`}>
          {style?.short || status}
        </span>
      )}
      {(cell?.is_late || cell?.rule_penalty_applied) && (
        <span className="mt-1 text-[10px] leading-none opacity-90">
          {cell.rule_penalty_applied ? 'P' : 'L'}
        </span>
      )}
      {interactive && (
        <span className="mt-1 text-[9px] font-medium leading-none opacity-90">Edit</span>
      )}
    </div>
  );
}

/** Compact square cell for mobile month grids — status color only, no IN/OUT split. */
function MobileDayChip({
  year,
  month,
  day,
  cell,
  isToday,
  isPast,
  selected,
  onSelect,
}: {
  year: number;
  month: number;
  day: number;
  cell: CalendarDayCell | undefined;
  isToday: boolean;
  isPast: boolean;
  selected?: boolean;
  onSelect: () => void;
}) {
  const sunday = isSunday(year, month, day);
  const status = cell?.status;
  const marked = Boolean(status && status !== 'BEFORE_JOINING');
  const lateBadge = cell?.rule_penalty_applied ? 'P' : cell?.is_late ? 'L' : '';

  let bg = 'bg-gray-100 text-gray-500';
  let label = String(day);
  let sub = '';

  if (sunday && !marked) {
    bg = 'bg-rose-50 text-rose-600';
    sub = 'Off';
  } else if (hasPunchTimes(cell) && (status === 'PRESENT' || status === 'HALF_DAY' || !status)) {
    if (status === 'HALF_DAY') {
      bg = 'bg-amber-400 text-amber-950';
      sub = '½';
    } else if (cell?.is_late) {
      bg = 'bg-amber-400 text-amber-950';
      sub = '';
    } else {
      bg = 'bg-emerald-500 text-white';
      sub = '';
    }
  } else if (!status || status === 'BEFORE_JOINING') {
    if (isPast && status !== 'BEFORE_JOINING') {
      bg = 'bg-red-500 text-white';
      sub = 'A';
    } else if (status === 'BEFORE_JOINING') {
      bg = 'bg-gray-50 text-gray-300';
      sub = '';
    } else {
      bg = isToday
        ? 'bg-white text-emerald-700 ring-1 ring-dashed ring-emerald-400'
        : 'bg-gray-100 text-gray-400';
      sub = '+';
    }
  } else {
    const style = STATUS_STYLE[status];
    bg = `${style?.bg || 'bg-gray-100'} ${style?.text || 'text-gray-500'}`;
    sub = style?.short || '';
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      title={cellTitle(cell, `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)}
      className={`relative flex aspect-square w-full flex-col items-center justify-center rounded-lg ${bg} ${
        isToday && marked ? 'ring-2 ring-emerald-700 ring-offset-1' : ''
      } ${selected ? 'ring-2 ring-emerald-600 ring-offset-1' : ''} focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600`}
      aria-label={`Day ${day}${sub ? `, ${sub}` : ''}`}
      aria-pressed={selected}
    >
      <span className="text-[11px] font-semibold leading-none tabular-nums">{label}</span>
      {sub && sub !== String(day) && (
        <span className="mt-0.5 text-[9px] font-bold leading-none opacity-90">{sub}</span>
      )}
      {lateBadge && (
        <span className="absolute right-0.5 top-0.5 text-[8px] font-bold leading-none opacity-90">
          {lateBadge}
        </span>
      )}
      {status === 'HOLIDAY' && !sub && <Umbrella className="mt-0.5 h-3 w-3" />}
    </button>
  );
}

function SelectedDayPanel({
  year,
  month,
  day,
  cell,
  today,
  employee,
  onAdd,
}: {
  year: number;
  month: number;
  day: number;
  cell: CalendarDayCell | undefined;
  today: string;
  employee: CalendarEmployee;
  onAdd?: (payload: CalendarDayClick) => void;
}) {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const sunday = isSunday(year, month, day);
  const canAdd = Boolean(onAdd) && canEditCalendarDayTimes(cell) && iso <= today;
  const status = cell?.status;
  const style = status ? STATUS_STYLE[status] : undefined;

  return (
    <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {weekdayShort(year, month, day)} {day} · {monthLabel(year, month)}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {status && status !== 'BEFORE_JOINING'
              ? statusLabel(status)
              : sunday
                ? 'Weekly off'
                : iso > today
                  ? 'Upcoming'
                  : 'Unmarked'}
          </div>
        </div>
        {style && status && status !== 'BEFORE_JOINING' && (
          <span className={`rounded-md px-2 py-1 text-xs font-bold ${style.bg} ${style.text}`}>
            {style.short}
          </span>
        )}
      </div>

      {(cell?.check_in_time || cell?.check_out_time) && (
        <div
          className={`grid gap-2 ${
            iso < today || cell?.check_out_time ? 'grid-cols-2' : 'grid-cols-1'
          }`}
        >
          <div className="rounded-lg bg-white border border-emerald-100 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">In</div>
            <div className="text-base font-semibold tabular-nums text-gray-900">
              {cell.check_in_time ? formatTime(cell.check_in_time) : '—'}
            </div>
            {cell.is_late && cell.minutes_late ? (
              <div className="text-[11px] text-amber-700 font-medium">Late {cell.minutes_late}m</div>
            ) : null}
          </div>
          {(iso < today || cell?.check_out_time) && (
            <div className="rounded-lg bg-white border border-emerald-100 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Out</div>
              <div className="text-base font-semibold tabular-nums text-gray-900">
                {cell.check_out_time ? formatTime(cell.check_out_time) : '—'}
              </div>
              {cell.is_early && cell.minutes_early ? (
                <div className="text-[11px] text-orange-700 font-medium">Early {cell.minutes_early}m</div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {cell?.rule_penalty_applied && (
        <div className="text-xs font-medium text-rose-700">Late penalty applied</div>
      )}

      {canAdd && (
        <button
          type="button"
          className="flex w-full items-center justify-center min-h-11 rounded-xl bg-emerald-600 text-white text-sm font-medium"
          onClick={() =>
            onAdd?.({
              employeeId: employee.id,
              employeeName: employee.name,
              date: iso,
              cell,
            })
          }
        >
          {cell?.id ? 'Edit attendance' : 'Add in / out times'}
        </button>
      )}
    </div>
  );
}

type CycleDayItem = {
  iso: string;
  y: number;
  m: number;
  d: number;
  cell: CalendarDayCell | undefined;
};

/** Add calendar days (can cross months). */
function addCalendarDays(y: number, m: number, d: number, delta: number) {
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function isoFromParts(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "14 October" from an ISO date or a cycle day item. */
function formatCycleBound(
  iso: string | null | undefined,
  fallback?: { y: number; m: number; d: number } | null,
) {
  if (iso) {
    const [y, m, d] = iso.split('-').map(Number);
    if (y && m && d) return `${d} ${monthLabel(y, m).split(' ')[0]}`;
  }
  if (fallback) return `${fallback.d} ${monthLabel(fallback.y, fallback.m).split(' ')[0]}`;
  return '';
}

/**
 * Build cycle strip for cycleDay > 1: previous joining day → this joining day.
 * Example day 13, October → 13 Sep … 13 Oct (31 days). Else calendar 1…last.
 */
function buildCycleWindowList(
  employee: CalendarEmployee,
  year: number,
  month: number,
  daysInMonth: number,
  cycleDay: number,
  rangeStartIso?: string | null,
  rangeEndIso?: string | null,
): CycleDayItem[] {
  if (cycleDay <= 1) {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const iso = isoFromParts(year, month, d);
      return {
        iso,
        y: year,
        m: month,
        d,
        cell: employee.cycle_days?.[iso] || employee.days[String(d)],
      };
    });
  }

  let startIso = rangeStartIso || undefined;
  let endIso = rangeEndIso || undefined;
  if (!startIso || !endIso) {
    // Period ending this month: previous joining day → this joining day
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const startD = Math.min(cycleDay, new Date(prev.y, prev.m, 0).getDate());
    const endD = Math.min(cycleDay, daysInMonth);
    startIso = isoFromParts(prev.y, prev.m, startD);
    endIso = isoFromParts(year, month, endD);
  }

  const list: CycleDayItem[] = [];
  const [sy, sm, sd] = startIso.split('-').map(Number);
  let cur = { y: sy, m: sm, d: sd };
  while (true) {
    const iso = isoFromParts(cur.y, cur.m, cur.d);
    const cell =
      employee.cycle_days?.[iso] ||
      (cur.y === year && cur.m === month ? employee.days[String(cur.d)] : undefined);
    list.push({ iso, y: cur.y, m: cur.m, d: cur.d, cell });
    if (iso >= endIso) break;
    cur = addCalendarDays(cur.y, cur.m, cur.d, 1);
    // Safety: never walk more than ~62 days
    if (list.length > 62) break;
  }
  return list;
}

/**
 * Days to show for one employee.
 * Prefer API cycle_days when bounds match period_start / period_end_marker;
 * otherwise rebuild so month changes still populate prior-cycle attendance.
 */
function employeeCycleDayList(
  employee: CalendarEmployee,
  year: number,
  month: number,
  daysInMonth: number,
): CycleDayItem[] {
  const cycleDay = employee.salary_cycle_start_day || 1;
  const cycle = employee.cycle_days;
  const periodStart = employee.period_start || null;
  const periodEndMarker = employee.period_end_marker || null;

  const boundsMatchRequest = (() => {
    if (!periodEndMarker || cycleDay <= 1) return true;
    const [ey, em] = periodEndMarker.split('-').map(Number);
    return ey === year && em === month;
  })();

  if (cycle && Object.keys(cycle).length > 0 && boundsMatchRequest) {
    const list = Object.keys(cycle)
      .sort()
      .map((iso) => {
        const [y, m, d] = iso.split('-').map(Number);
        return { iso, y, m, d, cell: cycle[iso] };
      });

    if (cycleDay > 1 && periodStart && periodEndMarker) {
      const first = list[0]?.iso;
      const last = list[list.length - 1]?.iso;
      const matchesBounds = first === periodStart && last === periodEndMarker;
      const tooShort = list.length < 27;
      if (matchesBounds && !tooShort) return list;
      return buildCycleWindowList(
        employee,
        year,
        month,
        daysInMonth,
        cycleDay,
        periodStart,
        periodEndMarker,
      );
    }

    if (cycleDay > 1) {
      const last = list[list.length - 1];
      const expectedEndD = Math.min(cycleDay, daysInMonth);
      const endsOnMonthLast =
        last && last.y === year && last.m === month && last.d === daysInMonth;
      const endsOnCycleMarker =
        last && last.y === year && last.m === month && last.d === expectedEndD;
      const hasMarker = list.some((item) => item.cell?.is_cycle_end_marker);
      const tooShort = list.length < 27;
      if (tooShort || (endsOnMonthLast && !endsOnCycleMarker && !hasMarker)) {
        return buildCycleWindowList(employee, year, month, daysInMonth, cycleDay);
      }
    }
    return list;
  }

  return buildCycleWindowList(
    employee,
    year,
    month,
    daysInMonth,
    cycleDay,
    boundsMatchRequest ? periodStart : null,
    boundsMatchRequest ? periodEndMarker : null,
  );
}

export function EmployeeMonthGrid({
  year,
  month,
  daysInMonth,
  today,
  employee,
  onDayClick,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  today: string;
  employee: CalendarEmployee;
  onDayClick?: (payload: CalendarDayClick) => void;
}) {
  const dayList = employeeCycleDayList(employee, year, month, daysInMonth);
  const first = dayList[0];
  const firstWeekday = first
    ? new Date(first.y, first.m - 1, first.d).getDay()
    : new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstWeekday });
  const cycleDay = employee.salary_cycle_start_day || 1;
  const usesCycle = Boolean(employee.cycle_days && Object.keys(employee.cycle_days).length > 0);

  const defaultIso =
    dayList.find((x) => x.iso === today)?.iso ||
    dayList.find((x) => x.iso <= today)?.iso ||
    dayList[0]?.iso ||
    null;

  const [selectedIso, setSelectedIso] = useState<string | null>(defaultIso);
  useEffect(() => {
    setSelectedIso(defaultIso);
  }, [year, month, employee.id, defaultIso]);

  const selected = dayList.find((x) => x.iso === selectedIso);

  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-3 sm:p-4 lg:p-6 space-y-2">
      {cycleDay > 1 && dayList.length > 0 ? (
        <p className="text-xs text-emerald-800 font-medium px-0.5">
          Cycle from joining day {cycleDay}:{' '}
          {formatCycleBound(employee.period_start, dayList[0])} →{' '}
          {formatCycleBound(employee.period_end_marker, dayList[dayList.length - 1])}{' '}
          ({dayList.length} days; next cycle starts the day after payday)
        </p>
      ) : null}

      {/* Mobile: dense status chips + selected-day detail */}
      <div className="md:hidden">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-gray-500 mb-2">
          {WEEKDAY_NARROW.map((d, i) => (
            <div key={`${d}-${i}`} className={`py-0.5 ${i === 0 ? 'text-rose-600' : ''}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {blanks.map((_, i) => (
            <div key={`mb-${i}`} />
          ))}
          {dayList.map((item) => (
            <MobileDayChip
              key={item.iso}
              year={item.y}
              month={item.m}
              day={item.d}
              cell={item.cell}
              isToday={item.iso === today}
              isPast={item.iso < today}
              selected={selectedIso === item.iso}
              onSelect={() => setSelectedIso(item.iso)}
            />
          ))}
        </div>
        {selected && (
          <SelectedDayPanel
            year={selected.y}
            month={selected.m}
            day={selected.d}
            cell={selected.cell}
            today={today}
            employee={employee}
            onAdd={onDayClick}
          />
        )}
      </div>

      {/* Desktop / tablet: full IN/OUT cycle grid */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 gap-2 text-center text-sm font-medium text-gray-500 mb-3">
          {WEEKDAY_SHORT.map((d) => (
            <div key={d} className={`py-1 ${d === 'Sun' ? 'text-rose-600' : ''}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {blanks.map((_, i) => (
            <div key={`b-${i}`} />
          ))}
          {dayList.map((item) => {
            const sunday = isSunday(item.y, item.m, item.d);
            const canAdd =
              Boolean(onDayClick) && canEditCalendarDayTimes(item.cell) && item.iso <= today;
            const monthChanged = item.d === 1 || item.iso === dayList[0]?.iso;
            const isEndMarker = Boolean(item.cell?.is_cycle_end_marker) || item.iso === dayList[dayList.length - 1]?.iso;
            return (
              <div key={item.iso} title={cellTitle(item.cell, item.iso)} className="space-y-1.5">
                <div
                  className={`text-center text-sm font-semibold ${
                    sunday
                      ? 'text-rose-600'
                      : item.iso === today
                        ? 'text-emerald-800'
                        : isEndMarker && cycleDay > 1
                          ? 'text-emerald-700'
                          : 'text-gray-600'
                  }`}
                >
                  {item.d}
                  {monthChanged && usesCycle ? (
                    <span className="block text-[10px] font-medium text-gray-400 leading-none mt-0.5">
                      {monthLabel(item.y, item.m).split(' ')[0]}
                    </span>
                  ) : null}
                  {isEndMarker && cycleDay > 1 && !monthChanged ? (
                    <span className="block text-[10px] font-medium text-emerald-600 leading-none mt-0.5">
                      cycle end
                    </span>
                  ) : null}
                </div>
                <DayStatusCell
                  year={item.y}
                  month={item.m}
                  day={item.d}
                  cell={item.cell}
                  isToday={item.iso === today}
                  isPast={item.iso < today}
                  clickable={canAdd}
                  onClick={
                    canAdd
                      ? () =>
                          onDayClick?.({
                            employeeId: employee.id,
                            employeeName: employee.name,
                            date: item.iso,
                            cell: item.cell,
                          })
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile admin day cell — in/out times always visible (no tap needed).
 * Layout: day label + stacked in (top) / out (bottom) times.
 */
function AdminStripDay({
  year,
  month,
  day,
  cell,
  isToday,
  isPast,
  isFuture,
  onAdd,
}: {
  year: number;
  month: number;
  day: number;
  cell: CalendarDayCell | undefined;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
  onAdd?: () => void;
}) {
  const sunday = isSunday(year, month, day);
  const status = cell?.status;
  const marked = Boolean(status && status !== 'BEFORE_JOINING');
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const inTime = shortTime(cell?.check_in_time);
  const outTime = shortTime(cell?.check_out_time);
  const hasPunches = Boolean(inTime || outTime);

  const lateIn = Boolean(cell?.is_late);
  const earlyOut = Boolean(cell?.is_early && cell?.check_out_time);
  const inBg = lateIn ? 'bg-amber-400 text-amber-950' : 'bg-emerald-500 text-white';
  const outBg = !cell?.check_out_time
    ? 'bg-slate-300 text-slate-700'
    : earlyOut
      ? 'bg-orange-500 text-white'
      : 'bg-sky-600 text-white';

  let body: ReactNode;
  if (hasPunches && (status === 'PRESENT' || status === 'HALF_DAY' || !status)) {
    // Always show both rows so cell height stays even across days.
    body = (
      <div className="flex w-full flex-col overflow-hidden rounded">
        <div className={`flex h-4 items-center justify-center px-px ${inBg}`}>
          <span className="text-[9px] font-semibold leading-none tabular-nums">{inTime || '—'}</span>
        </div>
        <div className={`flex h-4 items-center justify-center px-px ${outBg}`}>
          <span className="text-[9px] font-semibold leading-none tabular-nums">
            {isFuture ? '—' : outTime || (isToday && !outTime ? '…' : '—')}
          </span>
        </div>
      </div>
    );
  } else if (sunday && !marked) {
    body = (
      <div className="flex h-8 w-full items-center justify-center rounded bg-rose-50">
        <span className="text-[9px] font-semibold text-rose-600">Sun</span>
      </div>
    );
  } else if (status && status !== 'BEFORE_JOINING') {
    const style = STATUS_STYLE[status];
    body = (
      <div
        className={`flex h-8 w-full flex-col items-center justify-center rounded ${style?.bg || 'bg-gray-100'} ${style?.text || 'text-gray-500'}`}
      >
        <span className="text-[10px] font-bold leading-none">{style?.short || status}</span>
      </div>
    );
  } else if (isFuture || status === 'BEFORE_JOINING') {
    body = (
      <div className="flex h-8 w-full items-center justify-center rounded bg-gray-50 text-gray-300">
        <span className="text-xs leading-none">-</span>
      </div>
    );
  } else if (isPast) {
    body = (
      <div className="flex h-8 w-full flex-col items-center justify-center rounded bg-red-500 text-white">
        <span className="text-[10px] font-bold leading-none">A</span>
        {onAdd && <span className="mt-0.5 text-[7px] font-medium leading-none opacity-90">Add</span>}
      </div>
    );
  } else {
    // Today unmarked
    body = (
      <div
        className={`flex h-8 w-full items-center justify-center rounded bg-white text-emerald-700 ring-1 ring-dashed ring-emerald-400 ${
          isToday ? 'ring-2 ring-emerald-500' : ''
        }`}
      >
        <span className="text-[9px] font-medium leading-none">{onAdd ? 'Add' : '-'}</span>
      </div>
    );
  }

  const box = (
    <div
      className={`overflow-hidden rounded-lg border ${
        sunday ? 'border-rose-200' : 'border-gray-200'
      } ${isToday ? 'ring-2 ring-emerald-700' : ''} ${isFuture ? 'opacity-45' : ''}`}
    >
      <div
        className={`py-0.5 text-center text-[10px] font-semibold tabular-nums leading-none ${
          sunday
            ? 'bg-rose-50 text-rose-600'
            : isToday
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-slate-50 text-gray-600'
        }`}
      >
        {day}/{month}
      </div>
      {body}
    </div>
  );

  if (onAdd) {
    return (
      <button
        type="button"
        title={cellTitle(cell, iso)}
        onClick={onAdd}
        className="w-full min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-lg"
        aria-label={`${day}/${month}, attendance`}
      >
        {box}
      </button>
    );
  }

  return (
    <div title={cellTitle(cell, iso)} className="w-full min-w-0" aria-label={`${day}/${month}`}>
      {box}
    </div>
  );
}

function groupDaysByMonth(dayList: CycleDayItem[]) {
  const groups: { key: string; label: string; items: CycleDayItem[] }[] = [];
  for (const item of dayList) {
    const key = `${item.y}-${item.m}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: monthLabel(item.y, item.m), items: [item] });
  }
  return groups;
}

export function AdminMonthGrid({
  year,
  month,
  daysInMonth,
  today,
  employees,
  onDayClick,
  onAddAmount,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  today: string;
  employees: CalendarEmployee[];
  onDayClick?: (payload: CalendarDayClick) => void;
  onAddAmount?: (emp: CalendarEmployee) => void;
}) {
  const dayClickProps = (emp: CalendarEmployee, iso: string, cell: CalendarDayCell | undefined) => {
    const canAdd = Boolean(onDayClick) && canEditCalendarDayTimes(cell) && iso <= today;
    return {
      clickable: canAdd,
      isPast: iso < today,
      onClick: canAdd
        ? () =>
            onDayClick?.({
              employeeId: emp.id,
              employeeName: emp.name,
              date: iso,
              cell,
            })
        : undefined,
    };
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] sm:text-xs text-gray-500 px-0.5">
        Each box is day/month. Green = in, blue = out. Months are separate rows — open an employee to change month.
      </p>
      {employees.map((emp) => {
        const dayList = employeeCycleDayList(emp, year, month, daysInMonth);
        const cycleDay = emp.salary_cycle_start_day || 1;
        const months = groupDaysByMonth(dayList);
        return (
          <div key={emp.id} className="bg-white rounded-xl border border-emerald-100 px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-center gap-2 mb-2 min-h-8">
              <Link
                to={`/salary-book/calendar?employee=${emp.id}&year=${year}&month=${month}`}
                className="min-w-0 flex-1"
              >
                <div className="font-semibold text-sm sm:text-base text-gray-900 hover:text-emerald-800 truncate">
                  {emp.name}
                </div>
                <div className="text-[11px] sm:text-xs text-gray-500">
                  {emp.employee_id}
                  {cycleDay > 1 && (emp.period_start || dayList[0]) && (emp.period_end_marker || dayList[dayList.length - 1])
                    ? ` · ${formatCycleBound(emp.period_start, dayList[0])} → ${formatCycleBound(emp.period_end_marker, dayList[dayList.length - 1])}`
                    : ''}
                </div>
              </Link>
              {onAddAmount && (
                <button
                  type="button"
                  onClick={() => onAddAmount(emp)}
                  className="shrink-0 inline-flex items-center gap-1 min-h-9 px-2.5 rounded-full border border-emerald-500 text-emerald-800 text-xs sm:text-sm font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Amount
                </button>
              )}
              <span className="shrink-0 text-xs sm:text-sm font-semibold text-emerald-800 tabular-nums">
                {emp.counts.PRESENT}P
              </span>
            </div>
            <div className="space-y-2">
              {months.map((group) => (
                <div key={group.key}>
                  <div className="mb-1 text-[11px] font-semibold text-gray-500">{group.label}</div>
                  <div className="flex flex-wrap gap-1">
                    {group.items.map((item) => {
                      const click = dayClickProps(emp, item.iso, item.cell);
                      return (
                        <div key={item.iso} className="w-[4.25rem]">
                          <AdminStripDay
                            year={item.y}
                            month={item.m}
                            day={item.d}
                            cell={item.cell}
                            isToday={item.iso === today}
                            isPast={item.iso < today}
                            isFuture={item.iso > today}
                            onAdd={click.onClick}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <EmployeeMoneyFooter emp={emp} />
          </div>
        );
      })}
    </div>
  );
}
