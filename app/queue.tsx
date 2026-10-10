import { FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { playerStore } from '@/src/audio/player';
import { useStore } from '@/src/hooks/use-store';
import { useResponsive } from '@/src/hooks/use-responsive';
import { Txt } from '@/src/ui/text';
import { IconButton } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { EmptyState } from '@/src/ui/states';
import { spacing } from '@/src/theme/tokens';
import { useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/** What is playing next, and the ability to change it. */
export default function QueueScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const player = useStore(playerStore);

  const upcoming = player.queue.slice(player.index + 1);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <IconButton name="chevron-down" label="Close the queue" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Txt variant="title3">Up next</Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {player.contextLabel ?? 'Your queue'}
          </Txt>
        </View>
        {player.queue.length > 0 && (
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

      {player.current && (
        <View style={{ paddingHorizontal: gutter, paddingBottom: spacing.md }}>
          <Txt variant="micro" tone="accent" uppercase style={{ marginBottom: spacing.sm }}>
            Now playing
          </Txt>
          <TrackRow track={player.current} isPlaying onPress={() => router.back()} />
        </View>
      )}

      <FlatList
        data={upcoming}
        keyExtractor={(item) => item.id}
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
            message="Add songs from any list with Play next or Add to queue."
            compact
          />
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundElevated },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  });
