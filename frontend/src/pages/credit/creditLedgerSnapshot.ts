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
  ledgerEventTimeMs,
} from './creditLedgerUtils';
import {
  DEFAULT_LEDGER_EXPORT_SPLIT,
  normalizeLedgerExportSplit,
  type LedgerExportSplit,
} from './ledgerExportSettings';

/** @deprecated Use DEFAULT_LEDGER_EXPORT_SPLIT.daysPerPage */
export const LEDGER_SNAPSHOT_DAYS_PER_PAGE = DEFAULT_LEDGER_EXPORT_SPLIT.daysPerPage;

/** @deprecated Use DEFAULT_LEDGER_EXPORT_SPLIT.rowsPerPage */
export const LEDGER_SNAPSHOT_ROWS_PER_PAGE = DEFAULT_LEDGER_EXPORT_SPLIT.rowsPerPage;

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

type LedgerDatedRow = {
  created_at?: string | null;
  event_at?: string | null;
  event_at_ms?: number | null;
};

function startOfLocalDayMs(row: LedgerDatedRow): number {
  // Prefer event/created timestamps so paging matches the dates shown on the statement.
  const t =
    ledgerEventTimeMs(row.event_at || row.created_at || null) || ledgerEventTimeMs(row);
  if (!t) return 0;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addLocalDaysMs(dayMs: number, days: number): number {
  const d = new Date(dayMs);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * Walk oldest → newest and start a new page when the row cap or day window
 * is hit — whichever comes first. A 10-day page is closed even if it has
 * fewer than 15 rows; a busy week still splits at the row cap.
 */
function splitLedgerRowsByLimits<T extends LedgerDatedRow>(
  rows: T[],
  limits: { useDays: boolean; daysPerPage: number; useRows: boolean; rowsPerPage: number }
): T[][] {
  const sorted = [...rows].sort(compareLedgerStatementRows);
  if (!sorted.length) return [[]];

  const pages: T[][] = [];
  let chunk: T[] = [];
  let windowStart = 0;

  const rowOpensNewPage = (row: T) => {
    if (!chunk.length) return false;
    if (limits.useRows && chunk.length >= limits.rowsPerPage) return true;
    if (limits.useDays) {
      const day = startOfLocalDayMs(row);
      const windowEnd = addLocalDaysMs(windowStart, Math.max(1, limits.daysPerPage) - 1);
      if (day > windowEnd) return true;
    }
    return false;
  };

  for (const row of sorted) {
    if (rowOpensNewPage(row)) {
      pages.push(chunk);
      chunk = [];
    }
    if (!chunk.length) windowStart = startOfLocalDayMs(row);
    chunk.push(row);
  }
  if (chunk.length) pages.push(chunk);
  return pages.length ? pages : [[]];
}

/**
 * Split oldest-first rows into day windows (inclusive) from each page's first entry.
 * First page is the oldest window; latest entries land on the last page.
 * Pass maxRowsPerPage to also cap a busy window; omit for days-only paging.
 */
export function chunkLedgerRowsByDays<T extends LedgerDatedRow>(
  rows: T[],
  daysPerPage = LEDGER_SNAPSHOT_DAYS_PER_PAGE,
  maxRowsPerPage?: number
): T[][] {
  return splitLedgerRowsByLimits(rows, {
    useDays: true,
    daysPerPage,
    useRows: !!(maxRowsPerPage && maxRowsPerPage > 0),
    rowsPerPage: maxRowsPerPage && maxRowsPerPage > 0 ? maxRowsPerPage : Number.POSITIVE_INFINITY,
  });
}

export function chunkLedgerRowsForExport<T extends LedgerDatedRow>(
  rows: T[],
  split: LedgerExportSplit = DEFAULT_LEDGER_EXPORT_SPLIT
): T[][] {
  const normalized = normalizeLedgerExportSplit(split);
  const sorted = [...rows].sort(compareLedgerStatementRows);
  if (!sorted.length) return [[]];

  if (normalized.useDays) {
    return splitLedgerRowsByLimits(sorted, {
      useDays: true,
      daysPerPage: normalized.daysPerPage,
      useRows: normalized.useRows,
      rowsPerPage: normalized.rowsPerPage,
    });
  }
  return chunkRows(sorted, normalized.rowsPerPage);
}

export function ledgerSnapshotPageCount(
  rows: LedgerDatedRow[],
  split: LedgerExportSplit = DEFAULT_LEDGER_EXPORT_SPLIT
): number {
  return Math.max(1, chunkLedgerRowsForExport(rows, split).length);
}

export type CreditLedgerStatementSnapshot = {
  customer?: { name?: string | null; phone?: string | null } | null;
  opening_balance?: string | number | null;
  opening_side?: string | null;
  closing_balance?: string | number | null;
  closing_side?: string | null;
  total_debit?: string | number | null;
  total_credit?: string | number | null;
  includeTime?: boolean;
  rows?: Array<{
    id?: number;
    created_at?: string | null;
    event_at?: string | null;
    event_at_ms?: number | null;
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

function makeBroughtForwardSnapRow(
  prevChunk: NonNullable<CreditLedgerStatementSnapshot['rows']>,
  includeTime: boolean
): SnapRow | null {
  if (!prevChunk.length) return null;
  const snapPrev = toSnapRows(prevChunk, includeTime);
  const lastLine = snapPrev[snapPrev.length - 1];
  if (!lastLine?.balance) return null;
  return {
    date: '',
    particulars: 'Balance Carried Forward',
    debit: '',
    credit: '',
    balance: lastLine.balance,
    isOpening: true,
  };
}
function toSnapRows(
  rows: NonNullable<CreditLedgerStatementSnapshot['rows']>,
  includeTime = false
): SnapRow[] {
  return rows.map((row) => {
    const debit = formatMoney(row.debit);
    const credit = formatMoney(row.credit);
    return {
      date: includeTime
        ? formatCreditDateTime(row.event_at || row.created_at)
        : formatCreditStatementDate(row.event_at || row.created_at),
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
  periodLabel?: string;
  includeTime?: boolean;
};

/** One A4-style ledger page HTML (use with partIndex/partCount for multi-page). */
export function buildCreditLedgerSnapshotHtml(
  statement: CreditLedgerStatementSnapshot,
  page?: Partial<CreditLedgerSnapshotPageOptions>
): string {
  const allRows = sortStatementRows(statement);
  const includeTime = page?.includeTime ?? statement.includeTime ?? false;
  const snapAll = toSnapRows(allRows, includeTime);
  const partIndex = page?.partIndex ?? 1;
  const partCount = page?.partCount ?? 1;
  const pageRows = page?.pageRows ?? snapAll;
  const totalEntries = page?.totalEntries ?? snapAll.length;
  const showSummary = page?.showSummary ?? true;
  const showTotals = page?.showTotals ?? true;
  const lineStart = page?.lineStart ?? 1;
  const periodLabel = page?.periodLabel || 'All dates';
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
  const oldestRow = allRows.length ? allRows[0] : undefined;
  const openOn = oldestRow?.created_at ? `on ${formatCreditDate(oldestRow.created_at)}` : '';

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
      const weight = r.isOpening || r.isTotal ? '700' : itemWeight;
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

  const colgroup = includeTime
    ? `
    <col style="width:28%;" />
    <col style="width:24%;" />
    <col style="width:16%;" />
    <col style="width:16%;" />
    <col style="width:16%;" />
  `
    : `
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
      <div style="text-align:center;font-size:${subFont};font-weight:${subWeight};line-height:1.3;color:${theme.textMuted};margin-top:4px;">(${escapeHtml(periodLabel)})</div>
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

function pagePeriodLabel(rows: NonNullable<CreditLedgerStatementSnapshot['rows']>): string {
  if (!rows.length) return 'All dates';
  const oldest = rows[0];
  const newest = rows[rows.length - 1];
  const from = formatCreditDate(oldest.event_at || oldest.created_at);
  const to = formatCreditDate(newest.event_at || newest.created_at);
  if (from === '—' && to === '—') return `${LEDGER_SNAPSHOT_DAYS_PER_PAGE} days`;
  if (from === to) return to;
  return `${from} - ${to}`;
}

/** Build one HTML string per ledger page using the saved/requested split. */
export function buildCreditLedgerSnapshotPageHtmlList(
  statement: CreditLedgerStatementSnapshot,
  split: LedgerExportSplit = DEFAULT_LEDGER_EXPORT_SPLIT,
  options?: { includeTime?: boolean }
): string[] {
  const includeTime = options?.includeTime ?? statement.includeTime ?? false;
  const allRows = sortStatementRows(statement);
  const chunks = chunkLedgerRowsForExport(allRows, split);
  const partCount = chunks.length;
  let lineStart = 1;

  return chunks.map((chunk, i) => {
    let pageRows = toSnapRows(chunk, includeTime);
    if (i > 0) {
      const broughtForward = makeBroughtForwardSnapRow(chunks[i - 1], includeTime);
      if (broughtForward) {
        pageRows = [broughtForward, ...pageRows];
      }
    }
    const html = buildCreditLedgerSnapshotHtml(statement, {
      pageRows,
      partIndex: i + 1,
      partCount,
      totalEntries: allRows.length,
      showSummary: i === 0,
      showTotals: i === partCount - 1,
      lineStart,
      periodLabel: pagePeriodLabel(chunk),
      includeTime,
    });
    lineStart += pageRows.length;
    return html;
  });
}
