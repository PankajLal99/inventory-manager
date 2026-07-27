import html2canvas from 'html2canvas';
import {
  buildCreditInvoiceHtml,
  CREDIT_INVOICE_CAPTURE_HEIGHT,
  CREDIT_INVOICE_CAPTURE_WIDTH,
} from './creditInvoiceHtml';

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
    (doc.getElementById('credit-invoice-root') as HTMLElement | null) || doc.body;
  const w = CREDIT_INVOICE_CAPTURE_WIDTH;
  const h = Math.max(
    CREDIT_INVOICE_CAPTURE_HEIGHT,
    Math.ceil(root.scrollHeight || root.offsetHeight || 1)
  );
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
  const rows: CartSnapshotRow[] = items.map((item, idx) => ({
    idx: idx + 1,
    name: item.product_name || 'Item',
    qty: Math.round(parseFloat(String(item.quantity ?? '0')) || 0),
    unitPrice: parseFloat(String(item.unit_price ?? '0')) || 0,
    lineTotal: parseFloat(String(item.line_total ?? '0')) || 0,
  }));

  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  const totalAmt =
    parseFloat(String(input.total ?? 0)) ||
    rows.reduce((sum, row) => sum + row.lineTotal, 0);
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
      previous_balance: input.previous_balance,
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

async function mergePngBlobsVertically(blobs: Blob[]): Promise<Blob | null> {
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

/** Render credit invoice/return HTML to PNG and copy a single merged image to the clipboard. */
export async function copyCreditDocumentImageToClipboard(
  iframe: HTMLIFrameElement,
  input: CreditDocumentClipboardInput
): Promise<boolean> {
  const blobs = await buildCreditDocumentSnapshotBlobs(iframe, input);
  const merged = await mergePngBlobsVertically(blobs);
  if (!merged) return false;
  return copyPngBlobToClipboard(merged);
}
