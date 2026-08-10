import { useEffect, useState } from 'react';
import api from '../../lib/api';

export type CreditDocKind = 'invoice' | 'ledger';

/** Shared palette + typography used by credit invoice / ledger print, PDF, and on-screen previews. */
export type CreditDocTheme = {
  primary: string;
  primaryLight: string;
  primaryPale: string;
  primaryBorder: string;
  secondary: string;
  secondaryMuted: string;
  text: string;
  textMuted: string;
  /** Page / document background (also used for even table rows). */
  white: string;
  /** Alternating (odd) row fill — hex or `transparent`. */
  rowAlt: string;
  tableHead: string;
  debitBg: string;
  debitBgSoft: string;
  creditBg: string;
  creditBgSoft: string;
  debitText: string;
  creditText: string;
  /** Line-item body font size in px */
  rowFontSize: number;
  /** Bold line-item rows */
  rowFontBold: boolean;
  /** CSS font-family stack for the document */
  fontFamily: string;
};

export type CreditDocThemeOverrides = Partial<
  Pick<
    CreditDocTheme,
    | 'primary'
    | 'white'
    | 'rowAlt'
    | 'rowFontSize'
    | 'rowFontBold'
    | 'fontFamily'
  >
>;

const STORAGE_KEY = 'credit-doc-themes-v1';
const CHANGE_EVENT = 'credit-doc-theme-change';

export const DOC_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
];

export const ROW_FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18] as const;

const DEFAULT_TYPOGRAPHY = {
  rowFontSize: 12,
  rowFontBold: false,
  fontFamily: 'Arial, Helvetica, sans-serif',
};

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
  ...DEFAULT_TYPOGRAPHY,
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
  ...DEFAULT_TYPOGRAPHY,
};

const DEFAULTS: Record<CreditDocKind, CreditDocTheme> = {
  invoice: DEFAULT_INVOICE_THEME,
  ledger: DEFAULT_LEDGER_THEME,
};

type StoredThemes = Partial<Record<CreditDocKind, CreditDocThemeOverrides>>;

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

/** Accept hex colors or the keyword `transparent`. */
export function normalizeColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'transparent') return 'transparent';
  return normalizeHex(value);
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

function clampRowFontSize(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(v)) return DEFAULT_TYPOGRAPHY.rowFontSize;
  return Math.min(24, Math.max(9, Math.round(v)));
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

function sanitizeOverrides(partial: CreditDocThemeOverrides | undefined): CreditDocThemeOverrides {
  if (!partial || typeof partial !== 'object') return {};
  const out: CreditDocThemeOverrides = {};
  if (partial.primary) {
    const p = normalizeHex(partial.primary);
    if (p) out.primary = p;
  }
  if (partial.white) {
    const bg = normalizeHex(partial.white);
    if (bg) out.white = bg;
  }
  if (partial.rowAlt != null && String(partial.rowAlt).trim() !== '') {
    const alt = normalizeColor(String(partial.rowAlt));
    if (alt) out.rowAlt = alt;
  }
  if (partial.rowFontSize != null) {
    out.rowFontSize = clampRowFontSize(partial.rowFontSize);
  }
  if (typeof partial.rowFontBold === 'boolean') {
    out.rowFontBold = partial.rowFontBold;
  }
  if (typeof partial.fontFamily === 'string' && partial.fontFamily.trim()) {
    out.fontFamily = partial.fontFamily.trim();
  }
  return out;
}

function loadStored(): StoredThemes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredThemes;
    return {
      invoice: sanitizeOverrides(parsed.invoice),
      ledger: sanitizeOverrides(parsed.ledger),
    };
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
  const partial = sanitizeOverrides(stored[kind]);
  const primary = partial.primary || DEFAULTS[kind].primary;
  const built = themeFromPrimary(primary, kind);
  return {
    ...built,
    ...partial,
    primary: built.primary,
    rowFontSize: clampRowFontSize(partial.rowFontSize ?? built.rowFontSize),
    rowFontBold: partial.rowFontBold ?? built.rowFontBold,
    fontFamily: partial.fontFamily || built.fontFamily,
  };
}

/** Snapshot of overrides currently saved (for server sync). */
function overridesFromTheme(theme: CreditDocTheme, kind: CreditDocKind): CreditDocThemeOverrides {
  const def = DEFAULTS[kind];
  const out: CreditDocThemeOverrides = { primary: theme.primary };
  if (theme.white.toLowerCase() !== def.white.toLowerCase()) out.white = theme.white;
  // Always persist rowAlt when not the auto-derived value so transparent sticks after primary changes
  const derivedAlt = themeFromPrimary(theme.primary, kind).rowAlt;
  if (theme.rowAlt.toLowerCase() !== derivedAlt.toLowerCase()) out.rowAlt = theme.rowAlt;
  if (theme.rowFontSize !== def.rowFontSize) out.rowFontSize = theme.rowFontSize;
  if (theme.rowFontBold !== def.rowFontBold) out.rowFontBold = theme.rowFontBold;
  if (theme.fontFamily !== def.fontFamily) out.fontFamily = theme.fontFamily;
  return out;
}

function storedPayload(stored: StoredThemes): StoredThemes {
  const out: StoredThemes = {};
  (['invoice', 'ledger'] as CreditDocKind[]).forEach((kind) => {
    const theme = resolveTheme(kind, stored);
    const def = DEFAULTS[kind];
    const o = overridesFromTheme(theme, kind);
    // Keep at least primary if anything customized, or empty if fully default
    const hasCustom =
      (o.primary && o.primary.toLowerCase() !== def.primary.toLowerCase()) ||
      o.white != null ||
      o.rowAlt != null ||
      o.rowFontSize != null ||
      o.rowFontBold != null ||
      o.fontFamily != null;
    if (hasCustom) out[kind] = o;
  });
  return out;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let hydratePromise: Promise<void> | null = null;

async function pushThemesToServer(stored: StoredThemes) {
  try {
    await api.put('/document-theme/', storedPayload(stored));
  } catch {
    /* offline / permission — localStorage still applies on this device */
  }
}

function scheduleServerSync(stored: StoredThemes) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void pushThemesToServer(stored);
  }, 400);
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
  const prev = sanitizeOverrides(stored[kind]);
  // Keep typography + explicit bg / rowAlt; refresh chrome from new primary
  stored[kind] = sanitizeOverrides({
    ...prev,
    primary: hex,
  });
  persist(stored);
  notify();
  scheduleServerSync(stored);
}

export function updateDocTheme(kind: CreditDocKind, patch: CreditDocThemeOverrides) {
  const stored = loadStored();
  const prev = sanitizeOverrides(stored[kind]);
  stored[kind] = sanitizeOverrides({ ...prev, ...patch });
  persist(stored);
  notify();
  scheduleServerSync(stored);
}

export function resetDocTheme(kind: CreditDocKind) {
  const stored = loadStored();
  delete stored[kind];
  persist(stored);
  notify();
  scheduleServerSync(stored);
}

export function resetAllDocThemes() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
  scheduleServerSync({});
}

/** Load shop-wide theme from the API so all users share the same look. */
export function hydrateDocThemesFromServer(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const { data } = await api.get<{
        invoice?: CreditDocThemeOverrides;
        ledger?: CreditDocThemeOverrides;
      }>('/document-theme/');
      if (!data || typeof data !== 'object') return;
      const next: StoredThemes = {
        invoice: sanitizeOverrides(data.invoice),
        ledger: sanitizeOverrides(data.ledger),
      };
      const hasAny =
        Object.keys(next.invoice || {}).length > 0 || Object.keys(next.ledger || {}).length > 0;
      if (hasAny) {
        persist(next);
        notify();
      } else {
        // Seed server from this browser if local customizations exist
        const local = loadStored();
        const payload = storedPayload(local);
        if (Object.keys(payload).length > 0) {
          await pushThemesToServer(local);
        }
      }
    } catch {
      /* keep local */
    } finally {
      // Allow a later re-hydrate (e.g. after login)
      hydratePromise = null;
    }
  })();
  return hydratePromise;
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
  useEffect(() => {
    void hydrateDocThemesFromServer();
  }, []);
  void tick;
  return {
    invoice: getInvoiceTheme(),
    ledger: getLedgerTheme(),
    setPrimary: setDocPrimary,
    updateTheme: updateDocTheme,
    reset: resetDocTheme,
    resetAll: resetAllDocThemes,
  };
}

/** @deprecated Prefer getInvoiceTheme() — kept for existing imports */
export const CREDIT_THEME = DEFAULT_INVOICE_THEME;
