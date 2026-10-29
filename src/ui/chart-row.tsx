import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChartEntry } from '@/src/discovery/charts';
import { Artwork } from '@/src/ui/artwork';
import { DownloadButton } from '@/src/ui/download-button';
import { likesStore } from '@/src/ui/likes';
import { useDoubleTapLike } from '@/src/ui/use-double-tap-like';
import { useStore } from '@/src/hooks/use-store';
import { useSongInfo } from '@/src/ui/song-info';
import { releaseYear } from '@/src/core/format';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * One line of a chart.
 *
 * The position is the loudest thing on the row, because that is the fact the
 * row exists to carry. Beside it sits the only honest measure of reach Pulse
 * has — how many of the markets it tracks the song is charting in — and the
 * movement since yesterday, worked out from Pulse's own snapshot.
 */
export function ChartRow({
  entry,
  markets,
  onPress,
  onMore,
  compact = false,
}: {
  entry: ChartEntry;
  /** How many markets the board was built from, for the "3 of 12" line. */
  markets: number;
  onPress: () => void;
  onMore?: () => void;
  /** Tighter row without the download button, used in the Home block. */
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const likeOnDoubleTap = useDoubleTapLike();
  const likes = useStore(likesStore);
  const songInfo = useSongInfo();
  const { track, position, countries, movement, change } = entry;

  const isLiked = likes.ids.has(track.id);
  const movementColor =
    movement === 'up' ? colors.accentInk : movement === 'down' ? colors.danger : colors.textFaint;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Number ${position}, ${track.title} by ${track.artistName}`}
      onPress={() => {
        if (likeOnDoubleTap(track)) return;
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.card }]}
    >
      <View style={styles.rank}>
        <Txt style={[styles.position, position >= 100 && { fontSize: 17 }]}>{position}</Txt>
        {movement === 'new' ? (
          <Txt variant="micro" style={{ color: colors.accentInk }}>
            NEW
          </Txt>
        ) : movement === 'same' ? (
          <Ionicons name="remove" size={11} color={colors.textFaint} />
        ) : (
          <View style={styles.movement}>
            <Ionicons
              name={movement === 'up' ? 'caret-up' : 'caret-down'}
              size={11}
              color={movementColor}
            />
            <Txt variant="micro" style={{ color: movementColor }}>
              {Math.abs(change)}
            </Txt>
          </View>
        )}
      </View>

      <Artwork uri={track.artworkUrl} size={compact ? 42 : 48} radius={radii.sm} />

      <View style={styles.body}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {track.title}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {track.artistName}
        </Txt>
        {!compact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See how widely this song is played"
            hitSlop={6}
            onPress={() => songInfo(track)}
          >
            <Txt variant="caption" tone="faint" numberOfLines={1}>
              {[
                releaseYear(track.releaseDate),
                `charting in ${countries} of ${markets} markets`,
                `peak #${entry.peak}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Txt>
          </Pressable>
        )}
      </View>

      {isLiked && <Ionicons name="heart" size={15} color={colors.accentInk} />}
      {!compact && <DownloadButton track={track} size={30} />}
      {onMore && (
        <Pressable
          onPress={onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${track.title}`}
          style={({ pressed }) => [{ paddingLeft: 4 }, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="ellipsis-vertical" size={17} color={colors.textMuted} />
        </Pressable>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 8,
      borderRadius: radii.md,
    },
    rank: { width: 32, alignItems: 'center' },
    position: { fontSize: 21, fontWeight: '800', letterSpacing: -0.6, color: colors.text },
    movement: { flexDirection: 'row', alignItems: 'center', gap: 1 },
    body: { flex: 1, gap: 2 },
  });
