import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@/src/core/format';
import { playerStore, progressStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { isFavorite, toggleFavorite, addTrackToLibrary } from '@/src/db/repos/library';
import { useStore } from '@/src/hooks/use-store';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { trackShare } from '@/src/share/share';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { IconButton, PlayButton } from '@/src/ui/buttons';
import { EmptyState, ProgressBar } from '@/src/ui/states';
import { SeekBar } from '@/src/ui/seek-bar';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * The full player.
 *
 * Artwork leads, controls sit under the thumb, and the line above the art says
 * exactly where the audio came from — including when it is a provider preview
 * or a file already on the device.
 */
export default function PlayerScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height, isTabletUp } = useResponsive();
  const player = useStore(playerStore);
  const onRadio = player.context === 'radio';
  const progress = useStore(progressStore);
  const downloads = useStore(downloadManager);
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();

  const [liked, setLiked] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const track = player.current;

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    void isFavorite('track', track.id).then((value) => {
      if (!cancelled) setLiked(value);
    });
    return () => {
      cancelled = true;
    };
  }, [track]);

  if (!track) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState
          icon="musical-notes-outline"
          title="Nothing playing"
          message="Pick a song and it will show up here."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const artSize = Math.min(width - spacing.xxl * 2, isTabletUp ? 420 : height * 0.42);
  const position = scrubbing ?? progress.positionMs;
  const duration = progress.durationMs || player.source?.durationMs || track.durationMs || 0;
  const record = downloads.byTrackId[track.id];
  const downloaded = record?.status === 'completed';

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}>
      {/* Top bar */}
      <View style={styles.top}>
        <IconButton name="chevron-down" label="Close player" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Txt variant="micro" tone="muted" uppercase>
            Playing from
          </Txt>
          <Txt variant="callout" numberOfLines={1}>
            {player.contextLabel ?? track.albumTitle ?? 'Pulse'}
          </Txt>
        </View>
        <IconButton
          name="ellipsis-horizontal"
          label="More options"
          onPress={() => actions.openTrack(track, { queue: player.queue })}
        />
      </View>

      {/* Artwork */}
      <View style={styles.artWrap}>
        <Artwork uri={track.artworkUrl} size={artSize} radius={radii.xl} />
      </View>

      {/* Title */}
      <View style={styles.meta}>
        <View style={{ flex: 1 }}>
          <Txt variant="title2" numberOfLines={2}>
            {track.title}
          </Txt>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              track.artistId && router.push(`/artist/${encodeURIComponent(track.artistId)}`)
            }
          >
            <Txt variant="body" tone="secondary" numberOfLines={1}>
              {track.artistName}
            </Txt>
          </Pressable>
        </View>
        <IconButton
          name={liked ? 'heart' : 'heart-outline'}
          label={liked ? 'Unlike' : 'Like'}
          color={liked ? colors.accent : colors.textSecondary}
          onPress={async () => {
            const next = await toggleFavorite('track', track.id);
            if (next) await addTrackToLibrary(track);
            setLiked(next);
            toast(next ? 'Liked' : 'Removed from liked songs');
          }}
        />
      </View>

      {/* Source honesty line */}
      {player.source && (
        <View style={styles.sourceLine}>
          <Ionicons
            name={player.isOffline ? 'cloud-offline-outline' : 'radio-outline'}
            size={12}
            color={colors.textFaint}
          />
          <Txt variant="caption" tone="faint" numberOfLines={1}>
            {player.source.label}
          </Txt>
        </View>
      )}

      {/* Seek. The radio has no scrub bar: it plays forward and that is all. */}
      <View style={styles.seek}>
        {onRadio ? (
          <ProgressBar progress={duration > 0 ? position / duration : 0} height={3} />
        ) : (
          <SeekBar
            position={position}
            duration={duration}
            onScrub={setScrubbing}
            onSeek={(value) => void playerStore.seekTo(value)}
          />
        )}
        <View style={styles.times}>
          <Txt variant="caption" tone="muted">
            {onRadio ? 'Pulse Radio · live' : formatDuration(position)}
          </Txt>
          <Txt variant="caption" tone="muted">
            {formatDuration(duration)}
          </Txt>
        </View>
      </View>

      {/* Transport */}
      <View style={styles.transport}>
        <IconButton
          name="shuffle"
          label={player.shuffle ? 'Shuffle on' : 'Shuffle off'}
          color={player.shuffle ? colors.accent : colors.textMuted}
          onPress={() => playerStore.toggleShuffle()}
        />
        {!onRadio && (
          <IconButton
            name="play-skip-back"
            label="Previous track"
            size={26}
            onPress={() => void playerStore.previous()}
          />
        )}
        <PlayButton
          playing={player.isPlaying}
          loading={player.isLoading}
          onPress={() => playerStore.toggle()}
          size={70}
        />
        <IconButton
          name="play-skip-forward"
          label="Next track"
          size={26}
          onPress={() => void playerStore.next()}
        />
        <IconButton
          name={player.repeat === 'one' ? 'repeat' : 'repeat'}
          label={`Repeat ${player.repeat}`}
          color={player.repeat === 'off' ? colors.textMuted : colors.accent}
          onPress={() => playerStore.cycleRepeat()}
        />
      </View>
      {player.repeat === 'one' && (
        <Txt variant="micro" tone="accent" align="center" uppercase>
          Repeat one
        </Txt>
      )}

      {player.error && (
        <Txt variant="caption" tone="danger" align="center" style={{ marginTop: spacing.sm }}>
          {player.error}
        </Txt>
      )}

      {/* Bottom row */}
      <View style={styles.bottom}>
        <IconButton
          name={downloaded ? 'arrow-down-circle' : 'arrow-down-circle-outline'}
          label={downloaded ? 'Downloaded' : 'Download'}
          color={downloaded ? colors.accent : colors.textSecondary}
          onPress={() => {
            if (downloaded) {
              toast('Already downloaded');
              return;
            }
            void actions.download(track);
          }}
        />
        <IconButton
          name="list-outline"
          label="Open the queue"
          color={colors.textSecondary}
          onPress={() => router.push('/queue')}
        />
        <View style={{ flex: 1 }} />
        <IconButton
          name="volume-low-outline"
          label="Lower volume"
          color={colors.textSecondary}
          onPress={() => void playerStore.setVolume(player.volume - 0.1)}
        />
        <IconButton
          name="volume-high-outline"
          label="Raise volume"
          color={colors.textSecondary}
          onPress={() => void playerStore.setVolume(player.volume + 0.1)}
        />
        <IconButton
          name="share-outline"
          label="Share this song"
          color={colors.textSecondary}
          onPress={() => share(trackShare(track))}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.backgroundElevated,
      paddingHorizontal: spacing.xxl,
    },
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.lg },
    meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    sourceLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
    seek: { marginTop: spacing.md },
    times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
    transport: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.lg,
    },
    bottom: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.xl,
    },
  });
