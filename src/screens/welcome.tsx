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
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { useResponsive } from '@/src/hooks/use-responsive';
import { emailLinkError } from '@/lib/supabase';

type Mode = 'intro' | 'signin' | 'signup' | 'forgot' | 'newPassword';

/**
 * The first thing anyone sees: the Pulse mark on black, the lime wave, and one
 * decision — make an account or sign in. Everyone on Pulse is a real account;
 * there is no anonymous on-device profile.
 */
export function WelcomeScreen({ initial = 'intro' }: { initial?: Mode } = {}) {
  const styles = useThemedStyles(makeStyles);
  const { configured, signIn, signUp, resetPassword, updatePassword } = useAuth();
  const insets = useSafeAreaInsets();
  const { isTabletUp } = useResponsive();

  // A reset or confirmation link that no longer works lands here: say so,
  // rather than showing the plain sign-in as if nothing had happened.
  const [screen, setScreen] = useState<Mode>(
    emailLinkError && initial === 'intro' ? 'signin' : initial,
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(
    emailLinkError
      ? 'That email link has expired or was already used. Tap "Forgot your password?" for a new one.'
      : null,
  );
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
                  Your music, your people, one place
                </Txt>
                <Txt variant="body" tone="muted" align="center" style={{ marginBottom: spacing.lg }}>
                  Bring in your songs, get new ones picked for you, and tune in to freestyles from
                  everyone on Pulse Radio.
                </Txt>

                {configured ? (
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
                  <Txt variant="caption" tone="danger" align="center">
                    This copy of Pulse was built without its account server, so nobody can sign
                    in. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY and build
                    again (see docs/LAUNCH.md).
                  </Txt>
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
                        const live = await signUp(email, password, name);
                        if (!live) {
                          setNotice('Check your email to confirm your account, then sign in.');
                          setScreen('signin');
                        }
                      } else {
                        await signIn(email, password);
                      }
                    })
                  }
                />
                {screen === 'signin' && (
                  <Pressable
                    onPress={() => {
                      setError(null);
                      setScreen('forgot');
                    }}
                  >
                    <Txt variant="callout" tone="muted" align="center">
                      Forgot your password?
                    </Txt>
                  </Pressable>
                )}
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

            {screen === 'newPassword' && (
              <View style={styles.actions}>
                <Txt variant="title2" align="center">
                  Choose a new password
                </Txt>
                <Field
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 8 characters"
                  secureTextEntry
                  autoCapitalize="none"
                />
                {error && (
                  <Txt variant="caption" tone="danger">
                    {error}
                  </Txt>
                )}
                <Button
                  label="Save password"
                  full
                  loading={busy}
                  onPress={() => run(() => updatePassword(password))}
                />
              </View>
            )}

            {screen === 'forgot' && (
              <View style={styles.actions}>
                <Txt variant="title2" align="center">
                  Reset your password
                </Txt>
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
                {error && (
                  <Txt variant="caption" tone="danger">
                    {error}
                  </Txt>
                )}
                <Button
                  label="Email me a reset link"
                  full
                  loading={busy}
                  onPress={() =>
                    run(async () => {
                      await resetPassword(email);
                      setNotice('If that email has an account, a reset link is on its way.');
                      setScreen('signin');
                    })
                  }
                />
                <Pressable onPress={() => setScreen('signin')}>
                  <Txt variant="callout" tone="secondary" align="center">
                    Back to sign in
                  </Txt>
                </Pressable>
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
