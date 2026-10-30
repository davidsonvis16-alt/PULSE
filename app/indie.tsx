import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatCount } from '@/src/core/format';
import {
  INDIE_GENRES,
  indieTrending,
  indieUnderground,
  searchIndie,
  type IndieTrack,
} from '@/src/providers/music/adapters/audius';
import { oneCoverEach } from '@/src/discovery/variety';
import { playerStore } from '@/src/audio/player';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useTrackActions } from '@/src/ui/track-actions';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Chip } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { Shelf } from '@/src/ui/section';
import { DiscoveryCard } from '@/src/ui/editorial';
import { Txt } from '@/src/ui/text';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

/**
 * Indie: music put online by the people who made it.
 *
 * Everything here comes from Audius, where independent artists upload their
 * own songs to be streamed in full — so these play whole, not as previews.
 * People who make music can put their own on Pulse Radio from here too.
 */
export default function IndieScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const actions = useTrackActions();
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const [genre, setGenre] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const trending = useAsync(() => indieTrending(genre ?? undefined, 30), [genre]);
  const rising = useAsync(() => indieUnderground(20), []);
  const results = useAsync(() => searchIndie(submitted, 30), [submitted], { enabled: !!submitted });

  const play = (tracks: IndieTrack[], index: number, label: string) =>
    void playerStore.playQueue(tracks, { startIndex: index, context: 'recommendation', contextLabel: label });

  const searching = !!submitted;
  const list = searching ? (results.data ?? []) : (trending.data ?? []);
  const listState = searching ? results : trending;
  const risingTracks = oneCoverEach(rising.data ?? []) as IndieTrack[];

  return (
    <Screen>
      <PageHeader title="Indie" subtitle="Music put online by the artists who made it" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: gutter, gap: spacing.md }}>
          <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                if (!text.trim()) setSubmitted('');
              }}
              onSubmitEditing={() => setSubmitted(query.trim())}
              returnKeyType="search"
              placeholder="Search independent artists and songs"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Search independent music"
              style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 }}
            />
          </View>

          {/* Making music? Put it on Pulse. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Upload your own music to Pulse Radio"
            onPress={() => router.push('/freestyle')}
            style={({ pressed }) => [
              styles.upload,
              { borderColor: colors.border, backgroundColor: colors.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={[styles.uploadIcon, { backgroundColor: colors.accent }]}>
              <Ionicons name="cloud-upload-outline" size={20} color={colors.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="callout">Upload your own music</Txt>
              <Txt variant="caption" tone="muted">
                Songs you made go on Pulse Radio, and into the weekly vote.
              </Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {!searching && (
          <>
            {!!risingTracks.length && (
              <View style={{ marginTop: spacing.xl }}>
                <Txt variant="title2" style={{ paddingHorizontal: gutter }}>
                  Rising artists
                </Txt>
                <Txt variant="caption" tone="muted" style={{ paddingHorizontal: gutter, marginBottom: spacing.md }}>
                  Catching on before most people have heard of them
                </Txt>
                <Shelf
                  data={risingTracks}
                  gutter={gutter}
                  keyExtractor={(track) => track.id}
                  renderItem={(track) => (
                    <DiscoveryCard
                      track={track}
                      width={148}
                      onPlay={() => play(risingTracks, risingTracks.indexOf(track), 'Rising artists')}
                      onMore={() => actions.openTrack(track, { queue: risingTracks })}
                    />
                  )}
                />
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingVertical: spacing.lg }}
            >
              <Chip label="All" active={!genre} onPress={() => setGenre(null)} />
              {INDIE_GENRES.map((name) => (
                <Chip key={name} label={name} active={genre === name} onPress={() => setGenre(name)} />
              ))}
            </ScrollView>
          </>
        )}

        <View style={{ paddingHorizontal: gutter, marginTop: searching ? spacing.lg : 0 }}>
          <Txt variant="title2" style={{ marginBottom: spacing.sm }}>
            {searching ? `Results for “${submitted}”` : genre ? `Trending in ${genre}` : 'Trending this week'}
          </Txt>
          {listState.loading && !listState.data ? (
            <SkeletonRows count={8} />
          ) : listState.error ? (
            <ErrorState error={listState.error} onRetry={listState.reload} />
          ) : list.length === 0 ? (
            <EmptyState icon="musical-notes-outline" title="Nothing here yet" message="Try another search or genre." compact />
          ) : (
            list.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                subtitleOverride={
                  track.plays != null
                    ? `${track.artistName} · ${formatCount(track.plays)} plays`
                    : track.artistName
                }
                onPress={() => play(list, index, searching ? 'Indie search' : 'Indie')}
                onMore={() => actions.openTrack(track, { queue: list })}
              />
            ))
          )}
          <Txt variant="caption" tone="faint" style={{ marginTop: spacing.lg }}>
            Independent music from Audius, played in full.
          </Txt>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  upload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  uploadIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
