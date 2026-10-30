import { db, now, transaction } from '@/src/db/client';
import { rowToTrack } from '@/src/db/repos/catalog';
import type { Track } from '@/src/core/types';

/**
 * Grooves: clusters Pulse found inside the user's own collection.
 *
 * Stored rather than recomputed on every screen, because a Groove is meant to
 * be a stable thing the user recognises and returns to. The centroid is kept
 * alongside so music added later can be placed without rebuilding everything.
 */

export interface Groove {
  id: string;
  name: string;
  description: string | null;
  energy: number;
  era: number | null;
  genreFamily: string | null;
  accent: string | null;
  coverTrackId: string | null;
  coverArtworkUrl: string | null;
  trackCount: number;
  durationMs: number;
  generatedAt: number;
}

export interface GrooveDraft {
  id: string;
  name: string;
  description: string;
  energy: number;
  era: number | null;
  genreFamily: string | null;
  accent: string;
  members: { trackId: string; score: number; isPrimary: boolean }[];
}

const SELECT = `
  SELECT g.*,
         (SELECT t.artwork_url FROM groove_tracks gt
            JOIN tracks t ON t.id = gt.track_id
           WHERE gt.groove_id = g.id AND t.artwork_url IS NOT NULL
           ORDER BY gt.score DESC LIMIT 1) AS cover_artwork
  FROM grooves g
`;

function toGroove(row: Record<string, any>): Groove {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    energy: row.energy ?? 0.5,
    era: row.era ?? null,
    genreFamily: row.genre_family ?? null,
    accent: row.accent ?? null,
    coverTrackId: row.cover_track_id ?? null,
    coverArtworkUrl: row.cover_artwork ?? null,
    trackCount: row.track_count ?? 0,
    durationMs: row.duration_ms ?? 0,
    generatedAt: row.generated_at,
  };
}

export async function listGrooves(): Promise<Groove[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `${SELECT} WHERE g.track_count > 0 ORDER BY g.track_count DESC;`,
  );
  return rows.map(toGroove);
}

export async function getGroove(id: string): Promise<Groove | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, any>>(`${SELECT} WHERE g.id = ?;`, [id]);
  return row ? toGroove(row) : null;
}

export async function getGrooveTracks(id: string): Promise<Track[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.* FROM groove_tracks gt JOIN tracks t ON t.id = gt.track_id
     WHERE gt.groove_id = ? ORDER BY gt.is_primary DESC, gt.score DESC, t.artist_name COLLATE NOCASE;`,
    [id],
  );
  return rows.map(rowToTrack);
}

export async function groovesForTrack(trackId: string): Promise<Groove[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `${SELECT} JOIN groove_tracks gt ON gt.groove_id = g.id
     WHERE gt.track_id = ? ORDER BY gt.is_primary DESC, gt.score DESC;`,
    [trackId],
  );
  return rows.map(toGroove);
}

/** Replaces every Groove in one transaction, so the UI never sees a half state. */
export async function replaceGrooves(drafts: GrooveDraft[]): Promise<void> {
  const timestamp = now();

  await transaction(async (tx) => {
    await tx.runAsync('DELETE FROM groove_tracks;');
    await tx.runAsync('DELETE FROM grooves;');

    for (const draft of drafts) {
      if (draft.members.length === 0) continue;

      // The Groove first: its songs point at it, and the database refuses a
      // song for a Groove that does not exist yet.
      await tx.runAsync(
        `INSERT INTO grooves
           (id, name, description, energy, era, genre_family, accent, cover_track_id,
            track_count, duration_ms, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?);`,
        [
          draft.id,
          draft.name,
          draft.description,
          draft.energy,
          draft.era,
          draft.genreFamily,
          draft.accent,
          timestamp,
        ],
      );

      for (const member of draft.members) {
        // A song whose file has gone since the clustering ran is skipped, not fatal.
        await tx.runAsync(
          `INSERT OR REPLACE INTO groove_tracks (groove_id, track_id, score, is_primary)
           SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tracks WHERE id = ?);`,
          [draft.id, member.trackId, member.score, member.isPrimary ? 1 : 0, member.trackId],
        );
      }

      const totals = await tx.getFirstAsync<{ count: number; duration: number }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(t.duration_ms), 0) AS duration
         FROM groove_tracks gt JOIN tracks t ON t.id = gt.track_id
         WHERE gt.groove_id = ?;`,
        [draft.id],
      );

      const cover = await tx.getFirstAsync<{ track_id: string }>(
        `SELECT gt.track_id FROM groove_tracks gt JOIN tracks t ON t.id = gt.track_id
         WHERE gt.groove_id = ? AND t.artwork_url IS NOT NULL
         ORDER BY gt.score DESC LIMIT 1;`,
        [draft.id],
      );

      if (!totals?.count) {
        await tx.runAsync('DELETE FROM grooves WHERE id = ?;', [draft.id]);
        continue;
      }
      await tx.runAsync(
        'UPDATE grooves SET cover_track_id = ?, track_count = ?, duration_ms = ? WHERE id = ?;',
        [cover?.track_id ?? null, totals.count, totals.duration ?? 0, draft.id],
      );
    }
  });
}

/** Rows the clustering works from: one per track in the user's own library. */
export async function getClusterInput(): Promise<
  {
    trackId: string;
    title: string;
    artistName: string;
    genre: string | null;
    releaseDate: string | null;
    durationMs: number | null;
  }[]
> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    `SELECT t.id AS track_id, t.title, t.artist_name, t.genre, t.release_date, t.duration_ms
     FROM local_tracks l JOIN tracks t ON t.id = l.track_id;`,
  );
  return rows.map((row) => ({
    trackId: row.track_id,
    title: row.title,
    artistName: row.artist_name,
    genre: row.genre ?? null,
    releaseDate: row.release_date ?? null,
    durationMs: row.duration_ms ?? null,
  }));
}
