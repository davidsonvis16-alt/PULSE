import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Keeping a page current while someone is looking at it.
 *
 * News goes stale in minutes, so the page reloads when it is opened, when the
 * app comes back to the foreground, and on a slow timer while it is on screen.
 * Every one of those is a no-op when the last load was recent, so a listener
 * flicking between tabs does not re-download the same feeds.
 */
export function useLiveRefresh({
  enabled,
  refresh,
  /** Nothing reloads again within this window. */
  minIntervalMs = 2 * 60 * 1000,
  /** How often to check while the page is open. */
  pollMs = 5 * 60 * 1000,
}: {
  enabled: boolean;
  refresh: () => void;
  minIntervalMs?: number;
  pollMs?: number;
}) {
  const lastAt = useRef(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const maybeRefresh = useCallback(
    (force = false) => {
      if (!enabled) return;
      if (!force && Date.now() - lastAt.current < minIntervalMs) return;
      lastAt.current = Date.now();
      refreshRef.current();
    },
    [enabled, minIntervalMs],
  );

  // Opening the page.
  useEffect(() => {
    if (enabled) maybeRefresh();
  }, [enabled, maybeRefresh]);

  // Coming back to the app.
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeRefresh();
    });
    return () => subscription.remove();
  }, [enabled, maybeRefresh]);

  // Sitting on the page.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => maybeRefresh(), pollMs);
    return () => clearInterval(timer);
  }, [enabled, maybeRefresh, pollMs]);

  return { markLoaded: () => (lastAt.current = Date.now()) };
}

/** True for a story published in the last hour and a half. */
export function isJustIn(publishedAt: number, now = Date.now()): boolean {
  return publishedAt > 0 && now - publishedAt < 90 * 60 * 1000;
}

export function useNow(intervalMs = 60 * 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
