/**
 * Split input by newlines or pipes into trimmed barcode strings.
 */
export function parseBarcodesFromInput(input: string): string[] {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(/[\n|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Heuristic: does the string look like a barcode (vs free-text search)?
 */
export function looksLikeBarcode(input: string): boolean {
  if (!input || input.length < 3) return false;
  const barcodePattern = /^[A-Za-z0-9\-_]+$/;
  return barcodePattern.test(input) && (input.length >= 4 || input.includes('-') || input.includes('_'));
}
