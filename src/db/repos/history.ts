import { db, now } from '@/src/db/client';
import { rowToTrack, upsertTrack } from '@/src/db/repos/catalog';
import type { Track } from '@/src/core/types';

export type PlayContext =
  | 'search'
  | 'library'
  | 'playlist'
  | 'album'
  | 'artist'
  | 'recommendation'
  | 'mood'
  | 'radio'
  | 'downloads'
  | 'shared';

/**
 * Listening history.
 *
 * A play is opened when audio starts and closed when it stops, so what we store
 * is measured listening time — not a play counter we increment optimistically.
 * Every statistic in Pulse is an aggregate over this table.
 */

export async function beginPlay(
  track: Track,
  options: { context?: PlayContext; moodId?: string | null; offline?: boolean } = {},
): Promise<number> {
  await upsertTrack(track);
  const instance = await db();
  const result = await instance.runAsync(
    `INSERT INTO listening_history
       (track_id, artist_id, artist_name, album_id, genre, started_at, ms_played, completed, skipped, context, mood_id, offline)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?);`,
    [
      track.id,
      track.artistId,
      track.artistName,
      track.albumId,
      track.genre,
      now(),
      options.context ?? 'library',
      options.moodId ?? null,
      options.offline ? 1 : 0,
    ],
  );
  return result.lastInsertRowId;
}

export async function updatePlay(
  playId: number,
  msPlayed: number,
  flags: { completed?: boolean; skipped?: boolean } = {},
) {
  if (!playId) return;
  const instance = await db();
  await instance.runAsync(
    `UPDATE listening_history
        SET ms_played = MAX(ms_played, ?),
            completed = MAX(completed, ?),
            skipped = MAX(skipped, ?)
      WHERE id = ?;`,
    [Math.max(0, Math.round(msPlayed)), flags.completed ? 1 : 0, flags.skipped ? 1 : 0, playId],
  );
}

/** Plays shorter than this are noise (a mis-tap, a scrub past a track). */
const MIN_MEANINGFUL_MS = 4000;

export async function pruneTrivialPlays() {
  const instance = await db();
  await instance.runAsync('DELETE FROM listening_history WHERE ms_played < ?;', [MIN_MEANINGFUL_MS]);
}

export async function getRecentlyPlayed(limit = 20): Promise<Track[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.*, MAX(h.started_at) AS last_played
     FROM listening_history h JOIN tracks t ON t.id = h.track_id
     WHERE h.ms_played >= ?
     GROUP BY t.id ORDER BY last_played DESC LIMIT ?;`,
    [MIN_MEANINGFUL_MS, limit],
  );
  return rows.map(rowToTrack);
}

/** The track the user was in the middle of, if they stopped partway through. */
export async function getContinueListening(): Promise<{ track: Track; positionMs: number } | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, any>>(
    `SELECT t.*, h.ms_played AS ms_played, h.completed AS completed
     FROM listening_history h JOIN tracks t ON t.id = h.track_id
     WHERE h.ms_played >= ? ORDER BY h.started_at DESC LIMIT 1;`,
    [MIN_MEANINGFUL_MS],
  );
  if (!row || row.completed) return null;
  return { track: rowToTrack(row), positionMs: row.ms_played ?? 0 };
}

/* ------------------------------------------------------------------- ranges */

export type StatsRange = 'week' | 'month' | 'year' | 'all';

export function rangeStart(range: StatsRange, reference = new Date()): number {
  const d = new Date(reference);
  switch (range) {
    case 'week': {
      const day = (d.getDay() + 6) % 7; // weeks start Monday
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - day);
      return d.getTime();
    }
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case 'year':
      return new Date(d.getFullYear(), 0, 1).getTime();
    case 'all':
    default:
      return 0;
  }
}

export interface StatsSummary {
  totalMs: number;
  playCount: number;
  trackCount: number;
  artistCount: number;
  albumCount: number;
  genreCount: number;
  skipCount: number;
  completionRate: number;
  firstPlayAt: number | null;
}

export async function getStatsSummary(range: StatsRange): Promise<StatsSummary> {
  const instance = await db();
  const from = rangeStart(range);
  const row = await instance.getFirstAsync<Record<string, number | null>>(
    `SELECT
       COALESCE(SUM(ms_played), 0) AS total_ms,
       COUNT(*) AS play_count,
       COUNT(DISTINCT track_id) AS track_count,
       COUNT(DISTINCT artist_name) AS artist_count,
       COUNT(DISTINCT album_id) AS album_count,
       COUNT(DISTINCT genre) AS genre_count,
       COALESCE(SUM(skipped), 0) AS skip_count,
       COALESCE(SUM(completed), 0) AS completed_count,
       MIN(started_at) AS first_play
     FROM listening_history
     WHERE started_at >= ? AND ms_played >= ?;`,
    [from, MIN_MEANINGFUL_MS],
  );
  const playCount = Number(row?.play_count ?? 0);
  return {
    totalMs: Number(row?.total_ms ?? 0),
    playCount,
    trackCount: Number(row?.track_count ?? 0),
    artistCount: Number(row?.artist_count ?? 0),
    albumCount: Number(row?.album_count ?? 0),
    genreCount: Number(row?.genre_count ?? 0),
    skipCount: Number(row?.skip_count ?? 0),
    completionRate: playCount ? Number(row?.completed_count ?? 0) / playCount : 0,
    firstPlayAt: row?.first_play ? Number(row.first_play) : null,
  };
}

export interface TopTrack {
  track: Track;
  plays: number;
  msPlayed: number;
}

export async function getTopTracks(range: StatsRange, limit = 10): Promise<TopTrack[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.*, COUNT(*) AS plays, SUM(h.ms_played) AS ms_played
     FROM listening_history h JOIN tracks t ON t.id = h.track_id
     WHERE h.started_at >= ? AND h.ms_played >= ?
     GROUP BY t.id ORDER BY ms_played DESC, plays DESC LIMIT ?;`,
    [rangeStart(range), MIN_MEANINGFUL_MS, limit],
  );
  return rows.map((r) => ({ track: rowToTrack(r), plays: r.plays, msPlayed: r.ms_played ?? 0 }));
}

/** How many times this device has played one song. */
export async function getTrackPlayCount(trackId: string): Promise<number> {
  const instance = await db();
  const row = await instance.getFirstAsync<{ plays: number }>(
    'SELECT COUNT(*) AS plays FROM listening_history WHERE track_id = ? AND ms_played >= ?;',
    [trackId, MIN_MEANINGFUL_MS],
  );
  return row?.plays ?? 0;
}

/**
 * Songs the listener came back to.
 *
 * Playing something once can be an accident; playing it again is a statement,
 * and it is the strongest signal Pulse has about what someone actually likes.
 */
export async function getRepeatedTracks(
  minPlays = 2,
  limit = 5,
  range: StatsRange = 'all',
): Promise<TopTrack[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.*, COUNT(*) AS plays, SUM(h.ms_played) AS ms_played, MAX(h.started_at) AS last_played
     FROM listening_history h JOIN tracks t ON t.id = h.track_id
     WHERE h.started_at >= ? AND h.ms_played >= ?
     GROUP BY t.id
     HAVING plays >= ?
     ORDER BY last_played DESC, plays DESC LIMIT ?;`,
    [rangeStart(range), MIN_MEANINGFUL_MS, minPlays, limit],
  );
  return rows.map((r) => ({ track: rowToTrack(r), plays: r.plays, msPlayed: r.ms_played ?? 0 }));
}

export interface TopArtist {
  artistId: string | null;
  name: string;
  imageUrl: string | null;
  plays: number;
  msPlayed: number;
}

export async function getTopArtists(range: StatsRange, limit = 10): Promise<TopArtist[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT h.artist_name AS name, h.artist_id AS artist_id,
            COUNT(*) AS plays, SUM(h.ms_played) AS ms_played,
            COALESCE(a.image_url, (SELECT t.artwork_url FROM tracks t
                                    WHERE t.artist_name = h.artist_name AND t.artwork_url IS NOT NULL
                                    LIMIT 1)) AS image_url
     FROM listening_history h
     LEFT JOIN artists a ON a.id = h.artist_id
     WHERE h.started_at >= ? AND h.ms_played >= ?
     GROUP BY h.artist_name ORDER BY ms_played DESC LIMIT ?;`,
    [rangeStart(range), MIN_MEANINGFUL_MS, limit],
  );
  return rows.map((r) => ({
    artistId: r.artist_id ?? null,
    name: r.name,
    imageUrl: r.image_url ?? null,
    plays: r.plays,
    msPlayed: r.ms_played ?? 0,
  }));
}

export interface TopAlbum {
  albumId: string | null;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  plays: number;
  msPlayed: number;
}

export async function getTopAlbums(range: StatsRange, limit = 10): Promise<TopAlbum[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT al.id AS album_id, al.title AS title, al.artist_name AS artist_name,
            al.artwork_url AS artwork_url, COUNT(*) AS plays, SUM(h.ms_played) AS ms_played
     FROM listening_history h JOIN albums al ON al.id = h.album_id
     WHERE h.started_at >= ? AND h.ms_played >= ?
     GROUP BY al.id ORDER BY ms_played DESC LIMIT ?;`,
    [rangeStart(range), MIN_MEANINGFUL_MS, limit],
  );
  return rows.map((r) => ({
    albumId: r.album_id,
    title: r.title,
    artistName: r.artist_name,
    artworkUrl: r.artwork_url ?? null,
    plays: r.plays,
    msPlayed: r.ms_played ?? 0,
  }));
}

export interface TopGenre {
  genre: string;
  plays: number;
  msPlayed: number;
  share: number;
}

export async function getTopGenres(range: StatsRange, limit = 8): Promise<TopGenre[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT genre, COUNT(*) AS plays, SUM(ms_played) AS ms_played
     FROM listening_history
     WHERE started_at >= ? AND ms_played >= ? AND genre IS NOT NULL
     GROUP BY genre ORDER BY ms_played DESC LIMIT ?;`,
    [rangeStart(range), MIN_MEANINGFUL_MS, limit],
  );
  const total = rows.reduce((sum, r) => sum + Number(r.ms_played ?? 0), 0) || 1;
  return rows.map((r) => ({
    genre: r.genre,
    plays: r.plays,
    msPlayed: r.ms_played ?? 0,
    share: Number(r.ms_played ?? 0) / total,
  }));
}

export type TrendBucket = 'day' | 'week' | 'month' | 'year';

export interface TrendPoint {
  label: string;
  key: string;
  msPlayed: number;
  plays: number;
}

const BUCKET_FORMAT: Record<TrendBucket, string> = {
  day: '%Y-%m-%d',
  week: '%Y-W%W',
  month: '%Y-%m',
  year: '%Y',
};

export async function getListeningTrend(
  bucket: TrendBucket,
  range: StatsRange,
): Promise<TrendPoint[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT strftime('${BUCKET_FORMAT[bucket]}', started_at / 1000, 'unixepoch', 'localtime') AS key,
            SUM(ms_played) AS ms_played, COUNT(*) AS plays
     FROM listening_history
     WHERE started_at >= ? AND ms_played >= ?
     GROUP BY key ORDER BY key ASC;`,
    [rangeStart(range), MIN_MEANINGFUL_MS],
  );
  return rows.map((r) => ({
    key: r.key,
    label: r.key,
    msPlayed: Number(r.ms_played ?? 0),
    plays: Number(r.plays ?? 0),
  }));
}

/** How much of what the user played was new to them — the discovery signal. */
export async function getDiscoveryStats(range: StatsRange): Promise<{
  newTracks: number;
  newArtists: number;
}> {
  const instance = await db();
  const from = rangeStart(range);
  const row = await instance.getFirstAsync<Record<string, number>>(
    `SELECT
      (SELECT COUNT(*) FROM (
        SELECT track_id FROM listening_history WHERE ms_played >= ?
        GROUP BY track_id HAVING MIN(started_at) >= ?)) AS new_tracks,
      (SELECT COUNT(*) FROM (
        SELECT artist_name FROM listening_history WHERE ms_played >= ?
        GROUP BY artist_name HAVING MIN(started_at) >= ?)) AS new_artists;`,
    [MIN_MEANINGFUL_MS, from, MIN_MEANINGFUL_MS, from],
  );
  return { newTracks: row?.new_tracks ?? 0, newArtists: row?.new_artists ?? 0 };
}

/** Signals the discovery engine reads to build a taste profile. */
export async function getTasteSignals(limit = 60): Promise<{
  artists: { name: string; msPlayed: number; plays: number }[];
  genres: { genre: string; msPlayed: number }[];
  repeated: { trackId: string; title: string; artistName: string; plays: number }[];
  skippedArtists: string[];
  recentTrackIds: string[];
}> {
  const instance = await db();
  const [artists, genres, repeated, skipped, recent] = await Promise.all([
    instance.getAllAsync<Record<string, any>>(
      `SELECT artist_name AS name, SUM(ms_played) AS ms_played, COUNT(*) AS plays
       FROM listening_history WHERE ms_played >= ?
       GROUP BY artist_name ORDER BY ms_played DESC LIMIT ?;`,
      [MIN_MEANINGFUL_MS, limit],
    ),
    instance.getAllAsync<Record<string, any>>(
      `SELECT genre, SUM(ms_played) AS ms_played FROM listening_history
       WHERE genre IS NOT NULL AND ms_played >= ?
       GROUP BY genre ORDER BY ms_played DESC LIMIT 12;`,
      [MIN_MEANINGFUL_MS],
    ),
    instance.getAllAsync<Record<string, any>>(
      `SELECT h.track_id, t.title, t.artist_name, COUNT(*) AS plays
       FROM listening_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.ms_played >= ?
       GROUP BY h.track_id HAVING plays > 1 ORDER BY plays DESC LIMIT 20;`,
      [MIN_MEANINGFUL_MS],
    ),
    instance.getAllAsync<Record<string, any>>(
      `SELECT artist_name, SUM(skipped) AS skips, COUNT(*) AS plays
       FROM listening_history GROUP BY artist_name
       HAVING skips >= 3 AND skips * 1.0 / plays > 0.6 LIMIT 20;`,
    ),
    instance.getAllAsync<{ track_id: string }>(
      `SELECT DISTINCT track_id FROM listening_history ORDER BY started_at DESC LIMIT 200;`,
    ),
  ]);

  return {
    artists: artists.map((a) => ({ name: a.name, msPlayed: a.ms_played ?? 0, plays: a.plays })),
    genres: genres.map((g) => ({ genre: g.genre, msPlayed: g.ms_played ?? 0 })),
    repeated: repeated.map((r) => ({
      trackId: r.track_id,
      title: r.title,
      artistName: r.artist_name,
      plays: r.plays,
    })),
    skippedArtists: skipped.map((s) => s.artist_name),
    recentTrackIds: recent.map((r) => r.track_id),
  };
}

/**
 * Which of these songs the listener has really played — through to the end,
 * or for at least half a minute — rather than skipped past.
 */
export async function getPlayedTrackIds(trackIds: string[]): Promise<Set<string>> {
  if (trackIds.length === 0) return new Set();
  const instance = await db();
  const played = new Set<string>();
  for (let i = 0; i < trackIds.length; i += 400) {
    const chunk = trackIds.slice(i, i + 400);
    const rows = await instance.getAllAsync<{ track_id: string }>(
      `SELECT DISTINCT track_id FROM listening_history
       WHERE track_id IN (${chunk.map(() => '?').join(',')})
         AND (completed = 1 OR ms_played >= 30000);`,
      chunk,
    );
    for (const row of rows) played.add(row.track_id);
  }
  return played;
}
