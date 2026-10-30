import { useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { connection } from '@/src/core/connection';
import { useStore } from '@/src/hooks/use-store';
import { useToast } from '@/src/ui/toast';
import { Button } from '@/src/ui/buttons';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

/**
 * The card in the middle of the screen when the internet drops: one button,
 * into offline mode, so the app keeps going instead of filling with errors.
 */
export function OfflinePrompt() {
  const { colors } = useTheme();
  const toast = useToast();
  const state = useStore(connection);

  useEffect(() => {
    connection.start();
  }, []);

  useEffect(() => {
    if (state.justReconnected) toast('Back online', 'success');
  }, [state.justReconnected, toast]);

  return (
    <Modal visible={state.asking} transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.text} />
          </View>
          <Txt variant="title2" align="center">
            {"You're offline"}
          </Txt>
          <Txt variant="body" tone="secondary" align="center">
            Your own songs and downloads still play. Pulse switches back by itself when the
            internet returns.
          </Txt>
          <Button label="Go to offline mode" icon="musical-notes" full onPress={() => connection.goOffline()} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 340,
    aspectRatio: 1,
    borderRadius: radii.xxl,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radii.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
