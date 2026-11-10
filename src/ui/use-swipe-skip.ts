import { useMemo } from 'react';
import { PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';
import { playerStore } from '@/src/audio/player';

/** How far a sideways swipe must travel to count. */
const DISTANCE = 56;

/**
 * Swipe the playing song's card to change song: left for the next one, right
 * for the one before. Mostly-vertical drags are left alone, so scrolling and
 * the player's own pull-down still work; on a laptop a sideways drag with the
 * mouse does the same.
 */
export function useSwipeSkip() {
  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < DISTANCE || Math.abs(g.dx) < Math.abs(g.dy)) return;
          void Haptics.selectionAsync().catch(() => {});
          if (g.dx < 0) void playerStore.next();
          else void playerStore.previous();
        },
      }).panHandlers,
    [],
  );
}
