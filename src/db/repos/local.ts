import { db, now, transaction } from '@/src/db/client';
import { rowToTrack, upsertTrack } from '@/src/db/repos/catalog';
import { addTrackToLibrary, removeFromLibrary } from '@/src/db/repos/library';
import type { Track } from '@/src/core/types';
import type { IdentificationStatus } from '@/src/ingestion/identify/identifier';

/**
 * The index of music that lives on the user's device.
 *
 * A local track is a normal `tracks` row with provider `local`, plus a row here
 * holding everything that is true of the file rather than the recording: where
 * it is, what format it is in, and how sure Pulse is that it identified it.
 * That split is why imported music flows through the same library, player,
 * history and statistics as anything else.
 */

export const LOCAL_PROVIDER_ID = 'local';

export interface LocalTrackRecord {
  trackId: string;
  assetId: string | null;
  fileUri: string;
  filename: string;
  container: string | null;
  mimeType: string | null;
  fileSize: number | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  albumArtist: string | null;
  embeddedArtUri: string | null;
  identification: IdentificationStatus;
  confidence: number | null;
  matchedTrackId: string | null;
  source: 'device' | 'picked';
  addedAt: number;
  scannedAt: number;
  modifiedAt: number | null;
}

export interface LocalTrack extends LocalTrackRecord {
  track: Track;
}

/**
 * Stable id for a file. FNV-1a over the path: the same file always produces the
 * same id, so a rescan updates rather than duplicates.
 */
export function localTrackId(fileUri: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < fileUri.length; i += 1) {
    hash ^= fileUri.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${LOCAL_PROVIDER_ID}:track:${hash.toString(36)}${fileUri.length.toString(36)}`;
}

function toRecord(row: Record<string, any>): LocalTrackRecord {
  return {
    trackId: row.track_id,
    assetId: row.asset_id ?? null,
    fileUri: row.file_uri,
    filename: row.filename,
    container: row.container ?? null,
    mimeType: row.mime_type ?? null,
    fileSize: row.file_size ?? null,
    bitrate: row.bitrate ?? null,
    sampleRate: row.sample_rate ?? null,
    channels: row.channels ?? null,
    albumArtist: row.album_artist ?? null,
    embeddedArtUri: row.embedded_art_uri ?? null,
    identification: row.identification,
    confidence: row.confidence ?? null,
    matchedTrackId: row.matched_track_id ?? null,
    source: row.source ?? 'device',
    addedAt: row.added_at,
    scannedAt: row.scanned_at,
    modifiedAt: row.modified_at ?? null,
  };
}

/** Writes the catalogue row and the file row together, then saves to library. */
export async function saveLocalTrack(track: Track, record: Omit<LocalTrackRecord, 'trackId'>) {
  await upsertTrack(track);
  const instance = await db();
  await instance.runAsync(
    `INSERT INTO local_tracks
       (track_id, asset_id, file_uri, filename, container, mime_type, file_size, bitrate,
        sample_rate, channels, album_artist, embedded_art_uri, identification, confidence,
        matched_track_id, source, added_at, scanned_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET
       asset_id = excluded.asset_id,
       file_uri = excluded.file_uri,
       filename = excluded.filename,
       container = excluded.container,
       mime_type = excluded.mime_type,
       file_size = excluded.file_size,
       bitrate = excluded.bitrate,
       sample_rate = excluded.sample_rate,
       channels = excluded.channels,
       album_artist = excluded.album_artist,
       embedded_art_uri = COALESCE(excluded.embedded_art_uri, local_tracks.embedded_art_uri),
       identification = excluded.identification,
       confidence = excluded.confidence,
       matched_track_id = excluded.matched_track_id,
       scanned_at = excluded.scanned_at,
       modified_at = excluded.modified_at;`,
    [
      track.id,
      record.assetId,
      record.fileUri,
      record.filename,
      record.container,
      record.mimeType,
      record.fileSize,
      record.bitrate,
      record.sampleRate,
      record.channels,
      record.albumArtist,
      record.embeddedArtUri,
      record.identification,
      record.confidence,
      record.matchedTrackId,
      record.source,
      record.addedAt,
      record.scannedAt,
      record.modifiedAt,
    ],
  );
  await addTrackToLibrary(track, 'import');
}

export async function getLocalTrack(trackId: string): Promise<LocalTrackRecord | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, any>>(
    'SELECT * FROM local_tracks WHERE track_id = ?;',
    [trackId],
  );
  return row ? toRecord(row) : null;
}

export async function getLocalFileUri(trackId: string): Promise<string | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<{ file_uri: string }>(
    'SELECT file_uri FROM local_tracks WHERE track_id = ?;',
    [trackId],
  );
  return row?.file_uri ?? null;
}

/** URIs already indexed, so a rescan can tell new files from known ones. */
export async function getKnownFileUris(): Promise<Map<string, number | null>> {
  const instance = await db();
  const rows = await instance.getAllAsync<{ file_uri: string; modified_at: number | null }>(
    'SELECT file_uri, modified_at FROM local_tracks;',
  );
  return new Map(rows.map((row) => [row.file_uri, row.modified_at]));
}

export async function listLocalTracks(options: { limit?: number } = {}): Promise<LocalTrack[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT l.*, t.* , l.track_id AS track_id
     FROM local_tracks l JOIN tracks t ON t.id = l.track_id
     ORDER BY l.added_at DESC LIMIT ?;`,
    [options.limit ?? 5000],
  );
  return rows.map((row) => ({ ...toRecord(row), track: rowToTrack({ ...row, id: row.track_id }) }));
}

/** Imported tracks that still have no cover, newest first. */
export async function listLocalTracksMissingArtwork(limit = 500): Promise<LocalTrack[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT l.*, t.*, l.track_id AS track_id
     FROM local_tracks l JOIN tracks t ON t.id = l.track_id
     WHERE t.artwork_url IS NULL OR t.artwork_url = ''
     ORDER BY l.added_at DESC LIMIT ?;`,
    [limit],
  );
  return rows.map((row) => ({ ...toRecord(row), track: rowToTrack({ ...row, id: row.track_id }) }));
}

export async function listTracksNeedingIdentification(limit = 200): Promise<LocalTrack[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT l.*, t.*, l.track_id AS track_id
     FROM local_tracks l JOIN tracks t ON t.id = l.track_id
     WHERE l.identification IN ('needs_identification', 'unidentified')
     ORDER BY l.added_at DESC LIMIT ?;`,
    [limit],
  );
  return rows.map((row) => ({ ...toRecord(row), track: rowToTrack({ ...row, id: row.track_id }) }));
}

export async function updateIdentification(
  trackId: string,
  patch: {
    identification: IdentificationStatus;
    confidence?: number | null;
    matchedTrackId?: string | null;
    embeddedArtUri?: string | null;
  },
) {
  const instance = await db();
  await instance.runAsync(
    `UPDATE local_tracks
        SET identification = ?,
            confidence = ?,
            matched_track_id = COALESCE(?, matched_track_id),
            embedded_art_uri = COALESCE(?, embedded_art_uri),
            scanned_at = ?
      WHERE track_id = ?;`,
    [
      patch.identification,
      patch.confidence ?? null,
      patch.matchedTrackId ?? null,
      patch.embeddedArtUri ?? null,
      now(),
      trackId,
    ],
  );
}

/**
 * Leaves every song waiting on a match exactly as it is: the listener has
 * decided they are fine, so they stop being offered for identifying.
 */
export async function keepAllUnidentifiedAsTheyAre(): Promise<number> {
  const instance = await db();
  const result = await instance.runAsync(
    `UPDATE local_tracks SET identification = 'tagged', confidence = NULL, scanned_at = ?
      WHERE identification IN ('needs_identification', 'unidentified');`,
    [now()],
  );
  return result.changes;
}

export async function getLocalCounts(): Promise<{
  tracks: number;
  artists: number;
  albums: number;
  needsIdentification: number;
  withArtwork: number;
  bytes: number;
}> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, number>>(
    `SELECT
       (SELECT COUNT(*) FROM local_tracks) AS tracks,
       (SELECT COUNT(DISTINCT t.artist_name) FROM local_tracks l JOIN tracks t ON t.id = l.track_id) AS artists,
       (SELECT COUNT(DISTINCT t.album_title) FROM local_tracks l JOIN tracks t ON t.id = l.track_id
         WHERE t.album_title IS NOT NULL) AS albums,
       (SELECT COUNT(*) FROM local_tracks WHERE identification = 'needs_identification'
          OR identification = 'unidentified') AS needs_identification,
       (SELECT COUNT(*) FROM local_tracks l JOIN tracks t ON t.id = l.track_id
         WHERE t.artwork_url IS NOT NULL) AS with_artwork,
       (SELECT COALESCE(SUM(file_size), 0) FROM local_tracks) AS bytes;`,
  );
  return {
    tracks: row?.tracks ?? 0,
    artists: row?.artists ?? 0,
    albums: row?.albums ?? 0,
    needsIdentification: row?.needs_identification ?? 0,
    withArtwork: row?.with_artwork ?? 0,
    bytes: row?.bytes ?? 0,
  };
}

/** Everything the taste engine needs from the imported collection, in one pass. */
export async function getLocalTasteRows(): Promise<
  { trackId: string; title: string; artistName: string; genre: string | null; releaseDate: string | null }[]
> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.id AS track_id, t.title, t.artist_name, t.genre, t.release_date
     FROM local_tracks l JOIN tracks t ON t.id = l.track_id;`,
  );
  return rows.map((row) => ({
    trackId: row.track_id,
    title: row.title,
    artistName: row.artist_name,
    genre: row.genre ?? null,
    releaseDate: row.release_date ?? null,
  }));
}

export async function removeLocalTrack(trackId: string) {
  const instance = await db();
  await instance.runAsync('DELETE FROM local_tracks WHERE track_id = ?;', [trackId]);
  await removeFromLibrary('track', trackId);
}

/** Removes every imported track and its catalogue rows. Used by Privacy. */
export async function clearLocalLibrary() {
  const instance = await db();
  const rows = await instance.getAllAsync<{ track_id: string }>('SELECT track_id FROM local_tracks;');
  await transaction(async (tx) => {
    for (const row of rows) {
      await tx.runAsync(
        "DELETE FROM library_items WHERE item_type = 'track' AND item_id = ?;",
        [row.track_id],
      );
      await tx.runAsync('DELETE FROM tracks WHERE id = ?;', [row.track_id]);
    }
    await tx.runAsync('DELETE FROM local_tracks;');
    await tx.runAsync('DELETE FROM groove_tracks;');
    await tx.runAsync('DELETE FROM grooves;');
  });
}
