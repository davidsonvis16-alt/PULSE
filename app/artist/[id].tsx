import { useState } from "react";
import {
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { ownedByArtist, ownedMatchOf } from "@/src/library/owned";
import { Ionicons } from "@expo/vector-icons";
import type { Album, Artist, MusicEvent, Track } from "@/src/core/types";
import { formatCount, formatShortDate, pluralize } from "@/src/core/format";
import { deezerMostPlayed } from "@/src/providers/music/adapters/deezer";
import { getArtistFacts, type ArtistFacts } from "@/src/discovery/artist-facts";
import { similarity } from "@/src/ingestion/identify/text";
import { EditorialCard } from "@/src/ui/editorial";
import { providerFor } from "@/src/providers/music";
import { eventProvider } from "@/src/providers/events";
import { upsertArtist } from "@/src/db/repos/catalog";
import { cacheEvents } from "@/src/db/repos/events";
import { playerStore } from "@/src/audio/player";
import { downloadManager } from "@/src/downloads/manager";
import { useAsync } from "@/src/hooks/use-async";
import { useResponsive } from "@/src/hooks/use-responsive";
import { useStore } from "@/src/hooks/use-store";
import { useFollowState } from "@/src/hooks/use-library-state";
import { useTrackActions } from "@/src/ui/track-actions";
import { useShareSheet } from "@/src/ui/share-sheet";
import { useToast } from "@/src/ui/toast";
import { artistShare } from "@/src/share/share";
import { useBottomInset } from "@/src/ui/screen";
import { Txt } from "@/src/ui/text";
import { Button, Chip, IconButton } from "@/src/ui/buttons";
import { TrackRow } from "@/src/ui/rows";
import { ArtistCard, EventCard } from "@/src/ui/cards";
import { SectionHeader, Shelf } from "@/src/ui/section";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonRows,
} from "@/src/ui/states";
import { radii, spacing } from "@/src/theme/tokens";
import { useTheme, useThemedStyles, type ThemeColors } from "@/src/theme/theme";

type Tab = "popular" | "albums" | "singles" | "about";

interface ArtistPageData {
  artist: Artist;
  topTracks: Track[];
  albums: Album[];
  singles: Album[];
  related: Artist[];
  events: MusicEvent[];
  /** Their songs already on this phone. */
  mine: Track[];
  /** Popular songs they already have (ticked, played from their own copy). */
  owned: Set<string>;
  /** Their most played songs of all time, most played first. */
  mostPlayed: Track[];
  facts: ArtistFacts | null;
  /** How many of each release's songs they already have, by release id. */
  ownedPerRelease: Record<string, number>;
}

/** "Thank U, Next (Deluxe)" and "thank u, next" are the same release. */
const releaseKey = (title: string | null | undefined) =>
  (title ?? "")
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/\s+-\s+(single|ep)$/i, "")
    .trim();

const MOST_PLAYED_SHOWN = 10;

/** The artist page: their music, their latest, and where to see them live. */
export default function ArtistScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    gutter,
    pageWidth: width,
    shelfCardWidth,
    isTabletUp,
  } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();
  const downloads = useStore(downloadManager);

  const [tab, setTab] = useState<Tab>("popular");
  const [allPlayed, setAllPlayed] = useState(false);
  const [allMine, setAllMine] = useState(false);

  const state = useAsync<ArtistPageData>(async () => {
    const artistId = decodeURIComponent(id ?? "");
    const provider = providerFor(artistId.split(":")[0]);
    const artist = await provider.getArtist(artistId);
    if (!artist)
      throw new Error("That artist is not available from this source.");
    await upsertArtist(artist);

    const [topTracks, albums, singles, related, ranked, facts] =
      await Promise.all([
        provider.getArtistTopTracks(artistId, 50).catch(() => [] as Track[]),
        provider.getArtistAlbums(artistId, 100).catch(() => [] as Album[]),
        provider.getArtistSingles(artistId, 100).catch(() => [] as Album[]),
        provider.getRelatedArtists(artistId, 12).catch(() => [] as Artist[]),
        deezerMostPlayed(artist.name, 100).catch(() => [] as Track[]),
        getArtistFacts(artist.name).catch(() => null),
      ]);
    // Ranked by plays when the play counts are known; the catalogue's own order otherwise.
    const mostPlayed = ranked.length >= 5 ? ranked : topTracks;

    let events: MusicEvent[] = [];
    const live = eventProvider();
    if (live.isConfigured()) {
      events = await live
        .searchEvents({ artistName: artist.name, limit: 6 })
        .catch(() => []);
      void cacheEvents(events);
    }

    // Their own copies play in full, and their own songs by this artist lead the page.
    const [ownedMatches, mine] = await Promise.all([
      Promise.all(mostPlayed.map((t) => ownedMatchOf(t).catch(() => null))),
      ownedByArtist(artist.name).catch(() => [] as Track[]),
    ]);
    const owned = new Set(
      mostPlayed.filter((_, i) => !!ownedMatches[i]).map((t) => t.id),
    );
    // Which of their releases they already have songs from.
    const ownedPerRelease: Record<string, number> = {};
    for (const release of [...albums, ...singles]) {
      const key = releaseKey(release.title);
      if (!key) continue;
      const count = mine.filter((t) => {
        const theirs = releaseKey(t.albumTitle);
        return !!theirs && (theirs === key || similarity(theirs, key) >= 0.85);
      }).length;
      // A single is named after its song: owning the song is owning the single.
      const single =
        release.albumType !== "album" &&
        mine.some((t) => similarity(releaseKey(t.title), key) >= 0.85);
      if (count || single)
        ownedPerRelease[release.id] = Math.max(count, single ? 1 : 0);
    }
    const newestFirst = (list: Album[]) =>
      [...list].sort((a, b) =>
        (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
      );

    return {
      artist,
      topTracks,
      mostPlayed,
      facts,
      ownedPerRelease,
      owned,
      albums: newestFirst(albums),
      singles: newestFirst(singles),
      related,
      events,
      mine,
    };
  }, [id]);

  const artist = state.data?.artist;
  const follow = useFollowState(artist);

  const heroHeight = Math.min(isTabletUp ? 380 : width * 0.92, 420);

  if (state.error) {
    return (
      <View style={styles.root}>
        <View style={{ paddingTop: insets.top }}>
          <IconButton
            name="chevron-back"
            label="Go back"
            onPress={() => router.back()}
          />
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
          imageStyle={{ resizeMode: "cover" }}
        >
          <LinearGradient
            colors={[
              "rgba(8,9,10,0.55)",
              "rgba(8,9,10,0.1)",
              colors.background,
            ]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.heroTop,
              {
                paddingTop: insets.top + spacing.sm,
                paddingHorizontal: gutter,
              },
            ]}
          >
            <IconButton
              name="chevron-back"
              label="Go back"
              background="surface"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
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
                <Txt variant="body" tone="secondary" numberOfLines={1}>
                  {[
                    state.data?.facts?.description ?? artist!.genre,
                    state.data?.facts?.country,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Txt>
                {!!state.data && (
                  <Txt variant="bodyStrong" tone="accent">
                    {state.data.mine.length > 0
                      ? `You have ${pluralize(state.data.mine.length, "song")} by ${artist!.name}`
                      : `You have none of their songs yet`}
                  </Txt>
                )}
              </>
            )}
          </View>
        </ImageBackground>

        {artist && (
          <>
            {/* Actions */}
            <View style={[styles.actions, { paddingHorizontal: gutter }]}>
              <Button
                label={follow.following ? "Following" : "Follow"}
                icon={follow.following ? "checkmark" : undefined}
                variant={follow.following ? "secondary" : "primary"}
                onPress={async () => {
                  const next = await follow.toggle();
                  toast(
                    next
                      ? `Following ${artist.name}. Pulse will tell you about new releases.`
                      : `Unfollowed ${artist.name}`,
                    next ? "success" : "default",
                  );
                }}
              />
              <IconButton
                name="play-circle"
                label="Play top songs"
                size={26}
                color={colors.accentInk}
                onPress={() =>
                  state.data?.mostPlayed.length &&
                  void playerStore.playQueue(state.data.mostPlayed, {
                    context: "artist",
                    contextLabel: artist.name,
                  })
                }
              />
              <IconButton
                name="shuffle"
                label="Shuffle their music"
                onPress={() =>
                  state.data?.mostPlayed.length &&
                  void playerStore.playQueue(state.data.mostPlayed, {
                    context: "artist",
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

            {/* The numbers, in small boxes. */}
            {!!state.data && (
              <FactBoxes
                facts={state.data.facts}
                mine={state.data.mine.length}
              />
            )}

            {/* Tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: gutter,
                gap: spacing.sm,
                paddingVertical: spacing.lg,
              }}
            >
              {(["popular", "albums", "singles", "about"] as Tab[]).map(
                (value) => (
                  <Chip
                    key={value}
                    label={value[0].toUpperCase() + value.slice(1)}
                    active={tab === value}
                    onPress={() => setTab(value)}
                  />
                ),
              )}
            </ScrollView>

            {state.loading ? (
              <View style={{ paddingHorizontal: gutter }}>
                <SkeletonRows count={5} />
              </View>
            ) : (
              <View style={{ paddingHorizontal: gutter }}>
                {tab === "popular" && (
                  <View style={{ gap: spacing.xl }}>
                    {/* What they already have by this artist comes first. */}
                    {state.data!.mine.length > 0 && (
                      <View>
                        <SectionHeader
                          title={`Your songs by ${artist.name}`}
                          subtitle={`${pluralize(state.data!.mine.length, "song")} on this phone · full length`}
                        />
                        {state
                          .data!.mine.slice(0, allMine ? undefined : 10)
                          .map((track, index) => (
                            <TrackRow
                              key={`mine-${track.id}`}
                              track={track}
                              showArtwork
                              onPress={() =>
                                void playerStore.playQueue(state.data!.mine, {
                                  startIndex: index,
                                  context: "library",
                                  contextLabel: `${artist.name} · your songs`,
                                })
                              }
                              onMore={() =>
                                actions.openTrack(track, {
                                  queue: state.data!.mine,
                                })
                              }
                            />
                          ))}
                        {state.data!.mine.length > 10 && (
                          <ShowMore
                            open={allMine}
                            total={state.data!.mine.length}
                            onToggle={() => setAllMine((v) => !v)}
                          />
                        )}
                      </View>
                    )}

                    <View>
                      <SectionHeader
                        title="Most played ever"
                        subtitle={`Their biggest songs, most played first · ${state.data!.owned.size} on your phone`}
                      />
                      {state.data!.mostPlayed.length === 0 ? (
                        <EmptyState
                          icon="musical-notes-outline"
                          title="No songs listed"
                          compact
                        />
                      ) : (
                        state
                          .data!.mostPlayed.slice(
                            0,
                            allPlayed ? undefined : MOST_PLAYED_SHOWN,
                          )
                          .map((track, index) => (
                            <TrackRow
                              key={track.id}
                              track={track}
                              index={index}
                              showArtwork
                              subtitleOverride={
                                state.data!.owned.has(track.id)
                                  ? `On your phone · ${track.albumTitle ?? artist.name}`
                                  : (track.albumTitle ?? artist.name)
                              }
                              trailing={
                                state.data!.owned.has(track.id) ? (
                                  <Ionicons
                                    name="checkmark-circle"
                                    size={20}
                                    color={colors.accentInk}
                                  />
                                ) : undefined
                              }
                              isDownloaded={
                                downloads.byTrackId[track.id]?.status ===
                                "completed"
                              }
                              onPress={() =>
                                void playerStore.playQueue(
                                  state.data!.mostPlayed,
                                  {
                                    startIndex: index,
                                    context: "artist",
                                    contextLabel: artist.name,
                                  },
                                )
                              }
                              onMore={() =>
                                actions.openTrack(track, {
                                  queue: state.data!.mostPlayed,
                                })
                              }
                            />
                          ))
                      )}
                      {state.data!.mostPlayed.length > MOST_PLAYED_SHOWN && (
                        <ShowMore
                          open={allPlayed}
                          total={state.data!.mostPlayed.length}
                          onToggle={() => setAllPlayed((v) => !v)}
                        />
                      )}
                    </View>

                    {state.data!.albums.length > 0 && (
                      <ReleaseRow
                        title="Albums"
                        releases={state.data!.albums}
                        onSeeAll={() => setTab("albums")}
                      />
                    )}
                    {state.data!.singles.length > 0 && (
                      <ReleaseRow
                        title="Singles & EPs"
                        releases={state.data!.singles}
                        onSeeAll={() => setTab("singles")}
                      />
                    )}
                  </View>
                )}

                {tab === "albums" && (
                  <ReleaseGrid
                    releases={state.data!.albums}
                    emptyLabel="No albums listed for this artist."
                  />
                )}
                {tab === "singles" && (
                  <ReleaseGrid
                    releases={state.data!.singles}
                    emptyLabel="No singles or EPs listed for this artist."
                  />
                )}

                {tab === "about" && (
                  <View style={styles.about}>
                    {[
                      [
                        "Genre",
                        [
                          state.data!.facts?.genre ?? artist.genre,
                          state.data!.facts?.style,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                      ],
                      ["From", state.data!.facts?.country],
                      ["Born", state.data!.facts?.born],
                      ["Started", state.data!.facts?.since],
                      ["Label", state.data!.facts?.label],
                      ["Releases", state.data!.facts?.releases],
                      [
                        "Fans",
                        state.data!.facts?.fans
                          ? formatCount(state.data!.facts.fans)
                          : null,
                      ],
                      [
                        "Listeners",
                        state.data!.facts?.listeners
                          ? formatCount(state.data!.facts.listeners)
                          : null,
                      ],
                      [
                        "Plays",
                        state.data!.facts?.plays
                          ? formatCount(state.data!.facts.plays)
                          : null,
                      ],
                      [
                        "On your phone",
                        pluralize(state.data!.mine.length, "song"),
                      ],
                    ]
                      .filter(
                        ([, value]) =>
                          value !== null && value !== undefined && value !== "",
                      )
                      .map(([label, value]) => (
                        <View key={String(label)} style={styles.factRow}>
                          <Txt
                            variant="caption"
                            tone="muted"
                            style={{ width: 110 }}
                          >
                            {label}
                          </Txt>
                          <Txt variant="callout" style={{ flex: 1 }}>
                            {String(value)}
                          </Txt>
                        </View>
                      ))}
                    {state.data!.facts?.biography ? (
                      <Txt variant="body" tone="secondary">
                        {state.data!.facts.biography}
                      </Txt>
                    ) : null}
                    <Txt variant="caption" tone="muted">
                      From TheAudioDB, Deezer, Last.fm and Wikipedia.
                    </Txt>
                    {artist.externalUrl && (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() =>
                          void WebBrowser.openBrowserAsync(artist.externalUrl!)
                        }
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
            {!!state.data?.singles.length && tab !== "about" && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader
                  title="Latest release"
                  subtitle={formatShortDate(state.data.singles[0].releaseDate)}
                  style={{ paddingHorizontal: gutter }}
                />
                <View style={{ paddingHorizontal: gutter }}>
                  <ReleaseCard
                    album={state.data.singles[0]}
                    width={isTabletUp ? 236 : 186}
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
                  onAction={() =>
                    router.push({
                      pathname: "/events",
                      params: { q: artist.name },
                    })
                  }
                  style={{ paddingHorizontal: gutter }}
                />
                <View style={{ paddingHorizontal: gutter, gap: spacing.md }}>
                  {state.data.events.slice(0, 3).map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onPress={() =>
                        event.ticket &&
                        void WebBrowser.openBrowserAsync(event.ticket.url)
                      }
                      onTickets={
                        event.ticket
                          ? () =>
                              void WebBrowser.openBrowserAsync(
                                event.ticket!.url,
                              )
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
                <SectionHeader
                  title="Related artists"
                  style={{ paddingHorizontal: gutter }}
                />
                <Shelf
                  data={state.data.related}
                  gutter={gutter}
                  keyExtractor={(item) => item.id}
                  renderItem={(item) => (
                    <ArtistCard
                      artist={item}
                      width={shelfCardWidth * 0.8}
                      onPress={() =>
                        router.push(`/artist/${encodeURIComponent(item.id)}`)
                      }
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

  /** A row of releases, newest first, each with its year. */
  function ReleaseRow({
    title,
    releases,
    onSeeAll,
  }: {
    title: string;
    releases: Album[];
    onSeeAll: () => void;
  }) {
    const have = releases.filter(
      (r) => state.data?.ownedPerRelease[r.id],
    ).length;
    return (
      <View>
        <SectionHeader
          title={title}
          subtitle={`${releases.length} in all${have ? ` · you have songs from ${have}` : ""} · swipe for more`}
          actionLabel="See all"
          onAction={onSeeAll}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -gutter }}
          contentContainerStyle={{ gap: spacing.md, paddingHorizontal: gutter }}
        >
          {releases.map((album) => (
            <ReleaseCard
              key={album.id}
              album={album}
              width={isTabletUp ? 236 : 186}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  /** A release as a tall card like Home's: cover on top, name and year below. */
  function ReleaseCard({
    album,
    width: cardWidth,
  }: {
    album: Album;
    width: number;
  }) {
    const owned = state.data?.ownedPerRelease[album.id] ?? 0;
    const year = album.releaseDate?.slice(0, 4);
    return (
      <EditorialCard
        overlay={false}
        kicker={
          owned ? `✓ ${pluralize(owned, "song")} yours` : (year ?? undefined)
        }
        title={album.title}
        subtitle={[
          year,
          album.trackCount ? pluralize(album.trackCount, "song") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        artworkUrl={album.artworkUrl}
        width={cardWidth}
        height={Math.round(cardWidth * 1.22)}
        onOpen={() => router.push(`/album/${encodeURIComponent(album.id)}`)}
      />
    );
  }

  function ShowMore({
    open,
    total,
    onToggle,
  }: {
    open: boolean;
    total: number;
    onToggle: () => void;
  }) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onToggle}
        style={styles.showMore}
      >
        <Txt variant="callout" tone="accent">
          {open ? "Show fewer" : `Show all ${total}`}
        </Txt>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.accentInk}
        />
      </Pressable>
    );
  }

  function FactBoxes({
    facts,
    mine,
  }: {
    facts: ArtistFacts | null;
    mine: number;
  }) {
    const boxes = [
      { value: String(mine), label: mine === 1 ? "song yours" : "songs yours" },
      facts?.listeners
        ? { value: formatCount(facts.listeners), label: "listeners" }
        : null,
      facts?.fans ? { value: formatCount(facts.fans), label: "fans" } : null,
      facts?.plays ? { value: formatCount(facts.plays), label: "plays" } : null,
      facts?.releases
        ? { value: String(facts.releases), label: "releases" }
        : null,
      facts?.since
        ? { value: String(facts.since), label: "started" }
        : facts?.born
          ? { value: String(facts.born), label: "born" }
          : null,
    ].filter((b): b is { value: string; label: string } => !!b);
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          gap: spacing.sm,
          paddingTop: spacing.lg,
        }}
      >
        {boxes.map((box) => (
          <View key={box.label} style={styles.factBox}>
            <Txt variant="title3">{box.value}</Txt>
            <Txt variant="caption" tone="muted">
              {box.label}
            </Txt>
          </View>
        ))}
      </ScrollView>
    );
  }

  function ReleaseGrid({
    releases,
    emptyLabel,
  }: {
    releases: Album[];
    emptyLabel: string;
  }) {
    if (releases.length === 0) {
      return <EmptyState icon="disc-outline" title={emptyLabel} compact />;
    }
    const columns = isTabletUp
      ? Math.max(4, Math.floor((width - gutter * 2) / 220))
      : 2;
    const cardWidth = Math.floor(
      (width - gutter * 2 - spacing.md * (columns - 1)) / columns,
    );
    return (
      <View style={styles.grid}>
        {releases.map((album) => (
          <ReleaseCard key={album.id} album={album} width={cardWidth} />
        ))}
      </View>
    );
  }
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    hero: { justifyContent: "space-between", backgroundColor: colors.cardHigh },
    heroTop: { flexDirection: "row" },
    heroBottom: { paddingBottom: spacing.lg, gap: 2 },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
    factBox: {
      minWidth: 92,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    factRow: {
      flexDirection: "row",
      gap: spacing.md,
      alignItems: "flex-start",
    },
    showMore: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: spacing.md,
    },
    about: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
  });
