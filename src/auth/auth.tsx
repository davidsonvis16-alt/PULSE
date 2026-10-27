import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { config } from '@/src/core/config';
import { getProfile, saveProfile, type PulseProfile } from '@/src/db/repos/social';
import { resetUserData } from '@/src/db/client';
import { clearLocalLibrary } from '@/src/db/repos/local';
import { setSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { clearImportedFiles } from '@/src/ingestion/scanner';
import { clearCachedArtwork } from '@/src/ingestion/artwork/provider';
import { invalidateTasteProfile } from '@/src/discovery/taste';
import { invalidateOwnedIndex } from '@/src/library/owned';

/**
 * Authentication.
 *
 * Every listener is a real account: Supabase email/password with a persisted,
 * auto-refreshing session. There is no anonymous "on this device" identity —
 * a phone shared between two people would otherwise mix their libraries,
 * taste and history into one profile that belongs to nobody.
 *
 * When a different account signs in on a device, whatever the previous
 * listener left behind is cleared first, so each person starts from their own
 * music and nobody else's.
 */

interface AuthApi {
  /** False when the build was made without a Supabase project to sign in to. */
  configured: boolean;
  ready: boolean;
  session: Session | null;
  profile: PulseProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves true when the account is ready to use, false when the email needs confirming first. */
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** True after arriving from a password-reset email, until a new one is set. */
  recovering: boolean;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
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
  const [recovering, setRecovering] = useState(false);

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
      await syncProfileFromSession(data.session).catch(() => {});
      await refreshProfile();
      if (active) {
        setSession(data.session);
        setReady(true);
      }
    })();

    const subscription = supabase?.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      // The profile is brought in line with the account before the session is
      // published, so no screen renders one person's library under another's name.
      void syncProfileFromSession(next)
        .catch(() => {})
        .then(() => refreshProfile())
        .then(() => {
          if (active) setSession(next);
        });
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
      const { data, error } = await client.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: confirmationLanding(),
        },
      });
      if (error) throw new Error(friendlyAuthError(error.message));
      // With email confirmation off the account is live straight away and the
      // auth listener takes it from here.
      return !!data.session;
    },
    [],
  );

  const resetPassword = useCallback(async (email: string) => {
    const emailError = validateEmail(email);
    if (emailError) throw new Error(emailError);
    const client = supabase;
    if (!client) throw new Error('Accounts are not available in this build.');
    const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: config.share.webBaseUrl,
    });
    if (error) throw new Error(friendlyAuthError(error.message));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const problem = validatePassword(password);
    if (problem) throw new Error(problem);
    const client = supabase;
    if (!client) throw new Error('Accounts are not available in this build.');
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(friendlyAuthError(error.message));
    setRecovering(false);
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      configured: isSupabaseConfigured,
      ready,
      session,
      profile,
      signIn,
      signUp,
      signOut,
      resetPassword,
      recovering,
      updatePassword,
      refreshProfile,
    }),
    [ready, session, profile, signIn, signUp, signOut, resetPassword, recovering, updatePassword, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function syncProfileFromSession(session: Session | null) {
  if (!session?.user || !supabase) return;
  const user = session.user;
  const existing = await getProfile();

  // A different person signing in on this phone starts clean.
  if (existing && existing.userId !== user.id) {
    await forgetPreviousListener();
  }

  // The server profile is the source of truth for who this is.
  const { data: remote } = await supabase
    .from('profiles')
    .select('handle, display_name, avatar_url, bio, activity_public, stats_public, library_public')
    .eq('id', user.id)
    .maybeSingle();

  const kept = existing?.userId === user.id ? existing : null;
  const emailName = user.email?.split('@')[0] ?? null;
  await saveProfile({
    userId: user.id,
    displayName:
      (remote?.display_name as string | null) ??
      kept?.displayName ??
      (user.user_metadata?.display_name as string | undefined) ??
      emailName,
    handle: (remote?.handle as string | null) ?? kept?.handle ?? null,
    avatarUrl: (remote?.avatar_url as string | null) ?? kept?.avatarUrl ?? null,
    bio: (remote?.bio as string | null) ?? kept?.bio ?? null,
    activityPublic: (remote?.activity_public as boolean | undefined) ?? kept?.activityPublic ?? false,
    statsPublic: (remote?.stats_public as boolean | undefined) ?? kept?.statsPublic ?? false,
    libraryPublic: (remote?.library_public as boolean | undefined) ?? kept?.libraryPublic ?? false,
  });
}

/**
 * Clears everything one listener left on the device: their imported library,
 * cached covers, history, playlists, downloads and taste. The music files on
 * the phone are never touched.
 */
async function forgetPreviousListener() {
  await resetUserData();
  await clearLocalLibrary();
  await clearImportedFiles().catch(() => {});
  await clearCachedArtwork().catch(() => {});
  await setSetting(SETTINGS_KEYS.onboardingDone, null);
  invalidateTasteProfile();
  invalidateOwnedIndex();
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

/**
 * Where the "confirm your email" link lands once Supabase has confirmed it.
 *
 * Left to itself Supabase sends everyone to the project's Site URL — a web
 * address that means nothing on a phone. So the link goes back to wherever the
 * person signed up: the Pulse app on a phone (pulse://), this same site on the
 * web. Each must also be listed under Authentication → URL Configuration →
 * Redirect URLs, or Supabase falls back to the Site URL.
 */
function confirmationLanding(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return Linking.createURL('/');
}
