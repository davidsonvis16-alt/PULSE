import { useCallback, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';


/**
 * The seek bar.
 *
 * Built from a plain View and a pan responder rather than a slider component:
 * it keeps the thin lime line the player is designed around, and it means the
 * player has no native dependency beyond audio itself.
 *
 * While the user is dragging, the bar follows the finger and the parent is told
 * the provisional position; the seek itself only happens on release, so audio
 * is not thrashed on every pixel of movement.
 */
export function SeekBar({
  position,
  duration,
  onScrub,
  onSeek,
  height = 4,
}: {
  positionSummary?: never;
  position: number;
  duration: number;
  /** Called continuously while dragging, with the provisional position in ms. */
  onScrub: (positionMs: number | null) => void;
  /** Called once on release, with the position to seek to in ms. */
  onSeek: (positionMs: number) => void;
  height?: number;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    widthRef.current = next;
    setWidth(next);
  }, []);

  const positionFor = useCallback((x: number) => {
    const total = durationRef.current;
    if (!widthRef.current || total <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, x / widthRef.current));
    return ratio * total;
  }, []);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        onScrub(positionFor(event.nativeEvent.locationX));
      },
      onPanResponderMove: (event) => {
        onScrub(positionFor(event.nativeEvent.locationX));
      },
      onPanResponderRelease: (event) => {
        const next = positionFor(event.nativeEvent.locationX);
        onScrub(null);
        onSeek(next);
      },
      onPanResponderTerminate: () => onScrub(null),
    }),
  ).current;

  const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  const thumbX = width * ratio;

  return (
    <View
      {...responder.panHandlers}
      onLayout={onLayout}
      accessibilityRole="adjustable"
      accessibilityLabel="Playback position"
      accessibilityValue={{ now: Math.round(ratio * 100), min: 0, max: 100 }}
      // A generous touch target around a deliberately thin bar.
      style={styles.hit}
    >
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <View
          style={{
            width: `${ratio * 100}%`,
            height,
            borderRadius: height / 2,
            backgroundColor: colors.accent,
          }}
        />
      </View>
      {width > 0 && (
        <View
          pointerEvents="none"
          style={[styles.thumb, { left: Math.max(0, Math.min(width - 12, thumbX - 6)) }]}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    hit: { height: 28, justifyContent: 'center' },
    track: { width: '100%', backgroundColor: colors.cardHigh, overflow: 'hidden' },
    thumb: {
      position: 'absolute',
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.accent,
    },
  });
