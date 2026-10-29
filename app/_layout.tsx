import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SystemUI from 'expo-system-ui';
import { useFonts } from 'expo-font';
import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { PermanentMarker_400Regular } from '@expo-google-fonts/permanent-marker';
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
import { PlayerBar } from '@/src/ui/player-bar';
import { Sidebar, TABS } from '@/src/ui/sidebar';
import { useResponsive } from '@/src/hooks/use-responsive';
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
  // A font that fails to load falls back to the system face; it never blocks start-up.
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    PermanentMarker_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

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
        <StatusBar style="light" />
        <View style={styles.boot}>
          <PulseLogo size={64} showWordmark variant="white" />
          <Txt variant="title3" align="center" style={{ marginTop: spacing.xl, color: brand.launchInk }}>
            Pulse could not start
          </Txt>
          <Txt variant="body" align="center" style={{ maxWidth: 300, color: brand.launchInkSoft }}>
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

  if (!ready || (!fontsLoaded && !fontError)) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.boot}>
          <PulseLogo size={96} showWordmark tagline variant="white" />
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
 * Pulse needs a real account before it can personalise anything, so the music
 * screens never render for someone who has not signed in.
 */
function AuthGate() {
  const { ready, session, profile, recovering } = useAuth();
  const [needsImport, setNeedsImport] = useState<boolean | null>(null);

  // A tapped news alert opens what it was about.
  useNotificationRouting();

  // Everyone has an account: nobody reaches the music without signing in, and
  // there is deliberately no switch to turn that off. The profile must belong
  // to this session; it is re-pointed on every sign-in.
  const signedIn = !!session && profile?.userId === session.user.id;

  useEffect(() => {
    if (!signedIn) return;
    setNeedsImport(null);
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
  }, [signedIn, session?.user.id]);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <PulseLogo size={76} showWordmark variant="white" />
        <ActivityIndicator color={brand.plate} style={{ marginTop: spacing.xxl }} />
      </View>
    );
  }

  if (recovering) return <WelcomeScreen initial="newPassword" />;
  if (!signedIn) return <WelcomeScreen />;

  if (needsImport === null) {
    return (
      <View style={styles.boot}>
        <PulseLogo size={76} showWordmark variant="white" />
        <ActivityIndicator color={brand.plate} style={{ marginTop: spacing.xxl }} />
      </View>
    );
  }

  if (needsImport) return <ImportScreen onFinished={() => setNeedsImport(false)} />;

  return <AppShell />;
}

/**
 * Phones: one screen at a time, with the mini player floating above the tabs.
 * Laptops: the sidebar on the left, the page in a panel beside it, and the
 * player bar along the bottom — except on the full player, which takes the
 * whole window.
 */
function AppShell() {
  const { colors } = useTheme();
  const { isLaptopUp } = useResponsive();
  const pathname = usePathname();
  const chrome = isLaptopUp && !pathname.startsWith('/player');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {chrome ? <Sidebar tabs={TABS} /> : null}
        <View
          style={[
            { flex: 1 },
            chrome && {
              margin: spacing.sm,
              marginBottom: 0,
              borderRadius: 14,
              overflow: 'hidden',
              backgroundColor: colors.backgroundElevated,
            },
          ]}
        >
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: chrome ? colors.backgroundElevated : colors.background },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="player" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="queue" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="radio" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="freestyle" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
        </View>
      </View>
      {chrome ? <PlayerBar /> : null}
      {isLaptopUp ? null : <GlobalMiniPlayer />}
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
