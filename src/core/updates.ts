import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { getJson } from '@/src/core/http';

/**
 * "Update available" for the Android app.
 *
 * Pulse is shared as an APK rather than through a store, so nothing would tell
 * people a new version exists. Each release is published on the project's
 * GitHub page with the APK attached; the app compares that release's version
 * with its own and, when it is newer, offers to download it. Android then asks
 * the person to confirm the install — no app can skip that, and it is the
 * phone keeping them safe.
 *
 * The website needs none of this: it is always the newest version.
 */

const REPO = 'davidsonvis16-alt/PULSE';
const HOUR = 60 * 60 * 1000;

export interface AvailableUpdate {
  version: string;
  /** Where the APK downloads from. */
  url: string;
  notes: string | null;
}

export function installedVersion(): string {
  return Application.nativeApplicationVersion ?? '0.0.0';
}

/** Compares "1.2.10" with "1.10.0" as versions, not as text. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (Platform.OS !== 'android') return null;
  const release = await getJson<{
    tag_name?: string;
    body?: string | null;
    draft?: boolean;
    prerelease?: boolean;
    assets?: { name: string; browser_download_url: string }[];
  }>(`https://api.github.com/repos/${REPO}/releases/latest`, { ttlMs: HOUR }).catch(() => null);

  if (!release?.tag_name || release.draft || release.prerelease) return null;
  const apk = release.assets?.find((asset) => asset.name.toLowerCase().endsWith('.apk'));
  if (!apk || !isNewer(release.tag_name, installedVersion())) return null;
  return {
    version: release.tag_name.replace(/^v/i, ''),
    url: apk.browser_download_url,
    notes: release.body?.trim() || null,
  };
}
