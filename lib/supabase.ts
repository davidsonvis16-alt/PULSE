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

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(config.supabase.url!, config.supabase.anonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
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
