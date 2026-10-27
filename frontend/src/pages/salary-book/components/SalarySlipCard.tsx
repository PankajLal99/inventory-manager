import { formatINR } from '../utils';
import type { CalendarEmployee, SalarySlip } from '../types';

function cycleSummary(employee: CalendarEmployee, today: string) {
  const days = employee.cycle_days || {};
  const keys = Object.keys(days).sort();
  let present = 0;
  let half = 0;
  let absent = 0;
  let weeklyOff = 0;
  let paid = 0;
  let unpaid = 0;
  for (const iso of keys) {
    if (iso > today) continue;
    const [y, m, d] = iso.split('-').map(Number);
    const sunday = new Date(y, (m || 1) - 1, d || 1).getDay() === 0;
    const status = days[iso]?.status;
    if (status === 'HOLIDAY' || (sunday && (!status || status === 'BEFORE_JOINING'))) {
      weeklyOff += 1;
      continue;
    }
    if (status === 'PRESENT') present += 1;
    else if (status === 'HALF_DAY') half += 1;
    else if (status === 'PAID_LEAVE') paid += 1;
    else if (status === 'UNPAID_LEAVE') unpaid += 1;
    else if (status !== 'BEFORE_JOINING') absent += 1;
  }
  return {
    total: keys.length,
    present,
    half,
    absent,
    weeklyOff,
    paid,
    unpaid,
    payable: present + half * 0.5,
  };
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 min-w-[5.5rem] ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
    </div>
  );
}

export default function SalarySlipCard({
  employee,
  today,
}: {
  employee: CalendarEmployee;
  today: string;
}) {
  const slip: SalarySlip | null | undefined = employee.salary_slip;
  const summary = cycleSummary(employee, today);
  const lines = slip?.lines || [];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Stat label="Total days" value={String(summary.total)} tone="bg-white border-gray-200 text-gray-900" />
        <Stat label="Present" value={String(summary.present)} tone="bg-emerald-50 border-emerald-100 text-emerald-900" />
        <Stat label="Half day" value={String(summary.half)} tone="bg-amber-50 border-amber-100 text-amber-950" />
        <Stat label="Absent" value={String(summary.absent)} tone="bg-red-50 border-red-100 text-red-800" />
        <Stat label="Weekly off" value={String(summary.weeklyOff)} tone="bg-rose-50 border-rose-100 text-rose-800" />
        <Stat label="Paid leave" value={String(summary.paid)} tone="bg-sky-50 border-sky-100 text-sky-900" />
        <Stat label="Unpaid leave" value={String(summary.unpaid)} tone="bg-orange-50 border-orange-100 text-orange-900" />
        <Stat
          label="Payable days"
          value={Number.isInteger(summary.payable) ? String(summary.payable) : summary.payable.toFixed(1)}
          tone="bg-emerald-50 border-emerald-200 text-emerald-950"
        />
      </div>

      <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-emerald-50">
          <div>
            <h2 className="font-semibold text-gray-900">Salary less</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Monthly {formatINR(slip?.monthly_salary || 0)} · per day {formatINR(slip?.daily_salary || 0)}.
              Only days that were late in or left early, plus cash, online, and products taken.
              {slip?.overall_late_penalty_enabled
                ? ` Overall late cut is on: ${slip.overall_late_half_days} late days = half day, ${slip.overall_late_full_days} or more = one full day.`
                : ' Overall late-day cut is off for this employee.'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">
              {slip?.period_open ? 'Salary so far' : 'Total salary'}
            </div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {formatINR(slip?.total_salary || employee.salary_generated || 0)}
            </div>
          </div>
        </div>

        {slip?.fresh_cycle && (
          <p className="px-4 py-3 text-sm text-emerald-800 bg-emerald-50 border-b border-emerald-100">
            New salary cycle. Salary generated and amounts taken start at zero the day after payday.
            Open the previous month to see the last cycle.
          </p>
        )}

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">No salary less in this cycle.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2 w-12">S.No.</th>
                  <th className="px-3 py-2 w-24">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={`${line.kind}-${line.date || 'x'}-${index}`} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">{line.date_label || '—'}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{line.description}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-600">
                      −{formatINR(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 text-red-800">
          <span className="font-semibold">Total less</span>
          <span className="text-lg font-bold tabular-nums">{formatINR(slip?.total_less || 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-4 bg-emerald-50 text-emerald-950">
          <span className="font-semibold">Final payable salary</span>
          <span className="text-2xl font-bold tabular-nums">{formatINR(slip?.final_payable || 0)}</span>
        </div>
      </div>
    </div>
  );
}
