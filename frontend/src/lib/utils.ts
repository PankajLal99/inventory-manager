/** Red for product names containing "NON PESTING" */
export const PRODUCT_NAME_COLOR_NON_PESTING = '#be1129';

/** Green for product names containing "PESTING" (and not "NON PESTING") */
export const PRODUCT_NAME_COLOR_PESTING = '#418f28';

/**
 * Returns the display color for a product name based on PESTING / NON PESTING.
 * Check "NON PESTING" first so names containing both get red.
 */
export function getProductNameColor(name: string | null | undefined): string | undefined {
  if (name == null || typeof name !== 'string') return undefined;
  const upper = name.toUpperCase();
  if (upper.includes('NON PESTING')) return PRODUCT_NAME_COLOR_NON_PESTING;
  if (upper.includes('PESTING')) return PRODUCT_NAME_COLOR_PESTING;
  return undefined;
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

    // YYYY-MM-DD or ISO datetime beginning with YYYY-MM-DD
    const isoLike = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (isoLike) {
        const y = Number(isoLike[1]);
        const m = Number(isoLike[2]);
        const d = Number(isoLike[3]);
        const parsed = new Date(y, m - 1, d);
        if (parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d) return parsed;
        return null;
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

    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
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
 * Formats a date for display as MM/DD/YYYY (mm dd yyyy).
 * Accepts Date or YYYY-MM-DD string. Parses as local date.
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
 * Accepts Date or YYYY-MM-DD string. Parses as local date.
 */
export function formatDateDDMMYYYY(date: Date | string | null | undefined): string {
  const d = parseLocalDate(date);
  if (!d) return '';
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Formats a date-only string (YYYY-MM-DD) for display in the user's locale.
 * Parses as local date so the shown day doesn't shift (e.g. in timezones behind UTC).
 */
export function formatDateOnlyDisplay(dateStr: string | null | undefined): string {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString();
}

/** POS cart / line item scan timestamp (ISO from API). */
export function formatScannedTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });
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
