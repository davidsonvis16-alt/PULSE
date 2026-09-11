import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PulseLogo } from '@/src/ui/logo';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { useAuth } from '@/src/auth/auth';
import { colors, radii, spacing } from '@/src/theme/tokens';
import { useResponsive } from '@/src/hooks/use-responsive';

type Mode = 'intro' | 'signin' | 'signup' | 'local';

/**
 * The first thing anyone sees: the Pulse mark on black, the lime wave, and one
 * decision. With no backend configured the sign-in paths are replaced by a
 * single "use Pulse on this device" step, so nobody is asked for an account
 * that does not exist.
 */
export function WelcomeScreen() {
  const { mode: authMode, signIn, signUp, continueOnDevice } = useAuth();
  const insets = useSafeAreaInsets();
  const { isTabletUp } = useResponsive();

  const [screen, setScreen] = useState<Mode>('intro');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['rgba(203,242,76,0.10)', 'transparent']}
        start={{ x: 0.1, y: 1 }}
        end={{ x: 0.9, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + spacing.huge, paddingBottom: insets.bottom + spacing.xxxl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.inner, isTabletUp && { maxWidth: 440 }]}>
            <View style={styles.brand}>
              <PulseLogo size={68} />
              <Txt variant="display" style={{ marginTop: spacing.xl }}>
                Pulse
              </Txt>
              <Txt variant="body" tone="muted">
                Your music. Your way.
              </Txt>
            </View>

            {screen === 'intro' && (
              <View style={styles.actions}>
                <Txt variant="title3" align="center" style={{ marginBottom: spacing.sm }}>
                  {authMode === 'connected'
                    ? 'Your whole music life, in one place'
                    : 'Set up Pulse on this device'}
                </Txt>
                <Txt variant="body" tone="muted" align="center" style={{ marginBottom: spacing.lg }}>
                  Search, listen, download, and watch Pulse learn what you actually play.
                </Txt>

                {authMode === 'connected' ? (
                  <>
                    <Button label="Create an account" full onPress={() => setScreen('signup')} />
                    <Button
                      label="I already have one"
                      variant="secondary"
                      full
                      onPress={() => setScreen('signin')}
                    />
                  </>
                ) : (
                  <>
                    <Button label="Get started" full onPress={() => setScreen('local')} />
                    <Txt variant="caption" tone="faint" align="center" style={{ marginTop: spacing.md }}>
                      No account server is configured for this build, so your library, downloads and
                      statistics stay on this device. Friends and the activity feed switch on once a
                      Pulse backend is connected.
                    </Txt>
                  </>
                )}
              </View>
            )}

            {(screen === 'signin' || screen === 'signup') && (
              <View style={styles.actions}>
                <Txt variant="title2" align="center">
                  {screen === 'signup' ? 'Create your account' : 'Welcome back'}
                </Txt>

                {screen === 'signup' && (
                  <Field
                    label="Display name"
                    value={name}
                    onChangeText={setName}
                    placeholder="What should Pulse call you?"
                    autoCapitalize="words"
                  />
                )}
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder={screen === 'signup' ? 'At least 8 characters' : 'Your password'}
                  secureTextEntry
                  autoCapitalize="none"
                />

                {error && (
                  <Txt variant="caption" tone="danger">
                    {error}
                  </Txt>
                )}
                {notice && (
                  <Txt variant="caption" tone="accent">
                    {notice}
                  </Txt>
                )}

                <Button
                  label={screen === 'signup' ? 'Create account' : 'Sign in'}
                  full
                  loading={busy}
                  onPress={() =>
                    run(async () => {
                      if (screen === 'signup') {
                        await signUp(email, password, name);
                        setNotice('Check your email to confirm your account, then sign in.');
                        setScreen('signin');
                      } else {
                        await signIn(email, password);
                      }
                    })
                  }
                />
                <Pressable
                  onPress={() => {
                    setError(null);
                    setScreen(screen === 'signup' ? 'signin' : 'signup');
                  }}
                >
                  <Txt variant="callout" tone="secondary" align="center">
                    {screen === 'signup' ? 'I already have an account' : 'Create an account instead'}
                  </Txt>
                </Pressable>
              </View>
            )}

            {screen === 'local' && (
              <View style={styles.actions}>
                <Txt variant="title2" align="center">
                  What should Pulse call you?
                </Txt>
                <Field
                  label="Display name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  autoCapitalize="words"
                />
                {error && (
                  <Txt variant="caption" tone="danger">
                    {error}
                  </Txt>
                )}
                <Button
                  label="Start listening"
                  full
                  loading={busy}
                  onPress={() => run(() => continueOnDevice(name))}
                />
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <LimeWave />
    </View>
  );
}

function Field({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <TextInput
        {...props}
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** The lime sweep along the bottom edge, echoing the Pulse mark. */
function LimeWave() {
  return (
    <View pointerEvents="none" style={styles.wave}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.waveLine,
            {
              bottom: 10 + i * 16,
              opacity: 0.5 - i * 0.15,
              transform: [{ rotate: `${-4 + i * 1.4}deg` }, { scaleX: 1.3 }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.xxl, justifyContent: 'center' },
  inner: { width: '100%', alignSelf: 'center', gap: spacing.huge },
  brand: { alignItems: 'center' },
  actions: { gap: spacing.md },
  input: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  wave: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 120, overflow: 'hidden' },
  waveLine: {
    position: 'absolute',
    left: -40,
    right: -40,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});
