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
 * Interface for standardized product stock information
 */
export interface ProductStockInfo {
    available: number;
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
 * Extracts and calculates standardized stock information from a product object.
 * Consistent across Products, Search, and POS pages.
 * Custom products are exempt from stock checks and always treated as in stock.
 *
 * @param product The product object containing quantity fields
 * @returns Standardized ProductStockInfo
 */
export const getStockInfo = (product: any): ProductStockInfo => {
    // Custom products are exempt from stock checks — always in stock
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

    // available_quantity: barcodes with 'new'/'returned' tags - barcodes in active carts
    const available = typeof product.available_quantity === 'number'
        ? product.available_quantity
        : parseFloat(product.available_quantity || '0');

    // stock_quantity: count of all non-sold barcodes (new, returned, defective, etc.)
    const total = typeof product.stock_quantity === 'number'
        ? product.stock_quantity
        : parseFloat(product.stock_quantity || '0');

    const threshold = typeof product.low_stock_threshold === 'number'
        ? product.low_stock_threshold
        : parseFloat(product.low_stock_threshold || '0');

    // Business logic for statuses:
    // 1. Out of stock: No available quantity
    // 2. Low stock: Available quantity is at or below threshold (if threshold > 0)
    const isOutOfStock = available <= 0;
    const isLowStock = !isOutOfStock && threshold > 0 && available <= threshold;

    return {
        available: Math.max(0, available),
        total: Math.max(0, total),
        isLowStock,
        isOutOfStock,
        lowStockThreshold: threshold,
        displayAvailable: formatNumber(available, 0),
        displayTotal: formatNumber(total, 0),
    };
};
