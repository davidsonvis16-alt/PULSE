import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { pluralize } from '@/src/core/format';
import { fetchSharedPlaylist } from '@/src/share/shared-playlists';
import { addTracksToPlaylist, createPlaylist } from '@/src/db/repos/playlists';
import { playerStore } from '@/src/audio/player';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useTrackActions } from '@/src/ui/track-actions';
import { useToast } from '@/src/ui/toast';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { spacing } from '@/src/theme/tokens';

/**
 * A playlist someone shared with a link. Anyone signed in can play it, and
 * save their own copy into their library.
 */
export default function SharedPlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const actions = useTrackActions();
  const { gutter, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const [saving, setSaving] = useState(false);

  const state = useAsync(() => fetchSharedPlaylist(id!), [id]);
  const playlist = state.data;
  const tracks = playlist?.tracks ?? [];

  const play = (index: number, shuffle = false) =>
    void playerStore.playQueue(tracks, {
      startIndex: index,
      context: 'playlist',
      contextLabel: playlist?.name ?? 'Shared playlist',
      shuffle,
    });

  const save = async () => {
    if (!playlist) return;
    setSaving(true);
    try {
      const mine = await createPlaylist(playlist.name, playlist.description ?? undefined);
      await addTracksToPlaylist(mine.id, tracks);
      toast('Saved to your library', 'success');
      router.push(`/playlist/${mine.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save it', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <PageHeader title={playlist?.name ?? 'Shared playlist'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}>
        {state.loading && !playlist ? (
          <SkeletonRows count={8} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : !playlist ? null : (
          <>
            <View style={styles.hero}>
              <Artwork uri={playlist.artworkUrl} size={isTabletUp ? 200 : 150} />
              <View style={{ flex: 1, minWidth: 180, gap: spacing.xs }}>
                <Txt variant="micro" tone="muted" uppercase>
                  Shared playlist
                </Txt>
                <Txt variant="display" numberOfLines={2}>
                  {playlist.name}
                </Txt>
                <Txt variant="callout" tone="muted">
                  By {playlist.ownerName} · {pluralize(tracks.length, 'song')}
                </Txt>
                {!!playlist.description && (
                  <Txt variant="body" tone="secondary" numberOfLines={3}>
                    {playlist.description}
                  </Txt>
                )}
                <View style={styles.actions}>
                  <Button label="Play" icon="play" disabled={!tracks.length} onPress={() => play(0)} />
                  <Button
                    label="Shuffle"
                    icon="shuffle"
                    variant="secondary"
                    disabled={!tracks.length}
                    onPress={() => play(0, true)}
                  />
                  <Button
                    label="Save to my library"
                    icon="add"
                    variant="secondary"
                    loading={saving}
                    disabled={!tracks.length}
                    onPress={() => void save()}
                  />
                </View>
              </View>
            </View>

            {tracks.length === 0 ? (
              <EmptyState icon="musical-notes-outline" title="This playlist is empty" compact />
            ) : (
              tracks.map((track, index) => (
                <TrackRow
                  key={`${track.id}-${index}`}
                  track={track}
                  onPress={() => play(index)}
                  onMore={() => actions.openTrack(track, { queue: tracks })}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl, marginBottom: spacing.xl, alignItems: 'flex-end' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
});
