const STORAGE_KEY = 'personal-ledger-unlocked';

let unlockedInMemory = false;

export function isPersonalLedgerUnlocked(): boolean {
  if (unlockedInMemory) return true;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return unlockedInMemory;
  }
}

export function setPersonalLedgerUnlocked(unlocked: boolean): void {
  unlockedInMemory = unlocked;
  try {
    if (unlocked) {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors; in-memory flag still applies for this tab.
  }
}

export function clearPersonalLedgerUnlockIfLeaving(pathname: string): void {
  if (!pathname.startsWith('/personal-ledger')) {
    setPersonalLedgerUnlocked(false);
  }
}
