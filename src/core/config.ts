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

/**
 * Every variable is written out in full on purpose: Expo bakes
 * `process.env.EXPO_PUBLIC_*` into the bundle only where it appears literally,
 * so `process.env[key]` would be empty in every real build.
 */
const env: Record<string, string | undefined> = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_PULSE_API_URL: process.env.EXPO_PUBLIC_PULSE_API_URL,
  EXPO_PUBLIC_EVENTS_PROXY_URL: process.env.EXPO_PUBLIC_EVENTS_PROXY_URL,
  EXPO_PUBLIC_PUSH_REGISTER_URL: process.env.EXPO_PUBLIC_PUSH_REGISTER_URL,
  EXPO_PUBLIC_MUSIC_PROVIDER: process.env.EXPO_PUBLIC_MUSIC_PROVIDER,
  EXPO_PUBLIC_MUSIC_COUNTRY: process.env.EXPO_PUBLIC_MUSIC_COUNTRY,
  EXPO_PUBLIC_YOUTUBE_API_KEY: process.env.EXPO_PUBLIC_YOUTUBE_API_KEY,
  EXPO_PUBLIC_LASTFM_API_KEY: process.env.EXPO_PUBLIC_LASTFM_API_KEY,
  EXPO_PUBLIC_SHARE_BASE_URL: process.env.EXPO_PUBLIC_SHARE_BASE_URL,
};

function read(key: string): string | undefined {
  const value = env[key] ?? extra[key];
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
  /** Endpoint that registers this device for music-news push. */
  push: {
    registerUrl:
      read('EXPO_PUBLIC_PUSH_REGISTER_URL') ??
      (read('EXPO_PUBLIC_SUPABASE_URL')
        ? `${read('EXPO_PUBLIC_SUPABASE_URL')}/functions/v1/register-device`
        : undefined),
  },
  music: {
    /** Which registered adapter new searches run against. */
    provider: read('EXPO_PUBLIC_MUSIC_PROVIDER') ?? 'itunes',
    /** Storefront used for searches and charts. */
    country: read('EXPO_PUBLIC_MUSIC_COUNTRY') ?? 'US',
  },
  /**
   * Optional keys for the audience figures a song can carry.
   *
   * Neither is required: without them Pulse shows the figures that are public
   * without a key, and says plainly which platforms publish nothing.
   */
  popularity: {
    /** YouTube Data API key — turns on real view counts. */
    youtubeKey: read('EXPO_PUBLIC_YOUTUBE_API_KEY'),
    /** Last.fm API key — turns on listener and scrobble counts. */
    lastfmKey: read('EXPO_PUBLIC_LASTFM_API_KEY'),
  },
  /** Deep-link host used when building share links. */
  share: {
    // The address the web version is published at, so a shared link opens
    // Pulse in the browser for anyone without the app. On the web itself the
    // page's own address is always right.
    webBaseUrl:
      read('EXPO_PUBLIC_SHARE_BASE_URL') ??
      (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')
        ? window.location.origin
        : 'https://pulse.app'),
  },
} as const;

export const isSocialEnabled = () => config.supabase.isConfigured;
