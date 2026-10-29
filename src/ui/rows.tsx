import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { likesStore } from '@/src/ui/likes';
import { useDoubleTapLike } from '@/src/ui/use-double-tap-like';
import { useStore } from '@/src/hooks/use-store';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { formatDuration, releaseYear } from '@/src/core/format';
import { useSongInfo } from '@/src/ui/song-info';
import type { Album, Artist, Track } from '@/src/core/types';

export const TrackRow = memo(function TrackRow({
  track,
  onPress,
  onMore,
  index,
  isPlaying,
  isDownloaded,
  showArtwork = true,
  subtitleOverride,
  trailing,
}: {
  track: Track;
  onPress: () => void;
  onMore?: () => void;
  /** Shown instead of artwork on album pages, where every cover is the same. */
  index?: number;
  isPlaying?: boolean;
  isDownloaded?: boolean;
  showArtwork?: boolean;
  subtitleOverride?: string;
  trailing?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const likeOnDoubleTap = useDoubleTapLike();
  const likes = useStore(likesStore);
  const songInfo = useSongInfo();
  const isLiked = likes.ids.has(track.id);
  const year = releaseYear(track.releaseDate);
  const subtitle =
    subtitleOverride ??
    [track.artistName, track.albumTitle].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${track.artistName}${isLiked ? ', liked' : ''}. Double tap to ${isLiked ? 'unlike' : 'like'}.`}
      onPress={() => {
        // The second tap of a double tap likes the song instead of restarting it.
        if (likeOnDoubleTap(track)) return;
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {showArtwork ? (
        <Artwork uri={track.artworkUrl} size={48} radius={radii.sm} />
      ) : (
        <View style={styles.indexBox}>
          {isPlaying ? (
            <Ionicons name="volume-medium" size={15} color={colors.accentInk} />
          ) : (
            <Txt variant="callout" tone="muted">
              {(index ?? 0) + 1}
            </Txt>
          )}
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Txt
            variant="bodyStrong"
            numberOfLines={1}
            style={[{ flexShrink: 1 }, isPlaying && { color: colors.accentInk }]}
          >
            {track.title}
          </Txt>
          {track.explicit && (
            <View style={styles.explicit}>
              <Txt style={styles.explicitText}>E</Txt>
            </View>
          )}
        </View>
        <View style={styles.metaLine}>
          <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {subtitle}
          </Txt>
          {/* The release year, and the way into where the song stands. */}
          {!!year && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Released ${year}. See how widely this song is played.`}
              hitSlop={8}
              onPress={() => songInfo(track)}
              style={({ pressed }) => [styles.year, pressed && { opacity: 0.6 }]}
            >
              <Txt variant="micro" tone="secondary">
                {year}
              </Txt>
            </Pressable>
          )}
        </View>
      </View>

      {isLiked && (
        <Ionicons name="heart" size={15} color={colors.accentInk} style={styles.badge} />
      )}
      {isDownloaded && (
        <Ionicons name="arrow-down-circle" size={15} color={colors.accentInk} style={styles.badge} />
      )}
      {trailing ?? (
        <Txt variant="caption" tone="faint">
          {formatDuration(track.durationMs)}
        </Txt>
      )}
      {onMore && (
        <Pressable
          onPress={onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${track.title}`}
          style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="ellipsis-vertical" size={17} color={colors.textMuted} />
        </Pressable>
      )}
    </Pressable>
  );
});

export const ArtistRow = memo(function ArtistRow({
  artist,
  onPress,
  detail,
  trailing,
}: {
  artist: Artist;
  onPress: () => void;
  detail?: string;
  trailing?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={artist.name}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Artwork uri={artist.imageUrl} size={48} rounded />
      <View style={styles.body}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {artist.name}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {detail ?? artist.genre ?? 'Artist'}
        </Txt>
      </View>
      {trailing ?? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />}
    </Pressable>
  );
});

export const AlbumRow = memo(function AlbumRow({
  album,
  onPress,
  onMore,
}: {
  album: Album;
  onPress: () => void;
  onMore?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : null;
  const detail = [album.artistName, year, album.albumType === 'single' ? 'Single' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${album.title} by ${album.artistName}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Artwork uri={album.artworkUrl} size={52} radius={radii.sm} />
      <View style={styles.body}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {album.title}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {detail}
        </Txt>
      </View>
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={10} accessibilityLabel="More options">
          <Ionicons name="ellipsis-vertical" size={17} color={colors.textMuted} />
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      )}
    </Pressable>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 8,
      borderRadius: radii.md,
    },
    pressed: { backgroundColor: colors.card },
    body: { flex: 1, gap: 3 },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    year: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radii.xs,
      backgroundColor: colors.cardHigh,
    },
    indexBox: { width: 28, alignItems: 'center' },
    explicit: {
      width: 14,
      height: 14,
      borderRadius: 3,
      backgroundColor: colors.cardHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    explicitText: { fontSize: 9, fontWeight: '700', color: colors.textMuted },
    badge: { marginRight: 2 },
    more: { paddingLeft: 4 },
  });
