import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Umbrella } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime, monthLabel, statusLabel } from '../utils';
import type { CalendarEmployee, CalendarKpis, CalendarDayCell } from '../types';

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

/** Days with no attendance record can receive manual in/out. Marked days are locked. */
export function isUnmarkedCalendarDay(cell: CalendarDayCell | undefined) {
  return !cell?.status;
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
        aria-label={`Add attendance for day ${day}`}
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
    return <InOutSplitCell cell={cell!} isToday={isToday} compact={compact} />;
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
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center rounded-lg ${minH} ${style?.bg || 'bg-gray-100'} ${style?.text || 'text-gray-500'} ${
        isToday ? 'ring-2 ring-emerald-700 ring-offset-1' : ''
      }`}
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
  const canAdd = Boolean(onAdd) && isUnmarkedCalendarDay(cell) && iso <= today;
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
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white border border-emerald-100 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">In</div>
            <div className="text-base font-semibold tabular-nums text-gray-900">
              {cell.check_in_time ? formatTime(cell.check_in_time) : '—'}
            </div>
            {cell.is_late && cell.minutes_late ? (
              <div className="text-[11px] text-amber-700 font-medium">Late {cell.minutes_late}m</div>
            ) : null}
          </div>
          <div className="rounded-lg bg-white border border-emerald-100 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Out</div>
            <div className="text-base font-semibold tabular-nums text-gray-900">
              {cell.check_out_time ? formatTime(cell.check_out_time) : '—'}
            </div>
            {cell.is_early && cell.minutes_early ? (
              <div className="text-[11px] text-orange-700 font-medium">Early {cell.minutes_early}m</div>
            ) : null}
          </div>
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
          Add in / out times
        </button>
      )}
    </div>
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
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstWeekday });
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const todayDay = today.startsWith(`${year}-${String(month).padStart(2, '0')}-`)
    ? Number(today.slice(-2))
    : null;
  const [selectedDay, setSelectedDay] = useState<number | null>(todayDay);
  useEffect(() => {
    setSelectedDay(todayDay ?? 1);
  }, [year, month, todayDay]);
  const selectedCell = selectedDay != null ? employee.days[String(selectedDay)] : undefined;

  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-3 sm:p-4 lg:p-6">
      {/* Mobile: dense status chips + selected-day detail (avoids mushy IN/OUT in 7 cols) */}
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
          {days.map((day) => {
            const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const cell = employee.days[String(day)];
            return (
              <MobileDayChip
                key={day}
                year={year}
                month={month}
                day={day}
                cell={cell}
                isToday={iso === today}
                isPast={iso < today}
                selected={selectedDay === day}
                onSelect={() => setSelectedDay(day)}
              />
            );
          })}
        </div>
        {selectedDay != null && (
          <SelectedDayPanel
            year={year}
            month={month}
            day={selectedDay}
            cell={selectedCell}
            today={today}
            employee={employee}
            onAdd={onDayClick}
          />
        )}
      </div>

      {/* Desktop / tablet: full IN/OUT month grid */}
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
          {days.map((day) => {
            const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const cell = employee.days[String(day)];
            const sunday = isSunday(year, month, day);
            const canAdd = Boolean(onDayClick) && isUnmarkedCalendarDay(cell) && iso <= today;
            return (
              <div key={day} title={cellTitle(cell, iso)} className="space-y-1.5">
                <div
                  className={`text-center text-sm font-semibold ${
                    sunday ? 'text-rose-600' : iso === today ? 'text-emerald-800' : 'text-gray-600'
                  }`}
                >
                  {day}
                </div>
                <DayStatusCell
                  year={year}
                  month={month}
                  day={day}
                  cell={cell}
                  isToday={iso === today}
                  isPast={iso < today}
                  clickable={canAdd}
                  onClick={
                    canAdd
                      ? () =>
                          onDayClick?.({
                            employeeId: employee.id,
                            employeeName: employee.name,
                            date: iso,
                            cell,
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

/** Tiny status tile for admin mobile strip — day number + color only (~36px tall). */
function AdminStripChip({
  year,
  month,
  day,
  cell,
  isToday,
  isPast,
  onClick,
}: {
  year: number;
  month: number;
  day: number;
  cell: CalendarDayCell | undefined;
  isToday: boolean;
  isPast: boolean;
  onClick?: () => void;
}) {
  const sunday = isSunday(year, month, day);
  const status = cell?.status;
  const marked = Boolean(status && status !== 'BEFORE_JOINING');
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  let bg = 'bg-gray-100 text-gray-500';
  if (sunday && !marked) {
    bg = 'bg-rose-50 text-rose-600';
  } else if (hasPunchTimes(cell) && (status === 'PRESENT' || status === 'HALF_DAY' || !status)) {
    if (status === 'HALF_DAY' || cell?.is_late) bg = 'bg-amber-400 text-amber-950';
    else bg = 'bg-emerald-500 text-white';
  } else if (!status || status === 'BEFORE_JOINING') {
    if (isPast && status !== 'BEFORE_JOINING') bg = 'bg-red-500 text-white';
    else if (status === 'BEFORE_JOINING') bg = 'bg-gray-50 text-gray-300';
    else if (isToday) bg = 'bg-white text-emerald-700 ring-1 ring-dashed ring-emerald-400';
    else bg = 'bg-gray-100 text-gray-400';
  } else {
    const style = STATUS_STYLE[status];
    bg = `${style?.bg || 'bg-gray-100'} ${style?.text || 'text-gray-500'}`;
  }

  const className = `relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums ${bg} ${
    isToday && marked ? 'ring-2 ring-emerald-700' : ''
  }`;

  const content = (
    <>
      {day}
      {(cell?.rule_penalty_applied || cell?.is_late) && marked && (
        <span className="absolute right-0 top-0 text-[7px] font-bold leading-none opacity-90">
          {cell.rule_penalty_applied ? 'P' : 'L'}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        title={cellTitle(cell, iso)}
        onClick={onClick}
        className={`${className} cursor-pointer active:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600`}
        aria-label={`Day ${day}, add attendance`}
      >
        {content}
      </button>
    );
  }

  return (
    <div title={cellTitle(cell, iso)} className={className} aria-label={`Day ${day}`}>
      {content}
    </div>
  );
}

export function AdminMonthGrid({
  year,
  month,
  daysInMonth,
  today,
  employees,
  onDayClick,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  today: string;
  employees: CalendarEmployee[];
  onDayClick?: (payload: CalendarDayClick) => void;
}) {
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const dayClickProps = (emp: CalendarEmployee, iso: string, cell: CalendarDayCell | undefined) => {
    const canAdd = Boolean(onDayClick) && isUnmarkedCalendarDay(cell) && iso <= today;
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
    <>
      {/* Mobile: flat chip strip per employee (avoids tall day+status stacks) */}
      <div className="lg:hidden space-y-2">
        {employees.map((emp) => (
          <div key={emp.id} className="bg-white rounded-xl border border-emerald-100 px-2.5 py-2">
            <div className="flex items-center gap-2 mb-1.5 min-h-8">
              <Link
                to={`/salary-book/calendar?employee=${emp.id}&year=${year}&month=${month}`}
                className="min-w-0 flex-1 flex items-baseline gap-1.5"
              >
                <span className="font-semibold text-sm text-gray-900 hover:text-emerald-800 truncate">
                  {emp.name}
                </span>
                <span className="text-[11px] text-gray-400 shrink-0">{emp.employee_id}</span>
              </Link>
              <span className="shrink-0 text-[11px] font-semibold text-emerald-800 tabular-nums">
                {emp.counts.PRESENT}P
              </span>
            </div>
            <div className="overflow-x-auto -mx-2.5 px-2.5 overscroll-x-contain">
              <div className="flex gap-1 min-w-max">
                {days.map((day) => {
                  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const cell = emp.days[String(day)];
                  const click = dayClickProps(emp, iso, cell);
                  return (
                    <AdminStripChip
                      key={day}
                      year={year}
                      month={month}
                      day={day}
                      cell={cell}
                      isToday={iso === today}
                      isPast={iso < today}
                      onClick={click.onClick}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-slate-50 text-gray-600">
                <th className="sticky left-0 bg-slate-50 text-left px-4 py-3 font-semibold min-w-[14rem] z-20 border-b border-emerald-100">
                  Employee
                </th>
                {days.map((day) => {
                  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const sunday = isSunday(year, month, day);
                  return (
                    <th
                      key={day}
                      className={`px-1.5 py-3 font-medium min-w-[5.5rem] border-b border-emerald-100 ${
                        sunday
                          ? 'text-rose-600 bg-rose-50/60'
                          : iso === today
                            ? 'text-emerald-800'
                            : ''
                      }`}
                    >
                      <div className="text-base font-semibold leading-none">{day}</div>
                      <div className="mt-1 text-xs font-normal leading-none">
                        {weekdayShort(year, month, day)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-emerald-50/30">
                  <td className="sticky left-0 bg-white px-4 py-2 z-10 border-t border-emerald-50">
                    <Link
                      to={`/salary-book/calendar?employee=${emp.id}&year=${year}&month=${month}`}
                      className="font-semibold text-gray-900 hover:text-emerald-800"
                    >
                      {emp.name}
                    </Link>
                    <div className="text-xs text-gray-500">{emp.employee_id}</div>
                  </td>
                  {days.map((day) => {
                    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const cell = emp.days[String(day)];
                    const sunday = isSunday(year, month, day);
                    const click = dayClickProps(emp, iso, cell);
                    return (
                      <td
                        key={day}
                        className={`px-1.5 py-1.5 border-t border-emerald-50 align-middle ${
                          sunday ? 'bg-rose-50/40' : ''
                        }`}
                        title={cellTitle(cell, iso)}
                      >
                        <DayStatusCell
                          year={year}
                          month={month}
                          day={day}
                          cell={cell}
                          isToday={iso === today}
                          {...click}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
