import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import type { Track } from '@/src/core/types';
import { getMood, MOODS } from '@/src/core/moods';
import { pluralize } from '@/src/core/format';
import { musicProvider } from '@/src/providers/music';
import { upsertTracks } from '@/src/db/repos/catalog';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { Button, IconButton } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { MoodCard } from '@/src/ui/cards';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { colors, radii, spacing } from '@/src/theme/tokens';

/**
 * A mood page.
 *
 * The mood is a query, not a hand-made playlist: Pulse asks the provider for
 * music in that mood's genres and ranks it against the mood's energy.
 */
export default function MoodScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { gutter, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const downloads = useStore(downloadManager);

  const mood = getMood(id);

  const state = useAsync<Track[]>(async () => {
    if (!mood) return [];
    const tracks = await musicProvider().getMoodTracks(mood, 40);
    void upsertTracks(tracks);
    return tracks;
  }, [id]);

  if (!mood) {
    return (
      <Screen>
        <PageHeader title="Mood" />
        <EmptyState icon="color-palette-outline" title="That mood does not exist" compact />
      </Screen>
    );
  }

  const tracks = state.data ?? [];

  return (
    <Screen>
      <PageHeader transparent />
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: gutter }}>
          <LinearGradient
            colors={[mood.accent, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Txt variant="display">{mood.name}</Txt>
            <Txt variant="body" style={{ color: 'rgba(255,255,255,0.86)' }}>
              {mood.tagline}
            </Txt>
            <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
              {mood.seeds.join(' · ')}
            </Txt>
          </LinearGradient>

          <View style={styles.actions}>
            <Button
              label="Play"
              icon="play"
              disabled={tracks.length === 0}
              onPress={() =>
                void playerStore.playQueue(tracks, {
                  context: 'mood',
                  contextLabel: `${mood.name} mood`,
                })
              }
            />
            <IconButton
              name="shuffle"
              label={`Shuffle ${mood.name}`}
              onPress={() =>
                tracks.length &&
                void playerStore.playQueue(tracks, {
                  context: 'mood',
                  contextLabel: `${mood.name} mood`,
                  shuffle: true,
                })
              }
            />
            <View style={{ flex: 1 }} />
            <Txt variant="caption" tone="muted">
              {pluralize(tracks.length, 'song')}
            </Txt>
          </View>
        </View>

        <View style={{ paddingHorizontal: gutter, marginTop: spacing.lg }}>
          {state.loading ? (
            <SkeletonRows count={8} />
          ) : state.error ? (
            <ErrorState error={state.error} onRetry={state.reload} />
          ) : tracks.length === 0 ? (
            <EmptyState
              icon="musical-notes-outline"
              title="Nothing came back for this mood"
              message="The source returned no matches. Try another mood."
              compact
            />
          ) : (
            tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                isDownloaded={downloads.byTrackId[track.id]?.status === 'completed'}
                onPress={() =>
                  void playerStore.playQueue(tracks, {
                    startIndex: index,
                    context: 'mood',
                    contextLabel: `${mood.name} mood`,
                  })
                }
                onMore={() => actions.openTrack(track, { queue: tracks })}
              />
            ))
          )}
        </View>

        <View style={{ marginTop: spacing.xxl }}>
          <SectionHeader title="Other moods" style={{ paddingHorizontal: gutter }} />
          <Shelf
            data={MOODS.filter((m) => m.id !== mood.id)}
            gutter={gutter}
            keyExtractor={(item) => item.id}
            renderItem={(item) => (
              <MoodCard
                mood={item}
                width={isTabletUp ? 200 : 150}
                onPress={() => router.replace(`/mood/${item.id}`)}
              />
            )}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radii.xl,
    padding: spacing.xxl,
    minHeight: 160,
    justifyContent: 'flex-end',
    backgroundColor: colors.card,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
});
