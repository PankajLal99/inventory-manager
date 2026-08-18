import { useEffect, useState } from 'react';
import api from '../../lib/api';

const STORAGE_KEY = 'credit-ledger-export-split-v1';
const CHANGE_EVENT = 'credit-ledger-export-split-changed';

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
export const LEDGER_EXPORT_DAY_PRESETS = [1, 2, 5, 7, 10, 15, 30] as const;

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

function persistLocal(next: LedgerExportSplit) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

function notify() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function isServerSplitPayload(data: unknown): data is Partial<LedgerExportSplit> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    'useRows' in d ||
    'useDays' in d ||
    'rowsPerPage' in d ||
    'daysPerPage' in d ||
    'mode' in d
  );
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

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let hydratePromise: Promise<void> | null = null;
let localDirty = false;

async function pushSplitToServer(split: LedgerExportSplit) {
  try {
    await api.put('/ledger-export-settings/', split);
  } catch {
    /* offline / permission — local cache still applies on this device */
  }
}

function scheduleServerSync(split: LedgerExportSplit) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void pushSplitToServer(split);
  }, 400);
}

export function saveLedgerExportSplit(value: Partial<LedgerExportSplit>): LedgerExportSplit {
  const next = normalizeLedgerExportSplit(value);
  localDirty = true;
  persistLocal(next);
  notify();
  scheduleServerSync(next);
  return next;
}

/** Load shop-wide copy settings from the API so all users share the same split. */
export function hydrateLedgerExportSplitFromServer(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const { data } = await api.get<Partial<LedgerExportSplit> | Record<string, never>>(
        '/ledger-export-settings/'
      );
      if (isServerSplitPayload(data)) {
        if (!localDirty) {
          const next = normalizeLedgerExportSplit(data);
          persistLocal(next);
          notify();
        }
      } else {
        const local = loadLedgerExportSplit();
        await pushSplitToServer(local);
      }
    } catch {
      /* keep local */
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

export function subscribeLedgerExportSplit(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function useLedgerExportSplit(): LedgerExportSplit {
  const [split, setSplit] = useState<LedgerExportSplit>(loadLedgerExportSplit);
  useEffect(() => subscribeLedgerExportSplit(() => setSplit(loadLedgerExportSplit())), []);
  useEffect(() => {
    void hydrateLedgerExportSplitFromServer();
  }, []);
  return split;
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
