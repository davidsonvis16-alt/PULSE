/**
 * MusicScanner: the one place Pulse knows how to find audio on a device.
 *
 * Platforms differ sharply here. Android exposes the media store, so Pulse can
 * enumerate a whole collection once permission is granted. iOS keeps the Music
 * app's library behind a framework Expo does not surface, so there the user
 * picks files instead. Both produce the same `ScannedFile`, and everything
 * downstream — tags, identification, artwork, Grooves — is identical.
 */

export interface ScannedFile {
  /** Media-store id where the platform has one; null for picked files. */
  assetId: string | null;
  uri: string;
  filename: string;
  sizeBytes: number;
  /** Duration the platform reported, in milliseconds. Tags may improve on it. */
  durationMs: number | null;
  modifiedAt: number | null;
  addedAt: number;
  source: 'device' | 'picked';
}

export type PermissionState = 'granted' | 'denied' | 'limited' | 'undetermined' | 'unsupported';

export interface PermissionOutcome {
  state: PermissionState;
  /** True when the user said no and the system will not ask again. */
  blocked: boolean;
  message?: string;
}

export interface ScanOptions {
  /** Called as files are discovered so the UI can count up live. */
  onProgress?: (found: number) => void;
  /** Stop after this many files. Guards against a pathological collection. */
  limit?: number;
  signal?: AbortSignal;
}

export interface MusicScanner {
  readonly id: string;
  readonly name: string;
  /** Describes what the user is being asked for, in their terms. */
  readonly permissionRationale: string;
  /** True when this scanner can list files without the user choosing each one. */
  readonly canEnumerate: boolean;
  /**
   * Whether Pulse could write tags back into the user's files on this platform.
   * False everywhere Expo runs today, which is why the option is shown as
   * unavailable rather than offered and then quietly failing.
   */
  readonly canWriteTags: boolean;

  isAvailable(): Promise<boolean>;
  getPermission(): Promise<PermissionOutcome>;
  requestPermission(): Promise<PermissionOutcome>;
  scanLibrary(options?: ScanOptions): Promise<ScannedFile[]>;
  /** Fires when the device's music changes. Returns an unsubscribe function. */
  observeLibraryChanges(onChange: () => void): () => void;
}

export const AUDIO_EXTENSIONS = [
  'mp3',
  'm4a',
  'mp4',
  'aac',
  'flac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'wma',
  'aiff',
  'aif',
  'alac',
] as const;

export function isAudioFilename(filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase();
  return !!extension && (AUDIO_EXTENSIONS as readonly string[]).includes(extension);
}
