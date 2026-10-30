import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { playerStore } from '@/src/audio/player';
import { getPlaybackPrefs, setPlaybackPrefs } from '@/src/db/repos/settings';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Playback.
 *
 * Two of these are about how Pulse shares the phone rather than about Pulse
 * itself, which is why they are worth a screen: whether a song keeps going
 * after you leave the app, and whether Pulse takes the audio from whatever
 * else is playing or sits alongside it.
 */
export default function PlaybackSettings() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const player = useStore(playerStore);

  const prefs = useAsync(() => getPlaybackPrefs(), []);
  const preferDownloads = prefs.data?.preferDownloads ?? true;

  const setPreferDownloads = async (value: boolean) => {
    const current = await getPlaybackPrefs();
    await setPlaybackPrefs({ ...current, preferDownloads: value });
    prefs.reload();
  };

  return (
    <Screen>
      <PageHeader title="Playback" subtitle="How Pulse shares your phone's audio" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Play alongside other apps</Txt>
              <Txt variant="caption" tone="muted">
                {player.retuning
                  ? 'Retuning the audio… the song picks up where it was.'
                  : 'On, Pulse plays over whatever else is going without pausing it — a podcast, a game, a call. Off, other apps drop under Pulse the way a music app normally works.'}
              </Txt>
            </View>
            <Switch
              value={player.mixWithOtherApps}
              disabled={player.retuning}
              onValueChange={(value) => void playerStore.setMixWithOtherApps(value)}
              trackColor={{ true: colors.accent, false: colors.cardHigh }}
              thumbColor={colors.text}
              accessibilityLabel="Play alongside other apps"
            />
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Play downloads first</Txt>
              <Txt variant="caption" tone="muted">
                A song you have downloaded plays from the file rather than the network, so it
                sounds the same with no signal at all.
              </Txt>
            </View>
            <Switch
              value={preferDownloads}
              onValueChange={(value) => void setPreferDownloads(value)}
              trackColor={{ true: colors.accent, false: colors.cardHigh }}
              thumbColor={colors.text}
              accessibilityLabel="Play downloads first"
            />
          </View>
        </View>

        <Txt variant="caption" tone="faint" style={{ marginTop: spacing.lg }}>
          Music keeps playing when you leave Pulse, with the cover, title and controls on your lock
          screen and in the notification shade. Switching the audio between apps means rebuilding
          the phone&rsquo;s audio session, which stops playback for a moment — Pulse pauses on
          purpose and resumes at the same spot rather than letting the song cut out.
        </Txt>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    group: {
      backgroundColor: colors.card,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingVertical: spacing.lg,
    },
  });
