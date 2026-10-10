import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Track } from '@/src/core/types';
import { pluralize } from '@/src/core/format';
import { radioStation } from '@/src/radio/station';
import { playerStore, progressStore } from '@/src/audio/player';
import { quickImport } from '@/src/screens/import';
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
 * One stream, always moving. There is no scrub bar and no way back, so the
 * screen does not pretend otherwise: what is on, what is coming, and what has
 * already gone past. The sidebar is where the station is laid bare — the queue
 * ahead, the songs already played, and the way to put your own music into it.
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
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void radioStation.load();
  }, []);

  const onAir = player.context === 'radio' && !!player.current;
  const current = onAir ? player.current : null;
  const upcoming = radioStation.upcoming(8);

  const start = useCallback(async () => {
    setStarting(true);
    const ok = await radioStation.start();
    setStarting(false);
    if (!ok) toast('Add some music to this device first', 'error');
  }, [toast]);

  const addMusic = useCallback(async () => {
    const result = await quickImport('picker');
    if (!result || result.found === 0) return;
    const size = await radioStation.load();
    toast(`Station now has ${pluralize(size, 'song')}`, 'success');
  }, [toast]);

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
        {pluralize(station.poolSize, 'song')} in rotation
      </Txt>

      <Button
        label="Add your music to the station"
        icon="add-circle-outline"
        variant="secondary"
        full
        style={{ marginTop: spacing.md }}
        onPress={() => void addMusic()}
      />

      <ScrollView style={{ marginTop: spacing.lg }} showsVerticalScrollIndicator={false}>
        <Txt variant="micro" tone="muted" uppercase>
          Coming up
        </Txt>
        {upcoming.length === 0 ? (
          <Txt variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
            {onAir ? 'Picking the next songs…' : 'Nothing queued until the station is on.'}
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
            Songs move here once they have finished. They do not come back.
          </Txt>
        ) : (
          station.history
            .slice(1)
            .map((track, index) => (
              <StationRow key={`${track.id}-past-${index}`} track={track} styles={styles} faded />
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
          <Txt variant="callout">{onAir ? 'On air' : 'Off air'}</Txt>
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
            {current?.title ?? 'The station is quiet'}
          </Txt>
          <Txt variant="body" tone="muted" align="center" numberOfLines={1}>
            {current?.artistName ?? 'Start it and it plays until you stop it'}
          </Txt>

          {/* Deliberately not a seek bar: it shows the song passing, nothing more. */}
          <ProgressBar progress={ratio} height={3} style={{ width: '100%', marginTop: spacing.xl }} />
          <Txt variant="caption" tone="faint" align="center" style={{ marginTop: spacing.sm }}>
            No rewind, no replays — the radio only goes forward
          </Txt>

          <View style={styles.controls}>
            {onAir ? (
              <>
                <IconButton
                  name={player.isPlaying ? 'pause-circle' : 'play-circle'}
                  label={player.isPlaying ? 'Pause the radio' : 'Play the radio'}
                  size={54}
                  color={colors.accent}
                  onPress={() => playerStore.toggle()}
                />
                <IconButton
                  name="play-skip-forward"
                  label="Move on to the next song"
                  size={26}
                  onPress={() => void radioStation.skip()}
                />
                <IconButton
                  name="stop-circle-outline"
                  label="Turn the station off"
                  size={26}
                  onPress={() => radioStation.stop()}
                />
              </>
            ) : (
              <Button
                label={starting ? 'Tuning in…' : 'Turn on the radio'}
                icon="radio-outline"
                loading={starting}
                onPress={() => void start()}
              />
            )}
          </View>

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
