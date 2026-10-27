import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { parseEntityId, type Track } from '@/src/core/types';
import { formatRelativeTime, pluralize } from '@/src/core/format';
import { radioStation } from '@/src/radio/station';
import {
  deleteFreestyle,
  listMyFreestyles,
  reportFreestyle,
  type Freestyle,
} from '@/src/radio/freestyles';
import { playerStore, progressStore } from '@/src/audio/player';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useStore } from '@/src/hooks/use-store';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { Screen } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button, IconButton } from '@/src/ui/buttons';
import { ProgressBar } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Pulse Radio.
 *
 * Freestyles from people on Pulse, live: everyone tuned in hears the same one
 * at the same moment. There is no scrub bar and no way back, so the screen does
 * not pretend otherwise: what is on, who made it, what is coming, and what has
 * already gone past. The sidebar holds the queue, the history and the
 * listener's own freestyles; the big button is how they add one.
 */
export function RadioScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { isTabletUp, gutter } = useResponsive();
  const toast = useToast();

  const station = useStore(radioStation);
  const player = useStore(playerStore);
  const progress = useStore(progressStore);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const mine = useAsync<(Freestyle & { hidden: boolean })[]>(() => listMyFreestyles().catch(() => []), []);
  useFocusReload(mine.reload);

  const onAir = player.context === 'radio' && !!player.current;
  const current = onAir ? player.current : null;
  const upcoming = radioStation.upcoming(8);

  // It is a radio: opening it means hearing it. Coming back to a paused
  // station rejoins it live rather than resuming behind everyone else.
  useEffect(() => {
    if (!onAir) void radioStation.tuneIn();
    else void radioStation.load();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playPause = useCallback(async () => {
    if (onAir && player.isPlaying) {
      playerStore.pause();
      return;
    }
    const ok = await radioStation.tuneIn();
    if (!ok) toast(radioStation.getSnapshot().error ?? 'Nothing is on air yet', 'error');
  }, [onAir, player.isPlaying, toast]);

  const report = useCallback(() => {
    const id = current ? parseEntityId(current.id)?.raw : null;
    if (!id) return;
    const send = async () => {
      try {
        await reportFreestyle(id, 'Reported from the radio');
        toast('Thanks — it has been reported', 'success');
        await playerStore.next();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not send the report', 'error');
      }
    };
    if (Platform.OS === 'web') {
      void send();
      return;
    }
    Alert.alert('Report this freestyle?', 'Freestyles reported by several listeners come off air.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: () => void send() },
    ]);
  }, [current, toast]);

  const remove = useCallback(
    (freestyle: Freestyle) => {
      const run = async () => {
        try {
          await deleteFreestyle(freestyle);
          mine.reload();
          void radioStation.load();
          toast('Taken off the radio', 'success');
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Could not remove it', 'error');
        }
      };
      if (Platform.OS === 'web') {
        void run();
        return;
      }
      Alert.alert(`Remove "${freestyle.title}"?`, 'It comes off the radio for everyone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void run() },
      ]);
    },
    [mine, toast],
  );

  const isMine = !!current && !!mine.data?.some((item) => current.providerTrackId === item.storagePath);

  const ratio = progress.durationMs > 0 ? progress.positionMs / progress.durationMs : 0;

  const sidebar = (
    <View style={[styles.sidebar, isTabletUp && styles.sidebarDocked]}>
      <View style={styles.sidebarHeader}>
        <Txt variant="title3">The station</Txt>
        {!isTabletUp && (
          <IconButton name="close" label="Close the station panel" onPress={() => setSidebarOpen(false)} />
        )}
      </View>

      <Txt variant="caption" tone="muted">
        {pluralize(station.rotation.length, 'freestyle')} in rotation
      </Txt>

      <ScrollView style={{ marginTop: spacing.lg }} showsVerticalScrollIndicator={false}>
        <Txt variant="micro" tone="muted" uppercase>
          Coming up
        </Txt>
        {upcoming.length === 0 ? (
          <Txt variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
            {onAir ? 'Lining up the next freestyles…' : 'Tune in to see what is coming up.'}
          </Txt>
        ) : (
          upcoming.map((track, index) => (
            <StationRow key={`${track.id}-${index}`} track={track} styles={styles} />
          ))
        )}

        <Txt variant="micro" tone="muted" uppercase style={{ marginTop: spacing.xl }}>
          Already played
        </Txt>
        {station.history.length <= 1 ? (
          <Txt variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
            Freestyles move here once they have finished.
          </Txt>
        ) : (
          station.history
            .slice(1)
            .map((track, index) => (
              <StationRow key={`${track.id}-past-${index}`} track={track} styles={styles} faded />
            ))
        )}

        <Txt variant="micro" tone="muted" uppercase style={{ marginTop: spacing.xl }}>
          Your freestyles
        </Txt>
        {!mine.data?.length ? (
          <Txt variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
            Nothing of yours on air yet.
          </Txt>
        ) : (
          mine.data.map((item) => (
            <View key={item.id} style={styles.stationRow}>
              <Ionicons name="mic-outline" size={18} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Txt variant="callout" numberOfLines={1}>
                  {item.title}
                </Txt>
                <Txt variant="caption" tone={item.hidden ? 'danger' : 'muted'} numberOfLines={1}>
                  {item.hidden ? 'Off air after reports' : formatRelativeTime(item.createdAt)}
                </Txt>
              </View>
              <IconButton name="trash-outline" label={`Remove ${item.title}`} size={18} onPress={() => remove(item)} />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  return (
    <Screen>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <IconButton name="chevron-down" label="Close radio" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Txt variant="micro" tone="muted" uppercase>
            Pulse Radio
          </Txt>
          <Txt variant="callout">{onAir && player.isPlaying ? 'Live freestyles' : 'Freestyles, live'}</Txt>
        </View>
        {!isTabletUp && (
          <IconButton
            name="list-outline"
            label="Show the station panel"
            onPress={() => setSidebarOpen(true)}
          />
        )}
      </View>

      <View style={styles.body}>
        <ScrollView
          contentContainerStyle={[styles.stage, { paddingHorizontal: gutter }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.cover}>
            <Artwork uri={current?.artworkUrl} size={isTabletUp ? 300 : 240} radius={radii.xl} />
            {onAir && (
              <View style={styles.liveTag}>
                <View style={styles.liveDot} />
                <Txt variant="micro" tone="onAccent" uppercase>
                  Live
                </Txt>
              </View>
            )}
          </View>

          <Txt variant="title2" align="center" numberOfLines={2} style={{ marginTop: spacing.xl }}>
            {current?.title ?? (station.tuning ? 'Tuning in…' : 'Nothing on air yet')}
          </Txt>
          <Txt variant="body" tone="muted" align="center" numberOfLines={1}>
            {current
              ? `by ${current.artistName}`
              : station.rotation.length === 0 && station.ready
                ? 'Be the first to drop a freestyle'
                : 'Everyone hears the same freestyle at the same time'}
          </Txt>

          {/* Deliberately not a seek bar: it shows the song passing, nothing more. */}
          <ProgressBar progress={ratio} height={3} style={{ width: '100%', marginTop: spacing.xl }} />
          <Txt variant="caption" tone="faint" align="center" style={{ marginTop: spacing.sm }}>
            It is live — no rewinding, everyone is on the same second
          </Txt>

          <View style={styles.controls}>
            {onAir && !isMine && (
              <IconButton name="flag-outline" label="Report this freestyle" size={22} onPress={report} />
            )}
            <IconButton
              name={onAir && player.isPlaying ? 'pause-circle' : 'play-circle'}
              label={onAir && player.isPlaying ? 'Pause the radio' : 'Tune in live'}
              size={64}
              color={colors.accent}
              disabled={station.tuning}
              onPress={() => void playPause()}
            />
            {onAir && (
              <IconButton
                name="stop-circle-outline"
                label="Turn the radio off"
                size={26}
                onPress={() => radioStation.stop()}
              />
            )}
          </View>

          <Button
            label="Drop a freestyle"
            icon="mic"
            style={{ marginTop: spacing.xl }}
            onPress={() => router.push('/freestyle' as never)}
          />

          {!!station.error && (
            <Txt variant="caption" tone="danger" align="center" style={{ marginTop: spacing.md }}>
              {station.error}
            </Txt>
          )}
        </ScrollView>

        {isTabletUp && sidebar}
      </View>

      {!isTabletUp && (
        <Modal
          visible={sidebarOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setSidebarOpen(false)}
        >
          <Pressable style={styles.backdrop} onPress={() => setSidebarOpen(false)} />
          {sidebar}
        </Modal>
      )}
    </Screen>
  );
}

function StationRow({
  track,
  styles,
  faded,
}: {
  track: Track;
  styles: ReturnType<typeof makeStyles>;
  faded?: boolean;
}) {
  return (
    <View style={[styles.stationRow, faded && { opacity: 0.55 }]}>
      <Artwork uri={track.artworkUrl} size={36} radius={radii.xs} />
      <View style={{ flex: 1 }}>
        <Txt variant="callout" numberOfLines={1}>
          {track.title}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {track.artistName}
        </Txt>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    body: { flex: 1, flexDirection: 'row' },
    stage: { alignItems: 'center', paddingBottom: spacing.huge, flexGrow: 1 },
    cover: { marginTop: spacing.xl },
    liveTag: {
      position: 'absolute',
      top: spacing.md,
      left: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onAccent },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.lg,
      marginTop: spacing.xl,
    },
    sidebar: {
      width: '100%',
      maxWidth: 360,
      alignSelf: 'flex-end',
      flex: 1,
      padding: spacing.xl,
      backgroundColor: colors.backgroundElevated,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderTopLeftRadius: radii.xl,
      borderBottomLeftRadius: radii.xl,
      borderColor: colors.border,
    },
    sidebarDocked: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
    sidebarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    stationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  });
