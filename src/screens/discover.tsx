import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { SearchResults, Track } from '@/src/core/types';
import { MOODS } from '@/src/core/moods';
import { config } from '@/src/core/config';
import { formatDuration } from '@/src/core/format';
import { musicProvider } from '@/src/providers/music';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { addTrackToLibrary, isInLibrary } from '@/src/db/repos/library';
import { getRecentSearches, recordSearch, clearSearchHistory } from '@/src/db/repos/settings';
import { listPlaylists, type Playlist } from '@/src/db/repos/playlists';
import { useAsync, useDebounced } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { trackShare } from '@/src/share/share';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Chip } from '@/src/ui/buttons';
import { AlbumRow, ArtistRow } from '@/src/ui/rows';
import { MoodCard } from '@/src/ui/cards';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { colors, radii, spacing } from '@/src/theme/tokens';

type Filter = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' },
  { value: 'albums', label: 'Albums' },
  { value: 'playlists', label: 'Playlists' },
];

/**
 * Search and discovery.
 *
 * Results come straight from the configured provider — real titles, real
 * artists, real cover art. Each row carries the four things a listener wants to
 * do with a result without opening it first: play, download, add, share.
 */
export function DiscoverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const { gutter, shelfCardWidth, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();

  const [query, setQuery] = useState(params.q ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const inputRef = useRef<TextInput>(null);
  const debounced = useDebounced(query.trim(), 350);

  const provider = musicProvider();

  const results = useAsync<SearchResults | null>(
    async (signal) => {
      if (debounced.length < 2) return null;
      const found = await provider.searchAll(debounced, {
        limit: 25,
        country: config.music.country,
        signal,
      });
      void recordSearch(debounced);
      return found;
    },
    [debounced],
  );

  const playlistMatches = useAsync<Playlist[]>(
    async () => {
      if (debounced.length < 2) return [];
      const all = await listPlaylists();
      const needle = debounced.toLowerCase();
      return all.filter((p) => p.name.toLowerCase().includes(needle));
    },
    [debounced],
  );

  const recents = useAsync(() => getRecentSearches(8), [debounced.length === 0]);

  const showBrowse = debounced.length < 2;

  return (
    <Screen>
      {/* Search field */}
      <View style={[styles.searchRow, { paddingHorizontal: gutter }]}>
        <View style={styles.field}>
          <Ionicons name="search" size={17} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Artists, songs, albums, genres"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search music"
            clearButtonMode="never"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        {query.length > 0 && (
          <Pressable
            onPress={() => {
              setQuery('');
              inputRef.current?.blur();
            }}
            accessibilityRole="button"
          >
            <Txt variant="callout" tone="secondary">
              Cancel
            </Txt>
          </Pressable>
        )}
      </View>

      {/* Filters */}
      {!showBrowse && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingBottom: spacing.md }}
        >
          {FILTERS.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              active={filter === item.value}
              onPress={() => setFilter(item.value)}
            />
          ))}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {showBrowse ? (
          <BrowseState
            gutter={gutter}
            cardWidth={isTabletUp ? 200 : 150}
            recents={recents.data ?? []}
            onPick={(value) => setQuery(value)}
            onClearRecents={async () => {
              await clearSearchHistory();
              recents.reload();
            }}
            onMood={(id) => router.push(`/mood/${id}`)}
            providerName={provider.name}
          />
        ) : results.loading ? (
          <View style={{ paddingHorizontal: gutter, paddingTop: spacing.md }}>
            <SkeletonRows count={7} />
          </View>
        ) : results.error ? (
          <ErrorState error={results.error} onRetry={results.reload} />
        ) : (
          <SearchResultsView
            query={debounced}
            filter={filter}
            results={results.data}
            playlists={playlistMatches.data ?? []}
            gutter={gutter}
            shelfCardWidth={shelfCardWidth}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function BrowseState({
  gutter,
  cardWidth,
  recents,
  onPick,
  onClearRecents,
  onMood,
  providerName,
}: {
  gutter: number;
  cardWidth: number;
  recents: string[];
  onPick: (value: string) => void;
  onClearRecents: () => void;
  onMood: (id: string) => void;
  providerName: string;
}) {
  const trending = useAsync(() => musicProvider().getTrending(12), []);
  const router = useRouter();

  return (
    <View style={{ gap: spacing.xxl, paddingTop: spacing.sm }}>
      {recents.length > 0 && (
        <View>
          <SectionHeader
            title="Recent searches"
            actionLabel="Clear"
            onAction={onClearRecents}
            style={{ paddingHorizontal: gutter }}
          />
          <View style={{ paddingHorizontal: gutter, gap: 2 }}>
            {recents.map((item) => (
              <Pressable
                key={item}
                onPress={() => onPick(item)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.recent, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                <Txt variant="body" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
                  {item}
                </Txt>
                <Ionicons name="arrow-up-outline" size={14} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View>
        <SectionHeader
          title="Find your mood"
          subtitle="Music for every moment"
          style={{ paddingHorizontal: gutter }}
        />
        <Shelf
          data={MOODS}
          gutter={gutter}
          keyExtractor={(mood) => mood.id}
          renderItem={(mood) => (
            <MoodCard mood={mood} width={cardWidth} onPress={() => onMood(mood.id)} />
          )}
        />
      </View>

      <View>
        <SectionHeader
          title="Charting now"
          subtitle={`Most played on ${providerName}`}
          style={{ paddingHorizontal: gutter }}
        />
        {trending.loading ? (
          <View style={{ paddingHorizontal: gutter }}>
            <SkeletonRows count={4} />
          </View>
        ) : trending.error ? (
          <ErrorState error={trending.error} onRetry={trending.reload} compact />
        ) : (
          <View style={{ paddingHorizontal: gutter }}>
            {(trending.data ?? []).slice(0, 8).map((album) => (
              <AlbumRow
                key={album.id}
                album={album}
                onPress={() => router.push(`/album/${encodeURIComponent(album.id)}`)}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function SearchResultsView({
  query,
  filter,
  results,
  playlists,
  gutter,
  shelfCardWidth,
}: {
  query: string;
  filter: Filter;
  results: SearchResults | null | undefined;
  playlists: Playlist[];
  gutter: number;
  shelfCardWidth: number;
}) {
  const router = useRouter();

  const nothing =
    !results ||
    (results.tracks.length === 0 &&
      results.artists.length === 0 &&
      results.albums.length === 0 &&
      playlists.length === 0);

  if (nothing) {
    return (
      <EmptyState
        icon="search-outline"
        title={`No results for "${query}"`}
        message="Check the spelling, or try the artist's name on its own."
      />
    );
  }

  const showTracks = filter === 'all' || filter === 'songs';
  const showArtists = filter === 'all' || filter === 'artists';
  const showAlbums = filter === 'all' || filter === 'albums';
  const showPlaylists = filter === 'all' || filter === 'playlists';

  const topArtist = results!.artists[0];

  return (
    <View style={{ gap: spacing.xxl, paddingTop: spacing.xs }}>
      {showArtists && topArtist && filter === 'all' && (
        <View style={{ paddingHorizontal: gutter }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${topArtist.name}`}
            onPress={() => router.push(`/artist/${encodeURIComponent(topArtist.id)}`)}
            style={({ pressed }) => [styles.topResult, pressed && { opacity: 0.85 }]}
          >
            <Artwork uri={topArtist.imageUrl} size={64} rounded />
            <View style={{ flex: 1 }}>
              <Txt variant="micro" tone="accent" uppercase>
                Top result
              </Txt>
              <Txt variant="title3" numberOfLines={1}>
                {topArtist.name}
              </Txt>
              <Txt variant="caption" tone="muted">
                Artist{topArtist.genre ? ` · ${topArtist.genre}` : ''}
              </Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        </View>
      )}

      {showTracks && results!.tracks.length > 0 && (
        <View>
          <SectionHeader title="Songs" style={{ paddingHorizontal: gutter }} />
          <View style={{ paddingHorizontal: gutter }}>
            {results!.tracks.slice(0, filter === 'songs' ? 50 : 8).map((track, index) => (
              <SearchTrackRow
                key={track.id}
                track={track}
                queue={results!.tracks}
                index={index}
              />
            ))}
          </View>
        </View>
      )}

      {showArtists && results!.artists.length > (filter === 'all' ? 1 : 0) && (
        <View>
          <SectionHeader title="Artists" style={{ paddingHorizontal: gutter }} />
          {filter === 'artists' ? (
            <View style={{ paddingHorizontal: gutter }}>
              {results!.artists.map((artist) => (
                <ArtistRow
                  key={artist.id}
                  artist={artist}
                  onPress={() => router.push(`/artist/${encodeURIComponent(artist.id)}`)}
                />
              ))}
            </View>
          ) : (
            <Shelf
              data={results!.artists.slice(1)}
              gutter={gutter}
              keyExtractor={(artist) => artist.id}
              renderItem={(artist) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/artist/${encodeURIComponent(artist.id)}`)}
                  style={{ width: shelfCardWidth * 0.78, alignItems: 'center' }}
                >
                  <Artwork uri={artist.imageUrl} size={shelfCardWidth * 0.78} rounded />
                  <Txt variant="callout" numberOfLines={1} align="center" style={{ marginTop: 8 }}>
                    {artist.name}
                  </Txt>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {showAlbums && results!.albums.length > 0 && (
        <View>
          <SectionHeader title="Albums" style={{ paddingHorizontal: gutter }} />
          <View style={{ paddingHorizontal: gutter }}>
            {results!.albums.slice(0, filter === 'albums' ? 40 : 6).map((album) => (
              <AlbumRow
                key={album.id}
                album={album}
                onPress={() => router.push(`/album/${encodeURIComponent(album.id)}`)}
              />
            ))}
          </View>
        </View>
      )}

      {showPlaylists && (
        <View>
          <SectionHeader title="Your playlists" style={{ paddingHorizontal: gutter }} />
          <View style={{ paddingHorizontal: gutter }}>
            {playlists.length === 0 ? (
              <Txt variant="caption" tone="muted">
                None of your playlists match that.
              </Txt>
            ) : (
              playlists.map((playlist) => (
                <Pressable
                  key={playlist.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/playlist/${playlist.id}`)}
                  style={({ pressed }) => [styles.playlistRow, pressed && { opacity: 0.7 }]}
                >
                  <Artwork uri={playlist.coverArtworkUrl} size={48} radius={radii.sm} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {playlist.name}
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      {playlist.trackCount} songs
                    </Txt>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/** A result row carrying its own quick actions: play, download, add, share. */
function SearchTrackRow({ track, queue, index }: { track: Track; queue: Track[]; index: number }) {
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();
  const downloads = useStore(downloadManager);
  const [added, setAdded] = useState(false);

  const record = downloads.byTrackId[track.id];
  const downloaded = record?.status === 'completed';
  const downloading = record?.status === 'downloading' || record?.status === 'queued';
  const canDownload = musicProvider().capabilities.download;

  useEffect(() => {
    let cancelled = false;
    void isInLibrary('track', track.id).then((value) => {
      if (!cancelled) setAdded(value);
    });
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  return (
    <View style={styles.resultRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${track.title} by ${track.artistName}`}
        onPress={() =>
          void playerStore.playQueue(queue, {
            startIndex: index,
            context: 'search',
            contextLabel: 'Search results',
          })
        }
        onLongPress={() => actions.openTrack(track, { queue })}
        style={({ pressed }) => [styles.resultMain, pressed && { opacity: 0.7 }]}
      >
        <Artwork uri={track.artworkUrl} size={48} radius={radii.sm} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {track.title}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {[track.artistName, track.albumTitle].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <Txt variant="caption" tone="faint">
          {formatDuration(track.durationMs)}
        </Txt>
      </Pressable>

      <View style={styles.quickActions}>
        {canDownload && (
          <QuickAction
            icon={downloaded ? 'checkmark-circle' : downloading ? 'time-outline' : 'arrow-down-circle-outline'}
            label={downloaded ? 'Downloaded' : 'Download'}
            active={downloaded}
            onPress={() => {
              if (downloaded) {
                toast('Already in your downloads');
                return;
              }
              void actions.download(track);
            }}
          />
        )}
        <QuickAction
          icon={added ? 'checkmark-circle' : 'add-circle-outline'}
          label={added ? 'In your library' : 'Add to library'}
          active={added}
          onPress={async () => {
            if (added) {
              toast('Already in your library');
              return;
            }
            await addTrackToLibrary(track);
            setAdded(true);
            toast('Added to your library', 'success');
          }}
        />
        <QuickAction
          icon="share-outline"
          label="Share"
          onPress={() => share(trackShare(track))}
        />
        <QuickAction
          icon="ellipsis-vertical"
          label="More options"
          onPress={() => actions.openTrack(track, { queue })}
        />
      </View>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.quick, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11 },
  topResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  resultRow: { paddingVertical: 6 },
  resultMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  quickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingLeft: 60,
    paddingTop: 6,
  },
  quick: { padding: 2 },
  playlistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
});
