import Constants from 'expo-constants';

/**
 * Runtime configuration.
 *
 * Rule of the house: the only values that may live in the bundle are ones that
 * are safe in public — a Supabase URL, a Supabase anon key (which is only
 * useful alongside row-level security), and the URL of our own server proxy.
 *
 * Provider secrets — the Ticketmaster key in particular — never appear here.
 * They live in the Supabase Edge Function that fronts those APIs.
 */

type Extra = Record<string, string | undefined>;

const extra: Extra = {
  ...(Constants.expoConfig?.extra as Extra | undefined),
};

function read(key: string): string | undefined {
  const value = process.env[key] ?? extra[key];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

export const config = {
  supabase: {
    url: read('EXPO_PUBLIC_SUPABASE_URL'),
    anonKey: read('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
    get isConfigured() {
      return Boolean(this.url && this.anonKey);
    },
  },
  /**
   * Base URL of the Pulse edge functions. Supplying this turns on the social
   * layer and the events proxy; without it Pulse runs fully on-device.
   */
  api: {
    baseUrl: read('EXPO_PUBLIC_PULSE_API_URL'),
  },
  events: {
    /** Our own proxy endpoint. The provider key sits behind it, not in here. */
    proxyUrl:
      read('EXPO_PUBLIC_EVENTS_PROXY_URL') ??
      (read('EXPO_PUBLIC_SUPABASE_URL')
        ? `${read('EXPO_PUBLIC_SUPABASE_URL')}/functions/v1/events`
        : undefined),
  },
  music: {
    /** Which registered adapter new searches run against. */
    provider: read('EXPO_PUBLIC_MUSIC_PROVIDER') ?? 'itunes',
    /** Storefront used for searches and charts. */
    country: read('EXPO_PUBLIC_MUSIC_COUNTRY') ?? 'US',
  },
  /** Deep-link host used when building share links. */
  share: {
    webBaseUrl: read('EXPO_PUBLIC_SHARE_BASE_URL') ?? 'https://pulse.app',
  },
} as const;

export const isSocialEnabled = () => config.supabase.isConfigured;
