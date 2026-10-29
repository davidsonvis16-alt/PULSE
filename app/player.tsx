import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
 * On the player everything sits on the song's own cover, blurred and darkened,
 * so it is always light-on-dark whatever theme the rest of the app is in.
 */
const ON_ART = '#F5F3F7';
const ON_ART_SOFT = 'rgba(245, 243, 247, 0.74)';
const ON_ART_FAINT = 'rgba(245, 243, 247, 0.55)';

/**
 * The full player.
 *
 * The background is the cover that is playing, blurred, so every song brings
 * its own colour. On a phone the artwork leads and the controls sit under the
 * thumb; on a laptop the song takes the left of the window and what plays next
 * takes the right. The line under the title says exactly where the audio came
 * from — including when it is a provider preview or a file already on the
 * device.
 */
export default function PlayerScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height, isLaptopUp } = useResponsive();
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

  const artSize = isLaptopUp
    ? Math.min(400, height * 0.42, (width - 380 - 56 * 2 - 48) * 0.42)
    : Math.min(width - spacing.xxl * 2, height * 0.42);
  const position = scrubbing ?? progress.positionMs;
  const duration = progress.durationMs || player.source?.durationMs || track.durationMs || 0;
  const record = downloads.byTrackId[track.id];
  const downloaded = record?.status === 'completed';
  const upNext = player.queue
    .map((item, index) => ({ item, index }))
    .slice(player.index + 1, player.index + 31);

  const details = (
    <View style={{ gap: spacing.lg }}>
      {/* Title */}
      <View style={styles.meta}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt
            // Short titles get the poster treatment; long ones step down so they still fit.
            variant={isLaptopUp ? (track.title.length > 16 ? 'display' : 'hero') : 'title1'}
            numberOfLines={3}
            style={{ color: ON_ART }}
          >
            {track.title}
          </Txt>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              track.artistId && router.push(`/artist/${encodeURIComponent(track.artistId)}`)
            }
          >
            <Txt variant={isLaptopUp ? 'title3' : 'body'} numberOfLines={1} style={{ color: ON_ART_SOFT }}>
              {track.artistName}
            </Txt>
          </Pressable>
          {/* Source honesty line */}
          {player.source && (
            <View style={styles.sourceLine}>
              <Ionicons
                name={player.isOffline ? 'cloud-offline-outline' : 'radio-outline'}
                size={12}
                color={ON_ART_FAINT}
              />
              <Txt variant="caption" numberOfLines={1} style={{ color: ON_ART_FAINT }}>
                {player.source.label}
              </Txt>
            </View>
          )}
        </View>
        <IconButton
          name={liked ? 'heart' : 'heart-outline'}
          label={liked ? 'Unlike' : 'Like'}
          background="glass"
          color={liked ? colors.accent : ON_ART}
          onPress={async () => {
            const next = await toggleFavorite('track', track.id);
            if (next) await addTrackToLibrary(track);
            setLiked(next);
            toast(next ? 'Liked' : 'Removed from liked songs');
          }}
        />
        <IconButton
          name="ellipsis-horizontal"
          label="More options"
          background="glass"
          color={ON_ART}
          onPress={() => actions.openTrack(track, { queue: player.queue })}
        />
      </View>

      {/* Seek. The radio has no scrub bar: it plays forward and that is all. */}
      <View>
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
          <Txt variant="caption" style={{ color: ON_ART_SOFT }}>
            {onRadio ? 'Pulse Radio · live' : formatDuration(position)}
          </Txt>
          <Txt variant="caption" style={{ color: ON_ART_SOFT }}>
            {onRadio ? formatDuration(duration) : `-${formatDuration(Math.max(0, duration - position))}`}
          </Txt>
        </View>
      </View>

      {/* Transport */}
      <View style={styles.transport}>
        <IconButton
          name="shuffle"
          label={player.shuffle ? 'Shuffle on' : 'Shuffle off'}
          color={player.shuffle ? colors.accent : ON_ART_SOFT}
          onPress={() => playerStore.toggleShuffle()}
        />
        {!onRadio && (
          <IconButton
            name="play-skip-back"
            label="Previous track"
            size={30}
            color={ON_ART}
            onPress={() => void playerStore.previous()}
          />
        )}
        <PlayButton
          playing={player.isPlaying}
          loading={player.isLoading}
          onPress={() => playerStore.toggle()}
          size={76}
        />
        <IconButton
          name="play-skip-forward"
          label="Next track"
          size={30}
          color={ON_ART}
          onPress={() => void playerStore.next()}
        />
        <IconButton
          name="repeat"
          label={`Repeat ${player.repeat}`}
          color={player.repeat === 'off' ? ON_ART_SOFT : colors.accent}
          onPress={() => playerStore.cycleRepeat()}
        />
      </View>
      {player.repeat === 'one' && (
        <Txt variant="micro" tone="accent" align="center" uppercase>
          Repeat one
        </Txt>
      )}

      {player.retuning ? (
        <Txt variant="caption" align="center" style={{ color: ON_ART_SOFT }}>
          Retuning the audio… the song picks up where it was.
        </Txt>
      ) : (
        player.mixWithOtherApps && (
          <Txt variant="caption" align="center" style={{ color: ON_ART_SOFT }}>
            Playing alongside other apps — nothing else gets paused.
          </Txt>
        )
      )}

      {player.error && (
        <Txt variant="caption" tone="danger" align="center">
          {player.error}
        </Txt>
      )}

      {/* Bottom row */}
      <View style={styles.bottom}>
        <IconButton
          name={downloaded ? 'arrow-down-circle' : 'arrow-down-circle-outline'}
          label={downloaded ? 'Downloaded' : 'Download'}
          color={downloaded ? colors.accent : ON_ART_SOFT}
          onPress={() => {
            if (downloaded) {
              toast('Already downloaded');
              return;
            }
            void actions.download(track);
          }}
        />
        {!isLaptopUp && (
          <IconButton
            name="list-outline"
            label="Open the queue"
            color={ON_ART_SOFT}
            onPress={() => router.push('/queue')}
          />
        )}
        {/*
          Share the phone's audio with whatever else is playing. Switching it
          costs a beat — the audio session is rebuilt and the OS stops playback
          while that happens — so the button says it is retuning and the song
          comes back where it left off.
        */}
        <IconButton
          name={
            player.retuning
              ? 'sync-outline'
              : player.mixWithOtherApps
                ? 'layers'
                : 'layers-outline'
          }
          label={
            player.mixWithOtherApps
              ? 'Playing alongside other apps. Turn off to take the audio back.'
              : 'Play alongside other apps without pausing them'
          }
          color={player.mixWithOtherApps ? colors.accent : ON_ART_SOFT}
          disabled={player.retuning}
          onPress={() => void playerStore.setMixWithOtherApps(!player.mixWithOtherApps)}
        />
        <View style={{ flex: 1 }} />
        <IconButton
          name="volume-low-outline"
          label="Lower volume"
          color={ON_ART_SOFT}
          onPress={() => void playerStore.setVolume(player.volume - 0.1)}
        />
        <IconButton
          name="volume-high-outline"
          label="Raise volume"
          color={ON_ART_SOFT}
          onPress={() => void playerStore.setVolume(player.volume + 0.1)}
        />
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* The cover, blurred, is the whole background. */}
      {track.artworkUrl ? (
        <Image
          source={{ uri: track.artworkUrl }}
          blurRadius={isLaptopUp ? 90 : 60}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <LinearGradient
        colors={['rgba(12, 11, 16, 0.35)', 'rgba(12, 11, 16, 0.6)', 'rgba(12, 11, 16, 0.9)']}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.lg,
          paddingHorizontal: isLaptopUp ? 56 : spacing.xxl,
        }}
      >
        {/* Top bar */}
        <View style={styles.top}>
          <IconButton
            name="chevron-down"
            label="Close player"
            background="glass"
            color={ON_ART}
            onPress={() => router.back()}
          />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Txt variant="micro" uppercase style={{ color: ON_ART_SOFT }}>
              Playing from
            </Txt>
            <Txt variant="callout" numberOfLines={1} style={{ color: ON_ART }}>
              {player.contextLabel ?? track.albumTitle ?? 'Pulse'}
            </Txt>
          </View>
          <IconButton
            name="share-outline"
            label="Share this song"
            background="glass"
            color={ON_ART}
            onPress={() => share(trackShare(track))}
          />
        </View>

        {isLaptopUp ? (
          <View style={styles.wide}>
            <View style={styles.wideSong}>
              {/* The queue as a row of records: what played and what is next lean away on either side. */}
              <View style={[styles.flow, { height: artSize + 24 }]}>
                {([-2, -1, 1, 2] as const).map((offset) => {
                  const index = player.index + offset;
                  const item = player.queue[index];
                  if (!item) return null;
                  const near = Math.abs(offset) === 1;
                  const size = artSize * (near ? 0.7 : 0.52);
                  const shift = artSize * (near ? 0.62 : 1.02) * Math.sign(offset);
                  return (
                    <Pressable
                      key={`${item.id}-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Play ${item.title} by ${item.artistName}`}
                      onPress={() => void playerStore.jumpTo(index)}
                      style={{
                        position: 'absolute',
                        opacity: near ? 0.7 : 0.35,
                        transform: [
                          { translateX: shift },
                          { perspective: 900 },
                          { rotateY: `${offset < 0 ? 28 : -28}deg` },
                        ],
                      }}
                    >
                      <Artwork uri={item.artworkUrl} size={size} radius={radii.md} />
                    </Pressable>
                  );
                })}
                <View style={styles.artShadow}>
                  <Artwork uri={track.artworkUrl} size={artSize} radius={radii.xl} />
                </View>
              </View>
              <View style={{ width: '100%', maxWidth: 560 }}>{details}</View>
            </View>

            {/* What plays next */}
            <View style={styles.upNext}>
              <View style={styles.upNextHead}>
                <Txt variant="title3" style={{ color: ON_ART }}>
                  Up next
                </Txt>
                <Pressable accessibilityRole="button" onPress={() => router.push('/queue')} hitSlop={8}>
                  <Txt variant="callout" style={{ color: ON_ART_SOFT }}>
                    Edit queue
                  </Txt>
                </Pressable>
              </View>
              {upNext.length === 0 ? (
                <Txt variant="caption" style={{ color: ON_ART_SOFT, padding: spacing.md }}>
                  Nothing queued after this song.
                </Txt>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {upNext.map(({ item, index }) => (
                    <Pressable
                      key={`${item.id}-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Play ${item.title} by ${item.artistName}`}
                      onPress={() => void playerStore.jumpTo(index)}
                      style={({ pressed }) => [styles.queueRow, pressed && { opacity: 0.7 }]}
                    >
                      <Artwork uri={item.artworkUrl} size={44} radius={radii.xs} />
                      <View style={{ flex: 1 }}>
                        <Txt variant="callout" numberOfLines={1} style={{ color: ON_ART }}>
                          {item.title}
                        </Txt>
                        <Txt variant="caption" numberOfLines={1} style={{ color: ON_ART_SOFT }}>
                          {item.artistName}
                        </Txt>
                      </View>
                      {item.durationMs ? (
                        <Txt variant="caption" style={{ color: ON_ART_SOFT }}>
                          {formatDuration(item.durationMs)}
                        </Txt>
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        ) : (
          <>
            <View style={styles.artWrap}>
              <View style={styles.artShadow}>
                <Artwork uri={track.artworkUrl} size={artSize} radius={radii.xl} />
              </View>
            </View>
            {details}
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, overflow: 'hidden' },
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.lg },
    artShadow: {
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 40,
      shadowOffset: { width: 0, height: 24 },
      elevation: 20,
    },
    meta: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    sourceLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
    transport: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      maxWidth: 440,
    },
    bottom: { flexDirection: 'row', alignItems: 'center' },
    wide: { flex: 1, flexDirection: 'row', gap: 48, paddingVertical: spacing.xxl },
    wideSong: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xxl },
    flow: { width: '100%', alignItems: 'center', justifyContent: 'center' },
    upNext: {
      width: 380,
      borderRadius: radii.lg,
      backgroundColor: 'rgba(0, 0, 0, 0.28)',
      padding: spacing.sm,
    },
    upNextHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
    },
    queueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.sm,
      borderRadius: radii.sm,
    },
  });
