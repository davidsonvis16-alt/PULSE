import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { layout, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { playerStore, progressStore } from '@/src/audio/player';
import { useStore } from '@/src/hooks/use-store';

/**
 * The mini player follows the user everywhere. It sits directly above the tab
 * bar so playback is always one tap away, and it never unmounts, so navigating
 * between screens cannot interrupt audio.
 */
export function MiniPlayer({ bottom }: { bottom: number }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const player = useStore(playerStore);
  const progress = useStore(progressStore);

  if (!player.current) return null;

  const track = player.current;
  const ratio = progress.durationMs > 0 ? progress.positionMs / progress.durationMs : 0;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Now playing: ${track.title} by ${track.artistName}. Open the player.`}
        onPress={() => router.push('/player')}
        style={({ pressed }) => [styles.bar, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(100, ratio * 100)}%` }]} />
        </View>

        <View style={styles.content}>
          <Artwork uri={track.artworkUrl} size={42} radius={radii.xs} />
          <View style={styles.meta}>
            <Txt variant="callout" numberOfLines={1}>
              {track.title}
            </Txt>
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              {player.isOffline ? 'On device · ' : ''}
              {track.artistName}
            </Txt>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
            hitSlop={10}
            onPress={(event) => {
              event.stopPropagation();
              playerStore.toggle();
            }}
            style={styles.control}
          >
            <Ionicons
              name={player.isLoading ? 'ellipsis-horizontal' : player.isPlaying ? 'pause' : 'play'}
              size={21}
              color={colors.text}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next track"
            hitSlop={10}
            onPress={(event) => {
              event.stopPropagation();
              void playerStore.next();
            }}
            style={styles.control}
          >
            <Ionicons name="play-skip-forward" size={19} color={colors.textSecondary} />
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: spacing.md },
    bar: {
      height: layout.miniPlayerHeight,
      borderRadius: radii.lg,
      backgroundColor: colors.cardRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      justifyContent: 'center',
      maxWidth: 720,
      width: '100%',
      alignSelf: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
    },
    progressTrack: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: colors.cardHigh,
    },
    progressFill: { height: 2, backgroundColor: colors.accent },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
    },
    meta: { flex: 1, gap: 2 },
    control: { padding: 4 },
  });
