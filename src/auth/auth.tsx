import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getProfile, saveProfile, type PulseProfile } from '@/src/db/repos/social';

/**
 * Authentication.
 *
 * Two modes, and the app says which one it is in:
 *
 *  - Connected: Supabase email/password with a persisted, auto-refreshing
 *    session. Needed for profiles, friends and the activity feed.
 *  - On-device: no backend configured. Everything personal still works and
 *    stays on the device; the social screens explain what is missing rather
 *    than showing an empty feed as if it were real.
 */

export type AuthMode = 'connected' | 'local';

interface AuthApi {
  mode: AuthMode;
  ready: boolean;
  session: Session | null;
  profile: PulseProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Sets up a local identity when there is no backend. */
  continueOnDevice: (displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (value.length === 0) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'That does not look like an email address.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Mix letters and numbers.';
  }
  return null;
}

export function validateDisplayName(name: string): string | null {
  const value = name.trim();
  if (value.length < 2) return 'Enter a name with at least 2 characters.';
  if (value.length > 40) return 'Keep it under 40 characters.';
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<PulseProfile | null>(null);
  const [ready, setReady] = useState(false);

  const refreshProfile = useCallback(async () => {
    setProfile(await getProfile());
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      await refreshProfile();
      if (!isSupabaseConfigured || !supabase) {
        if (active) setReady(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (active) {
        setSession(data.session);
        setReady(true);
      }
    })();

    const subscription = supabase?.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void syncProfileFromSession(next).then(() => refreshProfile());
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const emailError = validateEmail(email);
    if (emailError) throw new Error(emailError);
    if (password.length === 0) throw new Error('Enter your password.');
    const client = supabase;
    if (!client) throw new Error('Accounts are not available in this build.');
    const { error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw new Error(friendlyAuthError(error.message));
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const errors = [
        validateEmail(email),
        validatePassword(password),
        validateDisplayName(displayName),
      ].filter(Boolean);
      if (errors.length > 0) throw new Error(errors[0]!);

      const client = supabase;
      if (!client) throw new Error('Accounts are not available in this build.');
      const { error } = await client.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (error) throw new Error(friendlyAuthError(error.message));
      await saveProfile({ displayName: displayName.trim() });
      await refreshProfile();
    },
    [refreshProfile],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setSession(null);
  }, []);

  const continueOnDevice = useCallback(
    async (displayName: string) => {
      const error = validateDisplayName(displayName);
      if (error) throw new Error(error);
      await saveProfile({
        displayName: displayName.trim(),
        handle: displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''),
      });
      await refreshProfile();
    },
    [refreshProfile],
  );

  const value = useMemo<AuthApi>(
    () => ({
      mode: isSupabaseConfigured ? 'connected' : 'local',
      ready,
      session,
      profile,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      continueOnDevice,
    }),
    [ready, session, profile, signIn, signUp, signOut, refreshProfile, continueOnDevice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function syncProfileFromSession(session: Session | null) {
  if (!session?.user) return;
  const existing = await getProfile();
  await saveProfile({
    ...existing,
    userId: session.user.id,
    displayName:
      existing?.displayName ??
      (session.user.user_metadata?.display_name as string | undefined) ??
      session.user.email?.split('@')[0] ??
      null,
    handle: existing?.handle ?? session.user.email?.split('@')[0] ?? null,
  });
}

/** Turns backend error strings into something a person can act on. */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login')) return 'That email and password do not match.';
  if (lower.includes('already registered')) return 'That email already has an account. Sign in instead.';
  if (lower.includes('email not confirmed')) return 'Confirm your email address, then sign in.';
  if (lower.includes('rate limit')) return 'Too many attempts. Wait a moment and try again.';
  return message;
}
