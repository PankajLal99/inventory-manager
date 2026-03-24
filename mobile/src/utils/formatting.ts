import type { ProductStockInfo, DateRangePreset, DateRangeValue } from '../types';

// ─── Product Name Colors ───────────────────────────────────────
export const PRODUCT_NAME_COLOR_NON_PESTING = '#be1129';
export const PRODUCT_NAME_COLOR_PESTING = '#418f28';

export function getProductNameColor(name: string | null | undefined): string | undefined {
  if (name == null || typeof name !== 'string') return undefined;
  const upper = name.toUpperCase();
  if (upper.includes('NON PESTING')) return PRODUCT_NAME_COLOR_NON_PESTING;
  if (upper.includes('PESTING')) return PRODUCT_NAME_COLOR_PESTING;
  return undefined;
}

// ─── Number Formatting ─────────────────────────────────────────
export const formatNumber = (
  num: number | string | undefined | null,
  decimals = 2,
  useCommas = true,
): string => {
  if (num === undefined || num === null) return '0';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0';
  const value = parseFloat(n.toFixed(decimals));
  if (!useCommas) return value.toString();
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
};

export const formatAmountINR = (
  num: number | string | undefined | null,
  decimals = 2,
): string => {
  if (num === undefined || num === null) return '0';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0';
  const value = parseFloat(n.toFixed(decimals));
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
};

export function amountForInput(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return '';
  return n % 1 === 0 ? String(Math.round(n)) : String(n);
}

// ─── Ledger Helpers ────────────────────────────────────────────
export const canEditLedgerEntry = (entry: { invoice?: number | null }): boolean =>
  !entry.invoice;

// ─── Date Helpers ──────────────────────────────────────────────
export function toLocalDateString(date: Date | string | null | undefined): string {
  if (date == null) return '';
  let d: Date;
  if (typeof date === 'string') {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, day] = match.map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateDDMMYYYY(date: Date | string | null | undefined): string {
  if (date == null) return '';
  let d: Date;
  if (typeof date === 'string') {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, day] = match.map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDateOnlyDisplay(dateStr: string | null | undefined): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString();
}

export function dateStringWithCurrentTimeISO(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  const date = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  return date.toISOString();
}

export function dateStringToLocalMidnightISO(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

export function getTodayDateString(referenceDate: Date = new Date()): string {
  return toLocalDateString(referenceDate);
}

export function getShiftedLocalDateString(daysOffset: number, referenceDate: Date = new Date()): string {
  const date = new Date(referenceDate);
  date.setDate(date.getDate() + daysOffset);
  return toLocalDateString(date);
}

export function getDateRangeByPreset(
  preset: Exclude<DateRangePreset, 'custom'>,
  referenceDate: Date = new Date(),
): DateRangeValue {
  const today = getTodayDateString(referenceDate);
  if (preset === 'one_day') return { startDate: today, endDate: today };
  if (preset === 'last_7_days')
    return { startDate: getShiftedLocalDateString(-6, referenceDate), endDate: today };
  return { startDate: getShiftedLocalDateString(-29, referenceDate), endDate: today };
}

export function normalizeDateRange(range: DateRangeValue): DateRangeValue {
  const { startDate, endDate } = range;
  if (!startDate || !endDate) return range;
  if (startDate <= endDate) return range;
  return { startDate: endDate, endDate: startDate };
}

// ─── Stock Info ────────────────────────────────────────────────
const isCustomProduct = (product: any): boolean =>
  !!(product?.name && typeof product.name === 'string' && product.name.startsWith('Other -'));

export const getStockInfo = (product: any): ProductStockInfo => {
  if (isCustomProduct(product)) {
    return { available: 0, total: 0, isLowStock: false, isOutOfStock: false, lowStockThreshold: 0, displayAvailable: '0', displayTotal: '0' };
  }

  const available =
    typeof product.available_quantity === 'number'
      ? product.available_quantity
      : parseFloat(product.available_quantity || '0');
  const total =
    typeof product.stock_quantity === 'number'
      ? product.stock_quantity
      : parseFloat(product.stock_quantity || '0');
  const threshold =
    typeof product.low_stock_threshold === 'number'
      ? product.low_stock_threshold
      : parseFloat(product.low_stock_threshold || '0');

  const isOutOfStock = available <= 0;
  const isLowStock = !isOutOfStock && threshold > 0 && available <= threshold;

  return {
    available: Math.max(0, available),
    total: Math.max(0, total),
    isLowStock,
    isOutOfStock,
    lowStockThreshold: threshold,
    displayAvailable: formatNumber(available, 2),
    displayTotal: formatNumber(total, 2),
  };
};
