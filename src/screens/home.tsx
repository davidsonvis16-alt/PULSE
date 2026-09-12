import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Album, MusicEvent, Track } from '@/src/core/types';
import { MOODS } from '@/src/core/moods';
import { formatListeningTime, greeting, initialsOf, pluralize } from '@/src/core/format';
import { eventProvider } from '@/src/providers/events';
import { musicProvider } from '@/src/providers/music';
import { config } from '@/src/core/config';
import {
  buildTasteProfile,
  getRecommendationShelves,
  getRepeatPlayShelves,
  type RecommendationShelf,
} from '@/src/discovery/engine';
import type { TasteProfile } from '@/src/discovery/taste';
import { getNewReleasesFromFollowed } from '@/src/discovery/releases';
import { getGlobalChart, type ChartEntry } from '@/src/discovery/charts';
import {
  getContinueListening,
  getStatsSummary,
  getTopArtists,
  getTopTracks,
  type TopArtist,
  type TopTrack,
} from '@/src/db/repos/history';
import { unreadNotificationCount } from '@/src/db/repos/notifications';
import { getCachedEvents } from '@/src/db/repos/events';
import { listGrooves, type Groove } from '@/src/db/repos/grooves';
import { getLocalCounts, listLocalTracks } from '@/src/db/repos/local';
import { getLibraryTracks, getRecentlyAdded } from '@/src/db/repos/library';
import { GrooveCard } from '@/src/screens/grooves';
import { getSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { ingestEngine } from '@/src/ingestion/ingest';
import { artworkRepair } from '@/src/ingestion/artwork/backfill';
import { radioStation } from '@/src/radio/station';
import { useAuth } from '@/src/auth/auth';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { AlbumCard, ArtCard, EventCard, MoodCard, TrackCard } from '@/src/ui/cards';
import { TrackRow } from '@/src/ui/rows';
import { ChartRow } from '@/src/ui/chart-row';
import { IconButton } from '@/src/ui/buttons';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { PulseLogo } from '@/src/ui/logo';
import { EmptyState, ErrorState, SkeletonRows, SkeletonShelf } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

interface HomeData {
  /** The user's own files — the first music on the page. */
  yourMusic: Track[];
  yourMusicTotal: number;
  recentlyAdded: Track[];
  counts: Awaited<ReturnType<typeof getLocalCounts>>;
  continueTrack: { track: Track; positionMs: number } | null;
  taste: TasteProfile;
  shelves: RecommendationShelf[];
  /** Built from songs played more than once — the strongest signal there is. */
  repeatShelves: RecommendationShelf[];
  charts: Album[];
  /** The worldwide top ten, with real positions and movement. */
  globalTop: ChartEntry[];
  newReleases: Album[];
  followedReleases: boolean;
  topArtists: TopArtist[];
  topTracks: TopTrack[];
  grooves: Groove[];
  events: MusicEvent[];
  unread: number;
  stats: { totalMs: number; artistCount: number; trackCount: number };
}

/** How many of the user's own songs the Home screen shows before "see all". */
const OWN_SONGS_ON_HOME = 10;

/**
 * Home.
 *
 * Two halves, deliberately mixed rather than separated: the music the user
 * already owns, and the music they do not. Their own songs come first, then
 * what Pulse thinks they would like, then what is genuinely charting, then more
 * of their own. Every shelf says where it came from — the number of songs a
 * suggestion was drawn from, a real chart position, a real play count — so the
 * page can be read rather than just scrolled.
 *
 * Nothing here is invented. A section with no data behind it is not rendered.
 */
export function HomeScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { profile } = useAuth();
  const { gutter, shelfCardWidth, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const downloads = useStore(downloadManager);
  const ingest = useStore(ingestEngine);
  const repair = useStore(artworkRepair);
  const radio = useStore(radioStation);
  const player = useStore(playerStore);

  const state = useAsync<HomeData>(async () => {
    const counts = await getLocalCounts();
    const own = counts.tracks > 0 ? (await listLocalTracks({ limit: 200 })).map((e) => e.track) : [];
    const yourMusic = own.length ? own : await getLibraryTracks({ sort: 'recent', limit: 200 });

    const taste = await buildTasteProfile();
    const [
      continueTrack,
      recentlyAdded,
      shelves,
      repeatShelves,
      charts,
      globalTop,
      followed,
      topArtists,
      topTracks,
      grooves,
      unread,
      stats,
    ] = await Promise.all([
      getContinueListening(),
      getRecentlyAdded(12),
      getRecommendationShelves(taste).catch(() => [] as RecommendationShelf[]),
      getRepeatPlayShelves().catch(() => [] as RecommendationShelf[]),
      musicProvider().getTrending(12).catch(() => [] as Album[]),
      getGlobalChart({ limit: 10 }).catch(() => [] as ChartEntry[]),
      getNewReleasesFromFollowed(12),
      getTopArtists('month', 10),
      getTopTracks('month', 5),
      listGrooves(),
      unreadNotificationCount(),
      getStatsSummary('month'),
    ]);

    // Following nobody yet is not a reason to show an empty page: fall back to
    // what is actually new in the catalogue.
    const newReleases = followed.length
      ? followed
      : await musicProvider()
          .getNewReleases({ limit: 12, country: config.music.country })
          .catch(() => [] as Album[]);

    return {
      yourMusic: yourMusic.slice(0, OWN_SONGS_ON_HOME),
      yourMusicTotal: yourMusic.length,
      recentlyAdded,
      counts,
      continueTrack,
      taste,
      shelves,
      repeatShelves,
      charts,
      globalTop,
      newReleases,
      followedReleases: followed.length > 0,
      topArtists,
      topTracks,
      grooves,
      events: await loadNearbyEvents(),
      unread,
      stats: {
        totalMs: stats.totalMs,
        artistCount: stats.artistCount,
        trackCount: stats.trackCount,
      },
    };
  }, []);

  useFocusReload(state.reload);

  const data = state.data;

  const playOwn = useCallback(
    (index: number, shuffle = false) => {
      const queue = data?.yourMusic ?? [];
      if (queue.length === 0) return;
      void playerStore.playQueue(queue, {
        startIndex: index,
        context: 'library',
        contextLabel: 'Your music',
        shuffle,
      });
    },
    [data],
  );

  const playShelf = useCallback((tracks: Track[], index: number, label: string) => {
    void playerStore.playQueue(tracks, {
      startIndex: index,
      context: 'recommendation',
      contextLabel: label,
    });
  }, []);

  if (state.error && !data) {
    return (
      <Screen>
        <ErrorState error={state.error} onRetry={state.reload} />
      </Screen>
    );
  }

  const name = profile?.displayName?.split(' ')[0] ?? 'there';
  const importing =
    ingest.phase !== 'idle' &&
    ingest.phase !== 'done' &&
    ingest.phase !== 'error' &&
    ingest.phase !== 'cancelled';

  /** The suggestion shelves, split so the first sits above the charts. */
  const firstShelf = data?.shelves[0];
  const restShelves = data?.shelves.slice(1) ?? [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={state.reload}
            tintColor={colors.accent}
          />
        }
      >
        <View style={[styles.header, { paddingHorizontal: gutter }]}>
          <PulseLogo size={28} showWordmark />
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add music from this device"
            hitSlop={8}
            onPress={() => router.push('/import')}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.text} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            onPress={() => router.push('/profile')}
            style={styles.avatar}
          >
            {profile?.avatarUrl ? (
              <Artwork uri={profile.avatarUrl} size={32} rounded />
            ) : (
              <Txt variant="callout" tone="onAccent">
                {initialsOf(profile?.displayName)}
              </Txt>
            )}
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: gutter, marginBottom: spacing.lg }}>
          <Txt variant="title1">
            {greeting()}, {name}
          </Txt>
          <Txt variant="body" tone="muted">
            {data
              ? summaryLine(data)
              : 'Your music and what Pulse thinks you should hear next.'}
          </Txt>
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
            detail="Confirm a match and Pulse fills in the details and the cover."
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

        {state.loading && !data && (
          <View style={{ paddingHorizontal: gutter, gap: spacing.xxl }}>
            <SkeletonRows count={5} />
            <SkeletonShelf cardWidth={shelfCardWidth} />
          </View>
        )}

        {/* Where they stopped */}
        {data?.continueTrack && (
          <View style={{ paddingHorizontal: gutter, marginBottom: spacing.xxl }}>
            <SectionHeader title="Pick up where you left off" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Continue ${data.continueTrack.track.title}`}
              onPress={() =>
                void playerStore.playTrack(data.continueTrack!.track, {
                  startPositionMs: data.continueTrack!.positionMs,
                  context: 'library',
                })
              }
              style={({ pressed }) => [styles.continueCard, pressed && { opacity: 0.85 }]}
            >
              <Artwork uri={data.continueTrack.track.artworkUrl} size={58} radius={radii.sm} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {data.continueTrack.track.title}
                </Txt>
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {data.continueTrack.track.artistName}
                </Txt>
              </View>
              <View style={styles.continuePlay}>
                <Ionicons name="play" size={19} color={colors.onAccent} style={{ marginLeft: 2 }} />
              </View>
            </Pressable>
          </View>
        )}

        {/* 1. Their own music, first on the page */}
        {!!data?.yourMusic.length && (
          <View style={{ marginBottom: spacing.xxl }}>
            <SectionHeader
              title="Your music"
              subtitle={`${pluralize(data.yourMusicTotal, 'song')} on this device`}
              actionLabel="See all"
              onAction={() => router.push('/collection/all')}
              style={{ paddingHorizontal: gutter }}
            />
            <View style={{ paddingHorizontal: gutter }}>
              <View style={styles.playRow}>
                <IconButton name="shuffle" label="Shuffle your music" onPress={() => playOwn(0, true)} />
                <IconButton
                  name="play-circle"
                  label="Play your music"
                  color={colors.accent}
                  size={26}
                  onPress={() => playOwn(0)}
                />
              </View>
              {data.yourMusic.map((track, index) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  isDownloaded={downloads.byTrackId[track.id]?.status === 'completed'}
                  onPress={() => playOwn(index)}
                  onMore={() => actions.openTrack(track, { queue: data.yourMusic })}
                />
              ))}
            </View>
          </View>
        )}

        {/* 2. Music they do not have, drawn from what they do */}
        {firstShelf && (
          <Section
            title={firstShelf.title}
            subtitle={shelfExplanation(firstShelf, data!.taste)}
            gutter={gutter}
          >
            <Shelf
              data={firstShelf.tracks}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item, index) => (
                <TrackCard
                  track={item}
                  width={shelfCardWidth}
                  downloadable
                  onPress={() => playShelf(firstShelf.tracks, index, firstShelf.title)}
                />
              )}
            />
          </Section>
        )}

        {/* 3. The station */}
        <View style={{ paddingHorizontal: gutter, marginBottom: spacing.xxl }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Pulse Radio"
            onPress={() => router.push('/radio')}
            style={({ pressed }) => [styles.radioCard, pressed && { opacity: 0.88 }]}
          >
            <View style={styles.radioIcon}>
              <Ionicons name="radio" size={22} color={colors.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Pulse Radio</Txt>
              <Txt variant="caption" tone="muted">
                {radio.live && player.current
                  ? `On air · ${player.current.title}`
                  : 'One stream that keeps going. No rewinding, nothing played twice.'}
              </Txt>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        </View>

        {/* 4. The worldwide top ten, with real positions and movement */}
        {!!data?.globalTop.length && (
          <Section
            title="Top 10 worldwide"
            subtitle="Most played across 12 country charts, updated daily"
            gutter={gutter}
            onSeeAll={() => router.push('/charts')}
          >
            <View style={{ paddingHorizontal: gutter }}>
              {data.globalTop.map((entry, index) => (
                <ChartRow
                  key={entry.track.id}
                  entry={entry}
                  markets={12}
                  compact
                  onPress={() =>
                    void playerStore.playQueue(
                      data.globalTop.map((row) => row.track),
                      { startIndex: index, context: 'recommendation', contextLabel: 'Worldwide chart' },
                    )
                  }
                  onMore={() =>
                    actions.openTrack(entry.track, {
                      queue: data.globalTop.map((row) => row.track),
                    })
                  }
                />
              ))}
            </View>
          </Section>
        )}

        {/* Albums charting, as a shelf of covers */}
        {!!data?.charts.length && (
          <Section
            title="Albums charting now"
            subtitle="The most-played records today, in chart order"
            gutter={gutter}
            onSeeAll={() => router.push('/charts')}
          >
            <Shelf
              data={data.charts}
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

        {/* 5. What repeat plays say they want more of */}
        {data?.repeatShelves.map((shelf) => (
          <Section key={shelf.id} title={shelf.title} subtitle={shelf.subtitle} gutter={gutter}>
            <Shelf
              data={shelf.tracks}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item, index) => (
                <TrackCard
                  track={item}
                  width={shelfCardWidth}
                  downloadable
                  onPress={() => playShelf(shelf.tracks, index, shelf.title)}
                />
              )}
            />
          </Section>
        ))}

        {/* 6. Back to theirs */}
        {!!data?.recentlyAdded.length && (
          <Section
            title="Recently added"
            subtitle="The newest music in your library"
            gutter={gutter}
            onSeeAll={() => router.push('/collection/recent')}
          >
            <Shelf
              data={data.recentlyAdded}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item, index) => (
                <TrackCard
                  track={item}
                  width={shelfCardWidth}
                  onPress={() =>
                    void playerStore.playQueue(data.recentlyAdded, {
                      startIndex: index,
                      context: 'library',
                      contextLabel: 'Recently added',
                    })
                  }
                />
              )}
            />
          </Section>
        )}

        {/* 7. The rest of the suggestions */}
        {restShelves.map((shelf) => (
          <Section
            key={shelf.id}
            title={shelf.title}
            subtitle={shelfExplanation(shelf, data!.taste)}
            gutter={gutter}
          >
            <Shelf
              data={shelf.tracks}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item, index) => (
                <TrackCard
                  track={item}
                  width={shelfCardWidth}
                  downloadable
                  onPress={() => playShelf(shelf.tracks, index, shelf.title)}
                />
              )}
            />
          </Section>
        ))}

        {/* 8. New releases */}
        {!!data?.newReleases.length && (
          <Section
            title="New releases"
            subtitle={
              data.followedReleases
                ? 'Out recently from the artists you follow'
                : 'Out recently, newest first'
            }
            gutter={gutter}
            onSeeAll={() => router.push('/discover')}
          >
            <Shelf
              data={data.newReleases}
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

        {/* 9. What they themselves played most — their own numbers */}
        {!!data?.topTracks.length && (
          <Section
            title="Your most played"
            subtitle="Counted from what you actually listened to this month"
            gutter={gutter}
            onSeeAll={() => router.push('/stats')}
          >
            <View style={{ paddingHorizontal: gutter }}>
              {data.topTracks.map((entry, index) => (
                <TrackRow
                  key={entry.track.id}
                  track={entry.track}
                  subtitleOverride={`${entry.track.artistName} · ${pluralize(entry.plays, 'play')}`}
                  isDownloaded={downloads.byTrackId[entry.track.id]?.status === 'completed'}
                  onPress={() =>
                    void playerStore.playQueue(
                      data.topTracks.map((t) => t.track),
                      { startIndex: index, context: 'library', contextLabel: 'Your most played' },
                    )
                  }
                  onMore={() =>
                    actions.openTrack(entry.track, { queue: data.topTracks.map((t) => t.track) })
                  }
                />
              ))}
            </View>
          </Section>
        )}

        {!!data?.topArtists.length && (
          <Section
            title="Your top artists"
            subtitle="By time listened this month"
            gutter={gutter}
            onSeeAll={() => router.push('/stats')}
          >
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

        {!!data?.grooves.length && (
          <Section
            title="Your Grooves"
            subtitle="Groups Pulse found inside your own collection"
            gutter={gutter}
            onSeeAll={() => router.push('/grooves')}
          >
            <Shelf
              data={data.grooves}
              gutter={gutter}
              keyExtractor={(groove) => groove.id}
              renderItem={(groove) => (
                <GrooveCard
                  groove={groove}
                  width={isTabletUp ? 220 : 168}
                  onPress={() => router.push(`/groove/${groove.id}`)}
                />
              )}
            />
          </Section>
        )}

        <Section title="Made for you" subtitle="Music for every moment" gutter={gutter}>
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

        {!!data?.events.length && (
          <Section
            title="Upcoming events"
            subtitle="Live near you"
            gutter={gutter}
            onSeeAll={() => router.push('/events')}
          >
            <View style={{ paddingHorizontal: gutter, gap: spacing.md }}>
              {data.events.slice(0, 3).map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onPress={() => router.push(`/events?event=${encodeURIComponent(event.id)}`)}
                />
              ))}
            </View>
          </Section>
        )}

        {!!data && data.stats.totalMs > 0 && (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.xxl }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open your listening statistics"
              onPress={() => router.push('/stats')}
              style={({ pressed }) => [styles.statsCard, pressed && { opacity: 0.85 }]}
            >
              <View style={{ flex: 1 }}>
                <Txt variant="micro" tone="muted" uppercase>
                  This month
                </Txt>
                <Txt variant="title2" style={{ marginTop: 4 }}>
                  {formatListeningTime(data.stats.totalMs)}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {data.stats.artistCount} artists · {data.stats.trackCount} songs
                </Txt>
              </View>
              <Ionicons name="stats-chart" size={22} color={colors.accent} />
            </Pressable>
          </View>
        )}

        {/* Nothing of their own and nothing played yet */}
        {!state.loading && data && data.yourMusic.length === 0 && (
          <EmptyState
            icon="phone-portrait-outline"
            title="Bring your music in first"
            message="Pulse works best from the songs you already own: it gives them real covers, groups them into Grooves, and everything it recommends is drawn from them."
            actionLabel="Add my music"
            onAction={() => router.push('/import')}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

/** One line under the greeting saying what this page is built from. */
function summaryLine(data: HomeData): string {
  const parts: string[] = [];
  if (data.yourMusicTotal > 0) parts.push(`${pluralize(data.yourMusicTotal, 'song')} of yours`);
  if (data.taste.artists.length > 0) {
    parts.push(`suggestions from ${pluralize(data.taste.artists.length, 'artist')} you play`);
  }
  if (data.charts.length > 0) parts.push("today's charts");
  if (parts.length === 0) return 'Your music and what Pulse thinks you should hear next.';
  return `${parts.join(', ')}.`;
}

/**
 * Says why a shelf is on the page. The engine knows the reason and the seed; a
 * listener should not have to guess whether a suggestion came from their own
 * collection or from a chart.
 */
function shelfExplanation(shelf: RecommendationShelf, taste: TasteProfile): string {
  if (shelf.subtitle) return shelf.subtitle;
  switch (shelf.reason) {
    case 'in_your_library':
    case 'from_imported':
      return shelf.seed ? `Because ${shelf.seed} is in your library` : 'Drawn from your own music';
    case 'sounds_like_collection':
      return `Close to the ${pluralize(taste.genres.length, 'genre')} you play most`;
    case 'related_artists':
      return shelf.seed ? `Artists close to ${shelf.seed}` : 'Artists close to the ones you play';
    case 'similar_to_favorites':
      return 'Similar to the songs you liked';
    case 'trending':
      return 'Popular right now';
    case 'mood':
      return shelf.seed ? `For a ${shelf.seed} mood` : 'Picked for the moment';
    default:
      return 'New to you, based on what you play';
  }
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
      gap: spacing.lg,
      paddingVertical: spacing.md,
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
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    playRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.xs },
    radioCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    radioIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    continueCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    continuePlay: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
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
    statsCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      padding: spacing.xl,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
  });
