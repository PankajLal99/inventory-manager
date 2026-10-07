const MAP_KEY = 'salary_book_tutorial_seen_by_user';
const LEGACY_KEY = 'salary_book_tutorial_seen';

type SeenMap = Record<string, boolean>;

function readMap(): SeenMap {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as SeenMap;
  } catch {
    return {};
  }
}

function writeMap(map: SeenMap) {
  localStorage.setItem(MAP_KEY, JSON.stringify(map));
}

function userKey(userId: number | string | null | undefined): string | null {
  if (userId === null || userId === undefined || userId === '') return null;
  return String(userId);
}

/** Whether this salary-book user has completed or skipped the tutorial. */
export function hasSeenSalaryBookTutorial(userId: number | string | null | undefined): boolean {
  const key = userKey(userId);
  if (!key) return false;
  try {
    return Boolean(readMap()[key]);
  } catch {
    return false;
  }
}

export function markSalaryBookTutorialSeen(userId: number | string | null | undefined): void {
  const key = userKey(userId);
  if (!key) return;
  try {
    const map = readMap();
    map[key] = true;
    writeMap(map);
    // Drop the old device-wide flag so it cannot affect other accounts.
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSalaryBookTutorialSeen(userId: number | string | null | undefined): void {
  const key = userKey(userId);
  if (!key) return;
  try {
    const map = readMap();
    delete map[key];
    writeMap(map);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}
