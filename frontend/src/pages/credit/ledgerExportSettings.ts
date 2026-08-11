const STORAGE_KEY = 'credit-ledger-export-split-v1';

export type LedgerExportSplit = {
  useRows: boolean;
  useDays: boolean;
  rowsPerPage: number;
  daysPerPage: number;
  /** @deprecated migrated to useRows / useDays */
  mode?: 'rows' | 'days';
};

export const DEFAULT_LEDGER_EXPORT_SPLIT: LedgerExportSplit = {
  useRows: true,
  useDays: false,
  rowsPerPage: 40,
  daysPerPage: 15,
};

export const LEDGER_EXPORT_ROW_PRESETS = [1, 5, 10, 15, 25, 40, 50, 80] as const;
export const LEDGER_EXPORT_DAY_PRESETS = [1, 2, 5, 7, 15, 30] as const;

const MIN_ROWS = 1;
const MAX_ROWS = 200;
const MIN_DAYS = 1;
const MAX_DAYS = 366;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeLedgerExportSplit(
  value?: Partial<LedgerExportSplit> | null
): LedgerExportSplit {
  let useRows = value?.useRows;
  let useDays = value?.useDays;
  if (useRows == null && useDays == null) {
    if (value?.mode === 'days') {
      useRows = false;
      useDays = true;
    } else {
      useRows = true;
      useDays = false;
    }
  }
  const next: LedgerExportSplit = {
    useRows: !!useRows,
    useDays: !!useDays,
    rowsPerPage: clampInt(
      value?.rowsPerPage,
      MIN_ROWS,
      MAX_ROWS,
      DEFAULT_LEDGER_EXPORT_SPLIT.rowsPerPage
    ),
    daysPerPage: clampInt(
      value?.daysPerPage,
      MIN_DAYS,
      MAX_DAYS,
      DEFAULT_LEDGER_EXPORT_SPLIT.daysPerPage
    ),
  };
  if (!next.useRows && !next.useDays) next.useRows = true;
  return next;
}

export function loadLedgerExportSplit(): LedgerExportSplit {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LEDGER_EXPORT_SPLIT };
    return normalizeLedgerExportSplit(JSON.parse(raw) as Partial<LedgerExportSplit>);
  } catch {
    return { ...DEFAULT_LEDGER_EXPORT_SPLIT };
  }
}

export function saveLedgerExportSplit(value: Partial<LedgerExportSplit>): LedgerExportSplit {
  const next = normalizeLedgerExportSplit(value);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

export function ledgerExportSplitBadge(split: LedgerExportSplit): string {
  const n = normalizeLedgerExportSplit(split);
  const parts: string[] = [];
  if (n.useDays) parts.push(`${n.daysPerPage}d`);
  if (n.useRows) parts.push(`${n.rowsPerPage}r`);
  return parts.join('·') || '—';
}

export function ledgerExportSplitLabel(split: LedgerExportSplit): string {
  const normalized = normalizeLedgerExportSplit(split);
  const parts: string[] = [];
  if (normalized.useDays) {
    parts.push(
      `${normalized.daysPerPage} day${normalized.daysPerPage === 1 ? '' : 's'} / image`
    );
  }
  if (normalized.useRows) {
    parts.push(
      `${normalized.rowsPerPage} row${normalized.rowsPerPage === 1 ? '' : 's'} / image`
    );
  }
  return parts.join(' · ') || '1 image';
}
