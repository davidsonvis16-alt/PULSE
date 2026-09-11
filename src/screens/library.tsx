import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pluralize } from '@/src/core/format';
import { getLibraryCounts, getRecentlyAdded } from '@/src/db/repos/library';
import { createPlaylist, listPlaylists, type Playlist } from '@/src/db/repos/playlists';
import { playerStore } from '@/src/audio/player';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button, SegmentedControl } from '@/src/ui/buttons';
import { Shelf } from '@/src/ui/section';
import { TrackCard } from '@/src/ui/cards';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { Sheet } from '@/src/ui/sheet';
import { DownloadsScreen } from '@/src/screens/downloads';
import { colors, radii, spacing } from '@/src/theme/tokens';

type Tab = 'music' | 'downloaded' | 'playlists';

type IconName = keyof typeof Ionicons.glyphMap;

const SECTIONS: { id: string; title: string; icon: IconName }[] = [
  { id: 'all', title: 'All music', icon: 'musical-notes-outline' },
  { id: 'recent', title: 'Recently added', icon: 'time-outline' },
  { id: 'played', title: 'Recently played', icon: 'play-circle-outline' },
  { id: 'downloads', title: 'Downloads', icon: 'arrow-down-circle-outline' },
  { id: 'songs', title: 'Songs', icon: 'musical-note-outline' },
  { id: 'albums', title: 'Albums', icon: 'disc-outline' },
  { id: 'artists', title: 'Artists', icon: 'people-outline' },
  { id: 'favorites', title: 'Favorites', icon: 'heart-outline' },
];

/** The user's own music: what they saved, downloaded, liked and built. */
export function LibraryScreen() {
  const router = useRouter();
  const { gutter, shelfCardWidth } = useResponsive();
  const bottomInset = useBottomInset();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('music');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const data = useAsync(
    async () => {
      const [counts, recentlyAdded, playlists] = await Promise.all([
        getLibraryCounts(),
        getRecentlyAdded(12),
        listPlaylists(),
      ]);
      return { counts, recentlyAdded, playlists };
    },
    [],
  );

  useFocusReload(data.reload);

  const create = useCallback(async () => {
    try {
      const playlist = await createPlaylist(newName);
      setCreating(false);
      setNewName('');
      data.reload();
      router.push(`/playlist/${playlist.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create the playlist', 'error');
    }
  }, [newName, data, router, toast]);

  const counts = data.data?.counts;

  return (
    <Screen>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <Txt variant="title1">Library</Txt>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search your library"
          hitSlop={8}
          onPress={() => router.push('/collection/all')}
        >
          <Ionicons name="search-outline" size={21} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Downloads"
          hitSlop={8}
          onPress={() => setTab('downloaded')}
        >
          <Ionicons name="arrow-down-circle-outline" size={21} color={colors.text} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: gutter, marginBottom: spacing.lg }}>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'music', label: 'All music' },
            { value: 'downloaded', label: 'Downloaded' },
            { value: 'playlists', label: 'Playlists' },
          ]}
        />
      </View>

      {tab === 'downloaded' ? (
        <DownloadsScreen embedded />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomInset }}
          showsVerticalScrollIndicator={false}
        >
          {data.loading && !data.data ? (
            <View style={{ paddingHorizontal: gutter }}>
              <SkeletonRows count={7} height={48} />
            </View>
          ) : data.error ? (
            <ErrorState error={data.error} onRetry={data.reload} />
          ) : tab === 'music' ? (
            <>
              <View style={{ paddingHorizontal: gutter }}>
                {SECTIONS.map((section) => (
                  <Pressable
                    key={section.id}
                    accessibilityRole="button"
                    accessibilityLabel={section.title}
                    onPress={() => router.push(`/collection/${section.id}`)}
                    style={({ pressed }) => [styles.sectionRow, pressed && { opacity: 0.65 }]}
                  >
                    <View style={styles.sectionIcon}>
                      <Ionicons name={section.icon} size={18} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{section.title}</Txt>
                      <Txt variant="caption" tone="muted">
                        {countLabel(section.id, counts)}
                      </Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  </Pressable>
                ))}
              </View>

              {!!data.data?.recentlyAdded.length && (
                <View style={{ marginTop: spacing.xxl }}>
                  <Txt variant="title3" style={{ paddingHorizontal: gutter, marginBottom: spacing.md }}>
                    Recently added
                  </Txt>
                  <Shelf
                    data={data.data.recentlyAdded}
                    gutter={gutter}
                    keyExtractor={(item) => item.id}
                    renderItem={(item, index) => (
                      <TrackCard
                        track={item}
                        width={shelfCardWidth}
                        onPress={() =>
                          void playerStore.playQueue(data.data!.recentlyAdded, {
                            startIndex: index,
                            context: 'library',
                            contextLabel: 'Recently added',
                          })
                        }
                      />
                    )}
                  />
                </View>
              )}

              {counts && counts.tracks === 0 && counts.downloads === 0 && (
                <EmptyState
                  icon="library-outline"
                  title="Your library is empty"
                  message="Save or download a song and it shows up here, with its artwork and details already filled in."
                  actionLabel="Find music"
                  onAction={() => router.push('/discover')}
                />
              )}
            </>
          ) : (
            <View style={{ paddingHorizontal: gutter }}>
              <Button
                label="Create playlist"
                icon="add"
                onPress={() => setCreating(true)}
                style={{ alignSelf: 'flex-start', marginBottom: spacing.lg }}
              />
              {(data.data?.playlists ?? []).map((playlist) => (
                <PlaylistRow
                  key={playlist.id}
                  playlist={playlist}
                  onPress={() => router.push(`/playlist/${playlist.id}`)}
                />
              ))}
              {data.data?.playlists.length === 0 && (
                <EmptyState
                  icon="albums-outline"
                  title="No playlists yet"
                  message="Build one from anything you find, and Pulse will suggest songs that fit it."
                  compact
                />
              )}
            </View>
          )}
        </ScrollView>
      )}

      <Sheet visible={creating} onClose={() => setCreating(false)} title="New playlist">
        <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Playlist name"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            maxLength={80}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={create}
          />
          <Button label="Create" full onPress={create} disabled={newName.trim().length === 0} />
        </View>
      </Sheet>
    </Screen>
  );
}

function PlaylistRow({ playlist, onPress }: { playlist: Playlist; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playlist.name}
      onPress={onPress}
      style={({ pressed }) => [styles.playlistRow, pressed && { opacity: 0.7 }]}
    >
      <Artwork uri={playlist.coverArtworkUrl} size={52} radius={radii.sm} />
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {playlist.name}
        </Txt>
        <Txt variant="caption" tone="muted">
          {pluralize(playlist.trackCount, 'song')}
        </Txt>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function countLabel(sectionId: string, counts?: Awaited<ReturnType<typeof getLibraryCounts>>) {
  if (!counts) return ' ';
  switch (sectionId) {
    case 'all':
    case 'songs':
      return pluralize(counts.tracks, 'song');
    case 'albums':
      return pluralize(counts.albums, 'album');
    case 'artists':
      return pluralize(counts.artists, 'artist');
    case 'downloads':
      return pluralize(counts.downloads, 'song');
    case 'favorites':
      return pluralize(counts.favorites, 'song');
    case 'recent':
      return 'Newest first';
    case 'played':
      return 'Your listening history';
    default:
      return ' ';
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11 },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
