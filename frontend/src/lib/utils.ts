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
    // parseFloat(n.toFixed(decimals)) removes trailing .00
    const value = parseFloat(n.toFixed(decimals));

    if (!useCommas) {
        return value.toString();
    }

    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
};
