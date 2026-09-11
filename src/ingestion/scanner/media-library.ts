import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import {
  isAudioFilename,
  type MusicScanner,
  type PermissionOutcome,
  type ScanOptions,
  type ScannedFile,
} from '@/src/ingestion/scanner/types';

/**
 * The device media store.
 *
 * On Android this is the real thing: every audio file the system knows about,
 * enumerated in pages, with a change listener so music added later is noticed
 * without the user doing anything.
 *
 * On iOS the Photos library holds no audio, so `isAvailable` reports false and
 * Pulse falls back to the file picker rather than showing an empty scan.
 */

const PAGE_SIZE = 200;
const DEFAULT_LIMIT = 5000;

export const mediaLibraryScanner: MusicScanner = {
  id: 'media-library',
  name: 'Device music',
  permissionRationale:
    'Pulse reads the audio files already on your device so it can build your library, find the right artwork and learn your taste. Your files are never changed and never uploaded.',
  canEnumerate: true,
  canWriteTags: false,

  async isAvailable() {
    if (Platform.OS === 'ios') return false;
    if (Platform.OS === 'web') return false;
    try {
      return await MediaLibrary.isAvailableAsync();
    } catch {
      return false;
    }
  },

  async getPermission() {
    if (!(await this.isAvailable())) {
      return { state: 'unsupported', blocked: false } satisfies PermissionOutcome;
    }
    try {
      const response = await MediaLibrary.getPermissionsAsync(false, ['audio']);
      return toOutcome(response);
    } catch {
      return { state: 'unsupported', blocked: false };
    }
  },

  async requestPermission() {
    if (!(await this.isAvailable())) {
      return { state: 'unsupported', blocked: false } satisfies PermissionOutcome;
    }
    try {
      const response = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      return toOutcome(response);
    } catch (error) {
      return {
        state: 'unsupported',
        blocked: false,
        message: error instanceof Error ? error.message : undefined,
      };
    }
  },

  async scanLibrary(options: ScanOptions = {}) {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const files: ScannedFile[] = [];
    let after: string | undefined;

    for (;;) {
      if (options.signal?.aborted) break;

      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.audio,
        first: PAGE_SIZE,
        after,
        sortBy: [MediaLibrary.SortBy.creationTime],
      });

      for (const asset of page.assets) {
        // The media store occasionally lists ringtones and voice memos too.
        if (!isAudioFilename(asset.filename)) continue;
        files.push({
          assetId: asset.id,
          uri: asset.uri,
          filename: asset.filename,
          sizeBytes: 0, // filled in when the file is read for tags
          durationMs: asset.duration > 0 ? Math.round(asset.duration * 1000) : null,
          modifiedAt: asset.modificationTime ?? null,
          addedAt: asset.creationTime ?? Date.now(),
          source: 'device',
        });
        if (files.length >= limit) break;
      }

      options.onProgress?.(files.length);
      if (!page.hasNextPage || files.length >= limit) break;
      after = page.endCursor;
    }

    return files;
  },

  observeLibraryChanges(onChange: () => void) {
    try {
      const subscription = MediaLibrary.addListener(() => onChange());
      return () => subscription.remove();
    } catch {
      return () => {};
    }
  },
};

function toOutcome(response: MediaLibrary.PermissionResponse): PermissionOutcome {
  if (response.granted) {
    // Android 14 and iOS can grant access to a chosen subset only.
    return { state: response.accessPrivileges === 'limited' ? 'limited' : 'granted', blocked: false };
  }
  return {
    state: response.status === 'undetermined' ? 'undetermined' : 'denied',
    blocked: !response.canAskAgain,
  };
}
