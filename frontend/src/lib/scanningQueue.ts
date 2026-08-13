/**
 * Shared helpers for the barcode scanning queue (POS & Invoice Edit).
 * Used when splitting pasted/buffered input and deciding if input is barcode-like.
 */

/**
 * Strip scanner artifacts from a scanned/typed barcode:
 * whitespace (including NBSP / zero-width), then uppercase.
 * Example: "ON/ -0185" -> "ON/-0185"
 */
export function sanitizeScannedBarcode(value: string): string {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Split a single line of input by newlines or pipes into sanitized barcode strings.
 * Used when user pastes multiple barcodes or scanner buffers several scans.
 */
export function parseBarcodesFromInput(input: string): string[] {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(/[\n|]+/)
    .map((s) => sanitizeScannedBarcode(s))
    .filter(Boolean);
}

/**
 * Heuristic: does the string look like a barcode (vs free-text search)?
 * Used to decide whether to send to the queue vs search.
 * Collapses scanner spaces next to / - _ so "ON/ -0185" still counts as a barcode,
 * but "FRAME A33" (space between words) stays a product-name search.
 */
export function looksLikeBarcode(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  const collapsed = input
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*([/\-_])\s*/g, '$1')
    .trim();
  if (collapsed.length < 3) return false;
  const barcodePattern = /^[A-Za-z0-9\-_\/]+$/;
  return barcodePattern.test(collapsed) && (collapsed.length >= 4 || /[-_/]/.test(collapsed));
}

export function normalizeBarcodeKey(value: string): string {
  return sanitizeScannedBarcode(value);
}

export type InvoiceLineBarcodeFields = {
  barcode_id?: number | null;
  barcode?: number | string | null;
  barcode_value?: string | null;
  barcode_full?: string | null;
  sold_barcode_value?: string | null;
};

type ResolvedBarcodeHint = {
  barcode_id?: number | null;
  canonical_barcode?: string | null;
  matched_barcode?: string | null;
};

/** True when searchValue (or resolved barcode id/strings) already appears on invoice lines. */
export function isBarcodeAlreadyOnInvoiceItems(
  searchValue: string,
  items: InvoiceLineBarcodeFields[] | null | undefined,
  resolved?: ResolvedBarcodeHint,
): boolean {
  if (!items?.length) return false;

  const searchKey = normalizeBarcodeKey(searchValue);
  const resolvedKeys = new Set<string>();
  if (searchKey) resolvedKeys.add(searchKey);
  for (const raw of [resolved?.canonical_barcode, resolved?.matched_barcode]) {
    if (raw) resolvedKeys.add(normalizeBarcodeKey(String(raw)));
  }
  const resolvedId = resolved?.barcode_id ?? null;

  for (const item of items) {
    if (resolvedId != null) {
      const itemBarcodeId = item.barcode_id ?? item.barcode;
      if (itemBarcodeId != null && Number(itemBarcodeId) === Number(resolvedId)) {
        return true;
      }
    }

    for (const raw of [
      item.barcode_value,
      item.barcode_full,
      item.sold_barcode_value,
    ]) {
      if (raw && resolvedKeys.has(normalizeBarcodeKey(String(raw)))) {
        return true;
      }
    }
  }

  return false;
}

/** Module-level guard: one in-flight scan per barcode string across all invoice screens. */
const inFlightInvoiceBarcodeScans = new Set<string>();

export type BarcodeLookupProduct = {
  id: number;
  barcode_id?: number | null;
  barcode_available?: boolean;
  barcode_tag?: string | null;
  sold_invoice?: string;
  selling_price?: number | null;
  canonical_barcode?: string | null;
  matched_barcode?: string | null;
  defective_moved_out?: boolean;
  defective_move_out_number?: string;
};

export type AddScannedBarcodeToInvoiceResult =
  | { ok: true }
  | { ok: false; message: string; duplicate?: boolean; silent?: boolean };

/**
 * Single entry point for scanning a barcode onto a draft invoice (checkout modal, edit modal, etc.).
 * UI pre-checks duplicates; backend still enforces via invoice_items + row lock.
 */
export async function addScannedBarcodeToInvoice(params: {
  barcode: string;
  items: InvoiceLineBarcodeFields[] | null | undefined;
  invoiceStatus?: string;
  invoiceType?: string;
  lookupBarcode: (barcode: string) => Promise<BarcodeLookupProduct | null | undefined>;
  addItem: (payload: Record<string, unknown>) => Promise<unknown>;
}): Promise<AddScannedBarcodeToInvoiceResult> {
  const trimmed = sanitizeScannedBarcode(params.barcode);
  if (!trimmed) return { ok: false, message: '', silent: true };

  const scanKey = trimmed;
  if (inFlightInvoiceBarcodeScans.has(scanKey)) {
    return { ok: false, message: '', silent: true };
  }

  const isDraft = params.invoiceStatus === 'draft';
  const isPendingOrCredit = params.invoiceType === 'pending' || params.invoiceType === 'credit';
  const isDefectiveInvoice = params.invoiceType === 'defective';
  if (!isDefectiveInvoice && (!isDraft || !isPendingOrCredit)) {
    return {
      ok: false,
      message: 'Items can only be added to draft pending or draft credit invoices. Please ensure the invoice is in draft status with pending/credit type.',
    };
  }

  if (isBarcodeAlreadyOnInvoiceItems(trimmed, params.items)) {
    return { ok: false, message: 'This barcode is already on this invoice.', duplicate: true };
  }

  inFlightInvoiceBarcodeScans.add(scanKey);
  try {
    let product: BarcodeLookupProduct | null | undefined;
    try {
      product = await params.lookupBarcode(trimmed);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        return {
          ok: false,
          message: `Barcode "${trimmed}" not found. Please ensure the barcode is correct or scan again.`,
        };
      }
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Failed to search for product';
      return { ok: false, message: msg };
    }

    if (!product?.id) {
      return { ok: false, message: 'Product not found' };
    }

    if (isBarcodeAlreadyOnInvoiceItems(trimmed, params.items, {
      barcode_id: product.barcode_id,
      canonical_barcode: product.canonical_barcode,
      matched_barcode: product.matched_barcode,
    })) {
      return { ok: false, message: 'This barcode is already on this invoice.', duplicate: true };
    }

    if (isDefectiveInvoice) {
      if (String(product.barcode_tag || '').toLowerCase() !== 'defective') {
        return {
          ok: false,
          message: 'Only defective barcodes can be added to a move-out invoice. Mark the item as defective first.',
        };
      }
      if (product.defective_moved_out) {
        const moveOutNum = product.defective_move_out_number ? ` (${product.defective_move_out_number})` : '';
        return {
          ok: false,
          message: `This defective barcode is already on a move-out${moveOutNum}.`,
        };
      }
    } else if (product.barcode_available === false) {
      const errorMsg = product.sold_invoice
        ? `This item (SKU: ${trimmed}) has already been sold and is assigned to invoice ${product.sold_invoice}. It is not available in inventory.`
        : `This item (SKU: ${trimmed}) has already been sold and is not available in inventory.`;
      return { ok: false, message: errorMsg };
    }

    const isPending = params.invoiceType === 'pending' && params.invoiceStatus === 'draft';
    const quantity = 1;
    const unitPrice = isPending ? 0 : (product.selling_price || 0);
    const lineTotal = quantity * unitPrice;
    const scannedBarcode = (product.canonical_barcode ?? product.matched_barcode ?? trimmed).toString().trim();

    const payload: Record<string, unknown> = {
      product: product.id,
      quantity,
      unit_price: unitPrice,
      discount_amount: 0,
      tax_amount: 0,
      line_total: lineTotal,
      barcode: scannedBarcode,
    };
    if (product.barcode_id != null) {
      payload.barcode_id = product.barcode_id;
    }

    try {
      await params.addItem(payload);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error
        || (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || 'Failed to add item';
      const duplicate = String(msg).toLowerCase().includes('already on this invoice');
      return { ok: false, message: msg, duplicate };
    }

    return { ok: true };
  } finally {
    inFlightInvoiceBarcodeScans.delete(scanKey);
  }
}
