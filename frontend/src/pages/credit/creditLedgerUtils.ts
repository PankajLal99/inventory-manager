import { format } from 'date-fns';
import { formatAmountINR } from '../../lib/utils';

export type CollectionStatus = 'good' | 'warning' | 'danger';

export type CreditLedgerCustomerRow = {
  id: number;
  name: string;
  phone?: string;
  balance?: string | number;
  total_debit?: string | number;
  total_credit?: string | number;
  net_amount?: string | number;
  entry_count?: number;
  latest_description?: string;
  last_payment_at?: string | null;
  days_since_last_payment?: number | null;
  collection_status?: CollectionStatus;
  customer_group_id?: number | null;
  customer_group_name?: string;
};

export function formatCustomerWithGroup(name: string, groupName?: string) {
  const safeName = name || 'Anonymous';
  const safeGroup = (groupName || '').trim();
  return safeGroup ? `${safeName} (${safeGroup})` : safeName;
}

export function formatLedgerDate(value?: string | null) {
  if (!value) return '—';
  try {
    return format(new Date(value), 'dd-MM-yyyy');
  } catch {
    return '—';
  }
}

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
      return 'bg-green-50 hover:bg-green-100/80 border-l-4 border-l-green-500';
    case 'warning':
      return 'bg-yellow-50 hover:bg-yellow-100/80 border-l-4 border-l-yellow-500';
    case 'danger':
      return 'bg-red-50 hover:bg-red-100/80 border-l-4 border-l-red-500';
    default:
      return 'bg-blue-50 hover:bg-blue-100';
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
