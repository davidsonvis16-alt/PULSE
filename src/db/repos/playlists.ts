import { db, newId, now } from '@/src/db/client';
import { rowToTrack, upsertTrack } from '@/src/db/repos/catalog';
import type { Track } from '@/src/core/types';

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  coverTrackId: string | null;
  coverArtworkUrl: string | null;
  trackCount: number;
  totalDurationMs: number;
  visibility: 'private' | 'friends' | 'public';
  isSystem: boolean;
  createdAt: number;
  updatedAt: number;
}

const LIST_SQL = `
  SELECT p.*,
         COUNT(pt.track_id) AS track_count,
         COALESCE(SUM(t.duration_ms), 0) AS total_duration,
         (SELECT t2.artwork_url FROM playlist_tracks pt2
            JOIN tracks t2 ON t2.id = pt2.track_id
           WHERE pt2.playlist_id = p.id
           ORDER BY pt2.position ASC LIMIT 1) AS cover_artwork
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
`;

function toPlaylist(row: Record<string, any>): Playlist {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    coverTrackId: row.cover_track_id ?? null,
    coverArtworkUrl: row.cover_artwork ?? null,
    trackCount: row.track_count ?? 0,
    totalDurationMs: row.total_duration ?? 0,
    visibility: row.visibility ?? 'private',
    isSystem: !!row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPlaylists(): Promise<Playlist[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `${LIST_SQL} GROUP BY p.id ORDER BY p.updated_at DESC;`,
  );
  return rows.map(toPlaylist);
}

export async function getPlaylist(id: string): Promise<Playlist | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, any>>(
    `${LIST_SQL} WHERE p.id = ? GROUP BY p.id;`,
    [id],
  );
  return row ? toPlaylist(row) : null;
}

export async function createPlaylist(name: string, description?: string): Promise<Playlist> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('A playlist needs a name.');
  const instance = await db();
  const id = newId('pl');
  const ts = now();
  await instance.runAsync(
    `INSERT INTO playlists (id, name, description, is_system, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'private', ?, ?);`,
    [id, clean, description?.trim().slice(0, 300) ?? null, ts, ts],
  );
  return (await getPlaylist(id))!;
}

export async function renamePlaylist(id: string, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('A playlist needs a name.');
  const instance = await db();
  await instance.runAsync('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?;', [
    clean,
    now(),
    id,
  ]);
}

export async function setPlaylistVisibility(id: string, visibility: Playlist['visibility']) {
  const instance = await db();
  await instance.runAsync('UPDATE playlists SET visibility = ?, updated_at = ? WHERE id = ?;', [
    visibility,
    now(),
    id,
  ]);
}

export async function deletePlaylist(id: string) {
  const instance = await db();
  await instance.runAsync('DELETE FROM playlists WHERE id = ?;', [id]);
}

export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = ? ORDER BY pt.position ASC;`,
    [playlistId],
  );
  return rows.map(rowToTrack);
}

export async function addTracksToPlaylist(playlistId: string, tracks: Track[]): Promise<number> {
  if (tracks.length === 0) return 0;
  const instance = await db();
  for (const track of tracks) await upsertTrack(track);

  const row = await instance.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?;',
    [playlistId],
  );
  let position = row?.next ?? 0;
  let added = 0;

  await instance.withTransactionAsync(async () => {
    for (const track of tracks) {
      const result = await instance.runAsync(
        `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
         VALUES (?, ?, ?, ?);`,
        [playlistId, track.id, position, now()],
      );
      if (result.changes > 0) {
        position += 1;
        added += 1;
      }
    }
    await instance.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?;', [now(), playlistId]);
  });
  return added;
}

export async function removeTrackFromPlaylist(playlistId: string, trackId: string) {
  const instance = await db();
  await instance.withTransactionAsync(async () => {
    await instance.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?;', [
      playlistId,
      trackId,
    ]);
    await renumber(instance, playlistId);
    await instance.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?;', [now(), playlistId]);
  });
}

/** Moves a track to a new index, shifting the rest to keep positions dense. */
export async function reorderPlaylist(playlistId: string, trackId: string, toIndex: number) {
  const instance = await db();
  const rows = await instance.getAllAsync<{ track_id: string }>(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC;',
    [playlistId],
  );
  const ids = rows.map((r) => r.track_id);
  const from = ids.indexOf(trackId);
  if (from === -1) return;
  const target = Math.max(0, Math.min(ids.length - 1, toIndex));
  ids.splice(target, 0, ids.splice(from, 1)[0]);

  await instance.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i += 1) {
      await instance.runAsync(
        'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?;',
        [i, playlistId, ids[i]],
      );
    }
    await instance.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?;', [now(), playlistId]);
  });
}

async function renumber(instance: Awaited<ReturnType<typeof db>>, playlistId: string) {
  const rows = await instance.getAllAsync<{ track_id: string }>(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC;',
    [playlistId],
  );
  for (let i = 0; i < rows.length; i += 1) {
    await instance.runAsync(
      'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?;',
      [i, playlistId, rows[i].track_id],
    );
  }
}

export async function playlistsContaining(trackId: string): Promise<string[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<{ playlist_id: string }>(
    'SELECT playlist_id FROM playlist_tracks WHERE track_id = ?;',
    [trackId],
  );
  return rows.map((r) => r.playlist_id);
}

/** The genres and artists a playlist is made of — the seed for "add more like this". */
export async function playlistProfile(playlistId: string): Promise<{
  genres: string[];
  artistNames: string[];
  trackIds: string[];
}> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.id, t.genre, t.artist_name FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ?;`,
    [playlistId],
  );
  const genreCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.genre) genreCounts.set(row.genre, (genreCounts.get(row.genre) ?? 0) + 1);
    if (row.artist_name) artistCounts.set(row.artist_name, (artistCounts.get(row.artist_name) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return {
    genres: top(genreCounts).slice(0, 4),
    artistNames: top(artistCounts).slice(0, 4),
    trackIds: rows.map((r) => r.id),
  };
}

/**
 * Writes a playlist Pulse keeps up to date itself, replacing what it held.
 *
 * Kept by a fixed id, so it is the same playlist every time — in the library,
 * in history, on the lock screen — with new songs rather than a new copy.
 */
export async function saveSystemPlaylist(
  id: string,
  name: string,
  description: string,
  tracks: Track[],
): Promise<void> {
  const instance = await db();
  for (const track of tracks) await upsertTrack(track);
  const ts = now();
  await instance.withTransactionAsync(async () => {
    await instance.runAsync(
      `INSERT INTO playlists (id, name, description, is_system, visibility, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'private', ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
         updated_at = excluded.updated_at;`,
      [id, name, description, ts, ts],
    );
    await instance.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?;', [id]);
    for (let i = 0; i < tracks.length; i += 1) {
      await instance.runAsync(
        `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
         VALUES (?, ?, ?, ?);`,
        [id, tracks[i].id, i, ts],
      );
    }
  });
}
