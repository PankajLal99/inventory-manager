import { resolveProductNameColor } from './productNameColorRules';

export {
  PRODUCT_NAME_COLOR_NON_PESTING,
  PRODUCT_NAME_COLOR_PESTING,
  PRODUCT_NAME_SUPER_RULES,
  DEFAULT_CUSTOM_KEYWORD_RULES,
  DEFAULT_PRODUCT_NAME_COLOR_RULES,
  loadCustomKeywordColorRules,
  loadProductNameColorRules,
  saveCustomKeywordColorRules,
  saveProductNameColorRules,
  resetCustomKeywordColorRules,
  resetProductNameColorRules,
  resolveProductNameSuperColor,
  resolveProductNameColor,
  buildProductNameSegments,
  getProductNameInlineStyle,
  formatProductNameHtml,
  createProductNameColorRule,
  hydrateProductNameColorRulesFromServer,
  subscribeProductNameColorRules,
  PRODUCT_NAME_COLOR_RULES_CHANGED,
  type ProductNameColorRule,
  type ProductNameColorRuleScope,
  type ProductNameSegment,
} from './productNameColorRules';

/** Returns the display color for a product name based on configured keyword rules. */
/** Parse API purchase_date (dd-mm-yyyy or ISO) for sorting. */
function purchaseDateSortKey(value: string | null | undefined): number {
  if (!value) return 0;
  const isoPrefix = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoPrefix) {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const dmy = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const t = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Supplier breakdown rows: newest purchase date first, then newest purchase item id. */
export function sortSupplierBreakdownByDateDesc<
  T extends {
    purchase_date?: string | null;
    purchase_date_iso?: string | null;
    purchase_item_id?: number | null;
  },
>(rows: T[] | null | undefined): T[] {
  if (!rows?.length) return rows ?? [];
  return [...rows].sort((a, b) => {
    const aDate = a.purchase_date_iso
      ? purchaseDateSortKey(a.purchase_date_iso)
      : purchaseDateSortKey(a.purchase_date ?? undefined);
    const bDate = b.purchase_date_iso
      ? purchaseDateSortKey(b.purchase_date_iso)
      : purchaseDateSortKey(b.purchase_date ?? undefined);
    if (bDate !== aDate) return bDate - aDate;
    return (b.purchase_item_id ?? 0) - (a.purchase_item_id ?? 0);
  });
}

export function getProductNameColor(name: string | null | undefined): string | undefined {
  return resolveProductNameColor(name);
}

/**
 * Formats a number for display, stripping unnecessary trailing zeros (e.g., .00)
 * and adding Indian comma separators (thousand/lakh/crore style).
 * 
 * @param num The number to format
 * @param decimals The maximum number of decimal places
 * @returns A formatted string
 */
export const formatNumber = (num: number | string | undefined | null, decimals: number = 2, useCommas: boolean = true): string => {
    if (num === undefined || num === null) return '0';

    const n = typeof num === 'string' ? parseFloat(num) : num;

    if (isNaN(n)) return '0';

    // Format with the specified maximum decimals, but strip unnecessary zeros
    const value = parseFloat(n.toFixed(decimals));

    if (!useCommas) {
        return value.toString();
    }

    // Use en-IN so comma grouping is Indian style for currency displays.
    // if 'value' is an integer, minimumFractionDigits: 0 will result in no decimals.
    return value.toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
};

/**
 * Formats a number as INR amount in Indian style (lakhs/crore comma-separated).
 * e.g. 1234567.89 → "12,34,567.89"
 * Use with ₹ prefix: ₹{formatAmountINR(amount)}
 */
export const formatAmountINR = (num: number | string | undefined | null, decimals: number = 2): string => {
    if (num === undefined || num === null) return '0';
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(n)) return '0';
    const value = parseFloat(n.toFixed(decimals));
    return value.toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
};

/**
 * Formats an amount for use in input fields (e.g. edit modal).
 * Strips unnecessary trailing zeros so whole numbers show as "100" not "100.00".
 */
export function amountForInput(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return '';
  return n % 1 === 0 ? String(Math.round(n)) : String(n);
}

/**
 * Whether a main-ledger entry can be edited in-place (pencil). Invoice-linked entries
 * are edited via the invoice; only entries without an invoice show the edit button.
 */
export const canEditLedgerEntry = (entry: { invoice?: number | null }): boolean => !entry.invoice;

function parseLocalDate(date: Date | string | null | undefined): Date | null {
    if (date == null) return null;
    if (date instanceof Date) return isNaN(date.getTime()) ? null : date;

    const value = String(date).trim();
    if (!value) return null;

    // Date-only YYYY-MM-DD — interpret as local calendar day (no UTC shift).
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
        const y = Number(dateOnly[1]);
        const m = Number(dateOnly[2]);
        const d = Number(dateOnly[3]);
        const parsed = new Date(y, m - 1, d);
        if (parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d) return parsed;
        return null;
    }

    // ISO / datetime with clock time — use local calendar day (avoids UTC date prefix off-by-one).
    if (/^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}/.test(value)) {
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    // DD/MM/YYYY
    const ddmmyyyy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) {
        const d = Number(ddmmyyyy[1]);
        const m = Number(ddmmyyyy[2]);
        const y = Number(ddmmyyyy[3]);
        const parsed = new Date(y, m - 1, d);
        if (parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d) return parsed;
        return null;
    }

    // DD-MM-YYYY
    const ddmmyyyyDash = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (ddmmyyyyDash) {
        const d = Number(ddmmyyyyDash[1]);
        const m = Number(ddmmyyyyDash[2]);
        const y = Number(ddmmyyyyDash[3]);
        const parsed = new Date(y, m - 1, d);
        if (parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d) return parsed;
        return null;
    }

    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
}

/** True when the source value includes a clock time (not date-only). */
function sourceHasTimeComponent(date: Date | string): boolean {
    if (date instanceof Date) return true;
    const value = String(date).trim();
    if (!value) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(value)) return false;
    return /[T\s]\d{1,2}:\d{2}/.test(value);
}

function formatDDMMYYYYParts(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

/** Local clock time in 12-hour format with AM/PM (e.g. 2:05 PM, 2:05:09 PM). */
function formatLocalTimeParts(d: Date, withSeconds = false): string {
    const hours24 = d.getHours();
    const hour12 = hours24 % 12 || 12;
    const min = String(d.getMinutes()).padStart(2, '0');
    const meridiem = hours24 >= 12 ? 'PM' : 'AM';
    if (!withSeconds) return `${hour12}:${min} ${meridiem}`;
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hour12}:${min}:${ss} ${meridiem}`;
}

/**
 * App-wide date display: always DD/MM/YYYY, independent of system locale.
 * Includes local time in 12-hour format (h:mm AM/PM) when the value has a time component.
 */
export function formatAppDate(
    date: Date | string | null | undefined,
    options?: {
        /** 'auto' (default): time only if source has time. true/false forces. */
        includeTime?: boolean | 'auto';
        /** Include seconds when showing time (default false). */
        withSeconds?: boolean;
        /** Returned for null/empty/invalid (default ''). */
        empty?: string;
    },
): string {
    const empty = options?.empty ?? '';
    if (date == null || date === '') return empty;

    const includeTimeOpt = options?.includeTime ?? 'auto';
    const withSeconds = options?.withSeconds ?? false;
    const wantsTime =
        includeTimeOpt === true ||
        (includeTimeOpt === 'auto' && sourceHasTimeComponent(date));

    let d: Date | null = null;
    // ISO datetimes must use local calendar day — stripping YYYY-MM-DD from a UTC
    // string (e.g. 2024-07-29T18:30:00Z = midnight IST Jul 30) shifts the date back one day.
    if (typeof date === 'string' && sourceHasTimeComponent(date)) {
        const parsed = new Date(String(date).trim());
        d = isNaN(parsed.getTime()) ? null : parsed;
    } else if (date instanceof Date) {
        d = isNaN(date.getTime()) ? null : date;
    } else {
        d = parseLocalDate(date);
    }
    if (!d) return empty;

    const datePart = formatDDMMYYYYParts(d);
    if (!wantsTime) return datePart;
    return `${datePart} ${formatLocalTimeParts(d, withSeconds)}`;
}

/** Alias: date-only DD/MM/YYYY (never shows time). */
export function formatAppDateOnly(date: Date | string | null | undefined, empty = ''): string {
    return formatAppDate(date, { includeTime: false, empty });
}

/** Alias: always DD/MM/YYYY h:mm AM/PM when parseable. */
export function formatAppDateTime(date: Date | string | null | undefined, empty = ''): string {
    return formatAppDate(date, { includeTime: true, empty });
}

export function toIsoDateString(date: Date | string | null | undefined): string {
    const d = parseLocalDate(date);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getWeekdayName(date: Date | string | null | undefined): string {
    const d = parseLocalDate(date);
    if (!d) return '';
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
}

/**
 * Returns the calendar date (YYYY-MM-DD) in the user's local timezone.
 * Use this when displaying a datetime from the API in a date input, so the selected day
 * doesn't shift by one (UTC vs local).
 */
export function toLocalDateString(date: Date | string | null | undefined): string {
    return toIsoDateString(date);
}

/**
 * Formats a date for display as MM/DD/YYYY (legacy). Prefer formatAppDate / formatDateDDMMYYYY.
 */
export function formatDateMMDDYYYY(date: Date | string | null | undefined): string {
  const d = parseLocalDate(date);
  if (!d) return '';
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Formats a date for display as DD/MM/YYYY (day month year).
 * Date-only — does not include time. For datetime columns use formatAppDate.
 */
export function formatDateDDMMYYYY(date: Date | string | null | undefined): string {
  return formatAppDate(date, { includeTime: false, empty: '' });
}

/** True when customer belongs to MT SHOP (name or MTSHOP customer group). */
export function isMtShopCustomer(
  customerName?: string | null,
  customerGroupName?: string | null,
): boolean {
  if (String(customerName || '').toUpperCase().includes('MT SHOP')) return true;
  const group = String(customerGroupName || '').toUpperCase().replace(/\s+/g, '');
  return group.includes('MTSHOP');
}

export const MT_SHOP_TABLE_ROW_CLASS = 'bg-blue-100/80 border-l-4 border-l-blue-700';
export const MT_SHOP_MOBILE_CARD_CLASS = 'bg-blue-100 border-blue-600 ring-1 ring-blue-400';
export const MT_SHOP_BADGE_CLASS =
  'inline-flex items-center rounded-full bg-blue-800 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white';

/**
 * Formats a date-only string (YYYY-MM-DD) for display as DD/MM/YYYY.
 * Parses as local date so the shown day doesn't shift (e.g. in timezones behind UTC).
 */
export function formatDateOnlyDisplay(dateStr: string | null | undefined): string {
    return formatAppDate(dateStr, { includeTime: false, empty: '' });
}

/** POS cart / line item scan timestamp (ISO from API). */
export function formatScannedTime(iso: string | null | undefined): string {
    return formatAppDate(iso, { includeTime: true, withSeconds: true, empty: '' });
}

/**
 * Converts a date-only string (YYYY-MM-DD) to an ISO string for that date at
 * the current local time. Use when sending created_at for ledger entries so
 * the entry shows the actual time (e.g. 2:14 PM) instead of midnight.
 */
export function dateStringWithCurrentTimeISO(dateStr: string): string {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const now = new Date();
    const date = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return date.toISOString();
}

/**
 * Converts a date-only string (YYYY-MM-DD) to an ISO string for midnight on that date
 * in the user's local timezone. Use when you need a date-only value as datetime (e.g.
 * backdating with no specific time).
 */
export function dateStringToLocalMidnightISO(dateStr: string): string {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toISOString();
}

export type DateRangePreset = 'one_day' | 'last_7_days' | 'last_30_days' | 'custom';

export interface DateRangeValue {
    startDate: string;
    endDate: string;
}

/**
 * Returns today's local date in YYYY-MM-DD.
 */
export function getTodayDateString(referenceDate: Date = new Date()): string {
    return toLocalDateString(referenceDate);
}

/**
 * Returns a date string shifted by N calendar days in local time.
 */
export function getShiftedLocalDateString(daysOffset: number, referenceDate: Date = new Date()): string {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() + daysOffset);
    return toLocalDateString(date);
}

/**
 * Builds a local date range for common presets.
 * Ranges are inclusive on both start and end dates.
 */
export function getDateRangeByPreset(
    preset: Exclude<DateRangePreset, 'custom'>,
    referenceDate: Date = new Date(),
): DateRangeValue {
    const today = getTodayDateString(referenceDate);

    if (preset === 'one_day') {
        return { startDate: today, endDate: today };
    }

    if (preset === 'last_7_days') {
        return {
            startDate: getShiftedLocalDateString(-6, referenceDate),
            endDate: today,
        };
    }

    return {
        startDate: getShiftedLocalDateString(-29, referenceDate),
        endDate: today,
    };
}

/**
 * Ensures start date is not after end date.
 */
export function normalizeDateRange(range: DateRangeValue): DateRangeValue {
    const { startDate, endDate } = range;
    if (!startDate || !endDate) return range;
    if (startDate <= endDate) return range;
    return {
        startDate: endDate,
        endDate: startDate,
    };
}

/**
 * Standardized product stock information.
 * Backend is source of truth. Unknown (tag/supplier) does NOT mean warehouse.
 * - Shop qty / warehouse_stock: from purchase only (no addition/subtraction).
 * - Available = (barcodes new+returned) - warehouse_qty; if negative, 0.
 */
export interface ProductStockInfo {
    /** Available to sell: backend computes (new+returned count) - warehouse_qty, min 0 */
    available: number;
    /** Total non-sold barcode count */
    total: number;
    isLowStock: boolean;
    isOutOfStock: boolean;
    lowStockThreshold: number;
    displayAvailable: string;
    displayTotal: string;
}

/**
 * Custom products (e.g. name starting with "Other -") are exempt from stock checks
 * and are always considered in stock.
 */
const isCustomProduct = (product: any): boolean =>
    !!(product?.name && typeof product.name === 'string' && product.name.startsWith('Other -'));

/**
 * Extracts stock information from product (backend is source of truth).
 *
 * - available_quantity (backend): (barcodes new+returned) - warehouse_qty; if negative, 0.
 * - shop_stock / warehouse_stock: from purchase only (stored numbers, no addition/subtraction).
 * - stock_quantity: all non-sold barcodes. Unknown does NOT mean warehouse.
 *
 * Stock quantities are displayed as decimals.
 */
export const getStockInfo = (product: any): ProductStockInfo => {
    if (isCustomProduct(product)) {
        return {
            available: 0,
            total: 0,
            isLowStock: false,
            isOutOfStock: false,
            lowStockThreshold: 0,
            displayAvailable: '0',
            displayTotal: '0',
        };
    }

    const available = typeof product.available_quantity === 'number'
        ? product.available_quantity
        : parseFloat(product.available_quantity || '0');

    const total = typeof product.stock_quantity === 'number'
        ? product.stock_quantity
        : parseFloat(product.stock_quantity || '0');

    const threshold = typeof product.low_stock_threshold === 'number'
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
