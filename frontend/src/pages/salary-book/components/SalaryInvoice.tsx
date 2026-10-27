import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import html2canvas from 'html2canvas';
import { Copy, Wallet } from 'lucide-react';
import { toast } from '../../../lib/toast';
import { salaryBookApi } from '../../../lib/api';
import { formatDate, formatINR, monthLabel } from '../utils';
import { useSalaryBookImage } from '../useSalaryBookImage';
import type { CalendarDayCell, CalendarEmployee, Employee, SalaryBookSettings } from '../types';

const DEFAULT_SHOP_NAME = 'MANISH TRADERS';
const DEFAULT_TAGLINE = 'Mobile Display / Parts Wholesale\nAll India Shipping';

function shopInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] || 'MT').slice(0, 2).toUpperCase();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function time24(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function shortDate(iso: string | null | undefined) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${monthLabel(y, m).split(' ')[0]} ${y}`;
}

async function copyPngBlob(blob: Blob) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

const UNSUPPORTED_COLOR = /oklch|oklab|color-mix|\blab\(|\blch\(|\bcolor\(/i;
const colorCache = new Map<string, string>();

/** Tailwind 4 computed colors are oklch. Sample a pixel so the copy is plain rgb. */
function toSrgb(value: string) {
  const cached = colorCache.get(value);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return value;
  ctx.clearRect(0, 0, 1, 1);
  try {
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
  } catch {
    return value;
  }
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const next =
    a === 0
      ? 'transparent'
      : a === 255
        ? `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
        : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  colorCache.set(value, next);
  return next;
}

const COLOR_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  '-webkit-text-fill-color',
  'fill',
  'stroke',
];

/** html2canvas only understands rgb/hex. Tailwind 4 computed colors are oklch. */
function flattenColors(root: HTMLElement) {
  const restores: Array<{ el: HTMLElement; prop: string; prev: string }> = [];
  const paint = (el: HTMLElement, prop: string, next: string) => {
    restores.push({ el, prop, prev: el.style.getPropertyValue(prop) });
    el.style.setProperty(prop, next);
  };
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const el of nodes) {
    const computed = getComputedStyle(el);
    for (const prop of COLOR_PROPS) {
      const value = computed.getPropertyValue(prop).trim();
      if (value && UNSUPPORTED_COLOR.test(value)) paint(el, prop, toSrgb(value));
    }
    for (const prop of ['box-shadow', 'text-shadow', 'background-image', 'filter']) {
      const value = computed.getPropertyValue(prop).trim();
      if (value && value !== 'none' && UNSUPPORTED_COLOR.test(value)) paint(el, prop, 'none');
    }
  }
  return () => {
    for (const { el, prop, prev } of restores) {
      if (prev) el.style.setProperty(prop, prev);
      else el.style.removeProperty(prop);
    }
  };
}

function downloadPng(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function invoiceNumber(code: string, startIso?: string | null) {
  if (!startIso) return code;
  const [y, m] = startIso.split('-');
  if (!y || !m) return code;
  return `${code}-${m}${y.slice(2)}`;
}

type DayItem = {
  iso: string;
  day: number;
  month: number;
  cell?: CalendarDayCell;
};

function cycleDays(employee: CalendarEmployee): DayItem[] {
  const cycle = employee.cycle_days;
  if (cycle && Object.keys(cycle).length) {
    return Object.keys(cycle)
      .sort()
      .map((iso) => {
        const [, m, d] = iso.split('-').map(Number);
        return { iso, day: d, month: m, cell: cycle[iso] };
      });
  }
  return Object.keys(employee.days || {})
    .map(Number)
    .sort((a, b) => a - b)
    .map((day) => ({
      iso: '',
      day,
      month: employee.period_month || 1,
      cell: employee.days[String(day)],
    }));
}

function DayBox({ item, today }: { item: DayItem; today: string }) {
  const iso = item.iso;
  const sunday = iso ? new Date(`${iso}T00:00:00`).getDay() === 0 : false;
  const cell = item.cell;
  const status = cell?.status;
  const marked = Boolean(status && status !== 'BEFORE_JOINING');
  const future = Boolean(iso && iso > today);
  const inTime = time24(cell?.check_in_time);
  const outTime = time24(cell?.check_out_time);
  const punched = Boolean(inTime || outTime);
  const dateLabel = item.month ? `${item.day}/${item.month}` : String(item.day);

  let tone = 'bg-gray-50 text-gray-300 border-gray-100';
  let body: string | null = '–';

  if (sunday && !marked) {
    tone = 'bg-rose-100 text-rose-700 border-rose-200';
    body = 'Sun';
  } else if (status === 'HOLIDAY') {
    tone = 'bg-rose-100 text-rose-700 border-rose-200';
    body = 'Off';
  } else if (punched && (status === 'PRESENT' || status === 'HALF_DAY' || !status)) {
    if (status === 'HALF_DAY' || cell?.is_late) {
      tone = 'bg-amber-100 text-amber-950 border-amber-200';
    } else if (cell?.is_early) {
      tone = 'bg-orange-100 text-orange-900 border-orange-200';
    } else {
      tone = 'bg-emerald-100 text-emerald-900 border-emerald-200';
    }
    body = null;
  } else if (status === 'PAID_LEAVE') {
    tone = 'bg-sky-100 text-sky-900 border-sky-200';
    body = 'PL';
  } else if (status === 'UNPAID_LEAVE') {
    tone = 'bg-orange-100 text-orange-900 border-orange-200';
    body = 'UL';
  } else if (status === 'ABSENT' || (!future && iso && iso <= today && status !== 'BEFORE_JOINING' && !marked)) {
    tone = 'bg-red-100 text-red-700 border-red-200';
    body = 'A';
  }

  return (
    <div className={`min-h-[4.25rem] rounded-lg border px-1 py-1 text-center ${tone}`}>
      <div className="text-[10px] font-semibold leading-none tabular-nums">{dateLabel}</div>
      {body ? (
        <div className="mt-2 text-xs font-bold leading-none">{body}</div>
      ) : (
        <div className="mt-1 space-y-0.5">
          <div className="text-[11px] font-semibold leading-none tabular-nums">{inTime || '—'}</div>
          <div className="text-[11px] font-semibold leading-none tabular-nums">{outTime || '—'}</div>
        </div>
      )}
    </div>
  );
}

function InfoCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 min-w-0 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-bold leading-snug text-gray-900 break-words">{value}</div>
      {hint ? <div className="text-[10px] leading-snug text-gray-500 break-words">{hint}</div> : null}
    </div>
  );
}

function SummaryCell({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className={`rounded-xl border px-3 py-3 sm:px-4 sm:py-4 min-w-0 ${tone}`}>
      <div className="text-xs sm:text-sm font-medium leading-tight text-gray-700">{label}</div>
      <div className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums leading-none text-gray-900">{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-gray-500">{hint}</div> : null}
    </div>
  );
}

export default function SalaryInvoice({
  profile,
  employee,
  today,
}: {
  profile: Employee;
  employee: CalendarEmployee;
  today: string;
}) {
  const days = cycleDays(employee);
  const first = days[0];
  const firstWeekday = first?.iso ? new Date(`${first.iso}T00:00:00`).getDay() : 0;
  const blanks = Array.from({ length: firstWeekday });
  const slip = employee.salary_slip;
  const lines = slip?.lines || [];
  const start = employee.period_start;
  const end = employee.period_end_marker || employee.period_end;
  const titleMonth = start
    ? monthLabel(Number(start.slice(0, 4)), Number(start.slice(5, 7)))
    : end
      ? monthLabel(Number(end.slice(0, 4)), Number(end.slice(5, 7)))
      : '';

  let present = 0;
  let half = 0;
  let absent = 0;
  let weeklyOff = 0;
  let paid = 0;
  let unpaid = 0;
  for (const item of days) {
    if (item.iso && item.iso > today) continue;
    const sunday = item.iso ? new Date(`${item.iso}T00:00:00`).getDay() === 0 : false;
    const status = item.cell?.status;
    if (status === 'HOLIDAY' || (sunday && (!status || status === 'BEFORE_JOINING'))) {
      weeklyOff += 1;
      continue;
    }
    if (status === 'PRESENT') present += 1;
    else if (status === 'HALF_DAY') half += 1;
    else if (status === 'PAID_LEAVE') paid += 1;
    else if (status === 'UNPAID_LEAVE') unpaid += 1;
    else if (status !== 'BEFORE_JOINING' && item.iso && item.iso <= today) absent += 1;
  }
  const payable = present + half * 0.5;
  const payableLabel = Number.isInteger(payable) ? String(payable) : payable.toFixed(1);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [copying, setCopying] = useState(false);
  const { data: branding } = useQuery({
    queryKey: ['salary-book', 'settings'],
    queryFn: async () => (await salaryBookApi.settings.get()).data as SalaryBookSettings,
  });
  const shopName = branding?.shop_name?.trim() || DEFAULT_SHOP_NAME;
  const taglineLines = (branding?.shop_tagline ?? DEFAULT_TAGLINE)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const logoSrc = useSalaryBookImage(branding?.shop_logo_url);

  const copyImage = async () => {
    const node = sheetRef.current;
    if (!node || copying) return;
    setCopying(true);
    const scrollers = Array.from(node.querySelectorAll<HTMLElement>('[data-slip-scroll]'));
    const saved = [
      { el: node, overflow: node.style.overflow, width: node.style.width },
      ...scrollers.map((el) => ({ el, overflow: el.style.overflow, width: el.style.width })),
    ];
    try {
      node.style.overflow = 'visible';
      scrollers.forEach((el) => {
        el.style.overflow = 'visible';
        el.style.width = `${el.scrollWidth}px`;
      });
      const fullWidth = Math.max(
        node.scrollWidth,
        node.offsetWidth,
        ...scrollers.map((el) => el.scrollWidth),
      );
      node.style.width = `${fullWidth}px`;
      const restoreColors = flattenColors(node);
      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(node, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: fullWidth,
          windowWidth: fullWidth,
          onclone: (_doc, cloned) => {
            flattenColors(cloned as HTMLElement);
          },
        });
      } finally {
        restoreColors();
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
      if (!blob) {
        toast('Could not create the invoice image.', 'error');
        return;
      }
      const filename = `salary-${profile.employee_id}-${titleMonth.replace(/\s+/g, '-') || 'invoice'}.png`;
      if (await copyPngBlob(blob)) {
        toast('Invoice image copied. Paste it into WhatsApp or a message to send.', 'success');
        return;
      }
      const file = new File([blob], filename, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `${profile.name} salary invoice` });
        return;
      }
      downloadPng(blob, filename);
      toast('Image downloaded. Send that file to the employee.', 'success');
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      toast('Could not copy the invoice image.', 'error');
    } finally {
      saved.forEach(({ el, overflow, width }) => {
        el.style.overflow = overflow;
        el.style.width = width;
      });
      setCopying(false);
    }
  };

  return (
    <div className="space-y-3">
    <div className="flex justify-end">
      <button
        type="button"
        onClick={copyImage}
        disabled={copying}
        className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60"
      >
        <Copy className="h-4 w-4" />
        {copying ? 'Copying image…' : 'Copy image'}
      </button>
    </div>
    <div ref={sheetRef} className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt=""
              className="h-12 w-12 shrink-0 rounded-lg object-cover bg-white"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-black text-amber-300 font-black tracking-tight">
              {shopInitials(shopName)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-lg font-black tracking-tight text-gray-900">{shopName}</div>
            {taglineLines.length > 0 ? (
              <div className="text-[11px] font-semibold leading-snug text-gray-500">
                {taglineLines.map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2 sm:text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Salary invoice</div>
          <div className="text-base font-bold text-gray-900">{titleMonth}</div>
          <div className="text-xs text-gray-600">
            {shortDate(start)} – {shortDate(end)}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-600 sm:text-right">
          <div>
            Invoice No. <span className="font-semibold text-gray-900">{invoiceNumber(profile.employee_id, start)}</span>
          </div>
          <div>
            Date <span className="font-semibold text-gray-900">{shortDate(end)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 p-4">
        <InfoCell label="Employee name" value={profile.name} tone="bg-white border-gray-200" />
        <InfoCell label="Employee ID" value={profile.employee_id} tone="bg-white border-gray-200" />
        <InfoCell
          label="Monthly salary"
          value={formatINR(slip?.monthly_salary || profile.monthly_salary)}
          tone="bg-emerald-50 border-emerald-100"
        />
        <InfoCell
          label="Per day salary"
          value={formatINR(slip?.daily_salary || profile.daily_rate_preview)}
          tone="bg-sky-50 border-sky-100"
        />
        <InfoCell label="Department" value={profile.department || '—'} tone="bg-white border-gray-200" />
        <InfoCell label="Joining date" value={formatDate(profile.date_of_joining) || '—'} tone="bg-white border-gray-200" />
      </div>

      <div className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-900">
            1. Attendance details
            <span className="ml-2 font-medium text-gray-500">
              ({shortDate(start)} – {shortDate(end)})
            </span>
          </h2>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Present</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" /> Half day / late</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> Absent</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-300" /> Weekly off</span>
          </div>
        </div>

        <div className="overflow-x-auto" data-slip-scroll>
          <div className="min-w-[40rem]">
            <div className="grid grid-cols-7 gap-1.5 mb-1.5 text-center text-[11px] font-semibold text-gray-500">
              {WEEKDAYS.map((name) => (
                <div key={name} className={name === 'Sun' ? 'text-rose-600' : ''}>
                  {name}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {blanks.map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {days.map((item) => (
                <DayBox key={item.iso || `${item.month}-${item.day}`} item={item} today={today} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 sm:gap-3">
          <SummaryCell label="Total days" value={String(days.length)} tone="bg-slate-50 border-slate-200" />
          <SummaryCell label="Present" value={String(present)} tone="bg-emerald-50 border-emerald-100" />
          <SummaryCell label="Half day" value={String(half)} tone="bg-amber-50 border-amber-100" />
          <SummaryCell label="Absent" value={String(absent)} tone="bg-red-50 border-red-100" />
          <SummaryCell label="Weekly off" value={String(weeklyOff)} tone="bg-rose-50 border-rose-100" />
          <SummaryCell label="Paid leave" value={String(paid)} tone="bg-sky-50 border-sky-100" />
          <SummaryCell label="Unpaid leave" value={String(unpaid)} tone="bg-orange-50 border-orange-100" />
          <SummaryCell label="Payable days" value={payableLabel} hint="Present + half day" tone="bg-emerald-50 border-emerald-200" />
        </div>
      </div>

      <div className="border-t border-gray-100">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-bold text-gray-900">2. Salary less ledger</h2>
          <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-1.5 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">
              {slip?.period_open ? 'Salary so far' : 'Total salary'}
            </div>
            <div className="text-lg font-bold tabular-nums text-gray-900">
              {formatINR(slip?.total_salary || 0)}
            </div>
          </div>
        </div>

        {slip?.fresh_cycle ? (
          <p className="mx-4 mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            New cycle. This invoice is ₹0 until a punch or an amount is added. Open the previous month for the last cycle.
          </p>
        ) : null}

        <div className="overflow-x-auto" data-slip-scroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 w-14">S.No.</th>
                <th className="px-3 py-2 w-28">Date</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-4 py-2 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                    No late in, early out, cash, or product less in this cycle.
                  </td>
                </tr>
              ) : (
                lines.map((line, index) => (
                  <tr key={`${line.kind}-${line.date || 'x'}-${index}`} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-gray-500">{index + 1}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">{line.date_label || '—'}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{line.description}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-red-600">
                      −{formatINR(line.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mx-4 mt-3 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-red-800">
          <span className="font-bold">Total less</span>
          <span className="text-xl font-black tabular-nums">{formatINR(slip?.total_less || 0)}</span>
        </div>
        <div className="m-4 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-4 text-emerald-950">
          <span className="inline-flex items-center gap-2 font-bold">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Wallet className="h-4 w-4" />
            </span>
            Final payable salary
          </span>
          <span className="text-2xl font-black tabular-nums">{formatINR(slip?.final_payable || 0)}</span>
        </div>
      </div>
    </div>
    </div>
  );
}
