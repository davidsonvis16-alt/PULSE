import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { downloadManager, formatBytes } from '@/src/downloads/manager';
import type { DownloadWithTrack } from '@/src/db/repos/downloads';
import { playerStore } from '@/src/audio/player';
import { useStore } from '@/src/hooks/use-store';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useTrackActions } from '@/src/ui/track-actions';
import { useToast } from '@/src/ui/toast';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Chip, IconButton } from '@/src/ui/buttons';
import { EmptyState, ProgressBar } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type Tab = 'active' | 'completed';
type Sort = 'recent' | 'title' | 'artist' | 'size';

const ACTIVE_STATES = ['queued', 'preparing', 'downloading', 'paused', 'failed'];

/**
 * The download manager.
 *
 * Shows what is actually happening to each file — preparing, a live percentage,
 * paused, failed with the reason — and gives the user the controls that go with
 * it. A completed download is a real file on the device with its cover art and
 * full metadata, which is what makes it playable with no connection.
 */
export function DownloadsScreen({ embedded }: { embedded?: boolean } = {}) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter } = useResponsive();
  const state = useStore(downloadManager);
  const actions = useTrackActions();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('completed');
  const [sort, setSort] = useState<Sort>('recent');

  const active = useMemo(
    () => state.items.filter((item) => ACTIVE_STATES.includes(item.status)),
    [state.items],
  );
  const completed = useMemo(() => {
    const done = state.items.filter((item) => item.status === 'completed');
    const sorted = [...done];
    if (sort === 'title') sorted.sort((a, b) => a.track.title.localeCompare(b.track.title));
    if (sort === 'artist') sorted.sort((a, b) => a.track.artistName.localeCompare(b.track.artistName));
    if (sort === 'size') sorted.sort((a, b) => b.totalBytes - a.totalBytes);
    if (sort === 'recent') sorted.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    return sorted;
  }, [state.items, sort]);

  const list = tab === 'active' ? active : completed;

  return (
    <View style={{ flex: 1 }}>
      {/* Storage */}
      <View style={[styles.storage, { marginHorizontal: gutter }]}>
        <View style={{ flex: 1 }}>
          <Txt variant="caption" tone="muted">
            Storage used
          </Txt>
          <Txt variant="title3">
            {formatBytes(state.storageBytes)}
            {state.freeDiskBytes != null && (
              <Txt variant="caption" tone="muted">
                {`  ·  ${formatBytes(state.freeDiskBytes)} free`}
              </Txt>
            )}
          </Txt>
          <Txt variant="caption" tone="faint">
            {state.storageCount} downloaded song{state.storageCount === 1 ? '' : 's'}
          </Txt>
        </View>
        {state.storageCount > 0 && (
          <IconButton
            name="trash-outline"
            label="Delete all downloads"
            background="surface"
            size={18}
            onPress={async () => {
              await downloadManager.removeAll();
              toast('All downloads removed');
            }}
          />
        )}
      </View>

      {/* Tabs */}
      <View style={[styles.tabs, { paddingHorizontal: gutter }]}>
        <TabButton label={`Downloading${active.length ? ` (${active.length})` : ''}`} active={tab === 'active'} onPress={() => setTab('active')} />
        <TabButton label="Downloaded" active={tab === 'completed'} onPress={() => setTab('completed')} />
      </View>

      {tab === 'completed' && completed.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingBottom: spacing.md }}
        >
          {(['recent', 'title', 'artist', 'size'] as Sort[]).map((option) => (
            <Chip
              key={option}
              label={option === 'recent' ? 'Recently added' : option[0].toUpperCase() + option.slice(1)}
              active={sort === option}
              onPress={() => setSort(option)}
            />
          ))}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: embedded ? spacing.xxxl : 120 }}
        showsVerticalScrollIndicator={false}
      >
        {list.length === 0 ? (
          <EmptyState
            icon={tab === 'active' ? 'cloud-download-outline' : 'arrow-down-circle-outline'}
            title={tab === 'active' ? 'Nothing downloading' : 'No downloads yet'}
            message={
              tab === 'active'
                ? 'Downloads you start will show their progress here.'
                : 'Download a song and it lands here, ready to play with no connection.'
            }
            actionLabel={tab === 'completed' ? 'Find music' : undefined}
            onAction={tab === 'completed' ? () => router.push('/discover') : undefined}
            compact
          />
        ) : (
          list.map((item) => (
            <DownloadRow
              key={item.id}
              item={item}
              onPlay={() =>
                void playerStore.playQueue(
                  completed.map((d) => d.track),
                  {
                    startIndex: Math.max(0, completed.findIndex((d) => d.id === item.id)),
                    context: 'downloads',
                    contextLabel: 'Downloads',
                  },
                )
              }
              onMore={() => actions.openTrack(item.track)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={styles.tab}>
      <Txt variant="callout" tone={active ? 'default' : 'muted'}>
        {label}
      </Txt>
      <View style={[styles.tabRule, active && { backgroundColor: colors.accent }]} />
    </Pressable>
  );
}

function DownloadRow({
  item,
  onPlay,
  onMore,
}: {
  item: DownloadWithTrack;
  onPlay: () => void;
  onMore: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const toast = useToast();
  const percent = Math.round(item.progress * 100);

  const statusLabel = (() => {
    switch (item.status) {
      case 'queued':
        return 'Waiting…';
      case 'preparing':
        return 'Preparing…';
      case 'downloading':
        return `Downloading ${percent}%`;
      case 'paused':
        return `Paused at ${percent}%`;
      case 'failed':
        return item.error ?? 'Download failed';
      case 'completed':
        return `${formatBytes(item.totalBytes)}${item.isExcerpt ? ' · preview' : ''}`;
      default:
        return item.status;
    }
  })();

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.track.title} by ${item.track.artistName}, ${statusLabel}`}
        onPress={item.status === 'completed' ? onPlay : undefined}
        style={({ pressed }) => [styles.rowMain, pressed && item.status === 'completed' && { opacity: 0.7 }]}
      >
        <Artwork uri={item.track.artworkUrl} size={48} radius={radii.sm} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {item.track.title}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {item.track.artistName}
          </Txt>
          <Txt
            variant="caption"
            tone={item.status === 'failed' ? 'danger' : item.status === 'completed' ? 'faint' : 'accent'}
            numberOfLines={1}
          >
            {statusLabel}
          </Txt>
        </View>

        <View style={styles.controls}>
          {item.status === 'downloading' && (
            <IconButton
              name="pause"
              label="Pause download"
              size={17}
              background="surface"
              onPress={() => void downloadManager.pause(item.trackId)}
            />
          )}
          {item.status === 'paused' && (
            <IconButton
              name="play"
              label="Resume download"
              size={17}
              background="surface"
              onPress={() => void downloadManager.resume(item.trackId)}
            />
          )}
          {item.status === 'failed' && (
            <IconButton
              name="refresh"
              label="Retry download"
              size={17}
              background="surface"
              onPress={() => void downloadManager.retry(item.trackId)}
            />
          )}
          {item.status !== 'completed' ? (
            <IconButton
              name="close"
              label="Cancel download"
              size={17}
              onPress={async () => {
                await downloadManager.cancel(item.trackId);
                toast('Download cancelled');
              }}
            />
          ) : (
            <IconButton name="ellipsis-vertical" label="More options" size={17} onPress={onMore} />
          )}
        </View>
      </Pressable>

      {item.status !== 'completed' && (
        <ProgressBar
          progress={item.progress}
          style={{ marginTop: 8, marginLeft: 60 }}
          color={item.status === 'failed' ? colors.danger : colors.accentInk}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    storage: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      marginBottom: spacing.lg,
    },
    tabs: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.md },
    tab: { gap: 8 },
    tabRule: { height: 2, borderRadius: 1, backgroundColor: 'transparent' },
    row: { paddingVertical: 10 },
    rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    controls: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  });
