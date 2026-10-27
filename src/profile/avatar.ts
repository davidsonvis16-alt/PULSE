import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Store } from '@/src/core/store';
import { newId } from '@/src/db/client';
import { getJsonSetting, setJsonSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import {
  DEFAULT_SCHEDULE,
  normaliseSchedule,
  type AvatarSchedule,
} from '@/src/profile/schedule';

/**
 * The listener's picture schedule, shared by every place the avatar appears so
 * an edit shows up on Home and Profile at once.
 */

const PHOTO_DIR = `${FileSystem.documentDirectory}pulse/avatars/`;

interface State {
  schedule: AvatarSchedule;
  loaded: boolean;
}

class AvatarScheduleStore extends Store<State> {
  private loading: Promise<void> | null = null;

  constructor() {
    super({ schedule: DEFAULT_SCHEDULE, loaded: false });
  }

  load(): Promise<void> {
    this.loading ??= getJsonSetting<unknown>(SETTINGS_KEYS.avatarSchedule, null)
      .then((raw) => this.set({ schedule: normaliseSchedule(raw), loaded: true }))
      .catch(() => this.set({ loaded: true }));
    return this.loading;
  }

  async save(schedule: AvatarSchedule) {
    this.set({ schedule });
    await setJsonSetting(SETTINGS_KEYS.avatarSchedule, schedule);
    await prunePhotos(schedule).catch(() => {});
  }
}

export const avatarSchedule = new AvatarScheduleStore();

/**
 * Lets the listener choose a photo and keeps a copy in Pulse's own storage,
 * since the picker's URI does not survive a restart. Null if they backed out.
 */
export async function pickAvatarPhoto(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'image/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  if (Platform.OS === 'web') {
    // No file system in a browser: keep the photo inline.
    const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  const extension = (asset.name.match(/\.(\w{2,5})$/)?.[1] ?? 'jpg').toLowerCase();
  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {});
  const target = `${PHOTO_DIR}${newId('avatar')}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: target });
  return target;
}

/** Deletes copied photos no part of the day uses any more. */
async function prunePhotos(schedule: AvatarSchedule) {
  if (Platform.OS === 'web') return;
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) return;
  const inUse = new Set(
    schedule.slots.flatMap((look) => (look?.kind === 'photo' ? [look.uri] : [])),
  );
  const files = await FileSystem.readDirectoryAsync(PHOTO_DIR);
  await Promise.all(
    files
      .map((name) => `${PHOTO_DIR}${name}`)
      .filter((uri) => !inUse.has(uri))
      .map((uri) => FileSystem.deleteAsync(uri, { idempotent: true })),
  );
}
