import { useEffect, useState } from 'react';
import api from '../../lib/api';

const STORAGE_KEY = 'invoice-photo-export-split-v1';
const CHANGE_EVENT = 'invoice-photo-export-split-changed';

export type InvoiceExportSplit = {
  rowsPerPage: number;
};

export const DEFAULT_INVOICE_EXPORT_SPLIT: InvoiceExportSplit = {
  rowsPerPage: 25,
};

export const INVOICE_EXPORT_ROW_PRESETS = [10, 15, 20, 25, 30, 40, 50] as const;

const MIN_ROWS = 1;
const MAX_ROWS = 200;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeInvoiceExportSplit(
  value?: Partial<InvoiceExportSplit> | null
): InvoiceExportSplit {
  return {
    rowsPerPage: clampInt(
      value?.rowsPerPage,
      MIN_ROWS,
      MAX_ROWS,
      DEFAULT_INVOICE_EXPORT_SPLIT.rowsPerPage
    ),
  };
}

function persistLocal(next: InvoiceExportSplit) {
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

function isServerSplitPayload(data: unknown): data is Partial<InvoiceExportSplit> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return 'rowsPerPage' in (data as Record<string, unknown>);
}

export function loadInvoiceExportSplit(): InvoiceExportSplit {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_INVOICE_EXPORT_SPLIT };
    return normalizeInvoiceExportSplit(JSON.parse(raw) as Partial<InvoiceExportSplit>);
  } catch {
    return { ...DEFAULT_INVOICE_EXPORT_SPLIT };
  }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let hydratePromise: Promise<void> | null = null;
let localDirty = false;

async function pushSplitToServer(split: InvoiceExportSplit) {
  try {
    await api.put('/invoice-export-settings/', split);
  } catch {
    /* offline / permission — local cache still applies on this device */
  }
}

function scheduleServerSync(split: InvoiceExportSplit) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void pushSplitToServer(split);
  }, 400);
}

export function saveInvoiceExportSplit(value: Partial<InvoiceExportSplit>): InvoiceExportSplit {
  const next = normalizeInvoiceExportSplit(value);
  localDirty = true;
  persistLocal(next);
  notify();
  scheduleServerSync(next);
  return next;
}

/** Load shop-wide invoice photo split so all users share the same row count. */
export function hydrateInvoiceExportSplitFromServer(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const { data } = await api.get<Partial<InvoiceExportSplit> | Record<string, never>>(
        '/invoice-export-settings/'
      );
      if (isServerSplitPayload(data)) {
        if (!localDirty) {
          const next = normalizeInvoiceExportSplit(data);
          persistLocal(next);
          notify();
        }
      } else {
        const local = loadInvoiceExportSplit();
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

export function subscribeInvoiceExportSplit(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function useInvoiceExportSplit(): InvoiceExportSplit {
  const [split, setSplit] = useState<InvoiceExportSplit>(loadInvoiceExportSplit);
  useEffect(() => subscribeInvoiceExportSplit(() => setSplit(loadInvoiceExportSplit())), []);
  useEffect(() => {
    void hydrateInvoiceExportSplitFromServer();
  }, []);
  return split;
}

export function invoiceExportSplitBadge(split: InvoiceExportSplit): string {
  return `${normalizeInvoiceExportSplit(split).rowsPerPage}r`;
}

export function chunkInvoiceRowsForExport<T>(
  rows: T[],
  rowsPerPage: number = DEFAULT_INVOICE_EXPORT_SPLIT.rowsPerPage
): T[][] {
  const size = clampInt(
    rowsPerPage,
    MIN_ROWS,
    MAX_ROWS,
    DEFAULT_INVOICE_EXPORT_SPLIT.rowsPerPage
  );
  if (!rows.length) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

export function invoiceSnapshotPageCount(
  rowCount: number,
  rowsPerPage: number = DEFAULT_INVOICE_EXPORT_SPLIT.rowsPerPage
): number {
  if (rowCount <= 0) return 1;
  const size = clampInt(
    rowsPerPage,
    MIN_ROWS,
    MAX_ROWS,
    DEFAULT_INVOICE_EXPORT_SPLIT.rowsPerPage
  );
  return Math.max(1, Math.ceil(rowCount / size));
}

export function invoiceExportSplitExplain(
  rowCount: number,
  rowsPerPage: number = DEFAULT_INVOICE_EXPORT_SPLIT.rowsPerPage
): string {
  const size = clampInt(
    rowsPerPage,
    MIN_ROWS,
    MAX_ROWS,
    DEFAULT_INVOICE_EXPORT_SPLIT.rowsPerPage
  );
  const pageCount = invoiceSnapshotPageCount(rowCount, size);
  const lineLabel = `${rowCount} ${rowCount === 1 ? 'line' : 'lines'}`;
  if (pageCount <= 1) {
    return `1 image · ${lineLabel} at ${size} rows per image.`;
  }
  return `${pageCount} images — Copy 1 … Copy ${pageCount}. Split at ${size} rows: ${lineLabel}.`;
}
