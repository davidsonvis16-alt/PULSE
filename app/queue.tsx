import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { playerStore } from '@/src/audio/player';
import { getRecentlyPlayed } from '@/src/db/repos/history';
import { useAsync } from '@/src/hooks/use-async';
import { useStore } from '@/src/hooks/use-store';
import { useResponsive } from '@/src/hooks/use-responsive';
import { Txt } from '@/src/ui/text';
import { IconButton, SegmentedControl } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { EmptyState } from '@/src/ui/states';
import { spacing } from '@/src/theme/tokens';
import { useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type Tab = 'queue' | 'recent';
const TABS = [
  { value: 'queue' as const, label: 'Queue' },
  { value: 'recent' as const, label: 'Recently played' },
];

/** The phone's queue: what is playing, what comes next, and what played before. */
export default function QueueScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const player = useStore(playerStore);
  const [tab, setTab] = useState<Tab>('queue');
  const recents = useAsync(() => getRecentlyPlayed(40), [player.current?.id]);

  const upcoming = player.queue.slice(player.index + 1);
  const recent = (recents.data ?? []).filter((t) => t.id !== player.current?.id);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <IconButton name="chevron-down" label="Close the queue" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Txt variant="title3">{tab === 'queue' ? 'Up next' : 'Recently played'}</Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {tab === 'queue' ? (player.contextLabel ?? 'Your queue') : 'Newest first'}
          </Txt>
        </View>
        {tab === 'queue' && player.queue.length > 0 && (
          <IconButton
            name="trash-outline"
            label="Clear the queue"
            onPress={() => {
              playerStore.clearQueue();
              router.back();
            }}
          />
        )}
      </View>
      <View style={{ paddingHorizontal: gutter, paddingBottom: spacing.md }}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </View>

      {tab === 'queue' && player.current && (
        <View style={{ paddingHorizontal: gutter, paddingBottom: spacing.md }}>
          <Txt variant="micro" tone="accent" uppercase style={{ marginBottom: spacing.sm }}>
            Now playing
          </Txt>
          <TrackRow track={player.current} isPlaying onPress={() => router.back()} />
        </View>
      )}

      {tab === 'queue' ? (
        <FlatList
          data={upcoming}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.xxxl }}
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              onPress={() => void playerStore.jumpTo(player.index + 1 + index)}
              onMore={() => playerStore.removeFromQueue(item.id)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="list-outline"
              title="Nothing queued"
              message="Double-tap any song to play it next, or use Add to queue in its menu."
              compact
            />
          }
        />
      ) : (
        <FlatList
          data={recent}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.xxxl }}
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              onPress={() =>
                void playerStore.playQueue(recent, { startIndex: index, context: 'library', contextLabel: 'Recently played' })
              }
            />
          )}
          ListEmptyComponent={<EmptyState icon="time-outline" title="Nothing played yet" compact />}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundElevated },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  });
