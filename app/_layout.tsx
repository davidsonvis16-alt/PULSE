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
import { colors, spacing } from '@/src/theme/tokens';
import { WelcomeScreen } from '@/src/screens/welcome';
import { GlobalMiniPlayer } from '@/src/ui/global-mini-player';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<Error | null>(null);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
    initializePulse()
      .then(() => setReady(true))
      .catch((error: unknown) => setBootError(error instanceof Error ? error : new Error('Start-up failed')));
  }, []);

  if (bootError) {
    return (
      <SafeAreaProvider>
        <View style={styles.boot}>
          <PulseLogo size={44} showWordmark />
          <Txt variant="title3" align="center" style={{ marginTop: spacing.xl }}>
            Pulse could not start
          </Txt>
          <Txt variant="body" tone="muted" align="center" style={{ maxWidth: 300 }}>
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
        <View style={styles.boot}>
          <PulseLogo size={52} showWordmark tagline />
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxxl }} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
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
  const { ready, mode, session, profile } = useAuth();

  if (!ready) {
    return (
      <View style={styles.boot}>
        <PulseLogo size={44} showWordmark />
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      </View>
    );
  }

  const signedIn = mode === 'connected' ? !!session : !!profile?.displayName;
  if (!signedIn) return <WelcomeScreen />;

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
      </Stack>
      <GlobalMiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xxl,
  },
});
