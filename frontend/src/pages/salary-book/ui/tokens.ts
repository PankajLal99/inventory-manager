export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export const STATUS_STYLE: Record<string, { bg: string; text: string; short: string }> = {
  PRESENT: { bg: 'bg-emerald-500', text: 'text-white', short: 'P' },
  HALF_DAY: { bg: 'bg-amber-400', text: 'text-amber-950', short: '½' },
  ABSENT: { bg: 'bg-red-500', text: 'text-white', short: 'A' },
  PAID_LEAVE: { bg: 'bg-sky-500', text: 'text-white', short: 'PL' },
  UNPAID_LEAVE: { bg: 'bg-orange-500', text: 'text-white', short: 'UL' },
  HOLIDAY: { bg: 'bg-violet-500', text: 'text-white', short: 'H' },
  BEFORE_JOINING: { bg: 'bg-gray-100', text: 'text-gray-300', short: '' },
  UNMARKED: { bg: 'bg-white', text: 'text-slate-500', short: '—' },
};

export const STATUS_PILL: Record<string, string> = {
  PRESENT: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  HALF_DAY: 'bg-amber-50 text-amber-900 border-amber-100',
  ABSENT: 'bg-red-50 text-red-800 border-red-100',
  PAID_LEAVE: 'bg-sky-50 text-sky-800 border-sky-100',
  UNPAID_LEAVE: 'bg-orange-50 text-orange-800 border-orange-100',
  HOLIDAY: 'bg-violet-50 text-violet-800 border-violet-100',
  UNMARKED: 'bg-slate-50 text-slate-600 border-slate-200',
  PENDING: 'bg-amber-50 text-amber-900 border-amber-100',
  PARTIALLY_PAID: 'bg-sky-50 text-sky-800 border-sky-100',
  PAID: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  DRAFT: 'bg-slate-50 text-slate-600 border-slate-200',
  FINALIZED: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  INACTIVE: 'bg-slate-100 text-slate-600 border-slate-200',
  VOID: 'bg-slate-100 text-slate-500 border-slate-200',
};

export const CARD_CLASS = 'bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgb(15_23_42_/_0.05)]';
export const INPUT_FOCUS = 'focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600';
