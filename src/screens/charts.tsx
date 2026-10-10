import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  CHART_MARKETS,
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
import { Chip } from '@/src/ui/buttons';
import { ChartRow } from '@/src/ui/chart-row';
import { Txt } from '@/src/ui/text';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { spacing } from '@/src/theme/tokens';

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
  const [market, setMarket] = useState('global');

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
  const marketName = CHART_MARKETS.find((m) => m.code === market)?.name ?? 'Worldwide';
  const markets = global.board?.markets ?? CHART_MARKET_COUNT;

  return (
    <Screen>
      <PageHeader
        title="Most played"
        subtitle={
          worldwide
            ? global.board
              ? `Worldwide · updated ${formatRelativeTime(global.board.builtAt)}`
              : 'Worldwide'
            : marketName
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingBottom: spacing.md }}
      >
        {CHART_MARKETS.map((entry) => (
          <Chip
            key={entry.code}
            label={entry.name}
            active={market === entry.code}
            onPress={() => setMarket(entry.code)}
          />
        ))}
      </ScrollView>

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

const styles = StyleSheet.create({
  footnote: { marginTop: spacing.xl, marginBottom: spacing.lg },
});
