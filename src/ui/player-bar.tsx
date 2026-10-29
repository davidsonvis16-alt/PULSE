import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@/src/core/format';
import { playerStore, progressStore } from '@/src/audio/player';
import { addTrackToLibrary, isFavorite, toggleFavorite } from '@/src/db/repos/library';
import { useStore } from '@/src/hooks/use-store';
import { Artwork } from '@/src/ui/artwork';
import { IconButton } from '@/src/ui/buttons';
import { SeekBar } from '@/src/ui/seek-bar';
import { Txt } from '@/src/ui/text';
import { layout, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * The laptop player: a bar along the bottom of every screen, like Spotify,
 * Apple Music and Deezer on a computer. The song on the left, the controls and
 * the seek line in the middle, the queue and volume on the right.
 */
export function PlayerBar() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const player = useStore(playerStore);
  const progress = useStore(progressStore);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);

  const track = player.current;

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    void isFavorite('track', track.id).then((value) => !cancelled && setLiked(value));
    return () => {
      cancelled = true;
    };
  }, [track]);

  if (!track) return null;

  const onRadio = player.context === 'radio';
  const duration = progress.durationMs || player.source?.durationMs || track.durationMs || 0;
  const position = scrubbing ?? progress.positionMs;
  const openPlayer = () => router.push('/player');

  return (
    <View style={styles.bar}>
      {/* The song */}
      <View style={styles.side}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open the player" onPress={openPlayer}>
          <Artwork uri={track.artworkUrl} size={56} radius={radii.xs} />
        </Pressable>
        <Pressable onPress={openPlayer} style={{ flexShrink: 1, gap: 2 }}>
          <Txt variant="callout" numberOfLines={1}>
            {track.title}
          </Txt>
          {player.error ? (
            <Txt variant="caption" tone="danger" numberOfLines={1}>
              {player.error}
            </Txt>
          ) : (
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              {track.artistName}
            </Txt>
          )}
        </Pressable>
        <IconButton
          name={liked ? 'heart' : 'heart-outline'}
          label={liked ? 'Unlike' : 'Like'}
          size={19}
          color={liked ? colors.accentInk : colors.textMuted}
          onPress={async () => {
            const next = await toggleFavorite('track', track.id);
            if (next) await addTrackToLibrary(track);
            setLiked(next);
          }}
        />
      </View>

      {/* Controls */}
      <View style={styles.center}>
        <View style={styles.transport}>
          <IconButton
            name="shuffle"
            label={player.shuffle ? 'Shuffle on' : 'Shuffle off'}
            size={18}
            color={player.shuffle ? colors.accentInk : colors.textMuted}
            onPress={() => playerStore.toggleShuffle()}
          />
          {!onRadio && (
            <IconButton
              name="play-skip-back"
              label="Previous track"
              size={20}
              onPress={() => void playerStore.previous()}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
            onPress={() => playerStore.toggle()}
            style={({ pressed }) => [styles.play, pressed && { transform: [{ scale: 0.94 }] }]}
          >
            <Ionicons
              name={player.isLoading ? 'ellipsis-horizontal' : player.isPlaying ? 'pause' : 'play'}
              size={20}
              color={colors.background}
              style={!player.isPlaying && !player.isLoading ? { marginLeft: 2 } : undefined}
            />
          </Pressable>
          <IconButton
            name="play-skip-forward"
            label="Next track"
            size={20}
            onPress={() => void playerStore.next()}
          />
          <IconButton
            name="repeat"
            label={`Repeat ${player.repeat}`}
            size={18}
            color={player.repeat === 'off' ? colors.textMuted : colors.accentInk}
            onPress={() => playerStore.cycleRepeat()}
          />
        </View>
        <View style={styles.seekRow}>
          <Txt variant="caption" tone="faint" style={styles.time}>
            {onRadio ? 'Live' : formatDuration(position)}
          </Txt>
          <View style={{ flex: 1 }}>
            {!onRadio && (
              <SeekBar
                position={position}
                duration={duration}
                onScrub={setScrubbing}
                onSeek={(value) => void playerStore.seekTo(value)}
              />
            )}
          </View>
          <Txt variant="caption" tone="faint" style={styles.time}>
            {formatDuration(duration)}
          </Txt>
        </View>
      </View>

      {/* Queue and volume */}
      <View style={[styles.side, { justifyContent: 'flex-end' }]}>
        <IconButton
          name="list"
          label="Open the queue"
          size={19}
          color={colors.textMuted}
          onPress={() => router.push('/queue')}
        />
        <IconButton
          name="volume-low"
          label="Lower volume"
          size={19}
          color={colors.textMuted}
          onPress={() => void playerStore.setVolume(player.volume - 0.1)}
        />
        <View style={styles.volume}>
          <View style={[styles.volumeFill, { width: `${Math.round(player.volume * 100)}%` }]} />
        </View>
        <IconButton
          name="volume-high"
          label="Raise volume"
          size={19}
          color={colors.textMuted}
          onPress={() => void playerStore.setVolume(player.volume + 0.1)}
        />
        <IconButton
          name="expand"
          label="Open the full player"
          size={18}
          color={colors.textMuted}
          onPress={openPlayer}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    bar: {
      height: layout.playerBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xxl,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.background,
    },
    side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0 },
    center: { flex: 1.6, maxWidth: 680, alignItems: 'center', gap: 2 },
    transport: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    play: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seekRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch' },
    time: { width: 40, textAlign: 'center', fontVariant: ['tabular-nums'] },
    volume: { width: 88, height: 4, borderRadius: 2, backgroundColor: colors.cardHigh, overflow: 'hidden' },
    volumeFill: { height: '100%', backgroundColor: colors.textMuted },
  });
