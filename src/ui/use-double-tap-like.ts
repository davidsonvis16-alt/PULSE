import { useCallback, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import type { Track } from '@/src/core/types';
import { likesStore } from '@/src/ui/likes';
import { useToast } from '@/src/ui/toast';

/** Two taps closer together than this are one gesture. */
const DOUBLE_TAP_MS = 300;

/**
 * Double tap to like.
 *
 * The first tap does what a tap has always done — it plays the song — and a
 * second tap on the same row within a moment likes it. Nothing is delayed
 * waiting to see whether a second tap is coming, because a song that takes
 * a third of a second to start feels broken.
 *
 * The returned function reports whether it consumed the tap, so callers can
 * skip their own handler for the second one.
 */
export function useDoubleTapLike(): (track: Track) => boolean {
  const toast = useToast();
  const last = useRef<{ id: string; at: number }>({ id: '', at: 0 });

  return useCallback(
    (track: Track) => {
      const now = Date.now();
      const previous = last.current;
      const isSecondTap = previous.id === track.id && now - previous.at < DOUBLE_TAP_MS;

      if (!isSecondTap) {
        last.current = { id: track.id, at: now };
        return false;
      }

      last.current = { id: '', at: 0 };
      void (async () => {
        try {
          const liked = await likesStore.toggle(track);
          void Haptics.impactAsync(
            liked ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
          ).catch(() => {});
          toast(liked ? 'Added to Liked songs' : 'Removed from Liked songs', liked ? 'success' : 'default');
        } catch {
          toast('Could not save that like', 'error');
        }
      })();
      return true;
    },
    [toast],
  );
}
