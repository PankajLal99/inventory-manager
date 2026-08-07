import { formatAmountINR } from '../../lib/utils';
import { creditAmountInWords } from './CreditInvoiceDocument';
import { getInvoiceTheme, type CreditDocTheme } from './creditDocTheme';
import { formatCreditInvoiceDate } from './creditLedgerUtils';

export { CREDIT_THEME } from './creditDocTheme';
export type { CreditDocTheme } from './creditDocTheme';

export const CREDIT_SHOP_NAME = 'MANISH TRADERS';
export const CREDIT_INVOICE_CAPTURE_WIDTH = 794;
export const CREDIT_INVOICE_CAPTURE_HEIGHT = 1123;

/** Consistent type scale — avoids footer / summary size jumps */
const FONT = {
  xs: '11px',
  sm: '12px',
  md: '13px',
  lg: '15px',
  xl: '24px',
};

export type CreditInvoiceHtmlItem = {
  product_name?: string | null;
  quantity?: string | number | null;
  unit_price?: string | number | null;
  line_total?: string | number | null;
};

export type CreditInvoiceHtmlInput = {
  variant?: 'invoice' | 'return';
  invoice_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  store_name?: string | null;
  shop_name?: string | null;
  created_at?: string | null;
  subtotal?: string | number | null;
  total?: string | number | null;
  notes?: string | null;
  status?: string | null;
  customer_balance?: string | number | null;
  previous_balance?: string | number | null;
  items?: CreditInvoiceHtmlItem[];
  totalQty?: number;
  totalItems?: number;
  partIndex?: number;
  partCount?: number;
  showTotals?: boolean;
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

/** Return docs: qty as "- (11)", unit as "- Pcs." */
function fmtReturnQty(qty: number): string {
  return `- (${fmtQty(Math.abs(qty))})`;
}

const RETURN_UNIT = '- Pcs.';

function fmtMoney(amount: number): string {
  return `₹ ${formatAmountINR(amount)}`;
}

function parseAmount(value: string | number | null | undefined): number {
  return parseFloat(String(value ?? 0)) || 0;
}

/** Flat abstract blobs — kept on the left so they never cover header text on the right */
function headerAbstractShapes(theme: CreditDocTheme): string {
  return `
    <div style="position:absolute;top:-48px;left:48px;width:128px;height:128px;border-radius:50%;background:rgba(255,255,255,0.14);z-index:0;"></div>
    <div style="position:absolute;bottom:-36px;left:28%;width:72px;height:72px;border-radius:50%;background:${theme.primaryBorder};opacity:0.5;z-index:0;"></div>
    <div style="position:absolute;bottom:8px;left:-18px;width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,0.1);transform:rotate(-12deg);z-index:0;"></div>
  `;
}

function footerAbstractShapes(theme: CreditDocTheme): string {
  return `
    <div style="position:absolute;bottom:-20px;right:24px;width:64px;height:64px;border-radius:50%;background:${theme.primaryBorder};opacity:0.35;"></div>
    <div style="position:absolute;top:16px;left:-12px;width:40px;height:40px;border-radius:10px;background:${theme.primary};opacity:0.12;transform:rotate(20deg);"></div>
  `;
}

/**
 * Self-contained colourful A4 invoice HTML for html2canvas / PDF / print.
 * Uses tables only (no CSS grid) so capture doesn't overlap cells.
 */
export function buildCreditInvoiceHtml(input: CreditInvoiceHtmlInput): string {
  const items = input.items || [];
  const variant = input.variant ?? 'invoice';
  const isReturn = variant === 'return';
  const documentTitle = isReturn ? 'Credit Return' : 'Credit Sale Invoice';
  const numberLabel = isReturn ? 'Return No.' : 'Invoice No.';
  const summaryTitle = isReturn ? 'Return Summary' : 'Invoice Summary';
  const paymentLabel = isReturn ? 'Credit to Ledger' : 'On Credit';
  const termsText = isReturn
    ? 'Return credit posted to customer ledger. Quantities and amounts are as recorded at return.'
    : 'Credit sale — payable as per account ledger. Goods once sold will not be taken back without prior approval.';
  const pageTitle = isReturn ? 'Credit Return' : 'Credit Invoice';
  const partIndex = input.partIndex ?? 1;
  const partCount = input.partCount ?? 1;
  const showTotals = input.showTotals !== false;
  const lineOffset = input.lineOffset ?? 0;
  const shopName = input.shop_name?.trim() || CREDIT_SHOP_NAME;
  const theme = getInvoiceTheme();

  const rows = items.map((item, idx) => {
    const rawQty = Math.round(parseFloat(String(item.quantity ?? 0)) || 0);
    const qty = Math.abs(rawQty);
    const price = Math.abs(parseFloat(String(item.unit_price ?? 0)) || 0);
    const rawAmount =
      parseFloat(String(item.line_total ?? qty * price)) || qty * price;
    const amount = isReturn ? Math.abs(rawAmount) : rawAmount;
    return {
      idx: lineOffset + idx + 1,
      name: item.product_name || '—',
      qty,
      price,
      amount,
    };
  });

  const pageQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalQtyRaw =
    typeof input.totalQty === 'number' ? input.totalQty : pageQty;
  const totalQty = isReturn ? Math.abs(totalQtyRaw) : totalQtyRaw;
  const totalItems =
    typeof input.totalItems === 'number' ? input.totalItems : items.length;
  const totalAmtRaw =
    parseAmount(input.total) || rows.reduce((s, r) => s + r.amount, 0);
  const totalAmt = isReturn ? Math.abs(totalAmtRaw) : totalAmtRaw;
  const subtotalAmtRaw = parseAmount(input.subtotal) || totalAmt;
  const subtotalAmt = isReturn ? Math.abs(subtotalAmtRaw) : subtotalAmtRaw;

  const partNote =
    partCount > 1
      ? `<div style="font-size:${FONT.xs};margin-top:8px;color:${theme.textMuted};font-weight:600;">Part ${partIndex} of ${partCount}${
          rows.length ? ` · Lines ${rows[0].idx}–${rows[rows.length - 1].idx}` : ''
        }</div>`
      : '';

  const voidBadge =
    input.status === 'void'
      ? `<div style="margin-top:10px;display:inline-block;padding:3px 10px;font-size:${FONT.xs};font-weight:700;text-transform:uppercase;border-radius:4px;border:1px solid #b91c1c;background:#fee2e2;color:#b91c1c;">Void</div>`
      : '';

  const returnBadge = isReturn
    ? `<div style="margin-top:10px;display:inline-block;padding:3px 10px;font-size:${FONT.xs};font-weight:700;text-transform:uppercase;border-radius:4px;border:1px solid #b45309;background:#fef3c7;color:#92400e;">Return Invoice</div>`
    : '';

  const qtyDisplay = (qty: number) =>
    isReturn ? fmtReturnQty(qty) : fmtQty(qty);
  const unitDisplay = isReturn ? RETURN_UNIT : 'Pcs.';
  const qtyWithUnit = (qty: number) =>
    isReturn
      ? `${fmtReturnQty(qty)} ${RETURN_UNIT}`
      : `${fmtQty(qty)} Pcs.`;

  const cellPad = '7px 8px';
  const bodyRows = rows
    .map(
      (r, i) => `<tr style="background:${i % 2 === 1 ? theme.rowAlt : theme.white};">
      <td style="border:1px solid ${theme.primaryBorder};padding:${cellPad};text-align:center;width:42px;font-size:${FONT.sm};color:${theme.secondaryMuted};font-weight:600;">${r.idx}</td>
      <td style="border:1px solid ${theme.primaryBorder};padding:${cellPad};text-align:left;font-size:${FONT.sm};font-weight:600;color:${theme.text};">${escapeHtml(r.name)}</td>
      <td style="border:1px solid ${theme.primaryBorder};padding:${cellPad};text-align:right;width:${isReturn ? '78' : '64'}px;font-size:${FONT.sm};font-weight:600;">${escapeHtml(qtyDisplay(r.qty))}</td>
      <td style="border:1px solid ${theme.primaryBorder};padding:${cellPad};text-align:center;width:${isReturn ? '64' : '52'}px;font-size:${FONT.sm};color:${theme.textMuted};">${escapeHtml(unitDisplay)}</td>
      <td style="border:1px solid ${theme.primaryBorder};padding:${cellPad};text-align:right;width:80px;font-size:${FONT.sm};">${escapeHtml(formatAmountINR(r.price))}</td>
      <td style="border:1px solid ${theme.primaryBorder};padding:${cellPad};text-align:right;width:96px;font-size:${FONT.sm};font-weight:700;color:${theme.secondary};">${escapeHtml(formatAmountINR(r.amount))}</td>
    </tr>`
    )
    .join('');

  const emptyRow = `<tr>
    <td colspan="6" style="border:1px solid ${theme.primaryBorder};padding:28px;text-align:center;font-size:${FONT.sm};color:#a8a29e;">No line items</td>
  </tr>`;

  const qtyFooterRow = showTotals
    ? `<tr>
      <td style="border:1px solid ${theme.secondaryMuted};padding:${cellPad};background:${theme.tableHead};"></td>
      <td style="border:1px solid ${theme.secondaryMuted};padding:${cellPad};background:${theme.tableHead};font-size:${FONT.sm};font-weight:700;color:${theme.secondary};">Total Quantity</td>
      <td colspan="2" style="border:1px solid ${theme.secondaryMuted};padding:${cellPad};background:${theme.tableHead};text-align:right;font-size:${FONT.sm};font-weight:700;color:${theme.secondary};">${escapeHtml(qtyWithUnit(totalQty))}</td>
      <td style="border:1px solid ${theme.secondaryMuted};padding:${cellPad};background:${theme.tableHead};"></td>
      <td style="border:1px solid ${theme.secondaryMuted};padding:${cellPad};background:${theme.tableHead};"></td>
    </tr>`
    : '';

  const summaryRowStyle = `padding:8px 14px;font-size:${FONT.sm};border-bottom:1px solid ${theme.primaryBorder};`;
  const summaryLabel = `color:${theme.textMuted};font-weight:600;`;
  const summaryValue = `text-align:right;font-weight:700;color:${theme.text};`;

  const summaryRows = showTotals
    ? `
      <tr>
        <td style="${summaryRowStyle}${summaryLabel}">Total Items</td>
        <td style="${summaryRowStyle}${summaryValue}">${escapeHtml(String(totalItems))} ${totalItems === 1 ? 'Line' : 'Lines'} · ${escapeHtml(qtyWithUnit(totalQty))}</td>
      </tr>
      <tr>
        <td style="${summaryRowStyle}${summaryLabel}">Sub Total</td>
        <td style="${summaryRowStyle}${summaryValue}">${escapeHtml(fmtMoney(subtotalAmt))}</td>
      </tr>
      <tr>
        <td style="padding:9px 14px;font-size:${FONT.sm};color:${theme.white};font-weight:700;background:${theme.primary};border-bottom:1px solid ${theme.secondaryMuted};">Total</td>
        <td style="padding:9px 14px;font-size:${FONT.sm};text-align:right;font-weight:800;color:${theme.white};background:${theme.primary};border-bottom:1px solid ${theme.secondaryMuted};">${escapeHtml(fmtMoney(totalAmt))}</td>
      </tr>`
    : '';

  const summaryBlock = showTotals
    ? `<table style="width:100%;border-collapse:collapse;margin-top:14px;border:2px solid ${theme.primary};font-size:${FONT.sm};">
        <tr>
          <td colspan="2" style="padding:9px 14px;background:${theme.primary};color:${theme.white};font-weight:700;font-size:${FONT.xs};letter-spacing:0.5px;text-transform:uppercase;">${summaryTitle}</td>
        </tr>
        ${summaryRows}
      </table>
      <div style="margin-top:12px;padding:10px 14px;background:${theme.white};border:1px solid ${theme.primaryBorder};border-left:4px solid ${theme.primary};font-size:${FONT.sm};line-height:1.5;">
        <span style="color:${theme.secondary};font-weight:700;">Amount in Words: </span>
        <span style="color:${theme.text};font-weight:600;">${escapeHtml(creditAmountInWords(totalAmt))}</span>
      </div>`
    : '';

  const footer = showTotals
    ? `<div style="position:relative;overflow:hidden;padding:16px 24px 20px;border-top:3px solid ${theme.primary};background:${theme.primaryPale};">
        ${footerAbstractShapes(theme)}
        ${summaryBlock}
        ${
          input.notes
            ? `<div style="position:relative;font-size:${FONT.sm};color:${theme.textMuted};margin-top:12px;"><span style="color:${theme.secondary};font-weight:700;">Notes: </span>${escapeHtml(input.notes)}</div>`
            : ''
        }
        <table style="position:relative;width:100%;border-collapse:collapse;font-size:${FONT.sm};margin-top:18px;">
          <tr>
            <td style="width:50%;vertical-align:bottom;padding:0 16px 0 0;">
              <div style="font-weight:700;color:${theme.secondary};text-transform:uppercase;letter-spacing:0.4px;font-size:${FONT.xs};">Terms &amp; Conditions</div>
              <div style="font-size:${FONT.sm};color:${theme.textMuted};margin-top:5px;line-height:1.45;">${termsText}</div>
            </td>
            <td style="width:50%;vertical-align:bottom;text-align:center;padding:0 0 0 16px;">
              <div style="height:32px;"></div>
              <div style="display:inline-block;border-top:2px solid ${theme.secondaryMuted};padding:5px 18px 0;font-size:${FONT.sm};font-weight:700;color:${theme.secondary};">Receiver's Signature</div>
            </td>
          </tr>
        </table>
        <div style="position:relative;margin-top:14px;text-align:center;font-size:${FONT.xs};color:${theme.textMuted};">Thank you for your business · ${escapeHtml(shopName)}</div>
      </div>`
    : partCount > 1
      ? `<div style="border-top:2px dashed ${theme.primaryBorder};padding:12px 24px;font-size:${FONT.sm};text-align:right;color:${theme.secondaryMuted};font-weight:600;background:${theme.primaryPale};">Continued on next page…</div>`
      : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${pageTitle} — ${escapeHtml(shopName)}</title>
</head>
<body style="margin:0;padding:0;background:#e7e5e4;font-size:${FONT.sm};">
  <div id="credit-invoice-root" style="width:${CREDIT_INVOICE_CAPTURE_WIDTH}px;min-height:${CREDIT_INVOICE_CAPTURE_HEIGHT}px;margin:0;background:${theme.white};color:${theme.text};font-family:Arial,Helvetica,sans-serif;font-size:${FONT.sm};line-height:1.4;box-sizing:border-box;display:flex;flex-direction:column;border:3px solid ${theme.primary};">

    <!-- Shop header -->
    <div style="position:relative;overflow:hidden;background:${theme.primary};padding:20px 28px;color:${theme.white};">
      ${headerAbstractShapes(theme)}
      <table style="position:relative;z-index:1;width:100%;border-collapse:collapse;color:${theme.white};">
        <tr>
          <td style="vertical-align:middle;">
            <div style="font-size:${FONT.xl};font-weight:800;letter-spacing:1px;text-transform:uppercase;line-height:1.2;color:${theme.white};">${escapeHtml(shopName)}</div>
            <div style="font-size:${FONT.xs};font-weight:600;margin-top:5px;letter-spacing:0.5px;text-transform:uppercase;color:${theme.white};">${documentTitle}</div>
          </td>
          <td style="vertical-align:middle;text-align:right;width:240px;color:${theme.white};">
            <div style="font-size:${FONT.xs};font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${theme.white};">${numberLabel}</div>
            <div style="font-size:${FONT.lg};font-weight:800;margin-top:4px;letter-spacing:0.3px;color:${theme.white};">${escapeHtml(input.invoice_number || '—')}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Party + date -->
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;background:${theme.primaryPale};border-bottom:2px solid ${theme.primaryBorder};font-size:${FONT.sm};">
      <tr>
        <td style="width:58%;vertical-align:top;padding:14px 20px;border-right:1px solid ${theme.primaryBorder};">
          <div style="font-size:${FONT.xs};font-weight:700;color:${theme.secondary};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">Bill To</div>
          <div style="font-size:${FONT.lg};font-weight:800;text-transform:uppercase;letter-spacing:0.2px;color:${theme.text};line-height:1.25;">${escapeHtml(input.customer_name || '—')}</div>
          ${input.customer_phone ? `<div style="font-size:${FONT.sm};color:${theme.textMuted};margin-top:4px;font-weight:600;">${escapeHtml(input.customer_phone)}</div>` : ''}
          ${returnBadge}
          ${voidBadge}
          ${partNote}
        </td>
        <td style="width:42%;vertical-align:top;padding:14px 20px;">
          <table style="width:100%;border-collapse:collapse;font-size:${FONT.sm};">
            <tr>
              <td style="padding:0 0 8px 0;font-weight:600;color:${theme.secondaryMuted};white-space:nowrap;">${numberLabel}</td>
              <td style="padding:0 0 8px 0;font-weight:800;text-align:right;color:${theme.secondary};">${escapeHtml(input.invoice_number || '—')}</td>
            </tr>
            <tr>
              <td style="padding:0 0 8px 0;font-weight:600;color:${theme.secondaryMuted};white-space:nowrap;">Dated</td>
              <td style="padding:0 0 8px 0;font-weight:700;text-align:right;color:${theme.text};">${escapeHtml(formatCreditInvoiceDate(input.created_at))}</td>
            </tr>
            <tr>
              <td style="padding:0;font-weight:600;color:${theme.secondaryMuted};white-space:nowrap;">Payment</td>
              <td style="padding:0;text-align:right;font-weight:700;color:${theme.primary};">${paymentLabel}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Items -->
    <table style="width:100%;border-collapse:collapse;font-size:${FONT.sm};table-layout:fixed;flex-shrink:0;">
      <thead>
        <tr style="background:${theme.tableHead};">
          <th style="border:1px solid ${theme.secondaryMuted};padding:8px 6px;text-align:center;font-weight:700;color:${theme.secondary};width:42px;font-size:${FONT.xs};">S.N.</th>
          <th style="border:1px solid ${theme.secondaryMuted};padding:8px 8px;text-align:left;font-weight:700;color:${theme.secondary};font-size:${FONT.xs};">Description of Goods</th>
          <th style="border:1px solid ${theme.secondaryMuted};padding:8px 6px;text-align:right;font-weight:700;color:${theme.secondary};width:64px;font-size:${FONT.xs};">Qty.</th>
          <th style="border:1px solid ${theme.secondaryMuted};padding:8px 6px;text-align:center;font-weight:700;color:${theme.secondary};width:52px;font-size:${FONT.xs};">Unit</th>
          <th style="border:1px solid ${theme.secondaryMuted};padding:8px 6px;text-align:right;font-weight:700;color:${theme.secondary};width:80px;font-size:${FONT.xs};">Rate (₹)</th>
          <th style="border:1px solid ${theme.secondaryMuted};padding:8px 8px;text-align:right;font-weight:700;color:${theme.secondary};width:96px;font-size:${FONT.xs};">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || emptyRow}
        ${qtyFooterRow}
      </tbody>
    </table>

    <div style="flex:1;min-height:20px;"></div>

    ${footer}
  </div>
</body>
</html>`;
}
