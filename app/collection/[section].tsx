import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/src/core/types';
import { pluralize } from '@/src/core/format';
import {
  getFavoriteTracks,
  getLibraryAlbums,
  getLibraryArtists,
  getLibraryTracks,
  type LibrarySort,
} from '@/src/db/repos/library';
import { getRecentlyPlayed } from '@/src/db/repos/history';
import { listLocalTracks } from '@/src/db/repos/local';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync, useDebounced } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Chip, IconButton } from '@/src/ui/buttons';
import { AlbumRow, ArtistRow, TrackRow } from '@/src/ui/rows';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { colors, radii, spacing } from '@/src/theme/tokens';

const TITLES: Record<string, string> = {
  all: 'All music',
  local: 'On this device',
  recent: 'Recently added',
  played: 'Recently played',
  downloads: 'Downloads',
  songs: 'Songs',
  albums: 'Albums',
  artists: 'Artists',
  favorites: 'Favorites',
};

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'duration', label: 'Length' },
];

/** One library section: search it, sort it, play it. */
export default function CollectionScreen() {
  const { section = 'all' } = useLocalSearchParams<{ section: string }>();
  const router = useRouter();
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const downloads = useStore(downloadManager);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const debounced = useDebounced(search.trim(), 250);

  const isAlbums = section === 'albums';
  const isArtists = section === 'artists';

  const data = useAsync(async () => {
    switch (section) {
      case 'local': {
        const local = await listLocalTracks();
        return { tracks: local.map((entry) => entry.track) };
      }
      case 'albums':
        return { albums: await getLibraryAlbums() };
      case 'artists':
        return { artists: await getLibraryArtists() };
      case 'played':
        return { tracks: await getRecentlyPlayed(200) };
      case 'favorites':
        return { tracks: await getFavoriteTracks(300) };
      case 'downloads':
        return { tracks: await getLibraryTracks({ sort, search: debounced, downloadedOnly: true }) };
      case 'recent':
        return { tracks: await getLibraryTracks({ sort: 'recent', search: debounced }) };
      default:
        return { tracks: await getLibraryTracks({ sort, search: debounced }) };
    }
  }, [section, sort, debounced]);

  const tracks = useMemo(() => {
    const list = data.data && 'tracks' in data.data ? (data.data.tracks as Track[]) : [];
    if (!debounced || section === 'downloads' || section === 'all' || section === 'songs') return list;
    const needle = debounced.toLowerCase();
    return list.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.artistName.toLowerCase().includes(needle) ||
        (t.albumTitle ?? '').toLowerCase().includes(needle),
    );
  }, [data.data, debounced, section]);

  const albums = data.data && 'albums' in data.data ? (data.data.albums ?? []) : [];
  const artists = data.data && 'artists' in data.data ? (data.data.artists ?? []) : [];

  const playAll = (shuffle: boolean) => {
    if (tracks.length === 0) return;
    void playerStore.playQueue(tracks, {
      context: 'library',
      contextLabel: TITLES[section] ?? 'Library',
      shuffle,
    });
  };

  return (
    <Screen>
      <PageHeader
        title={TITLES[section] ?? 'Library'}
        subtitle={
          isAlbums
            ? pluralize(albums.length, 'album')
            : isArtists
              ? pluralize(artists.length, 'artist')
              : pluralize(tracks.length, 'song')
        }
        right={
          !isAlbums && !isArtists && tracks.length > 0 ? (
            <View style={{ flexDirection: 'row' }}>
              <IconButton name="shuffle" label="Shuffle play" onPress={() => playAll(true)} />
              <IconButton
                name="play-circle"
                label="Play all"
                color={colors.accent}
                size={24}
                onPress={() => playAll(false)}
              />
            </View>
          ) : undefined
        }
      />

      {!isAlbums && !isArtists && (
        <>
          <View style={[styles.field, { marginHorizontal: gutter }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={`Search ${(TITLES[section] ?? 'library').toLowerCase()}`}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              accessibilityLabel="Search this section"
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {section !== 'played' && section !== 'favorites' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingVertical: spacing.md }}
            >
              {SORTS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  active={sort === option.value}
                  onPress={() => setSort(option.value)}
                />
              ))}
            </ScrollView>
          )}
        </>
      )}

      {data.loading && !data.data ? (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonRows count={8} />
        </View>
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : isAlbums ? (
        <FlatList
          data={albums}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
          renderItem={({ item }) => (
            <AlbumRow album={item} onPress={() => router.push(`/album/${encodeURIComponent(item.id)}`)} />
          )}
          ListEmptyComponent={<EmptyState icon="disc-outline" title="No albums saved yet" compact />}
        />
      ) : isArtists ? (
        <FlatList
          data={artists}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
          renderItem={({ item }) => (
            <ArtistRow
              artist={item}
              detail={pluralize(item.trackCount, 'song')}
              onPress={() => router.push(`/artist/${encodeURIComponent(item.id)}`)}
            />
          )}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No artists yet" compact />}
        />
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
          initialNumToRender={14}
          windowSize={8}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              isDownloaded={downloads.byTrackId[item.id]?.status === 'completed'}
              onPress={() =>
                void playerStore.playQueue(tracks, {
                  startIndex: index,
                  context: 'library',
                  contextLabel: TITLES[section] ?? 'Library',
                })
              }
              onMore={() => actions.openTrack(item, { queue: tracks })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes-outline"
              title={debounced ? 'Nothing matches that' : 'Nothing here yet'}
              message={
                debounced
                  ? 'Try a different word.'
                  : 'Save or download music and it will appear in this section.'
              }
              actionLabel={debounced ? undefined : 'Find music'}
              onAction={debounced ? undefined : () => router.push('/discover')}
              compact
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
});
