import { formatAmountINR, formatAppDate } from '../../lib/utils';
import { auth } from '../../lib/auth';

function userGroupNames(user = auth.getUser()): string[] {
  return (user?.groups || []).map((g) => {
    if (g == null) return '';
    if (typeof g === 'string') return g.trim().toLowerCase();
    if (typeof g === 'object' && 'name' in g) return String((g as { name?: string }).name || '').trim().toLowerCase();
    return String(g).trim().toLowerCase();
  }).filter(Boolean);
}

function isAccountGroupName(name: string): boolean {
  return name === 'account' || name === 'accounts';
}

/** Django group "Account" / "Accounts" — membership check (may also have other groups). */
export function isAccountsUser(user = auth.getUser()): boolean {
  return userGroupNames(user).some(isAccountGroupName);
}

/**
 * True only when the user has Account/Accounts and no other groups.
 * These users are forced into the credit portal. Users with Accounts + Counter/Admin/etc.
 * stay in the main app.
 */
export function isAccountsOnlyUser(user = auth.getUser()): boolean {
  const groups = userGroupNames(user);
  if (groups.length === 0) return false;
  if (!groups.some(isAccountGroupName)) return false;
  return groups.every(isAccountGroupName);
}

/**
 * Admin and Super may void credit invoices, returns, and delete manual ledger entries.
 * Account(s) users are always denied (even if also in Admin).
 */
export function canManageCreditRecords(user = auth.getUser()): boolean {
  if (isAccountsUser(user)) return false;
  const groups = userGroupNames(user);
  return groups.includes('admin') || groups.includes('super');
}

/**
 * Admin, Super, and Account(s) may edit credit invoices and returns.
 * Void/delete stays gated by canManageCreditRecords.
 */
export function canEditCreditRecords(user = auth.getUser()): boolean {
  if (isAccountsUser(user)) return true;
  return canManageCreditRecords(user);
}

/** Total receivable KPI is hidden from Accounts-only users. */
export function canSeeCreditReceivableKpi(user = auth.getUser()): boolean {
  return !isAccountsOnlyUser(user);
}

export type CollectionStatus = 'good' | 'warning' | 'danger';

export type CreditLedgerCustomerRow = {
  id: number;
  name: string;
  phone?: string;
  balance?: string | number;
  total_debit?: string | number;
  total_credit?: string | number;
  /** Payments received (CreditPayment only — not returns / manual non-payment credits) */
  total_received?: string | number;
  /** Sum of completed CreditReturn.total for the customer */
  total_returns?: string | number;
  net_amount?: string | number;
  entry_count?: number;
  latest_description?: string;
  last_payment_at?: string | null;
  last_sale_at?: string | null;
  days_since_last_payment?: number | null;
  collection_status?: CollectionStatus;
  customer_group_id?: number | null;
  customer_group_name?: string;
  collection_reason?: string;
  next_follow_up_date?: string | null;
  follow_up_delta_days?: number | null;
};

export type CreditLedgerDeleteSummary = {
  customer: {
    id: number;
    name: string;
    balance?: string | number;
    phone?: string;
  };
  invoice_count: number;
  open_invoice_count: number;
  void_invoice_count: number;
  return_count: number;
  completed_return_count: number;
  void_return_count: number;
  payment_count: number;
  ledger_entry_count: number;
  cart_count: number;
  collection_event_count: number;
};

export type CreditCollectionHistoryEvent = {
  id: number;
  event_type: string;
  event_type_label: string;
  reason: string;
  follow_up_date: string | null;
  previous_follow_up_date: string | null;
  note: string;
  created_by: number | null;
  created_by_name: string;
  created_at: string | null;
};

type CreditDateInput = Date | string | null | undefined;

/** Credit UI date column — DD/MM/YYYY only (no time). */
export function formatCreditDate(value?: CreditDateInput) {
  return formatAppDate(value, { includeTime: false, empty: '—' });
}

/** Credit UI datetime — DD/MM/YYYY h:mm AM/PM. */
export function formatCreditDateTime(value?: CreditDateInput) {
  return formatAppDate(value, { includeTime: true, empty: '—' });
}

/**
 * Statement / list columns — DD/MM/YYYY only (no time).
 */
export function formatCreditStatementDate(value?: CreditDateInput) {
  return formatAppDate(value, { includeTime: false, empty: '—' });
}

/** Invoice / return document "Dated" field. */
export function formatCreditInvoiceDate(value?: CreditDateInput) {
  return formatCreditDateTime(value);
}

/** @deprecated Use formatCreditDate */
export const formatLedgerDate = formatCreditDate;

/** @deprecated Use formatCreditDateTime */
export const formatLedgerDateTime = formatCreditDateTime;

export function formatMoneyCell(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  if (!Number.isFinite(n) || n === 0) return '';
  return formatAmountINR(n);
}

export function balanceLabel(amount: string | number, side: string) {
  const n = parseFloat(String(amount ?? 0));
  return `${formatAmountINR(n)} ${side || 'Dr'}`;
}

export function collectionStatusLabel(status: CollectionStatus | string | undefined): string {
  switch (status) {
    case 'good':
      return 'Paying on time';
    case 'warning':
      return 'No payment 7+ days';
    case 'danger':
      return 'No payment 12+ days';
    default:
      return '—';
  }
}

export function daysSincePaymentLabel(days: number | null | undefined, balance: number): string {
  if (balance <= 0) return 'Paid';
  if (days == null) return 'No payment yet';
  if (days === 0) return 'Paid today';
  if (days === 1) return '1 day since pay';
  return `${days} days since pay`;
}

export function followUpDeltaLabel(delta: number | null | undefined): string {
  if (delta == null) return 'No follow-up';
  if (delta === 0) return 'Follow-up today';
  if (delta > 0) return delta === 1 ? 'Follow-up in 1 day' : `Follow-up in ${delta} days`;
  const overdue = Math.abs(delta);
  return overdue === 1 ? 'Follow-up overdue 1 day' : `Follow-up overdue ${overdue} days`;
}

export function collectionStatusBadgeVariant(
  status: CollectionStatus | string | undefined
): 'success' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'good':
      return 'success';
    case 'warning':
      return 'warning';
    case 'danger':
      return 'danger';
    default:
      return 'default';
  }
}

export function collectionStatusRowClass(status: CollectionStatus | string | undefined): string {
  switch (status) {
    case 'good':
      return 'bg-white hover:bg-gray-50 border-l-[3px] border-l-green-500';
    case 'warning':
      return 'bg-white hover:bg-amber-50/40 border-l-[3px] border-l-amber-400';
    case 'danger':
      return 'bg-white hover:bg-red-50/40 border-l-[3px] border-l-red-500';
    default:
      return 'bg-white hover:bg-gray-50 border-l-[3px] border-l-transparent';
  }
}

export function collectionStatusDotClass(status: CollectionStatus | string | undefined): string {
  switch (status) {
    case 'good':
      return 'bg-green-500';
    case 'warning':
      return 'bg-yellow-500';
    case 'danger':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

export function followUpDeltaClass(delta: number | null | undefined): string {
  if (delta == null) return 'text-stone-500';
  if (delta < 0) return 'text-red-700 font-semibold';
  if (delta === 0) return 'text-amber-800 font-semibold';
  return 'text-stone-700';
}

export function collectionEventStyle(eventType: string | undefined): {
  dot: string;
  badge: string;
} {
  switch (eventType) {
    case 'reason':
      return {
        dot: 'bg-blue-600',
        badge: 'bg-blue-100 text-blue-900 border border-blue-200',
      };
    case 'follow_up':
      return {
        dot: 'bg-amber-600',
        badge: 'bg-amber-100 text-amber-950 border border-amber-200',
      };
    case 'auto_bump':
      return {
        dot: 'bg-emerald-600',
        badge: 'bg-emerald-100 text-emerald-900 border border-emerald-200',
      };
    case 'cleared':
      return {
        dot: 'bg-stone-500',
        badge: 'bg-stone-200 text-stone-900 border border-stone-300',
      };
    default:
      return {
        dot: 'bg-stone-400',
        badge: 'bg-stone-100 text-stone-800 border border-stone-200',
      };
  }
}

type LedgerSortRow = {
  id?: number | string | null;
  event_at_ms?: number | string | null;
  created_at?: string | Date | null;
  event_at?: string | Date | null;
};

/** Parse statement event time to epoch ms. Never uses US MM/DD (10/06 = 10 June). */
export function ledgerEventTimeMs(row: LedgerSortRow | string | Date | null | undefined): number {
  if (row == null || row === '') return 0;
  if (typeof row === 'number') return Number.isFinite(row) ? row : 0;
  if (row instanceof Date) {
    const t = row.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof row === 'object') {
    const ms = Number(row.event_at_ms);
    if (Number.isFinite(ms) && ms > 0) return ms;
    return ledgerEventTimeMs((row.event_at || row.created_at) as string | Date | null | undefined);
  }

  const s = String(row).trim();
  if (!s) return 0;

  const dmy = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i
  );
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = Number(dmy[3]);
    let hour = dmy[4] != null ? Number(dmy[4]) : 0;
    const minute = dmy[5] != null ? Number(dmy[5]) : 0;
    const second = dmy[6] != null ? Number(dmy[6]) : 0;
    const ap = (dmy[7] || '').toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    const local = new Date(year, month, day, hour, minute, second);
    const t = local.getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // Django can send 6-digit microseconds; Date.parse wants 3-digit ms.
  const iso = s.replace(/(\.\d{3})\d+/, '$1').replace(' ', 'T');
  const isoMs = Date.parse(iso);
  return Number.isFinite(isoMs) ? isoMs : 0;
}

/** Chronological statement order: event datetime ascending, then id. */
export function compareLedgerStatementRows(a: LedgerSortRow, b: LedgerSortRow): number {
  const ta = ledgerEventTimeMs(a);
  const tb = ledgerEventTimeMs(b);
  if (ta !== tb) return ta - tb;
  return (Number(a.id) || 0) - (Number(b.id) || 0);
}
