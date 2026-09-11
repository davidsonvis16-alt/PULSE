import { db, now } from '@/src/db/client';
import type { Album, Artist, Track } from '@/src/core/types';

/**
 * Cache of provider catalogue data.
 *
 * Anything the user acts on (plays, saves, queues, downloads) gets written here
 * first, so every later screen — library, history, statistics, offline playback
 * — can render complete metadata and artwork without another network call.
 */

type Row = Record<string, any>;

export function rowToTrack(row: Row): Track {
  return {
    id: row.id,
    provider: row.provider,
    providerTrackId: row.provider_track_id,
    title: row.title,
    artistName: row.artist_name,
    artistId: row.artist_id ?? null,
    albumTitle: row.album_title ?? null,
    albumId: row.album_id ?? null,
    artworkUrl: row.artwork_url ?? null,
    durationMs: row.duration_ms ?? null,
    releaseDate: row.release_date ?? null,
    genre: row.genre ?? null,
    trackNumber: row.track_number ?? null,
    discNumber: row.disc_number ?? null,
    explicit: !!row.explicit,
    externalUrl: row.external_url ?? null,
  };
}

export function rowToAlbum(row: Row): Album {
  return {
    id: row.id,
    provider: row.provider,
    providerAlbumId: row.provider_album_id,
    title: row.title,
    artistName: row.artist_name,
    artistId: row.artist_id ?? null,
    artworkUrl: row.artwork_url ?? null,
    releaseDate: row.release_date ?? null,
    trackCount: row.track_count ?? null,
    genre: row.genre ?? null,
    copyright: row.copyright ?? null,
    externalUrl: row.external_url ?? null,
    albumType: row.album_type ?? 'album',
  };
}

export function rowToArtist(row: Row): Artist {
  return {
    id: row.id,
    provider: row.provider,
    providerArtistId: row.provider_artist_id,
    name: row.name,
    imageUrl: row.image_url ?? null,
    genre: row.genre ?? null,
    externalUrl: row.external_url ?? null,
  };
}

export async function upsertArtist(artist: Artist) {
  const instance = await db();
  await instance.runAsync(
    `INSERT INTO artists (id, provider, provider_artist_id, name, image_url, genre, external_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       image_url = COALESCE(excluded.image_url, artists.image_url),
       genre = COALESCE(excluded.genre, artists.genre),
       external_url = COALESCE(excluded.external_url, artists.external_url),
       updated_at = excluded.updated_at;`,
    [
      artist.id,
      artist.provider,
      artist.providerArtistId,
      artist.name,
      artist.imageUrl,
      artist.genre,
      artist.externalUrl,
      now(),
    ],
  );
}

/** Placeholder row so a track's artist_id foreign key always resolves. */
async function ensureArtistStub(id: string | null, name: string, provider: string) {
  if (!id) return;
  const instance = await db();
  const existing = await instance.getFirstAsync<Row>('SELECT id FROM artists WHERE id = ?;', [id]);
  if (existing) return;
  const raw = id.split(':').slice(2).join(':');
  await instance.runAsync(
    `INSERT OR IGNORE INTO artists (id, provider, provider_artist_id, name, updated_at)
     VALUES (?, ?, ?, ?, ?);`,
    [id, provider, raw, name, now()],
  );
}

export async function upsertAlbum(album: Album) {
  const instance = await db();
  await ensureArtistStub(album.artistId, album.artistName, album.provider);
  await instance.runAsync(
    `INSERT INTO albums (id, provider, provider_album_id, title, artist_id, artist_name, artwork_url,
                         release_date, track_count, genre, copyright, external_url, album_type, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       artist_name = excluded.artist_name,
       artwork_url = COALESCE(excluded.artwork_url, albums.artwork_url),
       release_date = COALESCE(excluded.release_date, albums.release_date),
       track_count = COALESCE(excluded.track_count, albums.track_count),
       genre = COALESCE(excluded.genre, albums.genre),
       copyright = COALESCE(excluded.copyright, albums.copyright),
       external_url = COALESCE(excluded.external_url, albums.external_url),
       album_type = excluded.album_type,
       updated_at = excluded.updated_at;`,
    [
      album.id,
      album.provider,
      album.providerAlbumId,
      album.title,
      album.artistId,
      album.artistName,
      album.artworkUrl,
      album.releaseDate,
      album.trackCount,
      album.genre,
      album.copyright,
      album.externalUrl,
      album.albumType,
      now(),
    ],
  );
}

export async function upsertTrack(track: Track) {
  const instance = await db();
  await ensureArtistStub(track.artistId, track.artistName, track.provider);
  if (track.albumId) {
    const exists = await instance.getFirstAsync<Row>('SELECT id FROM albums WHERE id = ?;', [
      track.albumId,
    ]);
    if (!exists) {
      await upsertAlbum({
        id: track.albumId,
        provider: track.provider,
        providerAlbumId: track.albumId.split(':').slice(2).join(':'),
        title: track.albumTitle ?? 'Unknown album',
        artistName: track.artistName,
        artistId: track.artistId,
        artworkUrl: track.artworkUrl,
        releaseDate: track.releaseDate,
        trackCount: null,
        genre: track.genre,
        copyright: null,
        externalUrl: null,
        albumType: 'album',
      });
    }
  }

  await instance.runAsync(
    `INSERT INTO tracks (id, provider, provider_track_id, title, artist_id, artist_name, album_id,
                         album_title, artwork_url, duration_ms, release_date, genre, track_number,
                         disc_number, explicit, external_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       artist_name = excluded.artist_name,
       album_title = COALESCE(excluded.album_title, tracks.album_title),
       artwork_url = COALESCE(excluded.artwork_url, tracks.artwork_url),
       duration_ms = COALESCE(excluded.duration_ms, tracks.duration_ms),
       release_date = COALESCE(excluded.release_date, tracks.release_date),
       genre = COALESCE(excluded.genre, tracks.genre),
       track_number = COALESCE(excluded.track_number, tracks.track_number),
       disc_number = COALESCE(excluded.disc_number, tracks.disc_number),
       explicit = excluded.explicit,
       external_url = COALESCE(excluded.external_url, tracks.external_url),
       updated_at = excluded.updated_at;`,
    [
      track.id,
      track.provider,
      track.providerTrackId,
      track.title,
      track.artistId,
      track.artistName,
      track.albumId,
      track.albumTitle,
      track.artworkUrl,
      track.durationMs,
      track.releaseDate,
      track.genre,
      track.trackNumber,
      track.discNumber,
      track.explicit ? 1 : 0,
      track.externalUrl,
      now(),
    ],
  );

  if (track.genre) await linkGenre(track.id, track.genre);
}

async function linkGenre(trackId: string, genre: string) {
  const instance = await db();
  await instance.runAsync('INSERT OR IGNORE INTO genres (name) VALUES (?);', [genre]);
  const row = await instance.getFirstAsync<{ id: number }>(
    'SELECT id FROM genres WHERE name = ? COLLATE NOCASE;',
    [genre],
  );
  if (!row) return;
  await instance.runAsync(
    'INSERT OR IGNORE INTO track_genres (track_id, genre_id) VALUES (?, ?);',
    [trackId, row.id],
  );
}

export async function upsertTracks(tracks: Track[]) {
  for (const track of tracks) await upsertTrack(track);
}

export async function getCachedTrack(id: string): Promise<Track | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Row>('SELECT * FROM tracks WHERE id = ?;', [id]);
  return row ? rowToTrack(row) : null;
}

export async function getCachedTracks(ids: string[]): Promise<Track[]> {
  if (ids.length === 0) return [];
  const instance = await db();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await instance.getAllAsync<Row>(
    `SELECT * FROM tracks WHERE id IN (${placeholders});`,
    ids,
  );
  const byId = new Map(rows.map((r) => [r.id as string, rowToTrack(r)]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
}

export async function getCachedAlbum(id: string): Promise<Album | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Row>('SELECT * FROM albums WHERE id = ?;', [id]);
  return row ? rowToAlbum(row) : null;
}

export async function getCachedArtist(id: string): Promise<Artist | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Row>('SELECT * FROM artists WHERE id = ?;', [id]);
  return row ? rowToArtist(row) : null;
}
