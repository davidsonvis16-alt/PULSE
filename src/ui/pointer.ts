import { Platform } from 'react-native';

/**
 * Where the pointer last went down, on the web.
 *
 * A "…" menu on a laptop should open beside the button that was clicked, as
 * every desktop app's does. Rather than thread coordinates through every
 * caller, the page remembers the last press and the menu reads it.
 */

let last: { x: number; y: number; at: number } | null = null;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      last = { x: event.clientX, y: event.clientY, at: Date.now() };
    },
    { capture: true, passive: true },
  );
}

/** The last press, if it was recent enough to be the one opening a menu. */
export function lastPointer(maxAgeMs = 1500): { x: number; y: number } | null {
  if (!last || Date.now() - last.at > maxAgeMs) return null;
  return { x: last.x, y: last.y };
}
