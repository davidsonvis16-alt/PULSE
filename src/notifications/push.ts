import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { config } from '@/src/core/config';
import { supabase } from '@/lib/supabase';
import { getJsonSetting, setJsonSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { libraryArtistNames } from '@/src/library/owned';

/**
 * Music news on the lock screen.
 *
 * Alerts are sent by Pulse's own server, which watches the feeds and the
 * award pages around the clock, so news arrives whether or not the app is
 * open. This module is the phone's side of that: ask permission, hand the
 * server a push token, and say what this person wants to hear about.
 *
 * Two deliberate limits:
 *
 *  - It is off until asked for. Nothing registers on first launch.
 *  - The server is told artist *names* only, and only if personalisation is
 *    turned on. Never a listening history, never what is played when. Turning
 *    it off sends an empty list, which erases what the server had.
 */

export type PushTopic = 'breaking' | 'awards' | 'new-music';

export interface PushPrefs {
  /** Has the listener asked for alerts on this phone? */
  enabled: boolean;
  /** May the server use the names of artists in this library? */
  personalise: boolean;
  topics: PushTopic[];
}

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  enabled: false,
  personalise: false,
  topics: ['breaking', 'awards', 'new-music'],
};

export type PushResult =
  | { status: 'ready'; token: string }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string };

export async function getPushPrefs(): Promise<PushPrefs> {
  const saved = await getJsonSetting<Partial<PushPrefs>>(SETTINGS_KEYS.pushPrefs, DEFAULT_PUSH_PREFS);
  return { ...DEFAULT_PUSH_PREFS, ...saved };
}

export async function setPushPrefs(prefs: PushPrefs) {
  await setJsonSetting(SETTINGS_KEYS.pushPrefs, prefs);
}

/** Android draws notifications in channels; music news gets its own. */
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('music-news', {
    name: 'Music news',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {});
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

async function tokenForThisDevice(): Promise<PushResult> {
  if (!Device.isDevice) {
    return { status: 'unsupported', reason: 'Push alerts do not work on a simulator.' };
  }
  const id = projectId();
  if (!id) return { status: 'unsupported', reason: 'This build has no project id for push.' };

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return { status: 'denied' };

  await ensureChannel();
  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  return { status: 'ready', token: token.data };
}

async function tellServer(body: Record<string, unknown>): Promise<boolean> {
  const endpoint = config.push.registerUrl;
  if (!endpoint) return false;
  const session = await supabase?.auth.getSession().catch(() => null);
  const accessToken = session?.data.session?.access_token;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  return !!response?.ok;
}

/**
 * Turns alerts on for this phone.
 *
 * Safe to call again at any time: the server keys devices by token, so
 * re-registering updates the same row rather than adding another.
 */
export async function enablePush(options: { personalise?: boolean } = {}): Promise<PushResult> {
  const prefs = await getPushPrefs();
  const personalise = options.personalise ?? prefs.personalise;

  const result = await tokenForThisDevice();
  if (result.status !== 'ready') {
    await setPushPrefs({ ...prefs, enabled: false });
    return result;
  }

  const artists = personalise ? await libraryArtistNames(300).catch(() => []) : [];
  const sent = await tellServer({
    token: result.token,
    platform: Platform.OS,
    enabled: true,
    topics: prefs.topics,
    artists,
    country: config.music.country,
  });
  if (!sent) {
    return { status: 'unsupported', reason: 'Could not reach the Pulse server to register.' };
  }

  await setPushPrefs({ ...prefs, enabled: true, personalise });
  return result;
}

export async function disablePush(): Promise<void> {
  const prefs = await getPushPrefs();
  await setPushPrefs({ ...prefs, enabled: false });
  const result = await tokenForThisDevice();
  if (result.status !== 'ready') return;
  // Sending an empty artist list is also how personal data is erased.
  await tellServer({ token: result.token, platform: Platform.OS, enabled: false, artists: [] });
}

/**
 * Keeps the server's copy of the artist list current.
 *
 * Called after an import, because a library that has just grown by a few
 * hundred songs should change what this person is told about.
 */
export async function refreshPushRegistration(): Promise<void> {
  const prefs = await getPushPrefs();
  if (!prefs.enabled) return;
  await enablePush({ personalise: prefs.personalise }).catch(() => {});
}
