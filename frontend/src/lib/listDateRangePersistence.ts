import { useCallback, useState } from 'react';
import type { DateRangePreset, DateRangeValue } from './utils';
import { getDateRangeByPreset } from './utils';

const STORAGE_KEY = 'app:list-date-range:v1';

export type PersistedListDateRange = {
  preset: DateRangePreset;
  startDate: string;
  endDate: string;
};

export function readPersistedListDateRange(): PersistedListDateRange | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedListDateRange>;
    const preset = parsed.preset;
    const safePreset: DateRangePreset =
      preset === 'one_day' || preset === 'last_7_days' || preset === 'last_30_days' || preset === 'custom'
        ? preset
        : 'one_day';
    return {
      preset: safePreset,
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : '',
      endDate: typeof parsed.endDate === 'string' ? parsed.endDate : '',
    };
  } catch {
    return null;
  }
}

export function writePersistedListDateRange(preset: DateRangePreset, startDate: string, endDate: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset, startDate, endDate }));
  } catch {
    // quota / private mode
  }
}

function getInitialListDateRangeState(): { preset: DateRangePreset; dateFrom: string; dateTo: string } {
  const stored = readPersistedListDateRange();
  const fallback = getDateRangeByPreset('one_day');
  if (stored) {
    return {
      preset: stored.preset,
      dateFrom: stored.startDate,
      dateTo: stored.endDate,
    };
  }
  return {
    preset: 'one_day',
    dateFrom: fallback.startDate,
    dateTo: fallback.endDate,
  };
}

/**
 * Shared list/report date range: persists across route changes (and tab refresh) via localStorage.
 */
export function usePersistedListDateRange() {
  const [state, setState] = useState(getInitialListDateRangeState);

  const setListDateRange = useCallback((next: { preset: DateRangePreset; range: DateRangeValue }) => {
    setState({
      preset: next.preset,
      dateFrom: next.range.startDate,
      dateTo: next.range.endDate,
    });
    writePersistedListDateRange(next.preset, next.range.startDate, next.range.endDate);
  }, []);

  return {
    datePreset: state.preset,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    setListDateRange,
  };
}
