import api from './api';

export type ProductNameColorRuleScope = 'keyword' | 'whole_line';

export interface ProductNameColorRule {
  id: string;
  keyword: string;
  color: string;
  /** keyword = color only the matched word; whole_line = color entire name (overrides super rules) */
  scope?: ProductNameColorRuleScope;
}

export interface ProductNameSegment {
  text: string;
  color?: string;
}

/** Red — whole product name when it contains NON PESTING */
export const PRODUCT_NAME_COLOR_NON_PESTING = '#be1129';

/** Green — whole product name when it contains PESTING (and not NON PESTING) */
export const PRODUCT_NAME_COLOR_PESTING = '#418f28';

/** Fixed super rules: color the entire name line (not editable). */
export const PRODUCT_NAME_SUPER_RULES: ProductNameColorRule[] = [
  { id: 'super-non-pestaing', keyword: 'NON PESTING', color: PRODUCT_NAME_COLOR_NON_PESTING, scope: 'whole_line' },
  { id: 'super-pestaing', keyword: 'PESTING', color: PRODUCT_NAME_COLOR_PESTING, scope: 'whole_line' },
];

const SUPER_KEYWORDS = new Set(PRODUCT_NAME_SUPER_RULES.map((r) => r.keyword.toUpperCase()));

/** User-defined keyword rules. */
export const DEFAULT_CUSTOM_KEYWORD_RULES: ProductNameColorRule[] = [];

/** @deprecated use DEFAULT_CUSTOM_KEYWORD_RULES — kept for imports */
export const DEFAULT_PRODUCT_NAME_COLOR_RULES = DEFAULT_CUSTOM_KEYWORD_RULES;

const STORAGE_KEY = 'product_name_color_rules_v2';

export const PRODUCT_NAME_COLOR_RULES_CHANGED = 'product-name-color-rules-changed';

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isSuperKeyword(keyword: string): boolean {
  return SUPER_KEYWORDS.has(keyword.trim().toUpperCase());
}

export function ruleScope(rule: ProductNameColorRule): ProductNameColorRuleScope {
  return rule.scope === 'whole_line' ? 'whole_line' : 'keyword';
}

export function normalizeCustomKeywordRules(raw: unknown): ProductNameColorRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: ProductNameColorRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const keyword = typeof (entry as ProductNameColorRule).keyword === 'string'
      ? (entry as ProductNameColorRule).keyword.trim()
      : '';
    const color = typeof (entry as ProductNameColorRule).color === 'string'
      ? (entry as ProductNameColorRule).color.trim()
      : '';
    if (!keyword || !color || !HEX_COLOR_RE.test(color) || isSuperKeyword(keyword)) continue;
    const scopeRaw = (entry as ProductNameColorRule).scope;
    const scope: ProductNameColorRuleScope = scopeRaw === 'whole_line' ? 'whole_line' : 'keyword';
    const id = typeof (entry as ProductNameColorRule).id === 'string' && (entry as ProductNameColorRule).id
      ? (entry as ProductNameColorRule).id
      : `rule-${rules.length}-${keyword.toLowerCase().replace(/\s+/g, '-')}`;
    rules.push({ id, keyword, color, scope });
  }
  return rules;
}

function persistLocal(rules: ProductNameColorRule[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* ignore */
  }
}

function notify() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PRODUCT_NAME_COLOR_RULES_CHANGED));
  }
}

function isServerRulesPayload(data: unknown): data is ProductNameColorRule[] {
  return Array.isArray(data);
}

function nameContainsKeyword(name: string, keyword: string): boolean {
  return name.toUpperCase().includes(keyword.trim().toUpperCase());
}

/** First matching whole_line custom rule wins and bypasses PESTING / NON PESTING super rules. */
export function resolveCustomWholeLineColor(
  name: string | null | undefined,
  customRules?: ProductNameColorRule[],
): string | undefined {
  if (name == null || typeof name !== 'string') return undefined;
  const rules = customRules ?? loadCustomKeywordColorRules();
  for (const rule of rules) {
    if (ruleScope(rule) !== 'whole_line') continue;
    const keyword = rule.keyword.trim();
    if (!keyword) continue;
    if (nameContainsKeyword(name, keyword)) return rule.color;
  }
  return undefined;
}

/** Super rule color for the whole product name (PESTING / NON PESTING only). */
export function resolveProductNameSuperColor(name: string | null | undefined): string | undefined {
  if (name == null || typeof name !== 'string') return undefined;
  const upper = name.toUpperCase();
  if (upper.includes('NON PESTING')) return PRODUCT_NAME_COLOR_NON_PESTING;
  if (upper.includes('PESTING')) return PRODUCT_NAME_COLOR_PESTING;
  return undefined;
}

/** Whole-line color: custom whole_line rules first, then PESTING / NON PESTING super rules. */
export function resolveProductNameColor(name: string | null | undefined): string | undefined {
  return resolveCustomWholeLineColor(name) ?? resolveProductNameSuperColor(name);
}

export function loadCustomKeywordColorRules(): ProductNameColorRule[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeCustomKeywordRules(JSON.parse(saved));
    const legacy = localStorage.getItem('product_name_color_rules');
    if (legacy) return normalizeCustomKeywordRules(JSON.parse(legacy));
  } catch (error) {
    console.warn('Failed to load product name color rules:', error);
  }
  return [...DEFAULT_CUSTOM_KEYWORD_RULES];
}

/** @deprecated alias */
export function loadProductNameColorRules(): ProductNameColorRule[] {
  return loadCustomKeywordColorRules();
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let hydratePromise: Promise<void> | null = null;
let localDirty = false;

async function pushRulesToServer(rules: ProductNameColorRule[]) {
  try {
    await api.put('/product-name-color-rules/', rules);
  } catch {
    /* offline — local cache still applies on this device */
  }
}

function scheduleServerSync(rules: ProductNameColorRule[]) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void pushRulesToServer(rules);
  }, 400);
}

export function saveCustomKeywordColorRules(rules: ProductNameColorRule[]): ProductNameColorRule[] {
  const cleaned = normalizeCustomKeywordRules(rules);
  localDirty = true;
  persistLocal(cleaned);
  notify();
  scheduleServerSync(cleaned);
  return cleaned;
}

/** @deprecated alias */
export function saveProductNameColorRules(rules: ProductNameColorRule[]): void {
  saveCustomKeywordColorRules(rules);
}

export function resetCustomKeywordColorRules(): ProductNameColorRule[] {
  localDirty = true;
  const defaults = [...DEFAULT_CUSTOM_KEYWORD_RULES];
  persistLocal(defaults);
  notify();
  scheduleServerSync(defaults);
  return defaults;
}

/** @deprecated alias */
export function resetProductNameColorRules(): ProductNameColorRule[] {
  return resetCustomKeywordColorRules();
}

/** Load shop-wide keyword rules from the API (shared across users/devices). */
export function hydrateProductNameColorRulesFromServer(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const { data } = await api.get<ProductNameColorRule[] | Record<string, never>>(
        '/product-name-color-rules/',
      );
      if (isServerRulesPayload(data)) {
        if (!localDirty) {
          const next = normalizeCustomKeywordRules(data);
          persistLocal(next);
          notify();
        }
      } else {
        const local = loadCustomKeywordColorRules();
        await pushRulesToServer(local);
      }
    } catch {
      /* keep local */
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

export function subscribeProductNameColorRules(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PRODUCT_NAME_COLOR_RULES_CHANGED, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(PRODUCT_NAME_COLOR_RULES_CHANGED, listener);
    window.removeEventListener('storage', listener);
  };
}

type KeywordMatch = { start: number; end: number; color: string };

function findCustomKeywordMatches(name: string, rules: ProductNameColorRule[]): KeywordMatch[] {
  if (!name || rules.length === 0) return [];
  const upper = name.toUpperCase();
  const matches: KeywordMatch[] = [];

  for (const rule of rules) {
    if (ruleScope(rule) !== 'keyword') continue;
    const keyword = rule.keyword.trim();
    if (!keyword) continue;
    const kwUpper = keyword.toUpperCase();
    let idx = 0;
    while ((idx = upper.indexOf(kwUpper, idx)) !== -1) {
      matches.push({ start: idx, end: idx + keyword.length, color: rule.color });
      idx += keyword.length;
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: KeywordMatch[] = [];
  let lastEnd = 0;
  for (const match of matches) {
    if (match.start >= lastEnd) {
      nonOverlapping.push(match);
      lastEnd = match.end;
    }
  }
  return nonOverlapping;
}

/**
 * Build display segments:
 * 1. Custom whole_line rule → entire name (bypasses PESTING / NON PESTING)
 * 2. Super rule → entire name
 * 3. Custom keyword rules → only the matched word(s)
 */
export function buildProductNameSegments(
  name: string | null | undefined,
  customRules?: ProductNameColorRule[],
): ProductNameSegment[] {
  if (name == null || typeof name !== 'string' || name === '') return [{ text: '' }];
  const rules = customRules ?? loadCustomKeywordColorRules();

  const wholeLineColor = resolveCustomWholeLineColor(name, rules);
  if (wholeLineColor) {
    return [{ text: name, color: wholeLineColor }];
  }

  const superColor = resolveProductNameSuperColor(name);
  const keywordRules = rules.filter((rule) => ruleScope(rule) === 'keyword');
  const matches = findCustomKeywordMatches(name, keywordRules);

  if (matches.length === 0) {
    return superColor ? [{ text: name, color: superColor }] : [{ text: name }];
  }

  const segments: ProductNameSegment[] = [];
  let pos = 0;
  for (const match of matches) {
    if (match.start > pos) {
      segments.push({ text: name.slice(pos, match.start), color: superColor });
    }
    segments.push({ text: name.slice(match.start, match.end), color: match.color });
    pos = match.end;
  }
  if (pos < name.length) {
    segments.push({ text: name.slice(pos), color: superColor });
  }
  return segments.length > 0 ? segments : [{ text: name, color: superColor }];
}

export function getProductNameInlineStyle(
  name: string | null | undefined,
): { color: string } | undefined {
  const color = resolveProductNameColor(name);
  return color ? { color } : undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** For thermal / invoice HTML — supports whole-line, super, and per-keyword colors. */
export function formatProductNameHtml(
  name: string,
  customRules?: ProductNameColorRule[],
): string {
  return buildProductNameSegments(name, customRules)
    .map((seg) => {
      const escaped = escapeHtml(seg.text);
      return seg.color ? `<span style="color:${seg.color}">${escaped}</span>` : escaped;
    })
    .join('');
}

export function createProductNameColorRule(
  keyword = '',
  color = '#2563eb',
  scope: ProductNameColorRuleScope = 'keyword',
): ProductNameColorRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    keyword,
    color,
    scope,
  };
}

export const PRODUCT_NAME_SCOPE_LABELS: Record<ProductNameColorRuleScope, string> = {
  keyword: 'Keyword only',
  whole_line: 'Whole product name',
};

export const PRODUCT_NAME_SCOPE_HELP: Record<ProductNameColorRuleScope, string> = {
  keyword: 'Only the matching keyword text is colored. PESTING / NON PESTING super rules still apply to the rest of the name.',
  whole_line:
    'The entire product name is colored when it contains this keyword. This overrides PESTING and NON PESTING super rules.',
};
