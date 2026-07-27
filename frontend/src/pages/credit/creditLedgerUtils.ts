import { formatAmountINR, formatAppDate } from '../../lib/utils';
import { auth } from '../../lib/auth';

/** Admin and Super may edit/void credit invoices, returns, and manual ledger entries. */
export function canManageCreditRecords(user = auth.getUser()): boolean {
  const groups = user?.groups || [];
  return groups.includes('Admin') || groups.includes('Super');
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

/** Credit UI datetime — DD/MM/YYYY HH:mm. */
export function formatCreditDateTime(value?: CreditDateInput) {
  return formatAppDate(value, { includeTime: true, empty: '—' });
}

/**
 * Statement / list columns — DD/MM/YYYY, or DD/MM/YYYY HH:mm when source has time.
 */
export function formatCreditStatementDate(value?: CreditDateInput) {
  return formatAppDate(value, { includeTime: 'auto', empty: '—' });
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
      return 'No payment 5+ days';
    case 'danger':
      return 'No payment 10+ days';
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
