import { Pressable, ScrollView, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/src/core/types';
import { formatDuration } from '@/src/core/format';
import { playerStore } from '@/src/audio/player';
import { getRecentlyPlayed } from '@/src/db/repos/history';
import { useAsync } from '@/src/hooks/use-async';
import { useStore } from '@/src/hooks/use-store';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { queuePanel } from '@/src/ui/queue-panel-store';
import { layout, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type PressState = PressableStateCallbackType & { hovered?: boolean };

/**
 * The panel on the right of a laptop window: what is playing, what comes
 * next, and what played before — the way desktop music apps keep the queue
 * in view beside the page instead of behind a button.
 */
export function QueuePanel() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const panel = useStore(queuePanel);
  const player = useStore(playerStore);
  // Every change of song is a new entry in the recents.
  const recents = useAsync(() => getRecentlyPlayed(40), [player.current?.id, panel.tab]);

  const upcoming = player.queue.map((item, index) => ({ item, index })).slice(player.index + 1);
  const recent = (recents.data ?? []).filter((t) => t.id !== player.current?.id);

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        {(
          [
            ['queue', 'Queue'],
            ['recent', 'Recently played'],
          ] as const
        ).map(([tab, label]) => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: panel.tab === tab }}
            onPress={() => queuePanel.setTab(tab)}
            style={styles.tab}
          >
            <Txt variant="callout" style={{ color: panel.tab === tab ? colors.text : colors.textMuted }}>
              {label}
            </Txt>
            {panel.tab === tab && <View style={[styles.tabLine, { backgroundColor: colors.accentInk }]} />}
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the queue panel"
          hitSlop={8}
          onPress={() => queuePanel.setOpen(false)}
          style={(s: PressState) => [styles.close, s.hovered && { backgroundColor: colors.card }]}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
        {panel.tab === 'queue' ? (
          <>
            {player.current ? (
              <>
                <Txt variant="bodyStrong" style={styles.groupTitle}>
                  Now playing
                </Txt>
                <Row track={player.current} playing onPress={() => playerStore.toggle()} />
              </>
            ) : (
              <Txt variant="caption" tone="muted" style={styles.groupTitle}>
                Nothing playing.
              </Txt>
            )}

            <View style={styles.groupHead}>
              <Txt variant="bodyStrong">Next up</Txt>
              {upcoming.length > 0 && (
                <Pressable accessibilityRole="button" hitSlop={6} onPress={() => playerStore.clearQueue()}>
                  <Txt variant="caption" tone="muted">
                    Clear queue
                  </Txt>
                </Pressable>
              )}
            </View>
            {upcoming.length === 0 ? (
              <Txt variant="caption" tone="muted" style={{ paddingHorizontal: spacing.md }}>
                Nothing queued after this song. Double-tap any song to play it next.
              </Txt>
            ) : (
              upcoming.map(({ item, index }) => (
                <Row
                  key={`${item.id}-${index}`}
                  track={item}
                  onPress={() => void playerStore.jumpTo(index)}
                  onRemove={() => playerStore.removeFromQueue(item.id)}
                />
              ))
            )}
          </>
        ) : recent.length === 0 ? (
          <Txt variant="caption" tone="muted" style={styles.groupTitle}>
            Nothing played yet.
          </Txt>
        ) : (
          recent.map((track, index) => (
            <Row
              key={`${track.id}-${index}`}
              track={track}
              onPress={() =>
                void playerStore.playQueue(recent, { startIndex: index, context: 'library', contextLabel: 'Recently played' })
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Row({
  track,
  playing,
  onPress,
  onRemove,
}: {
  track: Track;
  playing?: boolean;
  onPress: () => void;
  onRemove?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${track.artistName}`}
      onPress={onPress}
      style={(s: PressState) => [styles.row, s.hovered && { backgroundColor: colors.card }]}
    >
      {(s: PressState) => (
        <>
          <Artwork uri={track.artworkUrl} size={44} radius={radii.xs} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="callout" numberOfLines={1} style={playing && { color: colors.accentInk }}>
              {track.title}
            </Txt>
            <Pressable
              accessibilityRole="link"
              hitSlop={4}
              onPress={() =>
                track.artistId
                  ? router.push(`/artist/${encodeURIComponent(track.artistId)}`)
                  : router.push({ pathname: '/discover', params: { q: track.artistName } })
              }
            >
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {track.artistName}
              </Txt>
            </Pressable>
          </View>
          {onRemove && s.hovered ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove from queue" hitSlop={8} onPress={onRemove}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          ) : (
            <Txt variant="caption" tone="faint">
              {formatDuration(track.durationMs)}
            </Txt>
          )}
        </>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      width: layout.queuePanelWidth,
      margin: spacing.sm,
      marginLeft: 0,
      marginBottom: 0,
      borderRadius: 14,
      backgroundColor: colors.backgroundElevated,
      overflow: 'hidden',
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSoft,
    },
    tab: { paddingVertical: spacing.sm, gap: 6 },
    tabLine: { height: 2, borderRadius: 1 },
    close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    groupTitle: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xl,
      paddingBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginHorizontal: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radii.sm,
    },
  });
