import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Album, MusicEvent, Track } from '@/src/core/types';
import { MOODS } from '@/src/core/moods';
import { formatListeningTime, greeting, pluralize } from '@/src/core/format';
import { eventProvider } from '@/src/providers/events';
import { musicProvider } from '@/src/providers/music';
import { config } from '@/src/core/config';
import {
  buildTasteProfile,
  getContinueRail,
  getRecommendationShelves,
  getRepeatPlayShelves,
  type RecommendationShelf,
} from '@/src/discovery/engine';
import type { TasteProfile } from '@/src/discovery/taste';
import { getNewReleasesFromFollowed } from '@/src/discovery/releases';
import { advanceRotation, currentRotation } from '@/src/discovery/rotation';
import { buildMix, YOUR_MIX_DESCRIPTION, YOUR_MIX_ID, YOUR_MIX_NAME } from '@/src/discovery/mix';
import { chartsStore, CHART_MARKET_COUNT, type ChartEntry } from '@/src/discovery/charts';
import { getTopArtists, getTopTracks, type TopArtist } from '@/src/db/repos/history';
import { unreadNotificationCount } from '@/src/db/repos/notifications';
import { getCachedEvents } from '@/src/db/repos/events';
import { listGrooves, type Groove } from '@/src/db/repos/grooves';
import { getLocalCounts, listLocalTracks } from '@/src/db/repos/local';
import { getLibraryTracks } from '@/src/db/repos/library';
import { listPlaylists, saveSystemPlaylist, type Playlist } from '@/src/db/repos/playlists';
import { getSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { playerStore } from '@/src/audio/player';
import { ingestEngine } from '@/src/ingestion/ingest';
import { artworkRepair } from '@/src/ingestion/artwork/backfill';
import { useAuth } from '@/src/auth/auth';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { AlbumCard, ArtCard, EventCard, MoodCard, TrackCard } from '@/src/ui/cards';
import { ChartRow } from '@/src/ui/chart-row';
import { Artwork } from '@/src/ui/artwork';
import { ProfileAvatar } from '@/src/ui/profile-avatar';
import { Txt } from '@/src/ui/text';
import { EmptyState, ErrorState, SkeletonShelf } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Everything that comes out of the device's own database.
 *
 * This is what draws the page. None of it touches the network, so it is ready
 * in milliseconds and the user sees their own music straight away.
 */
interface LocalHome {
  /** The user's own songs, most played first — what Your Mix is built from. */
  own: Track[];
  counts: Awaited<ReturnType<typeof getLocalCounts>>;
  recentlyPlayed: Track[];
  taste: TasteProfile;
  topArtists: TopArtist[];
  grooves: Groove[];
  /** Playlists the user made. Pulse's own (Your Mix) are shown separately. */
  playlists: Playlist[];
  unread: number;
}

/** Suggestions, which need the taste profile first and then the catalogue. */
interface Suggestions {
  shelves: RecommendationShelf[];
  /** Built from songs played more than once — the strongest signal there is. */
  repeatShelves: RecommendationShelf[];
  mix: Track[];
}

/** What the catalogue itself says is new and charting. */
interface Catalogue {
  charts: Album[];
  newReleases: Album[];
  followedReleases: boolean;
}

/** How much of the worldwide board Home shows before "see all". */
const TOP_ON_HOME = 5;

/** One tile in the quick-start grid at the top of the page. */
interface QuickTile {
  key: string;
  title: string;
  artwork: (string | null)[];
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

/**
 * Home.
 *
 * Laid out the way people expect a music app to open: a grid of the things
 * they play most, then their playlists, then rows of covers to browse. Their
 * own music is organised into playlists (Your Mix, and the Grooves Pulse finds
 * in their collection) instead of a long list of song rows, and new music sits
 * in shelves of artwork beside it.
 *
 * Nothing here is invented. A section with no data behind it is not rendered.
 */
export function HomeScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { profile } = useAuth();
  const { gutter, shelfCardWidth, width, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const ingest = useStore(ingestEngine);
  const repair = useStore(artworkRepair);

  // Which slice of this listener's taste today's shelves are drawn from. Pull
  // to refresh moves it on, so asking for more really does bring new songs
  // rather than re-fetching the ones already on screen.
  const [rotation, setRotation] = useState(currentRotation);

  const local = useAsync<LocalHome>(async () => {
    const counts = await getLocalCounts();
    const [ownFiles, topTracks] = await Promise.all([
      counts.tracks > 0 ? listLocalTracks({ limit: 1000 }) : Promise.resolve([]),
      getTopTracks('month', 50),
    ]);
    const library = ownFiles.length
      ? ownFiles.map((entry) => entry.track)
      : await getLibraryTracks({ sort: 'recent', limit: 1000 });
    // Most played first, then everything else, so the mix leans on favourites.
    const plays = new Map(topTracks.map((entry) => [entry.track.id, entry.plays]));
    const own = [...library].sort((a, b) => (plays.get(b.id) ?? 0) - (plays.get(a.id) ?? 0));

    const [recentlyPlayed, taste, topArtists, grooves, playlists, unread] = await Promise.all([
      getContinueRail(12),
      buildTasteProfile(),
      getTopArtists('month', 10),
      listGrooves(),
      listPlaylists(),
      unreadNotificationCount(),
    ]);

    return {
      own,
      counts,
      recentlyPlayed,
      taste,
      topArtists,
      grooves,
      playlists: playlists.filter((playlist) => !playlist.isSystem),
      unread,
    };
  }, []);

  const taste = local.data?.taste;
  // Read through a ref: coming back to Home re-reads the library, and that is
  // not a reason to fetch every suggestion again.
  const ownRef = useRef<Track[]>([]);
  ownRef.current = local.data?.own ?? ownRef.current;

  const suggestions = useAsync<Suggestions>(
    async () => {
      const [shelves, repeatShelves] = await Promise.all([
        getRecommendationShelves(taste!, { rotate: rotation }).catch(
          () => [] as RecommendationShelf[],
        ),
        getRepeatPlayShelves().catch(() => [] as RecommendationShelf[]),
      ]);
      const mix = buildMix(
        ownRef.current,
        [...repeatShelves, ...shelves].map((shelf) => shelf.tracks),
        rotation,
      );
      // Saved as a real playlist, so it is in the library and can be opened,
      // downloaded and played like any other.
      if (mix.length > 0) {
        await saveSystemPlaylist(YOUR_MIX_ID, YOUR_MIX_NAME, YOUR_MIX_DESCRIPTION, mix).catch(
          () => {},
        );
      }
      return { shelves, repeatShelves, mix };
    },
    [taste, rotation],
    { enabled: !!taste },
  );

  const catalogue = useAsync<Catalogue>(async () => {
    const [charts, followed] = await Promise.all([
      musicProvider().getTrending(12).catch(() => [] as Album[]),
      getNewReleasesFromFollowed(12).catch(() => [] as Album[]),
    ]);
    // Following nobody yet is not a reason to show an empty page: fall back to
    // what is actually new in the catalogue.
    const newReleases = followed.length
      ? followed
      : await musicProvider()
          .getNewReleases({ limit: 12, country: config.music.country })
          .catch(() => [] as Album[]);
    return { charts, newReleases, followedReleases: followed.length > 0 };
  }, []);

  const events = useAsync<MusicEvent[]>(() => loadNearbyEvents().catch(() => []), []);

  // The worldwide board is shared with the charts page and cached on disk, so
  // this is usually a read rather than a fetch.
  const chart = useStore(chartsStore);
  useEffect(() => {
    void chartsStore.open();
  }, []);

  const reload = useCallback(() => {
    local.reload();
    suggestions.reload();
    catalogue.reload();
    events.reload();
    void chartsStore.refresh();
  }, [local, suggestions, catalogue, events]);

  // Coming back to Home should show what was just played or imported. That is
  // all in the local database, so only that part re-reads.
  useFocusReload(local.reload);

  const refreshing =
    local.refreshing || suggestions.refreshing || catalogue.refreshing || chart.refreshing;

  const play = useCallback(
    (tracks: Track[], index: number, label: string, fromLibrary = false, shuffle?: boolean) => {
      if (tracks.length === 0) return;
      void playerStore.playQueue(tracks, {
        startIndex: index,
        context: fromLibrary ? 'library' : 'recommendation',
        contextLabel: label,
        shuffle,
      });
    },
    [],
  );

  const data = local.data;
  const mix = useMemo(() => suggestions.data?.mix ?? [], [suggestions.data]);
  const shelves = suggestions.data?.shelves ?? [];
  const repeatShelves = suggestions.data?.repeatShelves ?? [];
  const globalTop: ChartEntry[] = chart.board?.entries.slice(0, TOP_ON_HOME) ?? [];

  /** The quick-start grid: the few things someone opens the app to play. */
  const quickTiles = useMemo<QuickTile[]>(() => {
    if (!data) return [];
    const tiles: QuickTile[] = [];
    if (mix.length) {
      tiles.push({
        key: 'mix',
        title: YOUR_MIX_NAME,
        artwork: coverOf(mix),
        onPress: () => play(mix, 0, YOUR_MIX_NAME),
      });
    }
    if (data.own.length) {
      tiles.push({
        key: 'all',
        title: 'All your songs',
        artwork: [],
        icon: 'musical-notes',
        onPress: () => play(data.own, 0, 'Your music', true, true),
      });
    }
    for (const groove of data.grooves.slice(0, 3)) {
      tiles.push({
        key: groove.id,
        title: groove.name,
        artwork: [groove.coverArtworkUrl],
        onPress: () => router.push(`/groove/${groove.id}`),
      });
    }
    for (const playlist of data.playlists.slice(0, 2)) {
      tiles.push({
        key: playlist.id,
        title: playlist.name,
        artwork: [playlist.coverArtworkUrl],
        onPress: () => router.push(`/playlist/${playlist.id}`),
      });
    }
    tiles.push({
      key: 'radio',
      title: 'Pulse Radio',
      artwork: [],
      icon: 'radio',
      onPress: () => router.push('/radio'),
    });
    return tiles.slice(0, 6);
  }, [data, mix, play, router]);

  if (local.error && !data) {
    return (
      <Screen>
        <ErrorState error={local.error} onRetry={reload} />
      </Screen>
    );
  }

  const name = profile?.displayName?.split(' ')[0];
  const importing =
    ingest.phase !== 'idle' &&
    ingest.phase !== 'done' &&
    ingest.phase !== 'error' &&
    ingest.phase !== 'cancelled';
  const tileWidth = (Math.min(width, 900) - gutter * 2 - spacing.sm) / 2;
  const coverWidth = isTabletUp ? 180 : Math.min(160, shelfCardWidth + 8);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRotation(advanceRotation());
              reload();
            }}
            tintColor={colors.accent}
          />
        }
      >
        <View style={[styles.header, { paddingHorizontal: gutter }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            onPress={() => router.push('/profile')}
          >
            <ProfileAvatar size={34} />
          </Pressable>
          <Txt variant="title2" numberOfLines={1} style={{ flex: 1 }}>
            {name ? `${greeting()}, ${name}` : greeting()}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add music from this device"
            hitSlop={8}
            onPress={() => router.push('/import')}
          >
            <Ionicons name="add" size={26} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={data?.unread ? `Notifications, ${data.unread} unread` : 'Notifications'}
            hitSlop={8}
            onPress={() => router.push('/notifications')}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {!!data?.unread && <View style={styles.dot} />}
          </Pressable>
        </View>

        {importing && (
          <Banner
            gutter={gutter}
            icon="sync-outline"
            tint={colors.accent}
            title="Importing your music…"
            detail={`${ingest.found} found · ${Math.round(ingest.progress * 100)}%`}
            onPress={() => router.push('/import')}
          />
        )}

        {!!data?.counts.needsIdentification && (
          <Banner
            gutter={gutter}
            icon="help-circle-outline"
            tint={colors.warning}
            title={`${pluralize(data.counts.needsIdentification, 'song')} need identifying`}
            detail="Pulse wasn't sure enough to name these. Tap to pick the right match."
            onPress={() => router.push('/identify')}
          />
        )}

        {repair.running && (
          <Banner
            gutter={gutter}
            icon="image-outline"
            tint={colors.accent}
            title="Finding missing covers…"
            detail={`${repair.checked} of ${repair.total} checked · ${repair.found} found`}
          />
        )}

        {local.loading && !data && (
          <View style={{ paddingHorizontal: gutter, gap: spacing.xxl }}>
            <SkeletonShelf cardWidth={shelfCardWidth} />
            <SkeletonShelf cardWidth={shelfCardWidth} />
          </View>
        )}

        {/* The quick-start grid */}
        {quickTiles.length > 1 && (
          <View style={[styles.grid, { paddingHorizontal: gutter }]}>
            {quickTiles.map((tile) => (
              <Pressable
                key={tile.key}
                accessibilityRole="button"
                accessibilityLabel={`Play ${tile.title}`}
                onPress={tile.onPress}
                style={({ pressed }) => [
                  styles.tile,
                  { width: tileWidth },
                  pressed && { opacity: 0.8 },
                ]}
              >
                {tile.icon ? (
                  <View style={styles.tileIcon}>
                    <Ionicons name={tile.icon} size={22} color={colors.onAccent} />
                  </View>
                ) : (
                  <Cover artwork={tile.artwork} size={56} radius={0} />
                )}
                <Txt variant="callout" numberOfLines={2} style={{ flex: 1 }}>
                  {tile.title}
                </Txt>
              </Pressable>
            ))}
          </View>
        )}

        {/* Their music, organised into playlists */}
        {!!data && (mix.length > 0 || data.grooves.length > 0 || data.playlists.length > 0) && (
          <Section
            title="Your playlists"
            subtitle="Made from the songs on your phone"
            gutter={gutter}
            onSeeAll={() => router.push('/library')}
          >
            <Shelf
              data={[
                ...(mix.length
                  ? [{ key: YOUR_MIX_ID, title: YOUR_MIX_NAME, subtitle: 'Yours + new picks', artwork: coverOf(mix), href: `/playlist/${YOUR_MIX_ID}` }]
                  : []),
                ...data.grooves.map((groove) => ({
                  key: groove.id,
                  title: groove.name,
                  subtitle: pluralize(groove.trackCount, 'song'),
                  artwork: [groove.coverArtworkUrl],
                  href: `/groove/${groove.id}`,
                })),
                ...data.playlists.map((playlist) => ({
                  key: playlist.id,
                  title: playlist.name,
                  subtitle: pluralize(playlist.trackCount, 'song'),
                  artwork: [playlist.coverArtworkUrl],
                  href: `/playlist/${playlist.id}`,
                })),
              ]}
              gutter={gutter}
              keyExtractor={(item) => item.key}
              renderItem={(item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                  onPress={() => router.push(item.href as never)}
                  style={({ pressed }) => [{ width: coverWidth }, pressed && { opacity: 0.85 }]}
                >
                  <Cover artwork={item.artwork} size={coverWidth} radius={radii.md} />
                  <Txt variant="callout" numberOfLines={1} style={{ marginTop: spacing.sm }}>
                    {item.title}
                  </Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {item.subtitle}
                  </Txt>
                </Pressable>
              )}
            />
          </Section>
        )}

        {suggestions.loading && !suggestions.data && !!data && (
          <View style={{ paddingHorizontal: gutter, marginBottom: spacing.xxl }}>
            <SkeletonShelf cardWidth={shelfCardWidth} />
          </View>
        )}

        {/* Recently played */}
        {!!data?.recentlyPlayed.length && (
          <TrackShelf
            title="Recently played"
            tracks={data.recentlyPlayed}
            gutter={gutter}
            width={shelfCardWidth}
            onPlay={(index) => play(data.recentlyPlayed, index, 'Recently played', true)}
          />
        )}

        {/* New music drawn from theirs */}
        {shelves.slice(0, 2).map((shelf) => (
          <TrackShelf
            key={shelf.id}
            title={shelf.title}
            tracks={shelf.tracks}
            gutter={gutter}
            width={shelfCardWidth}
            downloadable
            onPlay={(index) => play(shelf.tracks, index, shelf.title)}
          />
        ))}

        {/* The worldwide top five */}
        {globalTop.length > 0 && (
          <Section
            title="Top songs worldwide"
            subtitle={`Across ${chart.board?.markets ?? CHART_MARKET_COUNT} country charts today`}
            gutter={gutter}
            onSeeAll={() => router.push('/charts')}
          >
            <View style={{ paddingHorizontal: gutter }}>
              {globalTop.map((entry, index) => (
                <ChartRow
                  key={entry.track.id}
                  entry={entry}
                  markets={chart.board?.markets ?? CHART_MARKET_COUNT}
                  compact
                  onPress={() =>
                    play(
                      globalTop.map((row) => row.track),
                      index,
                      'Worldwide chart',
                    )
                  }
                  onMore={() =>
                    actions.openTrack(entry.track, { queue: globalTop.map((row) => row.track) })
                  }
                />
              ))}
            </View>
          </Section>
        )}

        {repeatShelves.map((shelf) => (
          <TrackShelf
            key={shelf.id}
            title={shelf.title}
            tracks={shelf.tracks}
            gutter={gutter}
            width={shelfCardWidth}
            downloadable
            onPlay={(index) => play(shelf.tracks, index, shelf.title)}
          />
        ))}

        {!!catalogue.data?.newReleases.length && (
          <Section
            title="New releases"
            subtitle={
              catalogue.data.followedReleases ? 'From artists you follow' : undefined
            }
            gutter={gutter}
            onSeeAll={() => router.push('/discover')}
          >
            <Shelf
              data={catalogue.data.newReleases}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item) => (
                <AlbumCard
                  album={item}
                  width={shelfCardWidth}
                  onPress={() => router.push(`/album/${encodeURIComponent(item.id)}`)}
                />
              )}
            />
          </Section>
        )}

        {!!data?.topArtists.length && (
          <Section title="Your top artists" gutter={gutter} onSeeAll={() => router.push('/stats')}>
            <Shelf
              data={data.topArtists}
              gutter={gutter}
              keyExtractor={(item) => item.name}
              renderItem={(item) => (
                <ArtCard
                  title={item.name}
                  subtitle={formatListeningTime(item.msPlayed)}
                  artworkUrl={item.imageUrl}
                  width={shelfCardWidth * 0.82}
                  rounded
                  onPress={() =>
                    item.artistId
                      ? router.push(`/artist/${encodeURIComponent(item.artistId)}`)
                      : router.push({ pathname: '/discover', params: { q: item.name } })
                  }
                />
              )}
            />
          </Section>
        )}

        {shelves.slice(2).map((shelf) => (
          <TrackShelf
            key={shelf.id}
            title={shelf.title}
            tracks={shelf.tracks}
            gutter={gutter}
            width={shelfCardWidth}
            downloadable
            onPlay={(index) => play(shelf.tracks, index, shelf.title)}
          />
        ))}

        {!!catalogue.data?.charts.length && (
          <Section title="Albums charting now" gutter={gutter} onSeeAll={() => router.push('/charts')}>
            <Shelf
              data={catalogue.data.charts}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item, index) => (
                <ArtCard
                  title={item.title}
                  subtitle={item.artistName}
                  artworkUrl={item.artworkUrl}
                  width={shelfCardWidth}
                  badge={`#${index + 1}`}
                  onPress={() => router.push(`/album/${encodeURIComponent(item.id)}`)}
                />
              )}
            />
          </Section>
        )}

        <Section title="Moods" gutter={gutter}>
          <Shelf
            data={MOODS}
            gutter={gutter}
            keyExtractor={(mood) => mood.id}
            renderItem={(mood) => (
              <MoodCard
                mood={mood}
                width={isTabletUp ? 200 : 150}
                onPress={() => router.push(`/mood/${mood.id}`)}
              />
            )}
          />
        </Section>

        {!!events.data?.length && (
          <Section
            title="Live near you"
            gutter={gutter}
            onSeeAll={() => router.push('/events')}
          >
            <View style={{ paddingHorizontal: gutter, gap: spacing.md }}>
              {events.data.slice(0, 3).map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onPress={() => router.push(`/events?event=${encodeURIComponent(event.id)}`)}
                />
              ))}
            </View>
          </Section>
        )}

        {/* Nothing of their own and nothing played yet */}
        {!local.loading && data && data.own.length === 0 && (
          <EmptyState
            icon="phone-portrait-outline"
            title="Bring your music in first"
            message="Pulse turns the songs on your phone into playlists, gives them real covers, and mixes in new music that fits."
            actionLabel="Add my music"
            onAction={() => router.push('/import')}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

/** Up to four covers, for a playlist made of many songs. */
function coverOf(tracks: Track[]): (string | null)[] {
  const seen = new Set<string>();
  const covers: string[] = [];
  for (const track of tracks) {
    if (track.artworkUrl && !seen.has(track.artworkUrl)) {
      seen.add(track.artworkUrl);
      covers.push(track.artworkUrl);
    }
    if (covers.length === 4) break;
  }
  return covers;
}

/** One cover, or a two-by-two collage when a playlist has four to show. */
function Cover({
  artwork,
  size,
  radius,
}: {
  artwork: (string | null)[];
  size: number;
  radius: number;
}) {
  if (artwork.length >= 4) {
    const half = size / 2;
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          overflow: 'hidden',
          flexDirection: 'row',
          flexWrap: 'wrap',
        }}
      >
        {artwork.slice(0, 4).map((uri, index) => (
          <Artwork key={`${uri}-${index}`} uri={uri} size={half} radius={0} />
        ))}
      </View>
    );
  }
  return <Artwork uri={artwork[0] ?? null} size={size} radius={radius} />;
}

function TrackShelf({
  title,
  tracks,
  gutter,
  width,
  downloadable,
  onPlay,
}: {
  title: string;
  tracks: Track[];
  gutter: number;
  width: number;
  downloadable?: boolean;
  onPlay: (index: number) => void;
}) {
  return (
    <Section title={title} gutter={gutter}>
      <Shelf
        data={tracks}
        gutter={gutter}
        keyExtractor={(item) => item.id}
        renderItem={(item, index) => (
          <TrackCard
            track={item}
            width={width}
            downloadable={downloadable}
            onPress={() => onPlay(index)}
          />
        )}
      />
    </Section>
  );
}

function Banner({
  gutter,
  icon,
  tint,
  title,
  detail,
  onPress,
}: {
  gutter: number;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  detail: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const body = (
    <>
      <Ionicons name={icon} size={18} color={tint} />
      <View style={{ flex: 1 }}>
        <Txt variant="callout">{title}</Txt>
        <Txt variant="caption" tone="muted">
          {detail}
        </Txt>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />}
    </>
  );

  if (!onPress) {
    return <View style={[styles.banner, { marginHorizontal: gutter }]}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.banner, { marginHorizontal: gutter }, pressed && { opacity: 0.8 }]}
    >
      {body}
    </Pressable>
  );
}

function Section({
  title,
  subtitle,
  gutter,
  onSeeAll,
  children,
}: {
  title: string;
  subtitle?: string | null;
  gutter: number;
  onSeeAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: spacing.xxl }}>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        onAction={onSeeAll}
        style={{ paddingHorizontal: gutter }}
      />
      {children}
    </View>
  );
}

/** Events only load when the user has already chosen or allowed a location. */
async function loadNearbyEvents(): Promise<MusicEvent[]> {
  const provider = eventProvider();
  if (!provider.isConfigured()) return [];
  const saved = await getSetting(SETTINGS_KEYS.location);
  if (!saved) return getCachedEvents({ limit: 5 });
  try {
    const place = JSON.parse(saved) as { latitude?: number; longitude?: number; city?: string };
    if (place.latitude != null && place.longitude != null) {
      return provider.nearbyEvents(
        { latitude: place.latitude, longitude: place.longitude },
        { limit: 5 },
      );
    }
    if (place.city) return provider.searchEvents({ city: place.city, limit: 5 });
  } catch {
    /* fall through to the cache */
  }
  return getCachedEvents({ limit: 5 });
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
    },
    dot: {
      position: 'absolute',
      top: -1,
      right: -1,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.xxl,
    },
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      height: 56,
      paddingRight: spacing.sm,
      borderRadius: radii.sm,
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    tileIcon: {
      width: 56,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
  });
