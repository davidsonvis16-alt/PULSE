import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SystemUI from 'expo-system-ui';
import { AuthProvider, useAuth } from '@/src/auth/auth';
import { PulseProviders } from '@/src/ui/providers';
import { PulseLogo } from '@/src/ui/logo';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { initializePulse } from '@/src/bootstrap';
import { brand, spacing } from '@/src/theme/tokens';
import { ThemeProvider, useTheme } from '@/src/theme/theme';
import { WelcomeScreen } from '@/src/screens/welcome';
import { ImportScreen } from '@/src/screens/import';
import { getSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { getLocalCounts } from '@/src/db/repos/local';
import { GlobalMiniPlayer } from '@/src/ui/global-mini-player';
import { useNotificationRouting } from '@/src/notifications/routing';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <PulseRoot />
    </ThemeProvider>
  );
}

function PulseRoot() {
  const { colors, isDark } = useTheme();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<Error | null>(null);

  useEffect(() => {
    initializePulse()
      .then(() => setReady(true))
      .catch((error: unknown) => setBootError(error instanceof Error ? error : new Error('Start-up failed')));
  }, []);

  // Follows the scheme, so the area behind the app matches when it changes.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  if (bootError) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.boot}>
          <PulseLogo size={44} showWordmark onLight />
          <Txt variant="title3" align="center" style={{ marginTop: spacing.xl, color: brand.ink }}>
            Pulse could not start
          </Txt>
          <Txt variant="body" align="center" style={{ maxWidth: 300, color: brand.wordmark }}>
            {bootError.message}
          </Txt>
          <Button
            label="Try again"
            icon="refresh"
            style={{ marginTop: spacing.lg }}
            onPress={() => {
              setBootError(null);
              initializePulse()
                .then(() => setReady(true))
                .catch((error: unknown) =>
                  setBootError(error instanceof Error ? error : new Error('Start-up failed')),
                );
            }}
          />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.boot}>
          <PulseLogo size={64} showWordmark tagline onLight />
          <ActivityIndicator color={brand.plate} style={{ marginTop: spacing.xxxl }} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AuthProvider>
          <PulseProviders>
            <AuthGate />
          </PulseProviders>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Pulse needs an identity before it can personalise anything. With a backend
 * configured that means signing in; without one it means a name held on the
 * device. Either way the music screens never render for an unknown user.
 */
function AuthGate() {
  const { colors } = useTheme();
  const { ready, mode, session, profile } = useAuth();
  const [needsImport, setNeedsImport] = useState<boolean | null>(null);

  // A tapped news alert opens what it was about.
  useNotificationRouting();

  const signedIn = mode === 'connected' ? !!session : !!profile?.displayName;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      const [done, counts] = await Promise.all([
        getSetting(SETTINGS_KEYS.onboardingDone),
        getLocalCounts(),
      ]);
      // Offer the import once. After that the Library screen is where music
      // gets added, and Pulse never interrupts with it again.
      if (!cancelled) setNeedsImport(!done && counts.tracks === 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <PulseLogo size={56} showWordmark onLight />
        <ActivityIndicator color={brand.plate} style={{ marginTop: spacing.xxl }} />
      </View>
    );
  }

  if (!signedIn) return <WelcomeScreen />;

  if (needsImport === null) {
    return (
      <View style={styles.boot}>
        <PulseLogo size={56} showWordmark onLight />
        <ActivityIndicator color={brand.plate} style={{ marginTop: spacing.xxl }} />
      </View>
    );
  }

  if (needsImport) return <ImportScreen onFinished={() => setNeedsImport(false)} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="player" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="queue" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="radio" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
      <GlobalMiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    // Matches the launch screen exactly, so the hand-off does not flash.
    backgroundColor: brand.launchBackground,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xxl,
  },
});
