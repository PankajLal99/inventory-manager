import { useEffect, useState } from 'react';

export type CreditDocKind = 'invoice' | 'ledger';

/** Shared palette used by credit invoice / ledger print, PDF, and on-screen previews. */
export type CreditDocTheme = {
  primary: string;
  primaryLight: string;
  primaryPale: string;
  primaryBorder: string;
  secondary: string;
  secondaryMuted: string;
  text: string;
  textMuted: string;
  white: string;
  rowAlt: string;
  tableHead: string;
  debitBg: string;
  debitBgSoft: string;
  creditBg: string;
  creditBgSoft: string;
  debitText: string;
  creditText: string;
};

const STORAGE_KEY = 'credit-doc-themes-v1';
const CHANGE_EVENT = 'credit-doc-theme-change';

/** Orange / amber — original credit invoice look */
export const DEFAULT_INVOICE_THEME: CreditDocTheme = {
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
  debitBg: '#fee2e2',
  debitBgSoft: '#fef2f2',
  creditBg: '#dcfce7',
  creditBgSoft: '#f0fdf4',
  debitText: '#b91c1c',
  creditText: '#15803d',
};

/** Teal / slate — distinct from invoice amber for ledger statements */
export const DEFAULT_LEDGER_THEME: CreditDocTheme = {
  primary: '#0f766e',
  primaryLight: '#14b8a6',
  primaryPale: '#f0fdfa',
  primaryBorder: '#5eead4',
  secondary: '#134e4a',
  secondaryMuted: '#115e59',
  text: '#1c1917',
  textMuted: '#57534e',
  white: '#ffffff',
  rowAlt: '#f0fdfa',
  tableHead: '#ccfbf1',
  debitBg: '#fee2e2',
  debitBgSoft: '#fef2f2',
  creditBg: '#dcfce7',
  creditBgSoft: '#f0fdf4',
  debitText: '#b91c1c',
  creditText: '#15803d',
};

const DEFAULTS: Record<CreditDocKind, CreditDocTheme> = {
  invoice: DEFAULT_INVOICE_THEME,
  ledger: DEFAULT_LEDGER_THEME,
};

type StoredThemes = Partial<Record<CreditDocKind, Partial<CreditDocTheme> & { primary?: string }>>;

function clamp(n: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeHex(hex: string): string | null {
  const raw = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex)?.slice(1) ?? '000000';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

function mix(hex: string, toward: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(toward);
  const t = Math.min(1, Math.max(0, amount));
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

function lighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}

/** Build a full chrome palette from a primary brand color (keeps debit/credit semantic colors). */
export function themeFromPrimary(primaryInput: string, kind: CreditDocKind = 'invoice'): CreditDocTheme {
  const base = DEFAULTS[kind];
  const primary = normalizeHex(primaryInput) ?? base.primary;
  return {
    ...base,
    primary,
    primaryLight: lighten(primary, 0.22),
    primaryPale: lighten(primary, 0.92),
    primaryBorder: lighten(primary, 0.45),
    secondary: darken(primary, 0.55),
    secondaryMuted: darken(primary, 0.4),
    rowAlt: lighten(primary, 0.94),
    tableHead: lighten(primary, 0.82),
  };
}

function loadStored(): StoredThemes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredThemes;
  } catch {
    return {};
  }
}

function persist(stored: StoredThemes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* ignore quota */
  }
}

function notify() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function resolveTheme(kind: CreditDocKind, stored: StoredThemes): CreditDocTheme {
  const partial = stored[kind];
  if (!partial?.primary) return DEFAULTS[kind];
  const built = themeFromPrimary(partial.primary, kind);
  return { ...built, ...partial, primary: built.primary };
}

export function getDocTheme(kind: CreditDocKind): CreditDocTheme {
  return resolveTheme(kind, loadStored());
}

export function getInvoiceTheme(): CreditDocTheme {
  return getDocTheme('invoice');
}

export function getLedgerTheme(): CreditDocTheme {
  return getDocTheme('ledger');
}

export function setDocPrimary(kind: CreditDocKind, primary: string) {
  const hex = normalizeHex(primary);
  if (!hex) return;
  const stored = loadStored();
  stored[kind] = themeFromPrimary(hex, kind);
  persist(stored);
  notify();
}

export function resetDocTheme(kind: CreditDocKind) {
  const stored = loadStored();
  delete stored[kind];
  persist(stored);
  notify();
}

export function resetAllDocThemes() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function subscribeDocTheme(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function useCreditDocThemes() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeDocTheme(() => setTick((n) => n + 1)), []);
  void tick;
  return {
    invoice: getInvoiceTheme(),
    ledger: getLedgerTheme(),
    setPrimary: setDocPrimary,
    reset: resetDocTheme,
    resetAll: resetAllDocThemes,
  };
}

/** @deprecated Prefer getInvoiceTheme() — kept for existing imports */
export const CREDIT_THEME = DEFAULT_INVOICE_THEME;
