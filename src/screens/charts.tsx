import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  CHART_COUNTRIES,
  chartCountry,
  chartCountryName,
  summariseChart,
} from '@/src/discovery/chart-countries';
import {
  CHART_MARKET_COUNT,
  chartsStore,
  getCountryChart,
  type ChartEntry,
} from '@/src/discovery/charts';
import { playerStore } from '@/src/audio/player';
import { formatRelativeTime } from '@/src/core/format';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Sheet } from '@/src/ui/sheet';
import { ChartRow } from '@/src/ui/chart-row';
import { Txt } from '@/src/ui/text';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

/**
 * The charts.
 *
 * Worldwide first, then the individual markets it is built from. The board is
 * shared with Home and kept on disk, so opening this page shows the last one
 * immediately and only waits on the network when there is nothing to show.
 *
 * The footnote is not decoration: a chart with no stated method is a number
 * someone made up, and this one is a points table across published charts. It
 * says how many markets are actually in today's board, because some days a
 * storefront does not answer and the honest thing is to admit it.
 */
export function ChartsScreen() {
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const { colors } = useTheme();
  // The country this listener follows, remembered; tap the title to change it.
  const { code: market } = useStore(chartCountry);
  const setMarket = (code: string) => chartCountry.choose(code);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void chartCountry.load();
  }, []);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [{ code: 'global', name: 'Worldwide' }, ...CHART_COUNTRIES];
    return q ? all.filter((c) => c.name.toLowerCase().includes(q) || c.code === q) : all;
  }, [query]);

  const global = useStore(chartsStore);
  useEffect(() => {
    void chartsStore.open();
  }, []);

  const country = useAsync<ChartEntry[]>(
    () => (market === 'global' ? Promise.resolve([]) : getCountryChart(market, 50)),
    [market],
    { enabled: market !== 'global' },
  );

  const worldwide = market === 'global';
  const entries = worldwide ? (global.board?.entries.slice(0, 50) ?? []) : (country.data ?? []);
  const loading = worldwide ? global.loading && !global.board : country.loading && !country.data;
  const refreshing = worldwide ? global.refreshing : country.refreshing;
  const error = worldwide ? (global.board ? null : global.error) : country.error;
  const reload = () => (worldwide ? void chartsStore.refresh() : country.reload());

  const tracks = entries.map((entry) => entry.track);
  const marketName = chartCountryName(market);
  const summary = !worldwide && entries.length > 0 ? summariseChart(entries) : null;
  const markets = global.board?.markets ?? CHART_MARKET_COUNT;

  return (
    <Screen>
      <PageHeader title="Most played" />

      {/* Whose chart: tap to search for any country with a published chart. */}
      <View style={{ paddingHorizontal: gutter, gap: spacing.md, paddingBottom: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Chart for ${marketName}. Change country`}
          onPress={() => setPicking(true)}
          style={({ pressed }) => [
            styles.country,
            { borderColor: colors.border, backgroundColor: colors.card },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name={worldwide ? 'globe-outline' : 'flag-outline'} size={20} color={colors.accentInk} />
          <View style={{ flex: 1 }}>
            <Txt variant="title3">{marketName}</Txt>
            <Txt variant="caption" tone="muted">
              {worldwide
                ? global.board
                  ? `Updated ${formatRelativeTime(global.board.builtAt)} · tap to pick your country`
                  : 'Tap to pick your country'
                : 'Top 50 most played · tap to change'}
            </Txt>
          </View>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </Pressable>

        {summary && (
          <View style={[styles.summary, { borderColor: colors.border }]}>
            <Fact label="Number 1" value={summary.number1?.track.title ?? '—'} detail={summary.number1?.track.artistName} />
            <Fact
              label="Most songs in the chart"
              value={summary.topArtist?.name ?? '—'}
              detail={summary.topArtist ? `${summary.topArtist.songs} songs` : undefined}
            />
            <Fact
              label="Top genre"
              value={summary.topGenre?.name ?? '—'}
              detail={summary.topGenre ? `${summary.topGenre.songs} of ${entries.length}` : undefined}
            />
          </View>
        )}
      </View>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Choose a country">
        <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search countries"
            placeholderTextColor={colors.textFaint}
            autoFocus
            accessibilityLabel="Search countries"
            style={[styles.search, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          <View>
            {matches.slice(0, 60).map((country) => (
              <Pressable
                key={country.code}
                accessibilityRole="button"
                onPress={() => {
                  setMarket(country.code);
                  setPicking(false);
                  setQuery('');
                }}
                style={({ pressed }) => [styles.countryRow, pressed && { opacity: 0.7 }]}
              >
                <Txt variant="body" style={{ flex: 1 }}>
                  {country.name}
                </Txt>
                {country.code === market && <Ionicons name="checkmark" size={18} color={colors.accentInk} />}
              </Pressable>
            ))}
            {matches.length === 0 && (
              <Txt variant="caption" tone="muted">
                No chart is published for that country.
              </Txt>
            )}
          </View>
        </View>
      </Sheet>

      {loading ? (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonRows count={10} />
        </View>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => `${entry.position}-${entry.track.id}`}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={8}
          removeClippedSubviews
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          renderItem={({ item, index }) => (
            <ChartRow
              entry={item}
              markets={markets}
              onPress={() =>
                void playerStore.playQueue(tracks, {
                  startIndex: index,
                  context: 'recommendation',
                  contextLabel: worldwide ? 'Worldwide chart' : `${marketName} chart`,
                })
              }
              onMore={() => actions.openTrack(item.track, { queue: tracks })}
            />
          )}
          ListFooterComponent={
            entries.length > 0 ? (
              <Txt variant="caption" tone="faint" style={styles.footnote}>
                {worldwide
                  ? `Built from the published most-played charts of ${markets} market${markets === 1 ? '' : 's'}${
                      markets < CHART_MARKET_COUNT
                        ? ` — ${CHART_MARKET_COUNT - markets} of the usual ${CHART_MARKET_COUNT} did not answer today`
                        : ''
                    }. A song scores for how high it sits in each one, so reach across countries counts for more than a single number one. Movement is measured against yesterday's board.`
                  : 'The published most-played chart for this market, in order.'}
              </Txt>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="podium-outline"
              title="No chart right now"
              message="The chart could not be reached. It will fill in once you are back online."
              compact
            />
          }
        />
      )}
    </Screen>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 120, gap: 2 }}>
      <Txt variant="micro" tone="muted" uppercase>
        {label}
      </Txt>
      <Txt variant="callout" numberOfLines={2}>
        {value}
      </Txt>
      {!!detail && (
        <Txt variant="caption" tone="faint" numberOfLines={1}>
          {detail}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  footnote: { marginTop: spacing.xl, marginBottom: spacing.lg },
  country: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  search: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    fontSize: 15,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
});
