import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatCount, formatListeningTime, monthName } from '@/src/core/format';
import {
  getDiscoveryStats,
  getListeningTrend,
  getStatsSummary,
  getTopAlbums,
  getTopArtists,
  getTopGenres,
  getTopTracks,
  type StatsRange,
} from '@/src/db/repos/history';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useShareSheet } from '@/src/ui/share-sheet';
import { statsShare } from '@/src/share/share';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { IconButton, SegmentedControl } from '@/src/ui/buttons';
import { SectionHeader } from '@/src/ui/section';
import { StatTile } from '@/src/ui/cards';
import { EmptyState, ErrorState, ProgressBar, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

const RANGES: { value: StatsRange; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

const RANGE_TITLE: Record<StatsRange, string> = {
  week: 'This week',
  month: monthName(),
  year: `${new Date().getFullYear()}`,
  all: 'All time',
};

/**
 * Listening statistics.
 *
 * Every number here is an aggregate over measured listening time, not a play
 * counter. That is why the totals hold up: a song you skipped after four
 * seconds does not count as a play.
 */
export default function StatsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const share = useShareSheet();

  const [range, setRange] = useState<StatsRange>('month');

  const state = useAsync(async () => {
    const [summary, tracks, artists, albums, genres, discovery, trend] = await Promise.all([
      getStatsSummary(range),
      getTopTracks(range, 10),
      getTopArtists(range, 10),
      getTopAlbums(range, 8),
      getTopGenres(range, 6),
      getDiscoveryStats(range),
      getListeningTrend(range === 'week' ? 'day' : range === 'month' ? 'day' : 'month', range),
    ]);
    return { summary, tracks, artists, albums, genres, discovery, trend };
  }, [range]);

  const data = state.data;
  const trendMax = useMemo(
    () => Math.max(1, ...(data?.trend ?? []).map((point) => point.msPlayed)),
    [data?.trend],
  );

  return (
    <Screen>
      <PageHeader
        title="Your listening"
        subtitle={RANGE_TITLE[range]}
        right={
          data && data.summary.totalMs > 0 ? (
            <IconButton
              name="share-outline"
              label="Share your statistics"
              onPress={() =>
                share(
                  statsShare({
                    periodLabel: RANGE_TITLE[range],
                    totalMs: data.summary.totalMs,
                    artistCount: data.summary.artistCount,
                    trackCount: data.summary.trackCount,
                    topArtist: data.artists[0]?.name ?? null,
                    artworkUrl: data.artists[0]?.imageUrl ?? data.tracks[0]?.track.artworkUrl,
                  }),
                )
              }
            />
          ) : undefined
        }
      />

      <View style={{ paddingHorizontal: gutter, marginBottom: spacing.lg }}>
        <SegmentedControl<StatsRange> value={range} onChange={setRange} options={RANGES} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        {state.loading && !data ? (
          <SkeletonRows count={6} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : !data || data.summary.playCount === 0 ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Nothing measured yet"
            message="Play some music and Pulse will start building a real picture of your listening."
            actionLabel="Find music"
            onAction={() => router.push('/discover')}
          />
        ) : (
          <>
            {/* Headline */}
            <View style={styles.headline}>
              <Txt variant="micro" tone="muted" uppercase>
                {RANGE_TITLE[range]}
              </Txt>
              <Txt variant="display" style={{ marginTop: 4 }}>
                {formatListeningTime(data.summary.totalMs)}
              </Txt>
              <Txt variant="body" tone="muted">
                listening time
              </Txt>
            </View>

            <View style={styles.tiles}>
              <StatTile value={formatCount(data.summary.artistCount)} label="artists" />
              <StatTile value={formatCount(data.summary.trackCount)} label="songs" />
              <StatTile value={formatCount(data.summary.albumCount)} label="albums" />
            </View>
            <View style={[styles.tiles, { marginTop: spacing.md }]}>
              <StatTile value={formatCount(data.summary.playCount)} label="plays" />
              <StatTile
                value={`${Math.round(data.summary.completionRate * 100)}%`}
                label="finished"
              />
              <StatTile value={formatCount(data.discovery.newTracks)} label="new songs" />
            </View>

            {/* Trend */}
            {data.trend.length > 1 && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader
                  title="Listening trend"
                  subtitle={range === 'year' || range === 'all' ? 'By month' : 'By day'}
                />
                <View style={styles.chart}>
                  {data.trend.slice(-24).map((point) => (
                    <View key={point.key} style={styles.bar}>
                      <View
                        style={{
                          height: Math.max(3, (point.msPlayed / trendMax) * 96),
                          backgroundColor: colors.accent,
                          borderRadius: 3,
                          width: '100%',
                        }}
                      />
                    </View>
                  ))}
                </View>
                <View style={styles.chartLabels}>
                  <Txt variant="caption" tone="faint">
                    {data.trend.slice(-24)[0]?.key}
                  </Txt>
                  <Txt variant="caption" tone="faint">
                    {data.trend[data.trend.length - 1]?.key}
                  </Txt>
                </View>
              </View>
            )}

            {/* Top artists */}
            {data.artists.length > 0 && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader title="Top artists" />
                {data.artists.map((artist, index) => (
                  <Pressable
                    key={artist.name}
                    accessibilityRole="button"
                    accessibilityLabel={artist.name}
                    disabled={!artist.artistId}
                    onPress={() =>
                      artist.artistId &&
                      router.push(`/artist/${encodeURIComponent(artist.artistId)}`)
                    }
                    style={({ pressed }) => [styles.rankRow, pressed && { opacity: 0.7 }]}
                  >
                    <Txt variant="callout" tone="muted" style={{ width: 20 }}>
                      {index + 1}
                    </Txt>
                    <Artwork uri={artist.imageUrl} size={44} rounded />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {artist.name}
                      </Txt>
                      <Txt variant="caption" tone="muted">
                        {artist.plays} play{artist.plays === 1 ? '' : 's'}
                      </Txt>
                    </View>
                    <Txt variant="callout" tone="accent">
                      {formatListeningTime(artist.msPlayed)}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Top songs */}
            {data.tracks.length > 0 && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader title="Most played songs" />
                {data.tracks.map((entry, index) => (
                  <Pressable
                    key={entry.track.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/track/${encodeURIComponent(entry.track.id)}`)}
                    style={({ pressed }) => [styles.rankRow, pressed && { opacity: 0.7 }]}
                  >
                    <Txt variant="callout" tone="muted" style={{ width: 20 }}>
                      {index + 1}
                    </Txt>
                    <Artwork uri={entry.track.artworkUrl} size={44} radius={radii.sm} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {entry.track.title}
                      </Txt>
                      <Txt variant="caption" tone="muted" numberOfLines={1}>
                        {entry.track.artistName}
                      </Txt>
                    </View>
                    <Txt variant="callout" tone="accent">
                      {entry.plays}×
                    </Txt>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Top albums */}
            {data.albums.length > 0 && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader title="Most played albums" />
                {data.albums.map((album, index) => (
                  <Pressable
                    key={`${album.albumId}-${index}`}
                    accessibilityRole="button"
                    disabled={!album.albumId}
                    onPress={() =>
                      album.albumId && router.push(`/album/${encodeURIComponent(album.albumId)}`)
                    }
                    style={({ pressed }) => [styles.rankRow, pressed && { opacity: 0.7 }]}
                  >
                    <Txt variant="callout" tone="muted" style={{ width: 20 }}>
                      {index + 1}
                    </Txt>
                    <Artwork uri={album.artworkUrl} size={44} radius={radii.sm} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {album.title}
                      </Txt>
                      <Txt variant="caption" tone="muted" numberOfLines={1}>
                        {album.artistName}
                      </Txt>
                    </View>
                    <Txt variant="callout" tone="accent">
                      {formatListeningTime(album.msPlayed)}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Genres */}
            {data.genres.length > 0 && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader title="Favourite genres" />
                <View style={{ gap: spacing.md }}>
                  {data.genres.map((genre) => (
                    <View key={genre.genre} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Txt variant="callout">{genre.genre}</Txt>
                        <Txt variant="caption" tone="muted">
                          {Math.round(genre.share * 100)}%
                        </Txt>
                      </View>
                      <ProgressBar progress={genre.share} height={6} />
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Discovery */}
            <View style={{ marginTop: spacing.xxl }}>
              <SectionHeader title="Discovery" subtitle="How much was new to you" />
              <View style={[styles.tiles, isTabletUp && { maxWidth: 520 }]}>
                <StatTile value={formatCount(data.discovery.newTracks)} label="new songs" />
                <StatTile value={formatCount(data.discovery.newArtists)} label="new artists" />
                <StatTile value={formatCount(data.summary.skipCount)} label="skips" />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    headline: {
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.xl,
      borderRadius: radii.xl,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
      marginBottom: spacing.lg,
    },
    tiles: { flexDirection: 'row', gap: spacing.md },
    chart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 3,
      height: 100,
      paddingHorizontal: spacing.xs,
    },
    bar: { flex: 1, justifyContent: 'flex-end' },
    chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
    rankRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 8,
    },
  });
