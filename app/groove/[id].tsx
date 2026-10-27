import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import type { Track } from '@/src/core/types';
import { formatListeningTime, pluralize } from '@/src/core/format';
import { getGroove, getGrooveTracks } from '@/src/db/repos/grooves';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { playlistShare } from '@/src/share/share';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button, IconButton } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * A single Groove: what is in it, why, and the ability to play the whole thing.
 *
 * Everything here is the user's own music, so there is no streaming fallback
 * and no download prompt — the audio is already on the device.
 */
export default function GrooveScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { gutter, pageWidth: width } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const share = useShareSheet();
  const downloads = useStore(downloadManager);
  const player = useStore(playerStore);

  const state = useAsync(async () => {
    const groove = await getGroove(id!);
    if (!groove) throw new Error('That Groove no longer exists.');
    const tracks = await getGrooveTracks(groove.id);
    return { groove, tracks };
  }, [id]);

  const groove = state.data?.groove;
  const tracks: Track[] = state.data?.tracks ?? [];
  const accent = groove?.accent ?? colors.accent;

  if (state.error) {
    return (
      <Screen>
        <PageHeader />
        <ErrorState error={state.error} onRetry={state.reload} />
      </Screen>
    );
  }

  const play = (shuffle: boolean) => {
    if (tracks.length === 0) return;
    void playerStore.playQueue(tracks, {
      context: 'mood',
      contextLabel: groove?.name ?? 'Groove',
      shuffle,
    });
  };

  return (
    <Screen>
      <PageHeader transparent />
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: gutter }}>
          <LinearGradient
            colors={[`${accent}CC`, `${accent}22`, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.hero, { minHeight: Math.min(width * 0.5, 220) }]}
          >
            {groove?.coverArtworkUrl && (
              <View style={styles.heroArt}>
                <Artwork uri={groove.coverArtworkUrl} size={84} radius={radii.md} />
              </View>
            )}
            <Txt variant="micro" uppercase style={{ color: 'rgba(255,255,255,0.7)' }}>
              Groove
            </Txt>
            <Txt variant="display" numberOfLines={2}>
              {groove?.name ?? ' '}
            </Txt>
            {groove?.description ? (
              <Txt variant="body" style={{ color: 'rgba(255,255,255,0.84)' }}>
                {groove.description}
              </Txt>
            ) : null}
            <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
              {pluralize(tracks.length, 'song')}
              {groove && groove.durationMs > 0 ? ` · ${formatListeningTime(groove.durationMs)}` : ''}
            </Txt>
          </LinearGradient>

          <View style={styles.actions}>
            <Button label="Play" icon="play" disabled={tracks.length === 0} onPress={() => play(false)} />
            <IconButton name="shuffle" label="Shuffle this Groove" onPress={() => play(true)} />
            <IconButton
              name="albums-outline"
              label="Add this Groove to a playlist"
              onPress={() => actions.addToPlaylist(tracks)}
            />
            <IconButton
              name="share-outline"
              label="Share this Groove"
              onPress={() =>
                groove &&
                share(
                  playlistShare({
                    id: groove.id,
                    name: groove.name,
                    description: groove.description,
                    coverTrackId: groove.coverTrackId,
                    coverArtworkUrl: groove.coverArtworkUrl,
                    trackCount: groove.trackCount,
                    totalDurationMs: groove.durationMs,
                    visibility: 'private',
                    isSystem: true,
                    createdAt: groove.generatedAt,
                    updatedAt: groove.generatedAt,
                  }),
                )
              }
            />
          </View>

          <View style={{ marginTop: spacing.xl }}>
            {state.loading ? (
              <SkeletonRows count={6} />
            ) : tracks.length === 0 ? (
              <EmptyState icon="musical-notes-outline" title="This Groove is empty" compact />
            ) : (
              tracks.map((track, index) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  isPlaying={player.current?.id === track.id}
                  isDownloaded={downloads.byTrackId[track.id]?.status === 'completed'}
                  onPress={() =>
                    void playerStore.playQueue(tracks, {
                      startIndex: index,
                      context: 'mood',
                      contextLabel: groove?.name ?? 'Groove',
                    })
                  }
                  onMore={() => actions.openTrack(track, { queue: tracks })}
                />
              ))
            )}
          </View>

          <Txt variant="caption" tone="faint" style={{ marginTop: spacing.xl }}>
            Grooves are built from your own library. Pulse groups by genre, era and energy — it does
            not analyse the audio itself, so it never claims to know a track&apos;s tempo or key.
          </Txt>

          <Button
            label="See all Grooves"
            variant="secondary"
            style={{ alignSelf: 'flex-start', marginTop: spacing.lg }}
            onPress={() => router.replace('/grooves')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    hero: {
      borderRadius: radii.xl,
      padding: spacing.xl,
      justifyContent: 'flex-end',
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    heroArt: { position: 'absolute', top: spacing.lg, right: spacing.lg, opacity: 0.9 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg },
  });
