import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Re-runs a loader when the user comes back to a screen, but not on the first
 * focus (the loader already ran) and not more often than `minIntervalMs`.
 */
export function useFocusReload(reload: () => void, minIntervalMs = 1500) {
  const lastRun = useRef(Date.now());
  const first = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (Date.now() - lastRun.current < minIntervalMs) return;
      lastRun.current = Date.now();
      reload();
    }, [reload, minIntervalMs]),
  );
}
