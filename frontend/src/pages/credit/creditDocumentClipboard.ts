import html2canvas from 'html2canvas';
import {
  buildCreditInvoiceHtml,
  CREDIT_INVOICE_CAPTURE_HEIGHT,
  CREDIT_INVOICE_CAPTURE_WIDTH,
} from './creditInvoiceHtml';
import {
  buildCreditLedgerSnapshotHtml,
  buildCreditLedgerSnapshotPageHtmlList,
  type CreditLedgerStatementSnapshot,
} from './creditLedgerSnapshot';
import { setPendingLedgerClipboardImage } from './pendingLedgerClipboard';

export const SNAPSHOT_ROWS_PER_PAGE = 25;

type CartSnapshotRow = {
  idx: number;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

function chunkSnapshotRows<T>(rows: T[], size: number): T[][] {
  if (size <= 0) return [rows];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [[]];
}

export async function renderSnapshotHtmlToBlob(
  iframe: HTMLIFrameElement,
  html: string
): Promise<Blob | null> {
  const doc = iframe.contentDocument;
  if (!doc) return null;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => window.setTimeout(r, 150));

  const root =
    (doc.getElementById('credit-invoice-root') as HTMLElement | null) ||
    (doc.getElementById('credit-ledger-copy-root') as HTMLElement | null) ||
    doc.body;
  const w = CREDIT_INVOICE_CAPTURE_WIDTH;
  const h = Math.max(
    CREDIT_INVOICE_CAPTURE_HEIGHT,
    Math.ceil(root.scrollHeight || root.offsetHeight || 1)
  );
  iframe.style.width = `${w}px`;
  iframe.style.height = `${h + 8}px`;

  const canvas = await html2canvas(root, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: w,
    windowHeight: h,
    width: w,
    height: h,
  });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 1));
}

export async function copyPngBlobToClipboard(blob: Blob): Promise<boolean> {
  const canWriteImage =
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof (window as any).ClipboardItem !== 'undefined';
  if (!canWriteImage) return false;
  try {
    await navigator.clipboard.write([
      new (window as any).ClipboardItem({ 'image/png': blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export type CreditDocumentClipboardInput = {
  variant?: 'invoice' | 'return';
  invoice_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  created_at?: string | null;
  subtotal?: string | number | null;
  total?: string | number | null;
  previous_balance?: string | number | null;
  customer_balance?: string | number | null;
  status?: string | null;
  notes?: string | null;
  items?: Array<{
    product_name?: string | null;
    quantity?: string | number | null;
    unit_price?: string | number | null;
    line_total?: string | number | null;
  }>;
};

export async function buildCreditDocumentSnapshotBlobs(
  iframe: HTMLIFrameElement,
  input: CreditDocumentClipboardInput
): Promise<Blob[]> {
  const items = input.items || [];
  const rows: CartSnapshotRow[] = items.map((item, idx) => {
    const rawQty = Math.round(parseFloat(String(item.quantity ?? '0')) || 0);
    const qty = input.variant === 'return' ? Math.abs(rawQty) : rawQty;
    const rawPrice = parseFloat(String(item.unit_price ?? '0')) || 0;
    const unitPrice = input.variant === 'return' ? Math.abs(rawPrice) : rawPrice;
    const rawLine = parseFloat(String(item.line_total ?? '0')) || qty * unitPrice;
    const lineTotal = input.variant === 'return' ? Math.abs(rawLine) : rawLine;
    return {
      idx: idx + 1,
      name: item.product_name || 'Item',
      qty,
      unitPrice,
      lineTotal,
    };
  });

  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  const totalAmtRaw =
    parseFloat(String(input.total ?? 0)) ||
    rows.reduce((sum, row) => sum + row.lineTotal, 0);
  const totalAmt = input.variant === 'return' ? Math.abs(totalAmtRaw) : totalAmtRaw;
  const rowChunks = chunkSnapshotRows(rows, SNAPSHOT_ROWS_PER_PAGE);
  const blobs: Blob[] = [];
  let lineOffset = 0;

  for (let i = 0; i < rowChunks.length; i++) {
    const chunk = rowChunks[i];
    const html = buildCreditInvoiceHtml({
      variant: input.variant,
      invoice_number: input.invoice_number,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      created_at: input.created_at,
      subtotal: input.subtotal ?? totalAmt,
      total: input.total ?? totalAmt,
      totalQty,
      totalItems: rows.length,
      // Previous/old balance is never shown on credit invoice images.
      previous_balance: undefined,
      customer_balance: input.customer_balance,
      status: input.status,
      notes: input.notes,
      items: chunk.map((r) => ({
        product_name: r.name,
        quantity: r.qty,
        unit_price: r.unitPrice,
        line_total: r.lineTotal,
      })),
      partIndex: i + 1,
      partCount: rowChunks.length,
      showTotals: i === rowChunks.length - 1,
      lineOffset,
    });
    lineOffset += chunk.length;
    const blob = await renderSnapshotHtmlToBlob(iframe, html);
    if (!blob) {
      throw new Error(`Failed to create document image (part ${i + 1}).`);
    }
    blobs.push(blob);
  }

  return blobs;
}

export async function mergePngBlobsVertically(blobs: Blob[]): Promise<Blob | null> {
  if (blobs.length === 0) return null;
  if (blobs.length === 1) return blobs[0];

  const bitmaps = await Promise.all(blobs.map((blob) => createImageBitmap(blob)));
  const width = Math.max(...bitmaps.map((b) => b.width));
  const height = bitmaps.reduce((sum, b) => sum + b.height, 0);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blobs[0];

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let y = 0;
  for (const bitmap of bitmaps) {
    ctx.drawImage(bitmap, 0, y);
    y += bitmap.height;
    bitmap.close?.();
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 1));
}

export type CopyDocumentPartsResult = {
  ok: boolean;
  /** Total invoice/return image parts generated. */
  partCount: number;
  /** Remaining parts after the first was copied (caller copies these one-by-one). */
  remainingParts: Blob[];
};

/**
 * Render credit invoice/return HTML to PNG page(s) and copy the first page only.
 * Multi-page documents stay separate — do not merge into one tall image.
 */
export async function copyCreditDocumentImageToClipboard(
  iframe: HTMLIFrameElement,
  input: CreditDocumentClipboardInput
): Promise<CopyDocumentPartsResult> {
  const blobs = await buildCreditDocumentSnapshotBlobs(iframe, input);
  if (!blobs.length) {
    return { ok: false, partCount: 0, remainingParts: [] };
  }
  if (!(await copyPngBlobToClipboard(blobs[0]))) {
    return { ok: false, partCount: blobs.length, remainingParts: [] };
  }
  return {
    ok: true,
    partCount: blobs.length,
    remainingParts: blobs.slice(1),
  };
}

/**
 * Render ledger statement as one PNG per page (40 rows/page), then merge vertically.
 */
export async function buildCreditLedgerSnapshotBlobs(
  iframe: HTMLIFrameElement,
  statement: CreditLedgerStatementSnapshot
): Promise<Blob[]> {
  const pages = buildCreditLedgerSnapshotPageHtmlList(statement);
  const blobs: Blob[] = [];
  for (let i = 0; i < pages.length; i++) {
    const blob = await renderSnapshotHtmlToBlob(iframe, pages[i]);
    if (!blob) {
      throw new Error(`Failed to create ledger image (page ${i + 1}).`);
    }
    blobs.push(blob);
  }
  return blobs;
}

export async function buildMergedCreditLedgerSnapshotBlob(
  iframe: HTMLIFrameElement,
  statement: CreditLedgerStatementSnapshot
): Promise<Blob | null> {
  const blobs = await buildCreditLedgerSnapshotBlobs(iframe, statement);
  return mergePngBlobsVertically(blobs);
}

export type CopyDocumentThenLedgerResult = {
  ok: boolean;
  /** Total invoice/return image parts. */
  documentPartCount: number;
  /**
   * Remaining invoice/return pages after page 1 was copied.
   * When non-empty, ledger is NOT queued yet — finish copying these, then call
   * `finishDocumentPartsAndQueueLedger`.
   */
  remainingDocumentParts: Blob[];
  /** Ledger image (always built when ok). Queued automatically only when a single doc page. */
  ledgerBlob: Blob | null;
};

/**
 * Copy invoice/return page 1, prepare ledger as a later separate image.
 * Multi-page invoices are NOT merged — remaining pages are returned for sequential copy.
 * Browsers only keep one clipboard image at a time.
 */
export async function copyDocumentThenQueueLedgerImage(
  iframe: HTMLIFrameElement,
  documentInput: CreditDocumentClipboardInput,
  statement: CreditLedgerStatementSnapshot
): Promise<CopyDocumentThenLedgerResult> {
  const docBlobs = await buildCreditDocumentSnapshotBlobs(iframe, documentInput);
  if (!docBlobs.length) {
    return {
      ok: false,
      documentPartCount: 0,
      remainingDocumentParts: [],
      ledgerBlob: null,
    };
  }

  const ledgerBlob = await buildMergedCreditLedgerSnapshotBlob(iframe, statement);
  if (!ledgerBlob) {
    throw new Error('Failed to create ledger image');
  }

  if (!(await copyPngBlobToClipboard(docBlobs[0]))) {
    return {
      ok: false,
      documentPartCount: docBlobs.length,
      remainingDocumentParts: [],
      ledgerBlob: null,
    };
  }

  const remainingDocumentParts = docBlobs.slice(1);
  if (remainingDocumentParts.length === 0) {
    setPendingLedgerClipboardImage(ledgerBlob);
  }

  return {
    ok: true,
    documentPartCount: docBlobs.length,
    remainingDocumentParts,
    ledgerBlob,
  };
}

/** After all multi-page invoice/return images are copied, queue ledger for the ledger page. */
export function finishDocumentPartsAndQueueLedger(ledgerBlob: Blob) {
  setPendingLedgerClipboardImage(ledgerBlob);
}

/** @deprecated Prefer copyDocumentThenQueueLedgerImage for two separate images */
export async function copyDocumentAndLedgerImageToClipboard(
  iframe: HTMLIFrameElement,
  documentInput: CreditDocumentClipboardInput,
  statement: CreditLedgerStatementSnapshot
): Promise<boolean> {
  const result = await copyDocumentThenQueueLedgerImage(iframe, documentInput, statement);
  return result.ok && result.remainingDocumentParts.length === 0;
}

// Keep single-page helper available for callers that only need HTML
export { buildCreditLedgerSnapshotHtml };