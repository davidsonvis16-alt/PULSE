import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SketchArt } from '@/src/ui/sketch-art';
import type { Track } from '@/src/core/types';
import { getMood, MOODS } from '@/src/core/moods';
import { pluralize } from '@/src/core/format';
import { loadMoodCovers, refreshMoodMix, savedMoodMix } from '@/src/discovery/mood-mix';
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
import { radii, spacing } from '@/src/theme/tokens';
import { useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * A mood page.
 *
 * Each mood is a playlist kept for this listener (see discovery/mood-mix):
 * songs they have played are swapped for new ones, and a third is renewed
 * every day. The saved mix shows at once, then the refreshed one replaces it.
 */
export default function MoodScreen() {
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { gutter, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const downloads = useStore(downloadManager);

  const mood = getMood(id);

  const saved = useAsync<Track[]>(async () => (mood ? savedMoodMix(mood) : []), [id]);
  const state = useAsync(async () => (mood ? refreshMoodMix(mood) : null), [id]);
  const covers = useAsync(() => loadMoodCovers(), []);

  if (!mood) {
    return (
      <Screen>
        <PageHeader title="Mood" />
        <EmptyState icon="color-palette-outline" title="That mood does not exist" compact />
      </Screen>
    );
  }

  const tracks = state.data?.tracks ?? saved.data ?? [];
  const fresh = state.data?.fresh ?? 0;
  const cover = covers.data?.find((c) => c.moodId === mood.id);

  return (
    <Screen>
      <PageHeader transparent />
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: gutter }}>
          <View style={[styles.hero, { backgroundColor: mood.accent }]}>
            {!!cover?.imageUrl && <SketchArt uri={cover.imageUrl} />}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.72)']}
              start={{ x: 0, y: 0.2 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Txt variant="display" style={{ color: '#fff' }}>
              {mood.name} mix
            </Txt>
            <Txt variant="body" style={{ color: 'rgba(255,255,255,0.86)' }}>
              {mood.tagline}
            </Txt>
            <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)', marginTop: 6 }}>
              {fresh > 0
                ? `${pluralize(fresh, 'new song')} since you last looked. Songs you play make way for new ones.`
                : 'Made for you. Songs you play make way for new ones.'}
            </Txt>
          </View>

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
          {state.loading && tracks.length === 0 ? (
            <SkeletonRows count={8} />
          ) : state.error && tracks.length === 0 ? (
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
                imageUrl={covers.data?.find((c) => c.moodId === item.id)?.imageUrl}
                onPress={() => router.replace(`/mood/${item.id}`)}
              />
            )}
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
      padding: spacing.xxl,
      minHeight: 240,
      justifyContent: 'flex-end',
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  });
