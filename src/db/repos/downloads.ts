import { db, newId, now } from '@/src/db/client';
import { rowToTrack } from '@/src/db/repos/catalog';
import type { Track } from '@/src/core/types';

export type DownloadStatus =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadRecord {
  id: string;
  trackId: string;
  status: DownloadStatus;
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  fileUri: string | null;
  artworkUri: string | null;
  sourceUri: string;
  sourceLabel: string;
  isExcerpt: boolean;
  resumeData: string | null;
  error: string | null;
  queuedAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface DownloadWithTrack extends DownloadRecord {
  track: Track;
}

function toRecord(row: Record<string, any>): DownloadRecord {
  return {
    id: row.id,
    trackId: row.track_id,
    status: row.status,
    progress: row.progress ?? 0,
    bytesWritten: row.bytes_written ?? 0,
    totalBytes: row.total_bytes ?? 0,
    fileUri: row.file_uri ?? null,
    artworkUri: row.artwork_uri ?? null,
    sourceUri: row.source_uri,
    sourceLabel: row.source_label,
    isExcerpt: !!row.is_excerpt,
    resumeData: row.resume_data ?? null,
    error: row.error ?? null,
    queuedAt: row.queued_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

export async function getDownload(trackId: string): Promise<DownloadRecord | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, any>>(
    'SELECT * FROM downloads WHERE track_id = ?;',
    [trackId],
  );
  return row ? toRecord(row) : null;
}

export async function getAllDownloads(): Promise<DownloadWithTrack[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT d.*, t.id AS t_id, t.provider, t.provider_track_id, t.title, t.artist_id, t.artist_name,
            t.album_id, t.album_title, t.artwork_url, t.duration_ms, t.release_date, t.genre,
            t.track_number, t.disc_number, t.explicit, t.external_url
     FROM downloads d JOIN tracks t ON t.id = d.track_id
     ORDER BY CASE d.status
        WHEN 'downloading' THEN 0 WHEN 'preparing' THEN 1 WHEN 'queued' THEN 2
        WHEN 'paused' THEN 3 WHEN 'failed' THEN 4 ELSE 5 END,
      d.queued_at DESC;`,
  );
  return rows.map((row) => ({
    ...toRecord(row),
    track: rowToTrack({ ...row, id: row.t_id }),
  }));
}

export async function createDownload(input: {
  trackId: string;
  sourceUri: string;
  sourceLabel: string;
  isExcerpt: boolean;
  estimatedBytes: number | null;
}): Promise<DownloadRecord> {
  const instance = await db();
  const ts = now();
  const id = newId('dl');
  await instance.runAsync(
    `INSERT INTO downloads
       (id, track_id, status, progress, bytes_written, total_bytes, source_uri, source_label,
        is_excerpt, queued_at, updated_at)
     VALUES (?, ?, 'queued', 0, 0, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET
       status = 'queued', progress = 0, bytes_written = 0, error = NULL,
       source_uri = excluded.source_uri, source_label = excluded.source_label,
       resume_data = NULL, updated_at = excluded.updated_at;`,
    [
      id,
      input.trackId,
      input.estimatedBytes ?? 0,
      input.sourceUri,
      input.sourceLabel,
      input.isExcerpt ? 1 : 0,
      ts,
      ts,
    ],
  );
  return (await getDownload(input.trackId))!;
}

export async function updateDownload(
  trackId: string,
  patch: Partial<
    Pick<
      DownloadRecord,
      | 'status'
      | 'progress'
      | 'bytesWritten'
      | 'totalBytes'
      | 'fileUri'
      | 'artworkUri'
      | 'resumeData'
      | 'error'
      | 'completedAt'
    >
  >,
) {
  const columns: Record<string, string> = {
    status: 'status',
    progress: 'progress',
    bytesWritten: 'bytes_written',
    totalBytes: 'total_bytes',
    fileUri: 'file_uri',
    artworkUri: 'artwork_uri',
    resumeData: 'resume_data',
    error: 'error',
    completedAt: 'completed_at',
  };
  const sets: string[] = [];
  const params: any[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    params.push(value ?? null);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(now(), trackId);
  const instance = await db();
  await instance.runAsync(`UPDATE downloads SET ${sets.join(', ')} WHERE track_id = ?;`, params);
}

export async function deleteDownloadRow(trackId: string) {
  const instance = await db();
  await instance.runAsync('DELETE FROM downloads WHERE track_id = ?;', [trackId]);
}

export async function getDownloadedTrackIds(): Promise<Set<string>> {
  const instance = await db();
  const rows = await instance.getAllAsync<{ track_id: string }>(
    "SELECT track_id FROM downloads WHERE status = 'completed' AND file_uri IS NOT NULL;",
  );
  return new Set(rows.map((r) => r.track_id));
}

export async function getStorageUsage(): Promise<{ bytes: number; count: number }> {
  const instance = await db();
  const row = await instance.getFirstAsync<{ bytes: number; count: number }>(
    "SELECT COALESCE(SUM(total_bytes), 0) AS bytes, COUNT(*) AS count FROM downloads WHERE status = 'completed';",
  );
  return { bytes: row?.bytes ?? 0, count: row?.count ?? 0 };
}

/** Downloads interrupted by the app closing are resumable, not failed. */
export async function markInterruptedAsPaused() {
  const instance = await db();
  await instance.runAsync(
    "UPDATE downloads SET status = 'paused', updated_at = ? WHERE status IN ('downloading', 'preparing', 'queued');",
    [now()],
  );
}
