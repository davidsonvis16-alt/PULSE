import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import {
  DEFAULT_NOTIFICATION_PREFS,
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
} from '@/src/db/repos/settings';
import {
  DEFAULT_PUSH_PREFS,
  disablePush,
  enablePush,
  getPushPrefs,
  type PushPrefs,
} from '@/src/notifications/push';
import { config } from '@/src/core/config';
import { useToast } from '@/src/ui/toast';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { useEffect, useState } from 'react';

const ITEMS: { key: keyof NotificationPrefs; title: string; detail: string }[] = [
  { key: 'newReleases', title: 'New releases', detail: 'When an artist you follow puts out something new' },
  { key: 'musicNews', title: 'Music news and awards', detail: 'When artists you play are nominated, win, or make the headlines' },
  { key: 'events', title: 'Concerts and events', detail: 'Dates announced near you or for artists you follow' },
  { key: 'friendActivity', title: 'Friend activity', detail: 'What the people you follow are playing and sharing' },
  { key: 'recommendations', title: 'Recommendations', detail: 'Occasional picks based on what you have been playing' },
  { key: 'playlists', title: 'Playlist activity', detail: 'Changes to playlists you follow or share' },
  { key: 'downloads', title: 'Downloads', detail: 'A note when a download finishes' },
];

/** Notification preferences. Everything here is off-switchable, per category. */
export default function NotificationSettings() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [push, setPush] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const loaded = useAsync(() => getNotificationPrefs(), []);
  useEffect(() => {
    if (loaded.data) setPrefs(loaded.data);
  }, [loaded.data]);

  const loadedPush = useAsync(() => getPushPrefs(), []);
  useEffect(() => {
    if (loadedPush.data) setPush(loadedPush.data);
  }, [loadedPush.data]);

  /**
   * Turning alerts on asks the phone for permission and registers with the
   * Pulse server; turning them off unregisters, so nothing is sent again.
   */
  const updatePush = async (next: PushPrefs) => {
    setBusy(true);
    try {
      if (!next.enabled) {
        setPush(next);
        await disablePush();
        return;
      }
      const result = await enablePush({ personalise: next.personalise });
      if (result.status === 'ready') {
        setPush(next);
        toast(
          next.personalise
            ? 'Alerts on. You will hear when your artists are nominated, win, or make the news.'
            : 'Alerts on for the big music news.',
        );
      } else {
        setPush({ ...next, enabled: false });
        toast(
          result.status === 'denied'
            ? 'Your phone is blocking notifications for Pulse. Turn them on in your phone settings.'
            : result.reason,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const update = async (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await setNotificationPrefs(next);
  };

  return (
    <Screen>
      <PageHeader title="Notifications" subtitle="Choose what is worth interrupting you for" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Alerts on this phone</Txt>
              <Txt variant="caption" tone="muted">
                {config.push.registerUrl
                  ? 'Big music news, award nights and winners, sent while Pulse is closed'
                  : 'Needs a Pulse server. Without one, news still updates whenever you open the app.'}
              </Txt>
            </View>
            <Switch
              value={push.enabled}
              disabled={busy || !config.push.registerUrl}
              onValueChange={(value) => void updatePush({ ...push, enabled: value })}
              accessibilityLabel="Alerts on this phone"
            />
          </View>
          {push.enabled && (
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">Use my artists</Txt>
                <Txt variant="caption" tone="muted">
                  Sends the names of artists in your library so alerts can be about them. Never your
                  listening history, and erased when you turn this off.
                </Txt>
              </View>
              <Switch
                value={push.personalise}
                disabled={busy}
                onValueChange={(value) => void updatePush({ ...push, personalise: value })}
                accessibilityLabel="Use my artists for alerts"
              />
            </View>
          )}
        </View>

        <Txt variant="caption" tone="faint" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
          In the app
        </Txt>

        <View style={styles.group}>
          {ITEMS.map((item) => (
            <View key={item.key} style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">{item.title}</Txt>
                <Txt variant="caption" tone="muted">
                  {item.detail}
                </Txt>
              </View>
              <Switch
                value={prefs[item.key]}
                onValueChange={(value) => update(item.key, value)}
                trackColor={{ true: colors.accent, false: colors.cardHigh }}
                thumbColor={colors.text}
                accessibilityLabel={item.title}
              />
            </View>
          ))}
        </View>
        <Txt variant="caption" tone="faint" style={{ marginTop: spacing.lg }}>
          Pulse groups notifications and never sends the same announcement twice.
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
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingVertical: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
  });
