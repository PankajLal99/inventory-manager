import type { ReactNode } from 'react';
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
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${compact ? 'lg:grid-cols-8' : 'lg:grid-cols-4 xl:grid-cols-8'} gap-3`}>
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-xl border border-emerald-100 p-4">
          <div className="text-sm text-gray-500">{card.label}</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{card.value}</div>
        </div>
      ))}
    </div>
  );
}

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex h-5 overflow-hidden rounded-sm">
          <span className="bg-emerald-500 text-white px-1.5 text-[10px] leading-5">IN</span>
          <span className="bg-sky-600 text-white px-1.5 text-[10px] leading-5">OUT</span>
        </span>
        On time
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-sm bg-amber-400" />
        Late IN
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-sm bg-orange-500" />
        Early OUT
      </span>
      {Object.entries(STATUS_STYLE)
        .filter(([key]) => key !== 'BEFORE_JOINING' && key !== 'PRESENT')
        .map(([key, style]) => (
          <span key={key} className="inline-flex items-center gap-2">
            <span className={`h-3.5 w-3.5 rounded-sm ${style.bg}`} />
            {statusLabel(key)}
          </span>
        ))}
      <span className="inline-flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-sm bg-gray-200 ring-1 ring-dashed ring-emerald-300" />
        Today unmarked (tap to add)
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="text-xs font-semibold text-rose-600">Sunday</span>
        Weekly off
      </span>
      <span className="inline-flex items-center gap-2">L = Late</span>
      <span className="inline-flex items-center gap-2">P = Late penalty</span>
    </div>
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

  return (
    <div
      className={`flex h-full w-full overflow-hidden rounded-lg ${
        compact ? 'min-h-[3.25rem]' : 'min-h-[3.75rem]'
      } ${isToday ? 'ring-2 ring-emerald-700 ring-offset-1' : ''}`}
    >
      <div className={`flex flex-1 flex-col items-center justify-center px-1 py-1.5 ${inBg}`}>
        <span className="text-[10px] font-semibold uppercase leading-none tracking-wide opacity-90">IN</span>
        <span className={`mt-1 font-semibold leading-none tabular-nums ${compact ? 'text-xs' : 'text-sm'}`}>
          {shortTime(cell.check_in_time) || '—'}
        </span>
      </div>
      <div className={`flex flex-1 flex-col items-center justify-center px-1 py-1.5 ${outBg}`}>
        <span className="text-[10px] font-semibold uppercase leading-none tracking-wide opacity-90">OUT</span>
        <span className={`mt-1 font-semibold leading-none tabular-nums ${compact ? 'text-xs' : 'text-sm'}`}>
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

  // Sundays with no attendance show "Sunday" instead of a grey dash.
  if (sunday && !marked) {
    return wrap(
      <div
        className={`flex h-full w-full items-center justify-center rounded-lg bg-rose-50 px-1 ${minH} ${
          isToday ? 'ring-2 ring-emerald-500' : ''
        } ${interactive ? 'ring-1 ring-dashed ring-rose-200' : ''}`}
      >
        <span
          className={`font-semibold leading-tight text-rose-600 ${
            compact ? 'text-[10px]' : 'text-xs'
          }`}
        >
          Sunday
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

  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-4 lg:p-6">
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
      <div className="lg:hidden space-y-3">
        {employees.map((emp) => (
          <div key={emp.id} className="block bg-white rounded-xl border border-emerald-100 p-3">
            <div className="flex items-center justify-between mb-2">
              <Link
                to={`/salary-book/calendar?employee=${emp.id}&year=${year}&month=${month}`}
                className="min-w-0"
              >
                <div className="font-semibold text-gray-900 hover:text-emerald-800">{emp.name}</div>
                <div className="text-xs text-gray-500">{emp.employee_id}</div>
              </Link>
              <div className="text-xs text-emerald-800">{emp.counts.PRESENT}P</div>
            </div>
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="flex gap-1.5 min-w-max">
                {days.map((day) => {
                  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const cell = emp.days[String(day)];
                  const sunday = isSunday(year, month, day);
                  const click = dayClickProps(emp, iso, cell);
                  return (
                    <div key={day} className="w-[4.5rem] shrink-0 space-y-1" title={cellTitle(cell, iso)}>
                      <div
                        className={`text-center text-xs font-medium leading-tight ${
                          sunday ? 'text-rose-600' : iso === today ? 'text-emerald-800' : 'text-gray-500'
                        }`}
                      >
                        <div>{day}</div>
                        <div className="text-[10px] font-normal">{weekdayShort(year, month, day)}</div>
                      </div>
                      <DayStatusCell
                        year={year}
                        month={month}
                        day={day}
                        cell={cell}
                        isToday={iso === today}
                        compact
                        {...click}
                      />
                    </div>
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
