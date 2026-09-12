import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import {
  isAudioFilename,
  type MusicScanner,
  type PermissionOutcome,
  type ScanDiagnostics,
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

      // Sorted by modification time, not creation time: the media store backs
      // "creationTime" with DATE_TAKEN, which is an images column and is null
      // on every audio row.
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.audio,
        first: PAGE_SIZE,
        after,
        sortBy: [MediaLibrary.SortBy.modificationTime],
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
          modifiedAt: asset.modificationTime || null,
          // Audio rows carry no DATE_TAKEN, so creationTime arrives as 0.
          addedAt: asset.modificationTime || asset.creationTime || Date.now(),
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

  async diagnose(): Promise<ScanDiagnostics> {
    const available = await this.isAvailable();
    const permission = await this.getPermission();

    if (!available) {
      return {
        available,
        permission,
        audioCount: null,
        anyMediaCount: null,
        summary:
          Platform.OS === 'ios'
            ? 'This device does not let Pulse read its music library directly.'
            : 'This platform has no media library Pulse can read.',
        suggestion: 'Choose your audio files instead and Pulse will import them the same way.',
      };
    }

    if (permission.state !== 'granted' && permission.state !== 'limited') {
      return {
        available,
        permission,
        audioCount: null,
        anyMediaCount: null,
        summary: 'Pulse was not given permission to read audio on this device.',
        suggestion: permission.blocked
          ? 'Turn on music or files access for Pulse in your system settings, then try again.'
          : 'Grant access when asked, or choose files by hand instead.',
      };
    }

    // Count audio, then count media of any kind. The comparison is what tells
    // the difference between "blocked" and "there is genuinely no audio here".
    const audioCount = await countAssets([MediaLibrary.MediaType.audio]);
    const anyMediaCount = await countAssets([
      MediaLibrary.MediaType.audio,
      MediaLibrary.MediaType.photo,
      MediaLibrary.MediaType.video,
    ]);

    if (audioCount === null) {
      return {
        available,
        permission,
        audioCount,
        anyMediaCount,
        summary: 'The media store refused the query for audio files.',
        suggestion:
          'This usually means the build Pulse is running in cannot request audio access. Choose files by hand, or run Pulse in a development build.',
      };
    }

    if (audioCount > 0) {
      return {
        available,
        permission,
        audioCount,
        anyMediaCount,
        summary: `${audioCount} audio file${audioCount === 1 ? '' : 's'} visible to Pulse.`,
        suggestion: 'Run the import to bring them in.',
      };
    }

    if (anyMediaCount && anyMediaCount > 0) {
      return {
        available,
        permission,
        audioCount,
        anyMediaCount,
        summary:
          'Pulse can read this device\u2019s media store, but there are no audio files in it.',
        suggestion:
          'Music held privately by another app cannot be read by Pulse. If your files are in Downloads or on an SD card, choose them by hand.',
      };
    }

    return {
      available,
      permission,
      audioCount,
      anyMediaCount,
      summary: 'The media store reports no media of any kind.',
      suggestion:
        'Audio access may not be granted to the build Pulse is running in. Choose files by hand instead.',
    };
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

/** Returns null when the query itself fails, which is different from zero. */
async function countAssets(mediaType: MediaLibrary.MediaTypeValue[]): Promise<number | null> {
  try {
    const page = await MediaLibrary.getAssetsAsync({ mediaType, first: 1 });
    return page.totalCount ?? page.assets.length;
  } catch {
    return null;
  }
}

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
