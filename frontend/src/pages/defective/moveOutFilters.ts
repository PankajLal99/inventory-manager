export const MOVE_OUTS_FILTERS_STORAGE_KEY = 'defective-move-outs:filters:v1';

export type PersistedMoveOutFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  brand: string;
  category: string;
  supplier: string;
  storeId: number | null;
  viewAll: boolean;
  scopeChosen: boolean;
};

export function readPersistedMoveOutFilters(): PersistedMoveOutFilters | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MOVE_OUTS_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedMoveOutFilters>;
    const supplier = typeof parsed.supplier === 'string' ? parsed.supplier : '';
    const viewAll = Boolean(parsed.viewAll);
    const scopeChosen = Boolean(parsed.scopeChosen) || viewAll || Boolean(supplier);
    return {
      search: typeof parsed.search === 'string' ? parsed.search : '',
      dateFrom: typeof parsed.dateFrom === 'string' ? parsed.dateFrom : '',
      dateTo: typeof parsed.dateTo === 'string' ? parsed.dateTo : '',
      brand: typeof parsed.brand === 'string' ? parsed.brand : '',
      category: typeof parsed.category === 'string' ? parsed.category : '',
      supplier,
      storeId: typeof parsed.storeId === 'number' ? parsed.storeId : null,
      viewAll,
      scopeChosen,
    };
  } catch {
    return null;
  }
}

export function writePersistedMoveOutFilters(filters: PersistedMoveOutFilters): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MOVE_OUTS_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // quota / private mode
  }
}

export function parseMoveOutAmount(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return parseFloat(String(value || '0')) || 0;
}
