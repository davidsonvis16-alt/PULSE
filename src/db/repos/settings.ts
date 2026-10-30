import { db, now } from '@/src/db/client';

/** Small key/value store for preferences that do not deserve their own table. */

export async function getSetting(key: string): Promise<string | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM settings WHERE key = ?;',
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null) {
  const instance = await db();
  await instance.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, value],
  );
}

export async function getJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const raw = await getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJsonSetting<T>(key: string, value: T) {
  await setSetting(key, JSON.stringify(value));
}

export const SETTINGS_KEYS = {
  notificationPrefs: 'notifications.prefs',
  privacy: 'privacy.prefs',
  playback: 'playback.prefs',
  location: 'location.place',
  lastReleaseCheck: 'releases.lastCheckedAt',
  onboardingDone: 'onboarding.done',
  theme: 'appearance.theme',
  lastNewsCheck: 'news.lastCheckedAt',
  pushPrefs: 'push.prefs',
  avatarSchedule: 'profile.avatarSchedule',
  /** How many unidentified songs there were when the Home banner was closed. */
  identifyBannerDismissed: 'home.identifyBannerDismissed',
  /** The app version whose "Update available" banner was closed. */
  updateDismissed: 'home.updateDismissed',
  /** Set once Pulse has asked to keep working in the background. */
  backgroundAsked: 'import.backgroundAsked',
} as const;

export interface NotificationPrefs {
  newReleases: boolean;
  events: boolean;
  friendActivity: boolean;
  recommendations: boolean;
  playlists: boolean;
  downloads: boolean;
  /** Award nominations, winners and headlines about artists in the library. */
  musicNews: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newReleases: true,
  events: true,
  friendActivity: true,
  recommendations: true,
  playlists: true,
  downloads: false,
  musicNews: true,
};

export interface PrivacyPrefs {
  /** Off by default. Nothing about the user's listening leaves the device
   *  until they turn this on themselves. */
  shareListeningActivity: boolean;
  shareStatistics: boolean;
  shareLibrary: boolean;
  allowFriendRequests: boolean;
}

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = {
  shareListeningActivity: false,
  shareStatistics: false,
  shareLibrary: false,
  allowFriendRequests: true,
};

export interface PlaybackPrefs {
  volume: number;
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
  preferDownloads: boolean;
  /**
   * Share the phone's audio with whatever else is playing.
   *
   * Off — the default, and what a music app should normally do — Pulse takes
   * audio focus and other apps duck under it. On, Pulse plays alongside them
   * without interrupting them, which is what you want over a podcast, a game,
   * or a video call's background.
   */
  mixWithOtherApps: boolean;
}

export const DEFAULT_PLAYBACK_PREFS: PlaybackPrefs = {
  volume: 1,
  repeat: 'off',
  shuffle: false,
  preferDownloads: true,
  mixWithOtherApps: false,
};

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  // Saved before a newer switch existed, the stored object lacks it: default it on.
  const saved = await getJsonSetting<Partial<NotificationPrefs>>(
    SETTINGS_KEYS.notificationPrefs,
    DEFAULT_NOTIFICATION_PREFS,
  );
  return { ...DEFAULT_NOTIFICATION_PREFS, ...saved };
}
export async function setNotificationPrefs(prefs: NotificationPrefs) {
  await setJsonSetting(SETTINGS_KEYS.notificationPrefs, prefs);
}
export async function getPrivacyPrefs() {
  return getJsonSetting(SETTINGS_KEYS.privacy, DEFAULT_PRIVACY_PREFS);
}
export async function setPrivacyPrefs(prefs: PrivacyPrefs) {
  await setJsonSetting(SETTINGS_KEYS.privacy, prefs);
  const instance = await db();
  await instance.runAsync(
    `UPDATE profile SET activity_public = ?, stats_public = ?, library_public = ?, updated_at = ? WHERE id = 'me';`,
    [
      prefs.shareListeningActivity ? 1 : 0,
      prefs.shareStatistics ? 1 : 0,
      prefs.shareLibrary ? 1 : 0,
      now(),
    ],
  );
}
export async function getPlaybackPrefs(): Promise<PlaybackPrefs> {
  // Saved before a newer switch existed, the stored object lacks it: default it.
  const saved = await getJsonSetting<Partial<PlaybackPrefs>>(
    SETTINGS_KEYS.playback,
    DEFAULT_PLAYBACK_PREFS,
  );
  return { ...DEFAULT_PLAYBACK_PREFS, ...saved };
}
export async function setPlaybackPrefs(prefs: PlaybackPrefs) {
  await setJsonSetting(SETTINGS_KEYS.playback, prefs);
}

/* ------------------------------------------------------------ search recall */

export async function recordSearch(query: string) {
  const clean = query.trim();
  if (clean.length < 2) return;
  const instance = await db();
  await instance.runAsync('DELETE FROM search_history WHERE query = ? COLLATE NOCASE;', [clean]);
  await instance.runAsync('INSERT INTO search_history (query, created_at) VALUES (?, ?);', [
    clean,
    now(),
  ]);
  await instance.runAsync(
    'DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY created_at DESC LIMIT 20);',
  );
}

export async function getRecentSearches(limit = 8): Promise<string[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<{ query: string }>(
    'SELECT query FROM search_history ORDER BY created_at DESC LIMIT ?;',
    [limit],
  );
  return rows.map((r) => r.query);
}

export async function clearSearchHistory() {
  const instance = await db();
  await instance.runAsync('DELETE FROM search_history;');
}
