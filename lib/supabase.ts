import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '@/src/core/config';

/**
 * Supabase client.
 *
 * Pulse works fully without a backend — catalogue, playback, library,
 * downloads and statistics are all on-device. Supabase adds accounts and the
 * social layer, so the client is created only when the deployment supplies
 * credentials, and every caller checks `isSupabaseConfigured` first.
 *
 * The anon key is safe in the bundle: it grants nothing on its own, because
 * every table is protected by row-level security (see supabase/migrations).
 */
export const isSupabaseConfigured = config.supabase.isConfigured;

// Read the address an email link opened before the client below consumes it.
// The client announces a password reset a moment after starting, usually
// before any screen is listening, so the app checks the address itself.
const landing =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? new URLSearchParams(`${window.location.hash.slice(1)}&${window.location.search.slice(1)}`)
    : null;

/** The page was opened from a password-reset email. */
export const arrivedForPasswordReset = landing?.get('type') === 'recovery';

/** Why an email link failed, usually because it expired or was already used. */
export const emailLinkError = landing?.get('error_description') ?? null;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(config.supabase.url!, config.supabase.anonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // Password-reset emails land on the web app with the session in the
        // address; phones never receive sessions that way.
        detectSessionInUrl: Platform.OS === 'web',
      },
    })
  : null;

/** Throws a clear error instead of a null dereference deep in a screen. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Pulse accounts need Supabase. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}
