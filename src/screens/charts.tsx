import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import {
  CHART_MARKETS,
  getCountryChart,
  getGlobalChart,
  type ChartEntry,
} from '@/src/discovery/charts';
import { playerStore } from '@/src/audio/player';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useTrackActions } from '@/src/ui/track-actions';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Chip } from '@/src/ui/buttons';
import { ChartRow } from '@/src/ui/chart-row';
import { Txt } from '@/src/ui/text';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { spacing } from '@/src/theme/tokens';

/** How many markets the worldwide board is assembled from. */
const MARKET_COUNT = 12;

/**
 * The charts.
 *
 * Worldwide first, then the individual markets it is built from. The footnote
 * is not decoration: a chart with no stated method is a number someone made up,
 * and this one is a points table across twelve published charts.
 */
export function ChartsScreen() {
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const [market, setMarket] = useState('global');

  const chart = useAsync<ChartEntry[]>(
    () => (market === 'global' ? getGlobalChart({ limit: 50 }) : getCountryChart(market, 50)),
    [market],
  );

  const entries = chart.data ?? [];
  const tracks = entries.map((entry) => entry.track);
  const marketName = CHART_MARKETS.find((m) => m.code === market)?.name ?? 'Worldwide';

  return (
    <Screen>
      <PageHeader
        title="Most played"
        subtitle={market === 'global' ? `Worldwide · top ${entries.length || 50}` : marketName}
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

      {chart.loading && !chart.data ? (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonRows count={10} />
        </View>
      ) : chart.error ? (
        <ErrorState error={chart.error} onRetry={chart.reload} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => `${entry.position}-${entry.track.id}`}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
          initialNumToRender={12}
          windowSize={8}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <ChartRow
              entry={item}
              markets={MARKET_COUNT}
              onPress={() =>
                void playerStore.playQueue(tracks, {
                  startIndex: index,
                  context: 'recommendation',
                  contextLabel: market === 'global' ? 'Worldwide chart' : `${marketName} chart`,
                })
              }
              onMore={() => actions.openTrack(item.track, { queue: tracks })}
            />
          )}
          ListFooterComponent={
            entries.length > 0 ? (
              <Txt variant="caption" tone="faint" style={styles.footnote}>
                {market === 'global'
                  ? `Built from the published most-played charts of ${MARKET_COUNT} markets. A song scores for how high it sits in each one, so reach across countries counts for more than a single number one. Movement is measured against yesterday's board.`
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
