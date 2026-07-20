import { useCallback } from 'react';
import { useSubmitLock } from './useSubmitLock';

/** Wraps async handlers (non–useMutation) with the same double-click protection. */
export function useGuardedAsync() {
  const lock = useSubmitLock();

  const runGuarded = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (lock.ref.current) return undefined;
      if (!lock.tryAcquire()) return undefined;
      try {
        return await fn();
      } finally {
        lock.release();
      }
    },
    [lock],
  );

  return {
    runGuarded,
    isSubmitting: lock.isLocked,
    tryAcquire: lock.tryAcquire,
    release: lock.release,
    isLocked: lock.isLocked,
  };
}
