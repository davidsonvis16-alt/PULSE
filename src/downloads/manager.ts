import * as FileSystem from 'expo-file-system/legacy';
import { Store } from '@/src/core/store';
import type { Track } from '@/src/core/types';
import { providerFor } from '@/src/providers/music';
import {
  createDownload,
  deleteDownloadRow,
  getAllDownloads,
  getDownload,
  getStorageUsage,
  markInterruptedAsPaused,
  updateDownload,
  type DownloadRecord,
  type DownloadStatus,
  type DownloadWithTrack,
} from '@/src/db/repos/downloads';
import { addTrackToLibrary, removeFromLibrary } from '@/src/db/repos/library';
import { pushNotification } from '@/src/db/repos/notifications';
import { getNotificationPrefs } from '@/src/db/repos/settings';

/**
 * Download manager.
 *
 * Pulse asks the *provider* whether a track may be kept. If the answer is no,
 * nothing here runs and the UI shows no download affordance at all. When the
 * answer is yes, this module fetches the real audio, stores it alongside its
 * cover art, and writes a library entry whose metadata came from the provider —
 * the user never types a title or attaches artwork by hand.
 *
 * Transfers are resumable: pausing keeps the partial file and the provider's
 * resume token, so continuing picks up where it left off rather than starting
 * over. Interrupted transfers are marked paused at launch, not failed.
 */

const AUDIO_DIR = `${FileSystem.documentDirectory}pulse/audio/`;
const ART_DIR = `${FileSystem.documentDirectory}pulse/artwork/`;

/** How many files transfer at once. Beyond this, downloads wait in the queue. */
const MAX_CONCURRENT = 2;

export interface DownloadsState {
  items: DownloadWithTrack[];
  byTrackId: Record<string, DownloadRecord>;
  storageBytes: number;
  storageCount: number;
  freeDiskBytes: number | null;
  ready: boolean;
}

type Task = {
  trackId: string;
  resumable: FileSystem.DownloadResumable;
};

class DownloadManager extends Store<DownloadsState> {
  private tasks = new Map<string, Task>();
  private queue: string[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({
      items: [],
      byTrackId: {},
      storageBytes: 0,
      storageCount: 0,
      freeDiskBytes: null,
      ready: false,
    });
  }

  async init() {
    await ensureDirectories();
    await markInterruptedAsPaused();
    await this.refresh();
    this.set({ ready: true });
  }

  /** Reloads state from the database; the database is the source of truth. */
  async refresh() {
    const [items, usage, free] = await Promise.all([
      getAllDownloads(),
      getStorageUsage(),
      FileSystem.getFreeDiskStorageAsync().catch(() => null),
    ]);
    const byTrackId: Record<string, DownloadRecord> = {};
    for (const item of items) byTrackId[item.trackId] = item;
    this.set({
      items,
      byTrackId,
      storageBytes: usage.bytes,
      storageCount: usage.count,
      freeDiskBytes: free,
    });
  }

  /** Coalesces the frequent progress writes into one UI refresh. */
  private scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 350);
  }

  status(trackId: string): DownloadStatus | null {
    return this.getSnapshot().byTrackId[trackId]?.status ?? null;
  }

  isDownloaded(trackId: string): boolean {
    const record = this.getSnapshot().byTrackId[trackId];
    return record?.status === 'completed' && !!record.fileUri;
  }

  localUri(trackId: string): string | null {
    const record = this.getSnapshot().byTrackId[trackId];
    return record?.status === 'completed' ? record.fileUri : null;
  }

  /**
   * Queues a track. Returns a reason string when the download cannot start, so
   * the caller can say something specific instead of failing silently.
   */
  async enqueue(track: Track): Promise<{ started: boolean; reason?: string }> {
    const provider = providerFor(track.provider);
    if (!provider.capabilities.download) {
      return { started: false, reason: `${provider.name} does not allow downloads.` };
    }

    const existing = await getDownload(track.id);
    if (existing?.status === 'completed' && existing.fileUri) {
      const info = await FileSystem.getInfoAsync(existing.fileUri);
      if (info.exists) return { started: false, reason: 'Already in your downloads.' };
      // The row outlived the file (storage cleared): fall through and refetch.
    }
    if (existing && ['downloading', 'preparing', 'queued'].includes(existing.status)) {
      return { started: false, reason: 'Already downloading.' };
    }

    const source = await provider.getDownloadSource(track);
    if (!source) {
      return { started: false, reason: 'This source has no downloadable audio for that track.' };
    }

    await createDownload({
      trackId: track.id,
      sourceUri: source.uri,
      sourceLabel: source.label,
      isExcerpt: source.isExcerpt,
      estimatedBytes: source.estimatedBytes,
    });
    await this.refresh();

    this.queue.push(track.id);
    void this.pump();
    return { started: true };
  }

  async enqueueMany(tracks: Track[]): Promise<{ queued: number; skipped: number }> {
    let queued = 0;
    let skipped = 0;
    for (const track of tracks) {
      const result = await this.enqueue(track);
      if (result.started) queued += 1;
      else skipped += 1;
    }
    return { queued, skipped };
  }

  private async pump() {
    while (this.tasks.size < MAX_CONCURRENT && this.queue.length > 0) {
      const trackId = this.queue.shift()!;
      if (this.tasks.has(trackId)) continue;
      await this.start(trackId);
    }
  }

  private async start(trackId: string) {
    const record = await getDownload(trackId);
    if (!record || record.status === 'cancelled') return;

    await updateDownload(trackId, { status: 'preparing', error: null });
    this.scheduleRefresh();

    const target = `${AUDIO_DIR}${safeName(trackId)}.m4a`;

    const onProgress = (data: FileSystem.DownloadProgressData) => {
      const total = data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : 0;
      const progress = total > 0 ? data.totalBytesWritten / total : 0;
      void updateDownload(trackId, {
        status: 'downloading',
        progress: Math.max(0, Math.min(1, progress)),
        bytesWritten: data.totalBytesWritten,
        totalBytes: total,
      });
      this.scheduleRefresh();
    };

    const resumable = record.resumeData
      ? FileSystem.createDownloadResumable(record.sourceUri, target, {}, onProgress, record.resumeData)
      : FileSystem.createDownloadResumable(record.sourceUri, target, {}, onProgress);

    this.tasks.set(trackId, { trackId, resumable });

    try {
      const result = record.resumeData ? await resumable.resumeAsync() : await resumable.downloadAsync();
      if (!result) {
        // Paused or cancelled mid-flight; whichever handler ran owns the state.
        return;
      }

      const info = await FileSystem.getInfoAsync(result.uri);
      const size = info.exists && 'size' in info ? (info.size as number) : 0;
      const artworkUri = await cacheArtwork(trackId);

      await updateDownload(trackId, {
        status: 'completed',
        progress: 1,
        fileUri: result.uri,
        artworkUri,
        totalBytes: size,
        bytesWritten: size,
        resumeData: null,
        error: null,
        completedAt: Date.now(),
      });

      // The download *is* the library entry: full metadata, artwork, source.
      const item = (await getAllDownloads()).find((d) => d.trackId === trackId);
      if (item) await addTrackToLibrary(item.track, 'download');

      const prefs = await getNotificationPrefs();
      if (prefs.downloads && item) {
        await pushNotification({
          type: 'download',
          title: 'Download complete',
          body: `${item.track.title} — ${item.track.artistName}`,
          entityType: 'track',
          entityId: trackId,
          imageUrl: item.track.artworkUrl,
        });
      }
    } catch (error) {
      const current = await getDownload(trackId);
      if (current?.status === 'paused' || current?.status === 'cancelled') return;
      await updateDownload(trackId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Download failed',
      });
    } finally {
      this.tasks.delete(trackId);
      await this.refresh();
      void this.pump();
    }
  }

  async pause(trackId: string) {
    const task = this.tasks.get(trackId);
    if (!task) {
      this.queue = this.queue.filter((id) => id !== trackId);
      await updateDownload(trackId, { status: 'paused' });
      await this.refresh();
      return;
    }
    try {
      await task.resumable.pauseAsync();
      const saved = task.resumable.savable();
      await updateDownload(trackId, {
        status: 'paused',
        resumeData: saved.resumeData ?? null,
      });
    } catch {
      await updateDownload(trackId, { status: 'paused' });
    } finally {
      this.tasks.delete(trackId);
      await this.refresh();
      void this.pump();
    }
  }

  async resume(trackId: string) {
    const record = await getDownload(trackId);
    if (!record) return;
    await updateDownload(trackId, { status: 'queued', error: null });
    this.queue.push(trackId);
    await this.refresh();
    void this.pump();
  }

  async retry(trackId: string) {
    await updateDownload(trackId, { status: 'queued', error: null, progress: 0, resumeData: null });
    this.queue.push(trackId);
    await this.refresh();
    void this.pump();
  }

  async cancel(trackId: string) {
    const task = this.tasks.get(trackId);
    this.queue = this.queue.filter((id) => id !== trackId);
    await updateDownload(trackId, { status: 'cancelled' });
    if (task) {
      try {
        await task.resumable.cancelAsync();
      } catch {
        /* already gone */
      }
      this.tasks.delete(trackId);
    }
    await this.remove(trackId, { keepLibraryEntry: true });
    void this.pump();
  }

  /** Deletes the stored files and the download row. */
  async remove(trackId: string, options: { keepLibraryEntry?: boolean } = {}) {
    const record = await getDownload(trackId);
    if (record?.fileUri) await safeDelete(record.fileUri);
    if (record?.artworkUri) await safeDelete(record.artworkUri);
    await deleteDownloadRow(trackId);
    if (!options.keepLibraryEntry) {
      // Keep the track in the library if the user saved it separately; only
      // drop the entry that the download itself created.
      await removeFromLibrary('track', trackId);
    }
    await this.refresh();
  }

  async removeAll() {
    const { items } = this.getSnapshot();
    for (const item of items) await this.remove(item.trackId);
  }

  /** Restarts anything left paused by a previous launch. */
  async resumeInterrupted() {
    const { items } = this.getSnapshot();
    for (const item of items) {
      if (item.status === 'paused' && item.resumeData) await this.resume(item.trackId);
    }
  }
}

async function ensureDirectories() {
  for (const dir of [AUDIO_DIR, ART_DIR]) {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Stores the cover next to the audio so offline playback still has artwork. */
async function cacheArtwork(trackId: string): Promise<string | null> {
  const item = (await getAllDownloads()).find((d) => d.trackId === trackId);
  const url = item?.track.artworkUrl;
  if (!url) return null;
  const target = `${ART_DIR}${safeName(trackId)}.jpg`;
  try {
    const existing = await FileSystem.getInfoAsync(target);
    if (existing.exists) return target;
    const result = await FileSystem.downloadAsync(url, target);
    return result.uri;
  } catch {
    return null;
  }
}

async function safeDelete(uri: string) {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* nothing to delete */
  }
}

function safeName(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export const downloadManager = new DownloadManager();

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 MB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
