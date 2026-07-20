import { useCallback, useRef, useState } from 'react';

/**
 * Synchronous submit lock — closes the gap between click and React Query isPending.
 * Use tryAcquire() immediately before mutate/API call; release() in onSettled/finally.
 */
export function useSubmitLock() {
  const ref = useRef(false);
  const [locked, setLocked] = useState(false);

  const tryAcquire = useCallback((): boolean => {
    if (ref.current) return false;
    ref.current = true;
    setLocked(true);
    return true;
  }, []);

  const release = useCallback(() => {
    if (!ref.current) return;
    ref.current = false;
    setLocked(false);
  }, []);

  const isLocked = locked;

  return { ref, isLocked, tryAcquire, release };
}

/** Returns true if any lock or mutation pending flag is active. */
export function isSubmitBlocked(
  ...flags: Array<boolean | undefined>
): boolean {
  return flags.some(Boolean);
}
