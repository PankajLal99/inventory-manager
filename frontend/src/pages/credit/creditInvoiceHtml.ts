import { formatAmountINR } from '../../lib/utils';
import { creditAmountInWords, formatCreditInvoiceDate } from './CreditInvoiceDocument';

export const CREDIT_SHOP_NAME = 'MANISH TRADERS';
export const CREDIT_INVOICE_CAPTURE_WIDTH = 794;
export const CREDIT_INVOICE_CAPTURE_HEIGHT = 1123;

/** Orange / amber primary with deep brown secondary — matches credit POS theme */
export const CREDIT_THEME = {
  primary: '#d97706',
  primaryLight: '#f59e0b',
  primaryPale: '#fffbeb',
  primaryBorder: '#fbbf24',
  secondary: '#78350f',
  secondaryMuted: '#92400e',
  text: '#1c1917',
  textMuted: '#57534e',
  white: '#ffffff',
  rowAlt: '#fff7ed',
  tableHead: '#fef3c7',
  /** Ledger debit / credit row accents (Khatabook-style, on amber chrome) */
  debitBg: '#fee2e2',
  debitBgSoft: '#fef2f2',
  creditBg: '#dcfce7',
  creditBgSoft: '#f0fdf4',
  debitText: '#b91c1c',
  creditText: '#15803d',
};

const THEME = CREDIT_THEME;

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

function fmtMoney(amount: number): string {
  return `₹ ${formatAmountINR(amount)}`;
}

function parseAmount(value: string | number | null | undefined): number {
  return parseFloat(String(value ?? 0)) || 0;
}

/** Flat abstract blobs — kept on the left so they never cover header text on the right */
function headerAbstractShapes(): string {
  return `
    <div style="position:absolute;top:-48px;left:48px;width:128px;height:128px;border-radius:50%;background:rgba(255,255,255,0.14);z-index:0;"></div>
    <div style="position:absolute;bottom:-36px;left:28%;width:72px;height:72px;border-radius:50%;background:rgba(251,191,36,0.5);z-index:0;"></div>
    <div style="position:absolute;bottom:8px;left:-18px;width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,0.1);transform:rotate(-12deg);z-index:0;"></div>
  `;
}

function footerAbstractShapes(): string {
  return `
    <div style="position:absolute;bottom:-20px;right:24px;width:64px;height:64px;border-radius:50%;background:${THEME.primaryBorder};opacity:0.35;"></div>
    <div style="position:absolute;top:16px;left:-12px;width:40px;height:40px;border-radius:10px;background:${THEME.primary};opacity:0.12;transform:rotate(20deg);"></div>
  `;
}

/**
 * Self-contained colourful A4 invoice HTML for html2canvas / PDF / print.
 * Uses tables only (no CSS grid) so capture doesn't overlap cells.
 */
export function buildCreditInvoiceHtml(input: CreditInvoiceHtmlInput): string {
  const items = input.items || [];
  const partIndex = input.partIndex ?? 1;
  const partCount = input.partCount ?? 1;
  const showTotals = input.showTotals !== false;
  const lineOffset = input.lineOffset ?? 0;
  const shopName = input.shop_name?.trim() || CREDIT_SHOP_NAME;

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

  const pageQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalQty =
    typeof input.totalQty === 'number' ? input.totalQty : pageQty;
  const totalItems =
    typeof input.totalItems === 'number' ? input.totalItems : items.length;
  const totalAmt =
    parseAmount(input.total) || rows.reduce((s, r) => s + r.amount, 0);
  const subtotalAmt = parseAmount(input.subtotal) || totalAmt;

  const hasBalance =
    input.customer_balance != null || input.previous_balance != null;
  const previousBal = parseAmount(input.previous_balance);
  const closingBal =
    input.customer_balance != null
      ? parseAmount(input.customer_balance)
      : hasBalance
        ? previousBal + totalAmt
        : null;

  const partNote =
    partCount > 1
      ? `<div style="font-size:${FONT.xs};margin-top:8px;color:${THEME.textMuted};font-weight:600;">Part ${partIndex} of ${partCount}${
          rows.length ? ` · Lines ${rows[0].idx}–${rows[rows.length - 1].idx}` : ''
        }</div>`
      : '';

  const voidBadge =
    input.status === 'void'
      ? `<div style="margin-top:10px;display:inline-block;padding:3px 10px;font-size:${FONT.xs};font-weight:700;text-transform:uppercase;border-radius:4px;border:1px solid #b91c1c;background:#fee2e2;color:#b91c1c;">Void</div>`
      : '';

  const cellPad = '7px 8px';
  const bodyRows = rows
    .map(
      (r, i) => `<tr style="background:${i % 2 === 1 ? THEME.rowAlt : THEME.white};">
      <td style="border:1px solid ${THEME.primaryBorder};padding:${cellPad};text-align:center;width:42px;font-size:${FONT.sm};color:${THEME.secondaryMuted};font-weight:600;">${r.idx}</td>
      <td style="border:1px solid ${THEME.primaryBorder};padding:${cellPad};text-align:left;font-size:${FONT.sm};font-weight:600;color:${THEME.text};">${escapeHtml(r.name)}</td>
      <td style="border:1px solid ${THEME.primaryBorder};padding:${cellPad};text-align:right;width:64px;font-size:${FONT.sm};font-weight:600;">${escapeHtml(fmtQty(r.qty))}</td>
      <td style="border:1px solid ${THEME.primaryBorder};padding:${cellPad};text-align:center;width:52px;font-size:${FONT.sm};color:${THEME.textMuted};">Pcs.</td>
      <td style="border:1px solid ${THEME.primaryBorder};padding:${cellPad};text-align:right;width:80px;font-size:${FONT.sm};">${escapeHtml(formatAmountINR(r.price))}</td>
      <td style="border:1px solid ${THEME.primaryBorder};padding:${cellPad};text-align:right;width:96px;font-size:${FONT.sm};font-weight:700;color:${THEME.secondary};">${escapeHtml(formatAmountINR(r.amount))}</td>
    </tr>`
    )
    .join('');

  const emptyRow = `<tr>
    <td colspan="6" style="border:1px solid ${THEME.primaryBorder};padding:28px;text-align:center;font-size:${FONT.sm};color:#a8a29e;">No line items</td>
  </tr>`;

  const qtyFooterRow = showTotals
    ? `<tr>
      <td style="border:1px solid ${THEME.secondaryMuted};padding:${cellPad};background:${THEME.tableHead};"></td>
      <td style="border:1px solid ${THEME.secondaryMuted};padding:${cellPad};background:${THEME.tableHead};font-size:${FONT.sm};font-weight:700;color:${THEME.secondary};">Total Quantity</td>
      <td colspan="2" style="border:1px solid ${THEME.secondaryMuted};padding:${cellPad};background:${THEME.tableHead};text-align:right;font-size:${FONT.sm};font-weight:700;color:${THEME.secondary};">${escapeHtml(fmtQty(totalQty))} Pcs.</td>
      <td style="border:1px solid ${THEME.secondaryMuted};padding:${cellPad};background:${THEME.tableHead};"></td>
      <td style="border:1px solid ${THEME.secondaryMuted};padding:${cellPad};background:${THEME.tableHead};"></td>
    </tr>`
    : '';

  const summaryRowStyle = `padding:8px 14px;font-size:${FONT.sm};border-bottom:1px solid ${THEME.primaryBorder};`;
  const summaryLabel = `color:${THEME.textMuted};font-weight:600;`;
  const summaryValue = `text-align:right;font-weight:700;color:${THEME.text};`;

  const summaryRows = showTotals
    ? `
      <tr>
        <td style="${summaryRowStyle}${summaryLabel}">Total Items</td>
        <td style="${summaryRowStyle}${summaryValue}">${escapeHtml(String(totalItems))} ${totalItems === 1 ? 'Line' : 'Lines'} · ${escapeHtml(fmtQty(totalQty))} Pcs.</td>
      </tr>
      <tr>
        <td style="${summaryRowStyle}${summaryLabel}">Sub Total</td>
        <td style="${summaryRowStyle}${summaryValue}">${escapeHtml(fmtMoney(subtotalAmt))}</td>
      </tr>
      <tr>
        <td style="padding:9px 14px;font-size:${FONT.sm};color:${THEME.white};font-weight:700;background:${THEME.primary};border-bottom:1px solid ${THEME.secondaryMuted};">Total</td>
        <td style="padding:9px 14px;font-size:${FONT.sm};text-align:right;font-weight:800;color:${THEME.white};background:${THEME.primary};border-bottom:1px solid ${THEME.secondaryMuted};">${escapeHtml(fmtMoney(totalAmt))}</td>
      </tr>
      ${
        hasBalance
          ? `
      <tr>
        <td style="${summaryRowStyle}${summaryLabel}">Previous Balance</td>
        <td style="${summaryRowStyle}${summaryValue}">${escapeHtml(fmtMoney(previousBal))}</td>
      </tr>
      <tr>
        <td style="padding:9px 14px;font-size:${FONT.sm};color:${THEME.white};font-weight:700;background:${THEME.secondary};">Balance (Ledger)</td>
        <td style="padding:9px 14px;font-size:${FONT.sm};text-align:right;font-weight:800;color:${THEME.white};background:${THEME.secondary};">${escapeHtml(fmtMoney(closingBal ?? 0))}</td>
      </tr>`
          : ''
      }`
    : '';

  const summaryBlock = showTotals
    ? `<table style="width:100%;border-collapse:collapse;margin-top:14px;border:2px solid ${THEME.primary};font-size:${FONT.sm};">
        <tr>
          <td colspan="2" style="padding:9px 14px;background:${THEME.primary};color:${THEME.white};font-weight:700;font-size:${FONT.xs};letter-spacing:0.5px;text-transform:uppercase;">Invoice Summary</td>
        </tr>
        ${summaryRows}
      </table>
      <div style="margin-top:12px;padding:10px 14px;background:${THEME.white};border:1px solid ${THEME.primaryBorder};border-left:4px solid ${THEME.primary};font-size:${FONT.sm};line-height:1.5;">
        <span style="color:${THEME.secondary};font-weight:700;">Amount in Words: </span>
        <span style="color:${THEME.text};font-weight:600;">${escapeHtml(creditAmountInWords(totalAmt))}</span>
      </div>`
    : '';

  const footer = showTotals
    ? `<div style="position:relative;overflow:hidden;padding:16px 24px 20px;border-top:3px solid ${THEME.primary};background:${THEME.primaryPale};">
        ${footerAbstractShapes()}
        ${summaryBlock}
        ${
          input.notes
            ? `<div style="position:relative;font-size:${FONT.sm};color:${THEME.textMuted};margin-top:12px;"><span style="color:${THEME.secondary};font-weight:700;">Notes: </span>${escapeHtml(input.notes)}</div>`
            : ''
        }
        <table style="position:relative;width:100%;border-collapse:collapse;font-size:${FONT.sm};margin-top:18px;">
          <tr>
            <td style="width:50%;vertical-align:bottom;padding:0 16px 0 0;">
              <div style="font-weight:700;color:${THEME.secondary};text-transform:uppercase;letter-spacing:0.4px;font-size:${FONT.xs};">Terms &amp; Conditions</div>
              <div style="font-size:${FONT.sm};color:${THEME.textMuted};margin-top:5px;line-height:1.45;">Credit sale — payable as per account ledger. Goods once sold will not be taken back without prior approval.</div>
            </td>
            <td style="width:50%;vertical-align:bottom;text-align:center;padding:0 0 0 16px;">
              <div style="height:32px;"></div>
              <div style="display:inline-block;border-top:2px solid ${THEME.secondaryMuted};padding:5px 18px 0;font-size:${FONT.sm};font-weight:700;color:${THEME.secondary};">Receiver's Signature</div>
            </td>
          </tr>
        </table>
        <div style="position:relative;margin-top:14px;text-align:center;font-size:${FONT.xs};color:${THEME.textMuted};">Thank you for your business · ${escapeHtml(shopName)}</div>
      </div>`
    : partCount > 1
      ? `<div style="border-top:2px dashed ${THEME.primaryBorder};padding:12px 24px;font-size:${FONT.sm};text-align:right;color:${THEME.secondaryMuted};font-weight:600;background:${THEME.primaryPale};">Continued on next page…</div>`
      : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Credit Invoice — ${escapeHtml(shopName)}</title>
</head>
<body style="margin:0;padding:0;background:#e7e5e4;font-size:${FONT.sm};">
  <div id="credit-invoice-root" style="width:${CREDIT_INVOICE_CAPTURE_WIDTH}px;min-height:${CREDIT_INVOICE_CAPTURE_HEIGHT}px;margin:0;background:${THEME.white};color:${THEME.text};font-family:Arial,Helvetica,sans-serif;font-size:${FONT.sm};line-height:1.4;box-sizing:border-box;display:flex;flex-direction:column;border:3px solid ${THEME.primary};">

    <!-- Shop header -->
    <div style="position:relative;overflow:hidden;background:${THEME.primary};padding:20px 28px;color:${THEME.white};">
      ${headerAbstractShapes()}
      <table style="position:relative;z-index:1;width:100%;border-collapse:collapse;color:${THEME.white};">
        <tr>
          <td style="vertical-align:middle;">
            <div style="font-size:${FONT.xl};font-weight:800;letter-spacing:1px;text-transform:uppercase;line-height:1.2;color:${THEME.white};">${escapeHtml(shopName)}</div>
            <div style="font-size:${FONT.xs};font-weight:600;margin-top:5px;letter-spacing:0.5px;text-transform:uppercase;color:${THEME.white};">Credit Sale Invoice</div>
          </td>
          <td style="vertical-align:middle;text-align:right;width:240px;color:${THEME.white};">
            <div style="font-size:${FONT.xs};font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${THEME.white};">Invoice No.</div>
            <div style="font-size:${FONT.lg};font-weight:800;margin-top:4px;letter-spacing:0.3px;color:${THEME.white};">${escapeHtml(input.invoice_number || '—')}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Party + date -->
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;background:${THEME.primaryPale};border-bottom:2px solid ${THEME.primaryBorder};font-size:${FONT.sm};">
      <tr>
        <td style="width:58%;vertical-align:top;padding:14px 20px;border-right:1px solid ${THEME.primaryBorder};">
          <div style="font-size:${FONT.xs};font-weight:700;color:${THEME.secondary};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">Bill To</div>
          <div style="font-size:${FONT.lg};font-weight:800;text-transform:uppercase;letter-spacing:0.2px;color:${THEME.text};line-height:1.25;">${escapeHtml(input.customer_name || '—')}</div>
          ${input.customer_phone ? `<div style="font-size:${FONT.sm};color:${THEME.textMuted};margin-top:4px;font-weight:600;">${escapeHtml(input.customer_phone)}</div>` : ''}
          ${voidBadge}
          ${partNote}
        </td>
        <td style="width:42%;vertical-align:top;padding:14px 20px;">
          <table style="width:100%;border-collapse:collapse;font-size:${FONT.sm};">
            <tr>
              <td style="padding:0 0 8px 0;font-weight:600;color:${THEME.secondaryMuted};white-space:nowrap;">Invoice No.</td>
              <td style="padding:0 0 8px 0;font-weight:800;text-align:right;color:${THEME.secondary};">${escapeHtml(input.invoice_number || '—')}</td>
            </tr>
            <tr>
              <td style="padding:0 0 8px 0;font-weight:600;color:${THEME.secondaryMuted};white-space:nowrap;">Dated</td>
              <td style="padding:0 0 8px 0;font-weight:700;text-align:right;color:${THEME.text};">${escapeHtml(formatCreditInvoiceDate(input.created_at))}</td>
            </tr>
            <tr>
              <td style="padding:0;font-weight:600;color:${THEME.secondaryMuted};white-space:nowrap;">Payment</td>
              <td style="padding:0;text-align:right;font-weight:700;color:${THEME.primary};">On Credit</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Items -->
    <table style="width:100%;border-collapse:collapse;font-size:${FONT.sm};table-layout:fixed;flex-shrink:0;">
      <thead>
        <tr style="background:${THEME.tableHead};">
          <th style="border:1px solid ${THEME.secondaryMuted};padding:8px 6px;text-align:center;font-weight:700;color:${THEME.secondary};width:42px;font-size:${FONT.xs};">S.N.</th>
          <th style="border:1px solid ${THEME.secondaryMuted};padding:8px 8px;text-align:left;font-weight:700;color:${THEME.secondary};font-size:${FONT.xs};">Description of Goods</th>
          <th style="border:1px solid ${THEME.secondaryMuted};padding:8px 6px;text-align:right;font-weight:700;color:${THEME.secondary};width:64px;font-size:${FONT.xs};">Qty.</th>
          <th style="border:1px solid ${THEME.secondaryMuted};padding:8px 6px;text-align:center;font-weight:700;color:${THEME.secondary};width:52px;font-size:${FONT.xs};">Unit</th>
          <th style="border:1px solid ${THEME.secondaryMuted};padding:8px 6px;text-align:right;font-weight:700;color:${THEME.secondary};width:80px;font-size:${FONT.xs};">Rate (₹)</th>
          <th style="border:1px solid ${THEME.secondaryMuted};padding:8px 8px;text-align:right;font-weight:700;color:${THEME.secondary};width:96px;font-size:${FONT.xs};">Amount (₹)</th>
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
