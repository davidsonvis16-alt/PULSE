import { db, now } from '@/src/db/client';
import { rowToAlbum, rowToArtist, rowToTrack, upsertAlbum, upsertArtist, upsertTrack } from '@/src/db/repos/catalog';
import type { Album, Artist, Track } from '@/src/core/types';

export type LibraryItemType = 'track' | 'album' | 'artist' | 'playlist';
export type LibrarySource = 'saved' | 'download' | 'import';

export interface LibraryTrack extends Track {
  addedAt: number;
  source: LibrarySource;
  /** Present when the file is on the device and playable offline. */
  localUri: string | null;
  localArtworkUri: string | null;
  fileBytes: number | null;
  sourceLabel: string | null;
  isExcerpt: boolean;
}

const TRACK_SELECT = `
  SELECT t.*, l.added_at AS added_at, l.source AS lib_source,
         d.file_uri AS file_uri, d.artwork_uri AS artwork_uri,
         d.total_bytes AS file_bytes, d.source_label AS source_label,
         d.is_excerpt AS is_excerpt, d.status AS download_status
  FROM library_items l
  JOIN tracks t ON t.id = l.item_id
  LEFT JOIN downloads d ON d.track_id = t.id AND d.status = 'completed'
  WHERE l.item_type = 'track'
`;

function toLibraryTrack(row: Record<string, any>): LibraryTrack {
  return {
    ...rowToTrack(row),
    addedAt: row.added_at,
    source: row.lib_source,
    localUri: row.file_uri ?? null,
    localArtworkUri: row.artwork_uri ?? null,
    fileBytes: row.file_bytes ?? null,
    sourceLabel: row.source_label ?? null,
    isExcerpt: !!row.is_excerpt,
  };
}

export async function addTrackToLibrary(track: Track, source: LibrarySource = 'saved') {
  await upsertTrack(track);
  const instance = await db();
  await instance.runAsync(
    `INSERT INTO library_items (item_type, item_id, source, added_at)
     VALUES ('track', ?, ?, ?)
     ON CONFLICT(item_type, item_id) DO UPDATE SET
       source = CASE WHEN excluded.source = 'download' THEN 'download' ELSE library_items.source END;`,
    [track.id, source, now()],
  );
}

export async function addAlbumToLibrary(album: Album) {
  await upsertAlbum(album);
  const instance = await db();
  await instance.runAsync(
    `INSERT OR IGNORE INTO library_items (item_type, item_id, source, added_at) VALUES ('album', ?, 'saved', ?);`,
    [album.id, now()],
  );
}

export async function addArtistToLibrary(artist: Artist) {
  await upsertArtist(artist);
  const instance = await db();
  await instance.runAsync(
    `INSERT OR IGNORE INTO library_items (item_type, item_id, source, added_at) VALUES ('artist', ?, 'saved', ?);`,
    [artist.id, now()],
  );
}

export async function removeFromLibrary(type: LibraryItemType, id: string) {
  const instance = await db();
  await instance.runAsync('DELETE FROM library_items WHERE item_type = ? AND item_id = ?;', [type, id]);
}

export async function isInLibrary(type: LibraryItemType, id: string): Promise<boolean> {
  const instance = await db();
  const row = await instance.getFirstAsync(
    'SELECT 1 AS present FROM library_items WHERE item_type = ? AND item_id = ? LIMIT 1;',
    [type, id],
  );
  return !!row;
}

export type LibrarySort = 'recent' | 'title' | 'artist' | 'album' | 'duration';

const ORDER_BY: Record<LibrarySort, string> = {
  recent: 'l.added_at DESC',
  title: 't.title COLLATE NOCASE ASC',
  artist: 't.artist_name COLLATE NOCASE ASC, t.title COLLATE NOCASE ASC',
  album: 't.album_title COLLATE NOCASE ASC, t.disc_number ASC, t.track_number ASC',
  duration: 't.duration_ms DESC',
};

export async function getLibraryTracks(options: {
  sort?: LibrarySort;
  search?: string;
  downloadedOnly?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<LibraryTrack[]> {
  const { sort = 'recent', search, downloadedOnly, limit = 500, offset = 0 } = options;
  const instance = await db();
  const clauses: string[] = [];
  const params: any[] = [];

  if (downloadedOnly) clauses.push("d.file_uri IS NOT NULL");
  if (search?.trim()) {
    clauses.push('(t.title LIKE ? COLLATE NOCASE OR t.artist_name LIKE ? COLLATE NOCASE OR t.album_title LIKE ? COLLATE NOCASE)');
    const like = `%${search.trim()}%`;
    params.push(like, like, like);
  }

  const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  const rows = await instance.getAllAsync<Record<string, any>>(
    `${TRACK_SELECT}${where} ORDER BY ${ORDER_BY[sort]} LIMIT ? OFFSET ?;`,
    [...params, limit, offset],
  );
  return rows.map(toLibraryTrack);
}

export async function getRecentlyAdded(limit = 20): Promise<LibraryTrack[]> {
  return getLibraryTracks({ sort: 'recent', limit });
}

export async function getLibraryAlbums(): Promise<(Album & { addedAt: number })[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT a.*, l.added_at AS added_at FROM library_items l
     JOIN albums a ON a.id = l.item_id
     WHERE l.item_type = 'album'
     ORDER BY l.added_at DESC;`,
  );
  return rows.map((r) => ({ ...rowToAlbum(r), addedAt: r.added_at }));
}

export async function getLibraryArtists(): Promise<(Artist & { trackCount: number })[]> {
  const instance = await db();
  // Artists the user explicitly saved, plus any artist they have tracks from.
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT ar.*, COUNT(DISTINCT t.id) AS track_count
     FROM artists ar
     LEFT JOIN tracks t ON t.artist_id = ar.id
     LEFT JOIN library_items lt ON lt.item_type = 'track' AND lt.item_id = t.id
     LEFT JOIN library_items la ON la.item_type = 'artist' AND la.item_id = ar.id
     LEFT JOIN follows f ON f.artist_id = ar.id
     WHERE lt.item_id IS NOT NULL OR la.item_id IS NOT NULL OR f.artist_id IS NOT NULL
     GROUP BY ar.id
     ORDER BY track_count DESC, ar.name COLLATE NOCASE ASC;`,
  );
  return rows.map((r) => ({ ...rowToArtist(r), trackCount: r.track_count ?? 0 }));
}

export async function getLibraryCounts(): Promise<{
  tracks: number;
  albums: number;
  artists: number;
  playlists: number;
  downloads: number;
  favorites: number;
}> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, number>>(
    `SELECT
      (SELECT COUNT(*) FROM library_items WHERE item_type = 'track') AS tracks,
      (SELECT COUNT(*) FROM library_items WHERE item_type = 'album') AS albums,
      (SELECT COUNT(DISTINCT artist_id) FROM tracks t
        JOIN library_items l ON l.item_type = 'track' AND l.item_id = t.id) AS artists,
      (SELECT COUNT(*) FROM playlists) AS playlists,
      (SELECT COUNT(*) FROM downloads WHERE status = 'completed') AS downloads,
      (SELECT COUNT(*) FROM favorites WHERE item_type = 'track') AS favorites;`,
  );
  return {
    tracks: row?.tracks ?? 0,
    albums: row?.albums ?? 0,
    artists: row?.artists ?? 0,
    playlists: row?.playlists ?? 0,
    downloads: row?.downloads ?? 0,
    favorites: row?.favorites ?? 0,
  };
}

/* --------------------------------------------------------------- favourites */

export async function toggleFavorite(
  type: LibraryItemType,
  id: string,
): Promise<boolean> {
  const instance = await db();
  const existing = await instance.getFirstAsync(
    'SELECT 1 AS present FROM favorites WHERE item_type = ? AND item_id = ?;',
    [type, id],
  );
  if (existing) {
    await instance.runAsync('DELETE FROM favorites WHERE item_type = ? AND item_id = ?;', [type, id]);
    return false;
  }
  await instance.runAsync(
    'INSERT INTO favorites (item_type, item_id, created_at) VALUES (?, ?, ?);',
    [type, id, now()],
  );
  return true;
}

export async function isFavorite(type: LibraryItemType, id: string): Promise<boolean> {
  const instance = await db();
  const row = await instance.getFirstAsync(
    'SELECT 1 AS present FROM favorites WHERE item_type = ? AND item_id = ?;',
    [type, id],
  );
  return !!row;
}

export async function getFavoriteTracks(limit = 300): Promise<Track[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.* FROM favorites f JOIN tracks t ON t.id = f.item_id
     WHERE f.item_type = 'track' ORDER BY f.created_at DESC LIMIT ?;`,
    [limit],
  );
  return rows.map(rowToTrack);
}

export async function getFavoriteIds(type: LibraryItemType): Promise<Set<string>> {
  const instance = await db();
  const rows = await instance.getAllAsync<{ item_id: string }>(
    'SELECT item_id FROM favorites WHERE item_type = ?;',
    [type],
  );
  return new Set(rows.map((r) => r.item_id));
}

/* ------------------------------------------------------------ artist follow */

export async function followArtist(artist: Artist) {
  await upsertArtist(artist);
  const instance = await db();
  await instance.runAsync(
    `INSERT INTO follows (artist_id, followed_at, notify, last_checked_at)
     VALUES (?, ?, 1, NULL)
     ON CONFLICT(artist_id) DO NOTHING;`,
    [artist.id, now()],
  );
}

export async function unfollowArtist(artistId: string) {
  const instance = await db();
  await instance.runAsync('DELETE FROM follows WHERE artist_id = ?;', [artistId]);
}

export async function isFollowingArtist(artistId: string): Promise<boolean> {
  const instance = await db();
  const row = await instance.getFirstAsync('SELECT 1 AS present FROM follows WHERE artist_id = ?;', [
    artistId,
  ]);
  return !!row;
}

export async function getFollowedArtists(): Promise<Artist[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT a.* FROM follows f JOIN artists a ON a.id = f.artist_id ORDER BY f.followed_at DESC;`,
  );
  return rows.map(rowToArtist);
}

export async function markArtistChecked(artistId: string, latestReleaseDate: string | null) {
  const instance = await db();
  await instance.runAsync(
    'UPDATE follows SET last_checked_at = ?, last_seen_release_date = COALESCE(?, last_seen_release_date) WHERE artist_id = ?;',
    [now(), latestReleaseDate, artistId],
  );
}

export async function getFollowState(): Promise<
  { artistId: string; lastSeenReleaseDate: string | null; notify: boolean }[]
> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>('SELECT * FROM follows;');
  return rows.map((r) => ({
    artistId: r.artist_id,
    lastSeenReleaseDate: r.last_seen_release_date ?? null,
    notify: !!r.notify,
  }));
}
