import {
  docFooterFontPx,
  docFooterFontWeight,
  docHeaderFontPx,
  docHeaderFontWeight,
  docPageBackground,
  docRowBackground,
  docRowFontPx,
  docRowFontWeight,
  docSubHeaderFontPx,
  docSubHeaderFontWeight,
  getLedgerTheme,
} from './creditDocTheme';
import {
  compareLedgerStatementRows,
  formatCreditDate,
  formatCreditDateTime,
  formatCreditStatementDate,
} from './creditLedgerUtils';

/** Entry rows per ledger snapshot page (e.g. 80 rows → 2 pages). */
export const LEDGER_SNAPSHOT_ROWS_PER_PAGE = 40;

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAmount(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  if (!Number.isFinite(n) || n === 0) return '';
  return formatAmount(n);
}

function formatBalance(amount: string | number | null | undefined, side?: string) {
  const n = parseFloat(String(amount ?? 0));
  if (!Number.isFinite(n)) return '0.00 Dr';
  const s = (side || 'Dr').toLowerCase() === 'cr' ? 'Cr' : 'Dr';
  return `${formatAmount(n)} ${s}`;
}

function sanitizeText(value?: string | null) {
  return String(value ?? '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  if (size <= 0) return [rows];
  if (rows.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

export type CreditLedgerStatementSnapshot = {
  customer?: { name?: string | null; phone?: string | null } | null;
  opening_balance?: string | number | null;
  opening_side?: string | null;
  closing_balance?: string | number | null;
  closing_side?: string | null;
  total_debit?: string | number | null;
  total_credit?: string | number | null;
  rows?: Array<{
    id?: number;
    created_at?: string | null;
    event_at?: string | null;
    txn_type?: string | null;
    vch_no?: string | null;
    particulars?: string | null;
    narration?: string | null;
    debit?: string | number | null;
    credit?: string | number | null;
    running_balance?: string | number | null;
    balance_side?: string | null;
  }>;
};

type SnapRow = {
  date: string;
  particulars: string;
  debit: string;
  credit: string;
  balance: string;
  isOpening?: boolean;
  isTotal?: boolean;
  hasDebit?: boolean;
  hasCredit?: boolean;
};

function sortStatementRows(statement: CreditLedgerStatementSnapshot) {
  return [...(statement.rows || [])].sort(compareLedgerStatementRows);
}

function toSnapRows(
  rows: NonNullable<CreditLedgerStatementSnapshot['rows']>
): SnapRow[] {
  return rows.map((row) => {
    const debit = formatMoney(row.debit);
    const credit = formatMoney(row.credit);
    return {
      date: formatCreditStatementDate(row.created_at),
      particulars: sanitizeText(row.particulars || '') || '',
      debit,
      credit,
      balance: formatBalance(row.running_balance, row.balance_side || undefined),
      hasDebit: !!debit,
      hasCredit: !!credit,
    };
  });
}

export type CreditLedgerSnapshotPageOptions = {
  pageRows: SnapRow[];
  partIndex: number;
  partCount: number;
  totalEntries: number;
  showSummary: boolean;
  showTotals: boolean;
  lineStart: number;
};

/** One A4-style ledger page HTML (use with partIndex/partCount for multi-page). */
export function buildCreditLedgerSnapshotHtml(
  statement: CreditLedgerStatementSnapshot,
  page?: Partial<CreditLedgerSnapshotPageOptions>
): string {
  const allRows = sortStatementRows(statement);
  const snapAll = toSnapRows(allRows);
  const partIndex = page?.partIndex ?? 1;
  const partCount = page?.partCount ?? 1;
  const pageRows = page?.pageRows ?? snapAll;
  const totalEntries = page?.totalEntries ?? snapAll.length;
  const showSummary = page?.showSummary ?? true;
  const showTotals = page?.showTotals ?? true;
  const lineStart = page?.lineStart ?? 1;
  const theme = getLedgerTheme();
  const pageBg = docPageBackground(theme);
  const headerFont = docHeaderFontPx(theme);
  const headerWeight = docHeaderFontWeight(theme);
  const subFont = docSubHeaderFontPx(theme);
  const subWeight = docSubHeaderFontWeight(theme);
  const itemFont = docRowFontPx(theme);
  const itemWeight = docRowFontWeight(theme);
  const footerFont = docFooterFontPx(theme);
  const footerWeight = docFooterFontWeight(theme);
  const fontFamily = theme.fontFamily || 'Arial, Helvetica, sans-serif';

  const customerName = sanitizeText(statement.customer?.name || 'Customer') || 'Customer';
  const firstName = customerName.split(/\s+/)[0] || customerName;
  const netSide = String(statement.closing_side || 'Dr').toUpperCase();
  const isCr = netSide === 'CR';
  const netHint = isCr ? `(${firstName} will get)` : `(${firstName} will give)`;
  const netColor = isCr ? theme.creditText : theme.debitText;
  const openOn = allRows[0]?.created_at ? `on ${formatCreditDate(allRows[0].created_at)}` : '';

  const tableRows: SnapRow[] = [...pageRows];
  if (showTotals) {
    tableRows.push({
      date: '',
      particulars: 'Grand Total',
      debit: formatAmount(statement.total_debit),
      credit: formatAmount(statement.total_credit),
      balance: formatBalance(statement.closing_balance, statement.closing_side || undefined),
      isTotal: true,
      hasDebit: true,
      hasCredit: true,
    });
  }

  const cols: Array<{ id: keyof SnapRow; label: string; align: string }> = [
    { id: 'date', label: 'Date', align: 'left' },
    { id: 'particulars', label: 'Particulars', align: 'left' },
    { id: 'debit', label: 'Debit(-)', align: 'right' },
    { id: 'credit', label: 'Credit(+)', align: 'right' },
    { id: 'balance', label: 'Balance', align: 'right' },
  ];

  const cellBase =
    `padding:9px 10px;line-height:1.35;vertical-align:middle;box-sizing:border-box;` +
    `border-right:1px solid ${theme.primaryBorder};border-bottom:1px solid ${theme.primaryBorder};` +
    `font-family:${fontFamily};`;

  const ths = cols
    .map((c, i) => {
      let bg = theme.tableHead;
      if (c.id === 'debit') bg = theme.debitBg;
      if (c.id === 'credit') bg = theme.creditBg;
      const right = i === cols.length - 1 ? 'border-right:none;' : '';
      return `<th style="${cellBase}${right}text-align:${c.align};font-size:${subFont};font-weight:${subWeight};color:${theme.secondary};background:${bg};">${escapeHtml(c.label)}</th>`;
    })
    .join('');

  const trs = tableRows
    .map((r, rowIdx) => {
      const balCr = /cr/i.test(r.balance);
      const balColor = r.isOpening
        ? theme.textMuted
        : balCr
          ? theme.creditText
          : theme.debitText;
      const weight = r.isOpening || r.isTotal ? '700' : theme.rowFontBold ? '700' : '500';
      let rowBg = docRowBackground(theme, rowIdx);
      if (r.isTotal) rowBg = theme.tableHead;

      const tds = cols
        .map((c, i) => {
          let val = String(r[c.id] ?? '').trim();
          if (!val) val = '\u00A0';
          let bg = rowBg;
          let color = theme.text;
          let fw = weight;
          if (c.id === 'debit' && (r.hasDebit || r.isTotal)) bg = theme.debitBg;
          if (c.id === 'credit' && (r.hasCredit || r.isTotal)) bg = theme.creditBg;
          if (c.id === 'balance') {
            fw = '700';
            color = balColor;
            if (r.hasCredit && !r.isOpening && !r.isTotal) bg = theme.creditBg;
            else if (r.isTotal) bg = theme.tableHead;
          }
          const right = i === cols.length - 1 ? 'border-right:none;' : '';
          return `<td style="${cellBase}${right}font-size:${itemFont};text-align:${c.align};background:${bg};color:${color};font-weight:${fw};">${escapeHtml(val)}</td>`;
        })
        .join('');

      return `<tr>${tds}</tr>`;
    })
    .join('');

  const colgroup = `
    <col style="width:22%;" />
    <col style="width:30%;" />
    <col style="width:16%;" />
    <col style="width:16%;" />
    <col style="width:16%;" />
  `;

  const lineEnd = lineStart + Math.max(pageRows.length, 1) - 1;
  const partNote =
    partCount > 1
      ? `<div style="text-align:center;font-size:${subFont};font-weight:${subWeight};line-height:1.3;color:${theme.secondaryMuted};margin-top:6px;">Part ${partIndex} of ${partCount}${
          pageRows.length ? ` · Lines ${lineStart}–${lineEnd}` : ''
        }</div>`
      : '';

  const summaryBlock = showSummary
    ? `<table style="width:100%;border-collapse:separate;border-spacing:0;margin-top:12px;table-layout:fixed;border:1px solid ${theme.primaryBorder};">
        <tr>
          <td style="width:25%;padding:10px;vertical-align:top;border-right:1px solid ${theme.primaryBorder};background:${pageBg};">
            <div style="font-size:${subFont};line-height:1.3;color:${theme.textMuted};font-weight:${subWeight};">Opening Balance</div>
            <div style="font-size:${subFont};font-weight:${subWeight};line-height:1.35;margin-top:4px;color:${theme.text};">Rs. ${escapeHtml(formatAmount(statement.opening_balance))}</div>
            ${openOn ? `<div style="font-size:${footerFont};line-height:1.3;color:${theme.textMuted};margin-top:3px;font-weight:${footerWeight};">${escapeHtml(openOn)}</div>` : ''}
          </td>
          <td style="width:25%;padding:10px;vertical-align:top;border-right:1px solid ${theme.primaryBorder};background:${pageBg};">
            <div style="font-size:${subFont};line-height:1.3;color:${theme.textMuted};font-weight:${subWeight};">Total Debit(-)</div>
            <div style="font-size:${subFont};font-weight:${subWeight};line-height:1.35;margin-top:4px;color:${theme.text};">Rs. ${escapeHtml(formatAmount(statement.total_debit))}</div>
          </td>
          <td style="width:25%;padding:10px;vertical-align:top;border-right:1px solid ${theme.primaryBorder};background:${pageBg};">
            <div style="font-size:${subFont};line-height:1.3;color:${theme.textMuted};font-weight:${subWeight};">Total Credit(+)</div>
            <div style="font-size:${subFont};font-weight:${subWeight};line-height:1.35;margin-top:4px;color:${theme.text};">Rs. ${escapeHtml(formatAmount(statement.total_credit))}</div>
          </td>
          <td style="width:25%;padding:10px;vertical-align:top;background:${pageBg};">
            <div style="font-size:${subFont};line-height:1.3;color:${theme.textMuted};font-weight:${subWeight};">Net Balance</div>
            <div style="font-size:${subFont};font-weight:${subWeight};line-height:1.35;margin-top:4px;color:${netColor};">Rs. ${escapeHtml(formatAmount(statement.closing_balance))} ${isCr ? 'Cr' : 'Dr'}</div>
            <div style="font-size:${footerFont};line-height:1.3;margin-top:3px;color:${netColor};font-weight:${footerWeight};">${escapeHtml(netHint)}</div>
          </td>
        </tr>
      </table>
      <div style="margin-top:12px;margin-bottom:6px;font-size:${subFont};line-height:1.3;font-weight:${subWeight};color:${theme.secondary};">No. of Entries: ${totalEntries} (All)</div>`
    : `<div style="margin-top:12px;margin-bottom:6px;font-size:${subFont};line-height:1.3;font-weight:${subWeight};color:${theme.secondary};">Entries continued…</div>`;

  const continuedFooter =
    !showTotals && partCount > 1
      ? `<div style="margin-top:10px;text-align:right;font-size:${footerFont};font-weight:${footerWeight};color:${theme.secondaryMuted};">Continued on next page…</div>`
      : '';

  return `<!doctype html>
<html><head><meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; }
  table, th, td { border-collapse: separate; }
</style>
</head>
<body style="margin:0;padding:0;background:#fff;">
  <div id="credit-ledger-copy-root" style="width:794px;min-height:1123px;box-sizing:border-box;font-family:${fontFamily};color:${theme.text};background:${pageBg};border:3px solid ${theme.primary};display:flex;flex-direction:column;">
    <div style="background:${theme.primary};color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:${headerWeight};font-size:${headerFont};line-height:1.3;">Manish Traders</div>
      <div style="font-size:${subFont};font-weight:${subWeight};line-height:1.3;">Credit Ledger</div>
    </div>
    <div style="padding:14px 16px 12px;background:${pageBg};flex:1;">
      <div style="text-align:center;font-size:${headerFont};font-weight:${headerWeight};line-height:1.3;color:${theme.secondary};">${escapeHtml(customerName)} Statement</div>
      <div style="text-align:center;font-size:${subFont};font-weight:${subWeight};line-height:1.3;color:${theme.textMuted};margin-top:4px;">(All dates)</div>
      ${partNote}
      ${summaryBlock}

      <table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;border:1px solid ${theme.primaryBorder};background:${pageBg};">
        ${colgroup}
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>

      ${continuedFooter}

      <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:${footerFont};font-weight:${footerWeight};line-height:1.3;color:${theme.textMuted};">
        <div>Report Generated : ${escapeHtml(formatCreditDateTime(new Date()))}</div>
        <div>Page ${partIndex} of ${partCount}</div>
      </div>
    </div>
    <div style="background:${theme.primary};color:#fff;padding:10px 16px;display:flex;justify-content:space-between;font-size:${footerFont};font-weight:${footerWeight};line-height:1.3;">
      <div>Manish Traders</div>
      <div>Credit Ledger</div>
    </div>
  </div>
</body></html>`;
}

/** Build one HTML string per ledger page (40 rows each). */
export function buildCreditLedgerSnapshotPageHtmlList(
  statement: CreditLedgerStatementSnapshot,
  rowsPerPage = LEDGER_SNAPSHOT_ROWS_PER_PAGE
): string[] {
  const allRows = sortStatementRows(statement);
  const snapAll = toSnapRows(allRows);
  const chunks = chunkRows(snapAll, rowsPerPage);
  const partCount = chunks.length;

  return chunks.map((pageRows, i) =>
    buildCreditLedgerSnapshotHtml(statement, {
      pageRows,
      partIndex: i + 1,
      partCount,
      totalEntries: snapAll.length,
      showSummary: i === 0,
      showTotals: i === partCount - 1,
      lineStart: i * rowsPerPage + 1,
    })
  );
}
