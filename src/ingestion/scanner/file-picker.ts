import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { clearWebFiles, storeWebFile } from '@/src/ingestion/web-store';
import {
  isAudioFilename,
  type MusicScanner,
  type PermissionOutcome,
  type ScanDiagnostics,
  type ScanOptions,
  type ScannedFile,
} from '@/src/ingestion/scanner/types';

/**
 * Importing music the user chooses.
 *
 * This is the path on iOS, where the system music library is not reachable from
 * an Expo app, and a useful second path on Android for files the media store
 * has not indexed.
 *
 * The picked file is copied into Pulse's own storage rather than referenced in
 * place: the URIs the picker hands back do not survive a restart, and a copy
 * means Pulse never has to reach back into the user's files again. The original
 * is left exactly as it was.
 */

const IMPORT_DIR = `${FileSystem.documentDirectory}pulse/imported/`;

export const filePickerScanner: MusicScanner = {
  id: 'file-picker',
  name: 'Choose files',
  permissionRationale:
    'Pulse only sees the files you pick. It copies them into the app so they keep working offline, and leaves your originals untouched.',
  canEnumerate: false,
  canWriteTags: false,

  async isAvailable() {
    return true;
  },

  // The picker is its own consent: the user grants access by choosing files.
  async getPermission(): Promise<PermissionOutcome> {
    return { state: 'granted', blocked: false };
  },

  async requestPermission(): Promise<PermissionOutcome> {
    return { state: 'granted', blocked: false };
  },

  async scanLibrary(options: ScanOptions = {}) {
    // Some systems report perfectly ordinary audio files under a non-audio
    // MIME type, so the filter is deliberately wider than "audio/*" and the
    // extension check below is what actually decides.
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*', 'application/ogg', 'application/x-flac', 'application/octet-stream'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return [];

    if (Platform.OS !== 'web') await ensureImportDir();

    const files: ScannedFile[] = [];
    for (const asset of result.assets ?? []) {
      if (options.signal?.aborted) break;
      if (options.limit !== undefined && files.length >= options.limit) break;
      // Keep it only if the name or the reported type says it is audio.
      if (!isAudioFilename(asset.name) && !asset.mimeType?.startsWith('audio/')) continue;

      const stored =
        Platform.OS === 'web'
          ? await storeWebFile(safeName(asset.name), asset.file ?? (await (await fetch(asset.uri)).blob())).catch(
              () => null,
            )
          : await persist(asset.uri, asset.name);
      if (!stored) continue;

      files.push({
        assetId: null,
        uri: stored.uri,
        filename: asset.name,
        sizeBytes: stored.size || asset.size || 0,
        durationMs: null,
        modifiedAt: Date.now(),
        addedAt: Date.now(),
        source: 'picked',
      });
      options.onProgress?.(files.length);
    }
    return files;
  },

  async diagnose(): Promise<ScanDiagnostics> {
    return {
      available: true,
      permission: { state: 'granted', blocked: false },
      audioCount: null,
      anyMediaCount: null,
      summary: 'Pulse imports whichever files you choose.',
      suggestion: 'Pick your music and Pulse will read its tags and artwork.',
    };
  },

  observeLibraryChanges() {
    // Nothing to watch: files arrive only when the user picks them.
    return () => {};
  },
};

async function ensureImportDir() {
  const info = await FileSystem.getInfoAsync(IMPORT_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(IMPORT_DIR, { intermediates: true });
}

async function persist(sourceUri: string, filename: string) {
  const target = `${IMPORT_DIR}${safeName(filename)}`;
  try {
    const existing = await FileSystem.getInfoAsync(target);
    if (!existing.exists) await FileSystem.copyAsync({ from: sourceUri, to: target });
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) return null;
    return { uri: target, size: 'size' in info && typeof info.size === 'number' ? info.size : 0 };
  } catch {
    return null;
  }
}

/** Keeps the original name readable while making it safe as a path segment. */
function safeName(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(-120);
  return cleaned || `track-${Date.now()}.audio`;
}

export async function clearImportedFiles() {
  if (Platform.OS === 'web') {
    await clearWebFiles().catch(() => {});
    return;
  }
  try {
    await FileSystem.deleteAsync(IMPORT_DIR, { idempotent: true });
  } catch {
    /* nothing to remove */
  }
}
