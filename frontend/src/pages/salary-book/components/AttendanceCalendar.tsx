import { ChevronLeft, ChevronRight } from 'lucide-react';
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
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${compact ? 'lg:grid-cols-8' : 'lg:grid-cols-4 xl:grid-cols-8'} gap-2`}>
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-xl border border-emerald-100 p-3">
          <div className="text-xs text-gray-500">{card.label}</div>
          <div className="text-xl font-semibold text-gray-900 mt-0.5">{card.value}</div>
        </div>
      ))}
    </div>
  );
}

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-gray-600">
      {Object.entries(STATUS_STYLE)
        .filter(([key]) => key !== 'BEFORE_JOINING')
        .map(([key, style]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-sm ${style.bg}`} />
            {statusLabel(key)}
          </span>
        ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-gray-200" />
        Unmarked
      </span>
      <span className="inline-flex items-center gap-1.5">L = Late</span>
      <span className="inline-flex items-center gap-1.5">P = Late penalty</span>
    </div>
  );
}

function cellClass(cell: CalendarDayCell | undefined, isToday: boolean) {
  const status = cell?.status;
  if (!status) return `bg-gray-100 text-gray-400 ${isToday ? 'ring-2 ring-emerald-500' : ''}`;
  const style = STATUS_STYLE[status];
  if (!style) return `bg-gray-100 ${isToday ? 'ring-2 ring-emerald-500' : ''}`;
  return `${style.bg} ${style.text} ${isToday ? 'ring-2 ring-emerald-700 ring-offset-1' : ''}`;
}

function cellLabel(cell: CalendarDayCell | undefined) {
  const status = cell?.status;
  if (!status) return '·';
  return STATUS_STYLE[status]?.short || '';
}

export function EmployeeMonthGrid({
  year,
  month,
  daysInMonth,
  today,
  employee,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  today: string;
  employee: CalendarEmployee;
}) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const blanks = Array.from({ length: firstWeekday });
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-3 lg:p-5">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500 mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {blanks.map((_, i) => (
          <div key={`b-${i}`} />
        ))}
        {days.map((day) => {
          const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const cell = employee.days[String(day)];
          const title = cell?.status && cell.status !== 'BEFORE_JOINING'
            ? `${statusLabel(cell.status)}${cell.check_in_time ? ` · ${formatTime(cell.check_in_time)}` : ''}${cell.is_late && cell.minutes_late ? ` · Late ${cell.minutes_late}m` : ''}${cell.rule_penalty_applied ? ' · Penalty' : ''}`
            : iso;
          return (
            <div
              key={day}
              title={title}
              className={`min-h-11 lg:min-h-16 rounded-lg flex flex-col items-center justify-center text-xs ${cellClass(cell, iso === today)}`}
            >
              <span className="font-semibold">{day}</span>
              <span className="text-[10px] leading-none mt-0.5">{cellLabel(cell)}</span>
              {cell?.is_late && !cell?.rule_penalty_applied && <span className="text-[9px] leading-none">L</span>}
              {cell?.rule_penalty_applied && <span className="text-[9px] leading-none">P</span>}
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
}: {
  year: number;
  month: number;
  daysInMonth: number;
  today: string;
  employees: CalendarEmployee[];
}) {
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <>
      <div className="lg:hidden space-y-3">
        {employees.map((emp) => (
          <Link
            key={emp.id}
            to={`/salary-book/calendar?employee=${emp.id}&year=${year}&month=${month}`}
            className="block bg-white rounded-xl border border-emerald-100 p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold text-gray-900">{emp.name}</div>
                <div className="text-xs text-gray-500">{emp.employee_id}</div>
              </div>
              <div className="text-xs text-emerald-800">{emp.counts.PRESENT}P</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {days.map((day) => {
                const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const cell = emp.days[String(day)];
                return (
                  <span
                    key={day}
                    title={`${day}: ${cell?.status ? statusLabel(cell.status) : 'Unmarked'}`}
                    className={`h-6 w-6 rounded text-[10px] flex items-center justify-center ${cellClass(cell, iso === today)}`}
                  >
                    {day}
                  </span>
                );
              })}
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-emerald-50 text-gray-600">
                <th className="sticky left-0 bg-emerald-50 text-left px-3 py-2 font-semibold min-w-[11rem] z-10">
                  Employee
                </th>
                {days.map((day) => {
                  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  return (
                    <th
                      key={day}
                      className={`px-0.5 py-2 font-medium w-8 ${iso === today ? 'text-emerald-800' : ''}`}
                    >
                      {day}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-t border-emerald-50 hover:bg-emerald-50/40">
                  <td className="sticky left-0 bg-white px-3 py-1.5 z-10">
                    <Link
                      to={`/salary-book/calendar?employee=${emp.id}&year=${year}&month=${month}`}
                      className="font-medium text-gray-900 hover:text-emerald-800"
                    >
                      {emp.name}
                    </Link>
                    <div className="text-[10px] text-gray-500">{emp.employee_id}</div>
                  </td>
                  {days.map((day) => {
                    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const cell = emp.days[String(day)];
                    return (
                      <td key={day} className="px-0.5 py-1">
                        <div
                          title={
                            cell?.status
                              ? `${statusLabel(cell.status)}${cell.is_late && cell.minutes_late ? ` · Late ${cell.minutes_late}m` : ''}${cell.rule_penalty_applied ? ' · Penalty' : ''}`
                              : 'Unmarked'
                          }
                          className={`h-7 w-7 mx-auto rounded flex items-center justify-center ${cellClass(cell, iso === today)}`}
                        >
                          {cellLabel(cell)}
                        </div>
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
