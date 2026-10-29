import { useState } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import type { Album, Artist, MusicEvent, Track } from '@/src/core/types';
import { formatShortDate } from '@/src/core/format';
import { providerFor } from '@/src/providers/music';
import { eventProvider } from '@/src/providers/events';
import { upsertArtist } from '@/src/db/repos/catalog';
import { cacheEvents } from '@/src/db/repos/events';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useFollowState } from '@/src/hooks/use-library-state';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { artistShare } from '@/src/share/share';
import { useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { Button, Chip, IconButton } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { AlbumCard, ArtistCard, EventCard } from '@/src/ui/cards';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type Tab = 'popular' | 'albums' | 'singles' | 'about';

interface ArtistPageData {
  artist: Artist;
  topTracks: Track[];
  albums: Album[];
  singles: Album[];
  related: Artist[];
  events: MusicEvent[];
}

/** The artist page: their music, their latest, and where to see them live. */
export default function ArtistScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter, pageWidth: width, shelfCardWidth, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();
  const downloads = useStore(downloadManager);

  const [tab, setTab] = useState<Tab>('popular');

  const state = useAsync<ArtistPageData>(async () => {
    const artistId = decodeURIComponent(id ?? '');
    const provider = providerFor(artistId.split(':')[0]);
    const artist = await provider.getArtist(artistId);
    if (!artist) throw new Error('That artist is not available from this source.');
    await upsertArtist(artist);

    const [topTracks, albums, singles, related] = await Promise.all([
      provider.getArtistTopTracks(artistId, 20).catch(() => [] as Track[]),
      provider.getArtistAlbums(artistId, 20).catch(() => [] as Album[]),
      provider.getArtistSingles(artistId, 20).catch(() => [] as Album[]),
      provider.getRelatedArtists(artistId, 12).catch(() => [] as Artist[]),
    ]);

    let events: MusicEvent[] = [];
    const live = eventProvider();
    if (live.isConfigured()) {
      events = await live.searchEvents({ artistName: artist.name, limit: 6 }).catch(() => []);
      void cacheEvents(events);
    }

    return { artist, topTracks, albums, singles, related, events };
  }, [id]);

  const artist = state.data?.artist;
  const follow = useFollowState(artist);

  const heroHeight = Math.min(isTabletUp ? 380 : width * 0.92, 420);

  if (state.error) {
    return (
      <View style={styles.root}>
        <View style={{ paddingTop: insets.top }}>
          <IconButton name="chevron-back" label="Go back" onPress={() => router.back()} />
        </View>
        <ErrorState error={state.error} onRetry={state.reload} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <ImageBackground
          source={artist?.imageUrl ? { uri: artist.imageUrl } : undefined}
          style={[styles.hero, { height: heroHeight }]}
          imageStyle={{ resizeMode: 'cover' }}
        >
          <LinearGradient
            colors={['rgba(8,9,10,0.55)', 'rgba(8,9,10,0.1)', colors.background]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.heroTop, { paddingTop: insets.top + spacing.sm, paddingHorizontal: gutter }]}>
            <IconButton
              name="chevron-back"
              label="Go back"
              background="surface"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            />
          </View>
          <View style={[styles.heroBottom, { paddingHorizontal: gutter }]}>
            {state.loading && !artist ? (
              <Skeleton width="60%" height={30} />
            ) : (
              <>
                <Txt variant="display" numberOfLines={2}>
                  {artist!.name}
                </Txt>
                {artist!.genre ? (
                  <Txt variant="body" tone="secondary">
                    {artist!.genre}
                  </Txt>
                ) : null}
              </>
            )}
          </View>
        </ImageBackground>

        {artist && (
          <>
            {/* Actions */}
            <View style={[styles.actions, { paddingHorizontal: gutter }]}>
              <Button
                label={follow.following ? 'Following' : 'Follow'}
                icon={follow.following ? 'checkmark' : undefined}
                variant={follow.following ? 'secondary' : 'primary'}
                onPress={async () => {
                  const next = await follow.toggle();
                  toast(
                    next
                      ? `Following ${artist.name}. Pulse will tell you about new releases.`
                      : `Unfollowed ${artist.name}`,
                    next ? 'success' : 'default',
                  );
                }}
              />
              <IconButton
                name="play-circle"
                label="Play top songs"
                size={26}
                color={colors.accentInk}
                onPress={() =>
                  state.data?.topTracks.length &&
                  void playerStore.playQueue(state.data.topTracks, {
                    context: 'artist',
                    contextLabel: artist.name,
                  })
                }
              />
              <IconButton
                name="shuffle"
                label="Shuffle their music"
                onPress={() =>
                  state.data?.topTracks.length &&
                  void playerStore.playQueue(state.data.topTracks, {
                    context: 'artist',
                    contextLabel: artist.name,
                    shuffle: true,
                  })
                }
              />
              <IconButton
                name="share-outline"
                label="Share this artist"
                onPress={() => share(artistShare(artist))}
              />
            </View>

            {/* Tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingVertical: spacing.lg }}
            >
              {(['popular', 'albums', 'singles', 'about'] as Tab[]).map((value) => (
                <Chip
                  key={value}
                  label={value[0].toUpperCase() + value.slice(1)}
                  active={tab === value}
                  onPress={() => setTab(value)}
                />
              ))}
            </ScrollView>

            {state.loading ? (
              <View style={{ paddingHorizontal: gutter }}>
                <SkeletonRows count={5} />
              </View>
            ) : (
              <View style={{ paddingHorizontal: gutter }}>
                {tab === 'popular' &&
                  (state.data!.topTracks.length === 0 ? (
                    <EmptyState icon="musical-notes-outline" title="No songs listed" compact />
                  ) : (
                    state.data!.topTracks.map((track, index) => (
                      <TrackRow
                        key={track.id}
                        track={track}
                        index={index}
                        showArtwork
                        subtitleOverride={track.albumTitle ?? artist.name}
                        isDownloaded={downloads.byTrackId[track.id]?.status === 'completed'}
                        onPress={() =>
                          void playerStore.playQueue(state.data!.topTracks, {
                            startIndex: index,
                            context: 'artist',
                            contextLabel: artist.name,
                          })
                        }
                        onMore={() => actions.openTrack(track, { queue: state.data!.topTracks })}
                      />
                    ))
                  ))}

                {tab === 'albums' && (
                  <ReleaseGrid
                    releases={state.data!.albums}
                    emptyLabel="No albums listed for this artist."
                  />
                )}
                {tab === 'singles' && (
                  <ReleaseGrid
                    releases={state.data!.singles}
                    emptyLabel="No singles or EPs listed for this artist."
                  />
                )}

                {tab === 'about' && (
                  <View style={styles.about}>
                    <Txt variant="body" tone="secondary">
                      {artist.genre
                        ? `Pulse lists ${artist.name} under ${artist.genre}.`
                        : `Pulse has no genre on file for ${artist.name}.`}
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      {providerFor(artist.provider).attribution}. Pulse shows what the source
                      publishes and does not add biography text of its own.
                    </Txt>
                    {artist.externalUrl && (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => void WebBrowser.openBrowserAsync(artist.externalUrl!)}
                      >
                        <Txt variant="callout" tone="accent">
                          Open the official artist page
                        </Txt>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Latest release */}
            {!!state.data?.singles.length && tab !== 'about' && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader
                  title="Latest release"
                  subtitle={formatShortDate(state.data.singles[0].releaseDate)}
                  style={{ paddingHorizontal: gutter }}
                />
                <View style={{ paddingHorizontal: gutter }}>
                  <AlbumCard
                    album={state.data.singles[0]}
                    width={Math.min(width - gutter * 2, 260)}
                    onPress={() =>
                      router.push(`/album/${encodeURIComponent(state.data!.singles[0].id)}`)
                    }
                  />
                </View>
              </View>
            )}

            {/* Events */}
            {!!state.data?.events.length && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader
                  title="Upcoming events"
                  actionLabel="All events"
                  onAction={() => router.push({ pathname: '/events', params: { q: artist.name } })}
                  style={{ paddingHorizontal: gutter }}
                />
                <View style={{ paddingHorizontal: gutter, gap: spacing.md }}>
                  {state.data.events.slice(0, 3).map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onPress={() =>
                        event.ticket && void WebBrowser.openBrowserAsync(event.ticket.url)
                      }
                      onTickets={
                        event.ticket
                          ? () => void WebBrowser.openBrowserAsync(event.ticket!.url)
                          : undefined
                      }
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Related */}
            {!!state.data?.related.length && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader title="Related artists" style={{ paddingHorizontal: gutter }} />
                <Shelf
                  data={state.data.related}
                  gutter={gutter}
                  keyExtractor={(item) => item.id}
                  renderItem={(item) => (
                    <ArtistCard
                      artist={item}
                      width={shelfCardWidth * 0.8}
                      onPress={() => router.push(`/artist/${encodeURIComponent(item.id)}`)}
                    />
                  )}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  function ReleaseGrid({ releases, emptyLabel }: { releases: Album[]; emptyLabel: string }) {
    if (releases.length === 0) {
      return <EmptyState icon="disc-outline" title={emptyLabel} compact />;
    }
    const columns = isTabletUp ? 4 : 2;
    const cardWidth = (width - gutter * 2 - spacing.md * (columns - 1)) / columns;
    return (
      <View style={styles.grid}>
        {releases.map((album) => (
          <AlbumCard
            key={album.id}
            album={album}
            width={cardWidth}
            onPress={() => router.push(`/album/${encodeURIComponent(album.id)}`)}
          />
        ))}
      </View>
    );
  }
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    hero: { justifyContent: 'space-between', backgroundColor: colors.cardHigh },
    heroTop: { flexDirection: 'row' },
    heroBottom: { paddingBottom: spacing.lg, gap: 2 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    about: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
  });
