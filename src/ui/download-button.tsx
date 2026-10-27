import { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { Track } from '@/src/core/types';
import { downloadManager, downloadsSupported } from '@/src/downloads/manager';
import { providerFor } from '@/src/providers/music';
import { LOCAL_PROVIDER_ID } from '@/src/db/repos/local';
import { useStore } from '@/src/hooks/use-store';
import { useToast } from '@/src/ui/toast';
import { Txt } from '@/src/ui/text';
import { radii } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Keep-this-song button.
 *
 * It appears on anything Pulse recommends, so a song found on the Home screen
 * can be taken offline without opening it first. The button carries the whole
 * state of the transfer — queued, the live percentage, done — because a
 * download the user cannot see the progress of feels broken.
 *
 * Tracks already on the device never show it: they are as offline as they get.
 */
export function DownloadButton({
  track,
  size = 30,
  onSurface = false,
}: {
  track: Track;
  size?: number;
  /** Sits on top of artwork, so it needs its own backing. */
  onSurface?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const downloads = useStore(downloadManager);
  const toast = useToast();

  const record = downloads.byTrackId[track.id];
  const status = record?.status ?? null;

  const start = useCallback(async () => {
    void Haptics.selectionAsync().catch(() => {});
    const result = await downloadManager.enqueue(track);
    if (!result.started && result.reason) toast(result.reason);
  }, [track, toast]);

  const cancel = useCallback(async () => {
    await downloadManager.cancel(track.id);
  }, [track.id]);

  if (track.provider === LOCAL_PROVIDER_ID) return null;
  if (!downloadsSupported || !providerFor(track.provider).capabilities.download) return null;

  const iconSize = Math.round(size * 0.58);

  if (status === 'completed') {
    return (
      <View
        style={[styles.button, onSurface && styles.onSurface, { width: size, height: size, borderRadius: size / 2 }]}
        accessibilityLabel={`${track.title} is saved on this device`}
      >
        <Ionicons name="checkmark" size={iconSize} color={colors.accent} />
      </View>
    );
  }

  if (status === 'downloading' || status === 'preparing' || status === 'queued') {
    const percent = Math.round((record?.progress ?? 0) * 100);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stop downloading ${track.title}, ${percent} percent done`}
        hitSlop={10}
        onPress={cancel}
        style={({ pressed }) => [
          styles.button,
          onSurface && styles.onSurface,
          { width: size, height: size, borderRadius: size / 2 },
          pressed && { opacity: 0.7 },
        ]}
      >
        {status === 'downloading' && percent > 0 ? (
          <Txt style={[styles.percent, { fontSize: size * 0.3 }]}>{percent}</Txt>
        ) : (
          <ActivityIndicator size="small" color={colors.accent} />
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Download ${track.title} by ${track.artistName}`}
      hitSlop={10}
      onPress={start}
      style={({ pressed }) => [
        styles.button,
        onSurface && styles.onSurface,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons
        name={status === 'failed' ? 'refresh' : 'arrow-down'}
        size={iconSize}
        color={status === 'failed' ? colors.warning : colors.accent}
      />
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    button: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardHigh,
    },
    onSurface: {
      backgroundColor: colors.scrim,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    percent: { fontWeight: '800', color: colors.accent },
  });

export const DOWNLOAD_BUTTON_RADIUS = radii.pill;
