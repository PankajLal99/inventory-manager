import { formatAmountINR } from '../../lib/utils';
import { creditAmountInWords, formatCreditInvoiceDate } from './CreditInvoiceDocument';

export type CreditInvoiceHtmlItem = {
  product_name?: string | null;
  quantity?: string | number | null;
  unit_price?: string | number | null;
  line_total?: string | number | null;
};

export type CreditInvoiceHtmlInput = {
  invoice_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  store_name?: string | null;
  created_at?: string | null;
  total?: string | number | null;
  notes?: string | null;
  status?: string | null;
  items?: CreditInvoiceHtmlItem[];
  /** Full-document total qty (for grand total row); defaults to sum of items */
  totalQty?: number;
  /** When paginating cart snapshots */
  partIndex?: number;
  partCount?: number;
  showTotals?: boolean;
  /** Offset added to S.N. (0-based → display starts at lineOffset+1) */
  lineOffset?: number;
};

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : formatAmountINR(qty);
}

/**
 * Self-contained classic invoice HTML for html2canvas / PDF.
 * Uses tables only (no CSS grid) so capture doesn't overlap cells.
 */
export function buildCreditInvoiceHtml(input: CreditInvoiceHtmlInput): string {
  const items = input.items || [];
  const partIndex = input.partIndex ?? 1;
  const partCount = input.partCount ?? 1;
  const showTotals = input.showTotals !== false;
  const lineOffset = input.lineOffset ?? 0;

  const rows = items.map((item, idx) => {
    const qty = Math.round(parseFloat(String(item.quantity ?? 0)) || 0);
    const price = parseFloat(String(item.unit_price ?? 0)) || 0;
    const amount =
      parseFloat(String(item.line_total ?? qty * price)) || qty * price;
    return {
      idx: lineOffset + idx + 1,
      name: item.product_name || '—',
      qty,
      price,
      amount,
    };
  });

  // Grand total always uses full invoice total when provided; qty for footer is part-local
  // unless showTotals with provided total (cart/invoice level).
  const pageQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalQty =
    typeof input.totalQty === 'number' ? input.totalQty : pageQty;
  const totalAmt =
    parseFloat(String(input.total ?? 0)) || rows.reduce((s, r) => s + r.amount, 0);

  const partNote =
    partCount > 1
      ? `<div style="font-size:11px;margin-top:6px;color:#555;">Part ${partIndex} of ${partCount}${
          rows.length ? ` · Lines ${rows[0].idx}–${rows[rows.length - 1].idx}` : ''
        }</div>`
      : '';

  const voidBadge =
    input.status === 'void'
      ? `<div style="margin-top:8px;display:inline-block;padding:2px 8px;font-size:11px;font-weight:700;text-transform:uppercase;border:1px solid #b91c1c;background:#fee2e2;color:#b91c1c;">Void</div>`
      : '';

  const bodyRows = rows
    .map(
      (r) => `<tr>
      <td style="border:1px solid #333;padding:7px 6px;text-align:center;width:42px;">${r.idx}</td>
      <td style="border:1px solid #333;padding:7px 8px;text-align:left;font-weight:500;">${escapeHtml(r.name)}</td>
      <td style="border:1px solid #333;padding:7px 6px;text-align:right;width:64px;">${escapeHtml(fmtQty(r.qty))}</td>
      <td style="border:1px solid #333;padding:7px 6px;text-align:center;width:52px;">Pcs.</td>
      <td style="border:1px solid #333;padding:7px 6px;text-align:right;width:80px;">${escapeHtml(formatAmountINR(r.price))}</td>
      <td style="border:1px solid #333;padding:7px 6px;text-align:right;width:96px;font-weight:600;">${escapeHtml(formatAmountINR(r.amount))}</td>
    </tr>`
    )
    .join('');

  const emptyRow = `<tr>
    <td colspan="6" style="border:1px solid #333;padding:24px;text-align:center;color:#999;">No line items</td>
  </tr>`;

  const grandRow = showTotals
    ? `<tr>
      <td style="border:1px solid #111;padding:10px 6px;background:#f5f5f5;"></td>
      <td style="border:1px solid #111;padding:10px 8px;background:#f5f5f5;font-weight:700;">Grand Total</td>
      <td colspan="2" style="border:1px solid #111;padding:10px 6px;background:#f5f5f5;text-align:right;font-weight:700;">${escapeHtml(fmtQty(totalQty))} Pcs.</td>
      <td style="border:1px solid #111;padding:10px 6px;background:#f5f5f5;"></td>
      <td style="border:1px solid #111;padding:10px 6px;background:#f5f5f5;text-align:right;font-weight:700;">
        ₹ ${escapeHtml(formatAmountINR(totalAmt))}
      </td>
    </tr>`
    : '';

  const footer = showTotals
    ? `<div style="border-top:2px solid #111;padding:12px 16px;">
        <div style="font-size:13px;margin-bottom:16px;">
          <strong>Amount in Words: </strong>${escapeHtml(creditAmountInWords(totalAmt))}
        </div>
        ${
          input.notes
            ? `<div style="font-size:12px;color:#444;margin-bottom:16px;"><strong>Notes: </strong>${escapeHtml(input.notes)}</div>`
            : ''
        }
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
          <tr>
            <td style="width:50%;vertical-align:bottom;padding:0 8px 0 0;">
              <div style="font-weight:700;">Terms &amp; Conditions</div>
              <div style="font-size:11px;color:#666;margin-top:4px;">Credit sale — payable as per account ledger.</div>
            </td>
            <td style="width:50%;vertical-align:bottom;text-align:center;padding:0 0 0 8px;">
              <div style="height:28px;"></div>
              <div style="display:inline-block;border-top:1px solid #888;padding:4px 16px 0;font-weight:700;">Receiver's Signature</div>
            </td>
          </tr>
        </table>
      </div>`
    : partCount > 1
      ? `<div style="border-top:1px solid #ccc;padding:12px 16px;font-size:12px;text-align:right;color:#555;">Continued on next image…</div>`
      : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Credit Invoice</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div id="credit-invoice-root" style="width:794px;margin:0;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;border:2px solid #111111;box-sizing:border-box;display:inline-block;vertical-align:top;">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>
        <td style="width:50%;vertical-align:top;padding:14px 16px;border-right:1px solid #111;border-bottom:2px solid #111;">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Party Details :</div>
          <div style="font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;">${escapeHtml(input.customer_name || '—')}</div>
          ${input.customer_phone ? `<div style="font-size:12px;color:#444;margin-top:4px;">${escapeHtml(input.customer_phone)}</div>` : ''}
          ${input.store_name ? `<div style="font-size:12px;color:#666;margin-top:4px;">Store: ${escapeHtml(input.store_name)}</div>` : ''}
          ${voidBadge}
          ${partNote}
        </td>
        <td style="width:50%;vertical-align:top;padding:14px 16px;border-bottom:2px solid #111;font-size:13px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:0 0 8px 0;font-weight:700;white-space:nowrap;">Invoice No. :</td>
              <td style="padding:0 0 8px 0;font-weight:700;text-align:right;">${escapeHtml(input.invoice_number || '—')}</td>
            </tr>
            <tr>
              <td style="padding:0;font-weight:700;white-space:nowrap;">Dated :</td>
              <td style="padding:0;text-align:right;">${escapeHtml(formatCreditInvoiceDate(input.created_at))}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed;">
      <thead>
        <tr style="background:#f0f0f0;">
          <th style="border:1px solid #111;padding:8px 6px;text-align:left;font-weight:700;width:42px;">S.N.</th>
          <th style="border:1px solid #111;padding:8px 8px;text-align:left;font-weight:700;">Description of Goods</th>
          <th style="border:1px solid #111;padding:8px 6px;text-align:right;font-weight:700;width:64px;">Qty.</th>
          <th style="border:1px solid #111;padding:8px 6px;text-align:center;font-weight:700;width:52px;">Unit</th>
          <th style="border:1px solid #111;padding:8px 6px;text-align:right;font-weight:700;width:80px;">Price</th>
          <th style="border:1px solid #111;padding:8px 6px;text-align:right;font-weight:700;width:96px;">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || emptyRow}
        ${grandRow}
      </tbody>
    </table>

    ${footer}
  </div>
</body>
</html>`;
}

export const CREDIT_INVOICE_CAPTURE_WIDTH = 794;
