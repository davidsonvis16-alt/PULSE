import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Album, MusicEvent, Track } from '@/src/core/types';
import { MOODS } from '@/src/core/moods';
import { formatListeningTime, initialsOf, pluralize } from '@/src/core/format';
import { eventProvider } from '@/src/providers/events';
import { buildTasteProfile, getRecommendationShelves, type RecommendationShelf } from '@/src/discovery/engine';
import { getNewReleasesFromFollowed } from '@/src/discovery/releases';
import { getContinueListening, getStatsSummary, getTopArtists, type TopArtist } from '@/src/db/repos/history';
import { unreadNotificationCount } from '@/src/db/repos/notifications';
import { getCachedEvents } from '@/src/db/repos/events';
import { listGrooves, type Groove } from '@/src/db/repos/grooves';
import { getLocalCounts, listLocalTracks } from '@/src/db/repos/local';
import { getLibraryTracks } from '@/src/db/repos/library';
import { GrooveCard } from '@/src/screens/grooves';
import { getSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
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
import { TrackRow } from '@/src/ui/rows';
import { Chip, IconButton } from '@/src/ui/buttons';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { PulseLogo } from '@/src/ui/logo';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { colors, radii, spacing } from '@/src/theme/tokens';

interface HomeData {
  /** The user's own music. This is what the screen is built around. */
  tracks: Track[];
  isLocal: boolean;
  counts: Awaited<ReturnType<typeof getLocalCounts>>;
  continueTrack: { track: Track; positionMs: number } | null;
  grooves: Groove[];
  shelves: RecommendationShelf[];
  topArtists: TopArtist[];
  newReleases: Album[];
  events: MusicEvent[];
  unread: number;
  stats: { totalMs: number; artistCount: number; trackCount: number };
}

/** How many of the user's songs sit between two recommendation shelves. */
const SONGS_PER_BLOCK = 8;

type QuickLink = { id: string; label: string; icon: keyof typeof Ionicons.glyphMap };

const QUICK_LINKS: QuickLink[] = [
  { id: 'songs', label: 'Songs', icon: 'musical-note-outline' },
  { id: 'albums', label: 'Albums', icon: 'disc-outline' },
  { id: 'artists', label: 'Artists', icon: 'people-outline' },
  { id: 'favorites', label: 'Favorites', icon: 'heart-outline' },
  { id: 'downloads', label: 'Downloads', icon: 'arrow-down-circle-outline' },
];

/**
 * Home.
 *
 * The music the user already owns is the page. Their songs run down it in the
 * order they were added, and Pulse's own suggestions are dealt in between the
 * blocks rather than pushed above them — so the first thing on screen is always
 * something they chose, and a recommendation has to earn its place by sitting
 * next to it. Everything below the songs is built from what they actually did.
 */
export function HomeScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { gutter, shelfCardWidth, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const downloads = useStore(downloadManager);
  const ingest = useStore(ingestEngine);
  const repair = useStore(artworkRepair);

  const state = useAsync<HomeData>(async () => {
    const counts = await getLocalCounts();
    const own = counts.tracks > 0 ? (await listLocalTracks({ limit: 400 })).map((e) => e.track) : [];
    const tracks = own.length ? own : await getLibraryTracks({ sort: 'recent', limit: 400 });

    const profileTaste = await buildTasteProfile();
    const [continueTrack, shelves, topArtists, newReleases, unread, stats, grooves] =
      await Promise.all([
        getContinueListening(),
        getRecommendationShelves(profileTaste).catch(() => [] as RecommendationShelf[]),
        getTopArtists('month', 10),
        getNewReleasesFromFollowed(12),
        unreadNotificationCount(),
        getStatsSummary('month'),
        listGrooves(),
      ]);

    return {
      tracks,
      isLocal: own.length > 0,
      counts,
      continueTrack,
      grooves,
      shelves,
      topArtists,
      newReleases,
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
  const tracks = useMemo(() => data?.tracks ?? [], [data]);

  const playFrom = useCallback(
    (index: number) => {
      void playerStore.playQueue(tracks, {
        startIndex: index,
        context: 'library',
        contextLabel: 'Your music',
      });
    },
    [tracks],
  );

  const playShelf = useCallback((shelfTracks: Track[], index: number, label: string) => {
    void playerStore.playQueue(shelfTracks, {
      startIndex: index,
      context: 'recommendation',
      contextLabel: label,
    });
  }, []);

  const playAll = useCallback(
    (shuffle: boolean) => {
      if (tracks.length === 0) return;
      void playerStore.playQueue(tracks, { context: 'library', contextLabel: 'Your music', shuffle });
    },
    [tracks],
  );

  if (state.error && !data) {
    return (
      <Screen>
        <ErrorState error={state.error} onRetry={state.reload} />
      </Screen>
    );
  }

  const name = profile?.displayName?.split(' ')[0] ?? null;
  const importing =
    ingest.phase !== 'idle' && ingest.phase !== 'done' && ingest.phase !== 'error' && ingest.phase !== 'cancelled';

  const header = (
    <View>
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

      <View style={[styles.titleRow, { paddingHorizontal: gutter }]}>
        <View style={{ flex: 1 }}>
          <Txt variant="title1">Your music</Txt>
          <Txt variant="body" tone="muted">
            {tracks.length > 0
              ? `${pluralize(tracks.length, 'song')} on this device${name ? `, ${name}` : ''}`
              : 'Bring your own songs in and this becomes your library.'}
          </Txt>
        </View>
        {tracks.length > 0 && (
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="shuffle" label="Shuffle your music" onPress={() => playAll(true)} />
            <IconButton
              name="play-circle"
              label="Play your music"
              color={colors.accent}
              size={26}
              onPress={() => playAll(false)}
            />
          </View>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingVertical: spacing.md }}
      >
        {QUICK_LINKS.map((link) => (
          <Chip
            key={link.id}
            label={link.label}
            icon={link.icon}
            onPress={() => router.push(`/collection/${link.id}`)}
          />
        ))}
        <Chip label="Grooves" icon="color-wand-outline" onPress={() => router.push('/grooves')} />
      </ScrollView>

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

      {data?.continueTrack && (
        <View style={{ paddingHorizontal: gutter, marginBottom: spacing.lg }}>
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

      {state.loading && !data && (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonRows count={8} />
        </View>
      )}
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={state.reload}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={header}
        renderItem={({ item, index }) => {
          // One shelf of suggestions after each block of the user's own songs.
          const blockEnd = (index + 1) % SONGS_PER_BLOCK === 0;
          const shelf = blockEnd ? data?.shelves[(index + 1) / SONGS_PER_BLOCK - 1] : undefined;
          return (
            <View>
              <View style={{ paddingHorizontal: gutter }}>
                <TrackRow
                  track={item}
                  isDownloaded={downloads.byTrackId[item.id]?.status === 'completed'}
                  onPress={() => playFrom(index)}
                  onMore={() => actions.openTrack(item, { queue: tracks })}
                />
              </View>
              {shelf && (
                <View style={styles.interlude}>
                  <SectionHeader
                    title={shelf.title}
                    subtitle={shelf.subtitle}
                    style={{ paddingHorizontal: gutter }}
                  />
                  <Shelf
                    data={shelf.tracks}
                    gutter={gutter}
                    keyExtractor={(track) => track.id}
                    renderItem={(track, position) => (
                      <TrackCard
                        track={track}
                        width={shelfCardWidth}
                        downloadable
                        onPress={() => playShelf(shelf.tracks, position, shelf.title)}
                      />
                    )}
                  />
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          state.loading ? null : (
            <EmptyState
              icon="phone-portrait-outline"
              title="No music in here yet"
              message="Pulse works from the songs you already own. Bring them in and it gives them real covers, groups them into Grooves and learns your taste from them."
              actionLabel="Add my music"
              onAction={() => router.push('/import')}
            />
          )
        }
        ListFooterComponent={
          <View>
            {tracks.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/collection/all')}
                style={({ pressed }) => [
                  styles.seeAll,
                  { marginHorizontal: gutter },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Txt variant="callout" tone="secondary">
                  Browse all of your music
                </Txt>
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </Pressable>
            )}

            {/* Suggestions that did not fit between the song blocks. */}
            {data?.shelves
              .slice(Math.floor(tracks.length / SONGS_PER_BLOCK))
              .map((shelf) => (
                <Section key={shelf.id} title={shelf.title} subtitle={shelf.subtitle} gutter={gutter}>
                  <Shelf
                    data={shelf.tracks}
                    gutter={gutter}
                    keyExtractor={(track) => track.id}
                    renderItem={(track, position) => (
                      <TrackCard
                        track={track}
                        width={shelfCardWidth}
                        downloadable
                        onPress={() => playShelf(shelf.tracks, position, shelf.title)}
                      />
                    )}
                  />
                </Section>
              ))}

            {!!data?.grooves.length && (
              <Section
                title="Your Grooves"
                subtitle="Found in your own collection"
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

            {!!data?.newReleases.length && (
              <Section
                title="New releases"
                subtitle="From the artists you follow"
                gutter={gutter}
                onSeeAll={() => router.push('/notifications')}
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
              <View style={{ paddingHorizontal: gutter, marginTop: spacing.sm }}>
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
          </View>
        }
      />
    </Screen>
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
    <View style={{ marginTop: spacing.xxl }}>
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

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
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
  interlude: {
    marginVertical: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
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
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    marginTop: spacing.xxl,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
});
