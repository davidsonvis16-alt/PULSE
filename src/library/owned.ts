import type { Track } from '@/src/core/types';
import { listLocalTracks } from '@/src/db/repos/local';
import { coreTitle, normalise } from '@/src/ingestion/identify/text';

/**
 * The songs you already have.
 *
 * A recommendation and the copy on your phone are the same song wearing two
 * different catalogue ids, so nothing can match them by id. They are matched
 * here by name instead, and wherever a suggestion turns out to be something you
 * own, Pulse hands back your own file: full length, no network, no preview.
 *
 * The index is small — one entry per imported track — and is rebuilt after an
 * import rather than on every lookup.
 */

let index: Map<string, Track> | null = null;
let building: Promise<Map<string, Track>> | null = null;

/** "essence|wizkid" — the feature credit is dropped so it matches both ways. */
function keyOf(title: string, artist: string): string {
  return `${normalise(coreTitle(title))}|${normalise(artist)}`;
}

export async function ownedIndex(): Promise<Map<string, Track>> {
  if (index) return index;
  if (building) return building;

  building = (async () => {
    const rows = await listLocalTracks({ limit: 5000 }).catch(() => []);
    const map = new Map<string, Track>();
    for (const row of rows) {
      const key = keyOf(row.track.title, row.track.artistName);
      // First one wins: rescans keep the copy already indexed.
      if (!map.has(key)) map.set(key, row.track);
    }
    index = map;
    return map;
  })();

  const result = await building;
  building = null;
  return result;
}

export function invalidateOwnedIndex() {
  index = null;
  building = null;
}

/** Your copy of this song, or null when you do not have it. */
export async function ownedMatchOf(track: Track): Promise<Track | null> {
  if (track.provider === 'local') return track;
  const map = await ownedIndex();
  const mine = map.get(keyOf(track.title, track.artistName));
  return mine ?? null;
}

/** Swaps a suggestion for your own copy where you have one. */
export async function resolveOwned(track: Track): Promise<Track> {
  return (await ownedMatchOf(track)) ?? track;
}

/**
 * The same swap across a whole shelf, in one pass over the index.
 *
 * Artwork is kept from whichever of the two actually has it, so replacing a
 * suggestion with your own file never costs you the cover.
 */
export async function resolveOwnedAll(tracks: Track[]): Promise<Track[]> {
  if (tracks.length === 0) return tracks;
  const map = await ownedIndex();
  if (map.size === 0) return tracks;

  return tracks.map((track) => {
    if (track.provider === 'local') return track;
    const mine = map.get(keyOf(track.title, track.artistName));
    if (!mine) return track;
    return mine.artworkUrl ? mine : { ...mine, artworkUrl: track.artworkUrl };
  });
}

/**
 * The artists in the library, most-owned first.
 *
 * Credits are split so "Wizkid & Tems" counts for both, which is what matters
 * when checking whether someone you listen to is in the news or nominated.
 */
export async function libraryArtistNames(limit = 200): Promise<string[]> {
  const owned = await ownedIndex();
  const counts = new Map<string, { name: string; count: number }>();
  for (const track of owned.values()) {
    for (const part of track.artistName.split(/\s*(?:,|&|\+|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)) {
      const name = part.trim();
      if (name.length < 2 || /^unknown artist$/i.test(name)) continue;
      const key = normalise(name);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { name, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.name);
}
