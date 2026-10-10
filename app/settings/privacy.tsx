import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DEFAULT_PRIVACY_PREFS,
  getPrivacyPrefs,
  setPrivacyPrefs,
  type PrivacyPrefs,
} from '@/src/db/repos/settings';
import { savePlace } from '@/src/location/location';
import { resetUserData } from '@/src/db/client';
import { clearLocalLibrary, getLocalCounts } from '@/src/db/repos/local';
import { clearImportedFiles } from '@/src/ingestion/scanner';
import { clearCachedArtwork } from '@/src/ingestion/artwork/provider';
import { invalidateTasteProfile } from '@/src/discovery/taste';
import { pluralize } from '@/src/core/format';
import { isSocialAvailable, pushProfile } from '@/src/social/sync';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

const ITEMS: { key: keyof PrivacyPrefs; title: string; detail: string }[] = [
  {
    key: 'shareListeningActivity',
    title: 'Share what I am listening to',
    detail: 'Friends can see the songs you play. Off by default — nothing leaves this device until you turn it on.',
  },
  {
    key: 'shareStatistics',
    title: 'Share my statistics',
    detail: 'Lets friends see your listening totals and top artists.',
  },
  {
    key: 'shareLibrary',
    title: 'Share my library',
    detail: 'Friends can browse the playlists you marked as visible.',
  },
  {
    key: 'allowFriendRequests',
    title: 'Allow people to follow me',
    detail: 'Turn this off and your profile stops appearing in searches.',
  },
];

/** Privacy. The defaults are private; every share is something the user chose. */
export default function PrivacySettings() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const toast = useToast();
  const [prefs, setPrefs] = useState<PrivacyPrefs>(DEFAULT_PRIVACY_PREFS);

  const loaded = useAsync(() => getPrivacyPrefs(), []);
  const localCounts = useAsync(() => getLocalCounts(), []);
  useEffect(() => {
    if (loaded.data) setPrefs(loaded.data);
  }, [loaded.data]);

  const update = async (key: keyof PrivacyPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await setPrivacyPrefs(next);
    await pushProfile().catch(() => {});
  };

  return (
    <Screen>
      <PageHeader title="Privacy" subtitle="You decide what other people see" />
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
                disabled={!isSocialAvailable() && item.key !== 'shareListeningActivity'}
              />
            </View>
          ))}
        </View>

        {!isSocialAvailable() && (
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
            <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
              No account backend is connected, so nothing can be shared from this build. Your
              library, downloads, history and statistics stay on this device.
            </Txt>
          </View>
        )}

        <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
          <Txt variant="title3">Your imported music</Txt>
          <Txt variant="caption" tone="muted">
            Pulse read {pluralize(localCounts.data?.tracks ?? 0, 'file')} from this device to build
            your library, artwork and Grooves. That index lives here on the device and was never
            uploaded. Your original files were never modified.
          </Txt>
          <Button
            label="Remove my imported music from Pulse"
            variant="secondary"
            full
            onPress={async () => {
              await clearLocalLibrary();
              await clearImportedFiles();
              await clearCachedArtwork();
              invalidateTasteProfile();
              localCounts.reload();
              toast('Your imported library has been removed from Pulse');
            }}
          />
          <Txt variant="caption" tone="faint">
            This clears the index, the cached covers and the Grooves built from them. The music
            files on your device are untouched.
          </Txt>

          <Txt variant="title3" style={{ marginTop: spacing.lg }}>
            Your data
          </Txt>
          <Txt variant="caption" tone="muted">
            Pulse keeps your library, listening history and downloads in a database on this device.
            Clearing it removes all of them, including downloaded audio files.
          </Txt>
          <Button
            label="Forget my location"
            variant="secondary"
            full
            onPress={async () => {
              await savePlace(null);
              toast('Location cleared');
            }}
          />
          <Button
            label="Erase my Pulse data"
            variant="danger"
            full
            onPress={async () => {
              await resetUserData();
              toast('Your Pulse data has been erased');
            }}
          />
        </View>
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
    note: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
    },
  });
