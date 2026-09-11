import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Album, MusicEvent, Track } from '@/src/core/types';
import { MOODS } from '@/src/core/moods';
import { formatListeningTime, greeting, initialsOf } from '@/src/core/format';
import { eventProvider } from '@/src/providers/events';
import { buildTasteProfile, getRecommendationShelves, type RecommendationShelf } from '@/src/discovery/engine';
import { getNewReleasesFromFollowed } from '@/src/discovery/releases';
import { getContinueListening, getRecentlyPlayed, getStatsSummary, getTopArtists, type TopArtist } from '@/src/db/repos/history';
import { unreadNotificationCount } from '@/src/db/repos/notifications';
import { listActivity, type ActivityItem } from '@/src/db/repos/social';
import { getCachedEvents } from '@/src/db/repos/events';
import { listGrooves, type Groove } from '@/src/db/repos/grooves';
import { getLocalCounts } from '@/src/db/repos/local';
import { GrooveCard } from '@/src/screens/grooves';
import { getSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { playerStore } from '@/src/audio/player';
import { useAuth } from '@/src/auth/auth';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { AlbumCard, ArtCard, EventCard, MoodCard, TrackCard } from '@/src/ui/cards';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { PulseLogo } from '@/src/ui/logo';
import { EmptyState, ErrorState, SkeletonShelf } from '@/src/ui/states';
import { colors, radii, spacing } from '@/src/theme/tokens';

interface HomeData {
  continueTrack: { track: Track; positionMs: number } | null;
  grooves: Groove[];
  localTrackCount: number;
  recentlyPlayed: Track[];
  shelves: RecommendationShelf[];
  topArtists: TopArtist[];
  newReleases: Album[];
  events: MusicEvent[];
  activity: ActivityItem[];
  unread: number;
  stats: { totalMs: number; artistCount: number; trackCount: number };
}

/**
 * Home.
 *
 * Every section is built from something the user actually did. Sections with
 * nothing behind them are not rendered, which is why a brand-new Pulse shows a
 * short page that grows as they listen instead of a wall of filler.
 */
export function HomeScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { gutter, shelfCardWidth, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();

  const state = useAsync<HomeData>(async () => {
    const profileTaste = await buildTasteProfile();
    const [
      continueTrack,
      recentlyPlayed,
      shelves,
      topArtists,
      newReleases,
      activity,
      unread,
      stats,
      grooves,
      localCounts,
    ] = await Promise.all([
      getContinueListening(),
      getRecentlyPlayed(12),
      getRecommendationShelves(profileTaste).catch(() => [] as RecommendationShelf[]),
      getTopArtists('month', 10),
      getNewReleasesFromFollowed(12),
      listActivity(6),
      unreadNotificationCount(),
      getStatsSummary('month'),
      listGrooves(),
      getLocalCounts(),
    ]);

    return {
      continueTrack,
      grooves,
      localTrackCount: localCounts.tracks,
      recentlyPlayed,
      shelves,
      topArtists,
      newReleases,
      events: await loadNearbyEvents(),
      activity,
      unread,
      stats: {
        totalMs: stats.totalMs,
        artistCount: stats.artistCount,
        trackCount: stats.trackCount,
      },
    };
  }, []);

  useFocusReload(state.reload);

  const playShelf = useCallback((tracks: Track[], index: number, label: string) => {
    void playerStore.playQueue(tracks, {
      startIndex: index,
      context: 'recommendation',
      contextLabel: label,
    });
  }, []);

  const name = profile?.displayName?.split(' ')[0] ?? 'there';

  if (state.error && !state.data) {
    return (
      <Screen>
        <ErrorState error={state.error} onRetry={state.reload} />
      </Screen>
    );
  }

  const data = state.data;

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
        {/* Header */}
        <View style={[styles.header, { paddingHorizontal: gutter }]}>
          <PulseLogo size={28} showWordmark />
          <View style={{ flex: 1 }} />
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

        <View style={{ paddingHorizontal: gutter, marginBottom: spacing.xl }}>
          <Txt variant="title1">
            {greeting()}, {name}
          </Txt>
          <Txt variant="body" tone="muted">
            Here is what is new in your world.
          </Txt>
        </View>

        {state.loading && !data ? (
          <View style={{ paddingHorizontal: gutter, gap: spacing.xxl }}>
            <SkeletonShelf cardWidth={shelfCardWidth} />
            <SkeletonShelf cardWidth={shelfCardWidth} />
          </View>
        ) : null}

        {/* Continue listening */}
        {data?.continueTrack && (
          <View style={{ paddingHorizontal: gutter, marginBottom: spacing.xxl }}>
            <SectionHeader title="Continue listening" />
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

        {/* Recently played */}
        {!!data?.recentlyPlayed.length && (
          <Section title="Recently played" gutter={gutter} onSeeAll={() => router.push('/library')}>
            <Shelf
              data={data.recentlyPlayed}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item, index) => (
                <TrackCard
                  track={item}
                  width={shelfCardWidth}
                  onPress={() => playShelf(data.recentlyPlayed, index, 'Recently played')}
                />
              )}
            />
          </Section>
        )}

        {/* Grooves, built from the user's own collection */}
        {!!data?.grooves.length && (
          <Section
            title="Your Grooves"
            subtitle="Found in your own library"
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

        {/* Moods */}
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

        {/* Personalised shelves */}
        {data?.shelves.map((shelf) => (
          <Section key={shelf.id} title={shelf.title} subtitle={shelf.subtitle} gutter={gutter}>
            <Shelf
              data={shelf.tracks}
              gutter={gutter}
              keyExtractor={(item) => item.id}
              renderItem={(item, index) => (
                <TrackCard
                  track={item}
                  width={shelfCardWidth}
                  onPress={() => playShelf(shelf.tracks, index, shelf.title)}
                />
              )}
            />
          </Section>
        ))}

        {/* Top artists */}
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

        {/* New releases from followed artists */}
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

        {/* Events */}
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

        {/* Friends */}
        {!!data?.activity.length && (
          <Section title="Friends are listening to" gutter={gutter} onSeeAll={() => router.push('/profile')}>
            <View style={{ paddingHorizontal: gutter, gap: spacing.md }}>
              {data.activity.slice(0, 3).map((item) => (
                <View key={item.id} style={styles.activityRow}>
                  <Artwork uri={item.artworkUrl} size={44} radius={radii.sm} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="callout" numberOfLines={1}>
                      {item.entityTitle ?? 'Something new'}
                    </Txt>
                    <Txt variant="caption" tone="muted" numberOfLines={1}>
                      {item.actorName ?? item.actorHandle} · {verbLabel(item.verb)}
                    </Txt>
                  </View>
                </View>
              ))}
            </View>
          </Section>
        )}

        {/* Stats */}
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

        {/* Nothing yet */}
        {!state.loading && data && data.recentlyPlayed.length === 0 && data.shelves.length === 0 && (
          <EmptyState
            icon="phone-portrait-outline"
            title={data.localTrackCount > 0 ? 'Start with one song' : 'Bring your music in first'}
            message={
              data.localTrackCount > 0
                ? 'Play something and this page rebuilds itself around what you actually listen to.'
                : 'Pulse works best from the music you already own. Import it and this page fills itself in.'
            }
            actionLabel={data.localTrackCount > 0 ? 'Search music' : 'Import my music'}
            onAction={() => router.push(data.localTrackCount > 0 ? '/discover' : '/import')}
          />
        )}
      </ScrollView>
    </Screen>
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

function verbLabel(verb: ActivityItem['verb']): string {
  switch (verb) {
    case 'played':
      return 'is listening';
    case 'liked':
      return 'liked this';
    case 'added_playlist':
      return 'added a playlist';
    case 'followed':
      return 'followed an artist';
    case 'downloaded':
      return 'downloaded this';
    default:
      return 'shared this';
  }
}

const styles = StyleSheet.create({
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
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
