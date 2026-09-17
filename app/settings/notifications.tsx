import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import {
  DEFAULT_NOTIFICATION_PREFS,
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
} from '@/src/db/repos/settings';
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

  const loaded = useAsync(() => getNotificationPrefs(), []);
  useEffect(() => {
    if (loaded.data) setPrefs(loaded.data);
  }, [loaded.data]);

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
