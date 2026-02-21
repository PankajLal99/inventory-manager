/**
 * Formats a number for display, stripping unnecessary trailing zeros (e.g., .00)
 * and adding comma separators for thousands.
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

    // Use toLocaleString but explicitly control fraction digits to avoid trailing zeros
    // if 'value' is an integer, minimumFractionDigits: 0 will result in no decimals.
    return value.toLocaleString(undefined, {
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
 * Whether a main-ledger entry can be edited in-place (pencil). Invoice-linked entries
 * are edited via the invoice; only entries without an invoice show the edit button.
 */
export const canEditLedgerEntry = (entry: { invoice?: number | null }): boolean => !entry.invoice;

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
