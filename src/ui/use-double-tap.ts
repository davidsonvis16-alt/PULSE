import { useCallback, useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import type { Track } from '@/src/core/types';
import { playerStore } from '@/src/audio/player';
import { useToast } from '@/src/ui/toast';

/** Two taps closer together than this are one gesture. */
const DOUBLE_TAP_MS = 260;

/**
 * Tap to play, double tap to play next.
 *
 * A single tap does what it always did — plays the song — a quarter of a
 * second later, once it is clear no second tap is coming. Two quick taps put
 * the song straight after the one playing now, without interrupting it.
 * (Liking stays on the heart.)
 */
export function useDoubleTapPlayNext(): (track: Track, onSingleTap: () => void) => void {
  const toast = useToast();
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
    },
    [],
  );

  return useCallback(
    (track: Track, onSingleTap: () => void) => {
      const waiting = pending.current;
      if (waiting && waiting.id === track.id) {
        clearTimeout(waiting.timer);
        pending.current = null;
        const nothingPlaying = !playerStore.getSnapshot().current;
        if (nothingPlaying) {
          // Nothing to play after: just play it.
          onSingleTap();
          return;
        }
        playerStore.addToQueue([track], 'next');
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        toast(`“${track.title}” plays next`, 'success');
        return;
      }
      if (waiting) clearTimeout(waiting.timer);
      pending.current = {
        id: track.id,
        timer: setTimeout(() => {
          pending.current = null;
          onSingleTap();
        }, DOUBLE_TAP_MS),
      };
    },
    [toast],
  );
}
