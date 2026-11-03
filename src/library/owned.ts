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

/** Songs on the phone, by every title they could go by. */
let index: Map<string, Track[]> | null = null;
let building: Promise<Map<string, Track[]>> | null = null;
/** Every artist each song on the phone can be linked to, by track id. */
let artistsById = new Map<string, Set<string>>();

/**
 * A title reduced to the song's name: the feature credit and the bits files
 * pick up from video sites — "(Official Audio)", "[Lyrics]", "Official Music
 * Video" — are dropped so the same song matches however it was saved.
 */
function titleKey(title: string): string {
  const clean = title
    .replace(/[([][^)\]]*\b(official|audio|video|lyrics?|lyric video|visuali[sz]er|music video|hd|hq|explicit|clean|remaster(ed)?)\b[^)\]]*[)\]]/gi, ' ')
    .replace(/\b(official (music )?video|official audio|lyric video|lyrics)\b/gi, ' ');
  return normalise(coreTitle(clean));
}

/**
 * Every artist a credit names. Files and shops write the same song as
 * "Nicki Minaj, Juice WRLD", "Nicki Minaj & Juice WRLD" or "Nicki Minaj feat.
 * Juice WRLD", so a credit is compared artist by artist, not as one string.
 */
function artistsOf(credit: string): Set<string> {
  return new Set(
    credit
      .split(/\s*(?:,|&|\+|\/|;)\s*|\s+(?:feat\.?|ft\.?|featuring|with|and|x)\s+/i)
      .map((name) => normalise(name))
      .filter((name) => name.length > 0 && !UNKNOWN.has(name)),
  );
}

/** What tags say when they do not know. */
const UNKNOWN = new Set(['unknown artist', 'unknown', 'artist', 'various artists', 'va', '<unknown>']);

/**
 * "Juice WRLD - Lucid Dreams", "03. Juice WRLD - Lucid Dreams (Official Audio)":
 * the artist and song a file or title names, when it is written that way.
 */
function splitNamed(text: string): { artist: string; title: string } | null {
  const clean = text
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/^\s*\d{1,3}\s*[.)_-]?\s+/, '')
    .replace(/_/g, ' ');
  const parts = clean.split(/\s+[-–—]\s+/);
  if (parts.length < 2) return null;
  return { artist: parts[0], title: parts.slice(1).join(' - ') };
}

/**
 * The same song if a name matches and the artists agree. A song of theirs
 * that was never identified (artist unknown) matches on its name alone, as
 * long as the name is long enough not to be a coincidence ("Intro" is not).
 */
function findMine(map: Map<string, Track[]>, track: Track): Track | null {
  const key = titleKey(track.title);
  const candidates = map.get(key);
  if (!candidates?.length) return null;
  const theirs = artistsOf(track.artistName);
  const byArtist = candidates.find((mine) =>
    [...(artistsById.get(mine.id) ?? [])].some((name) => theirs.has(name)),
  );
  if (byArtist) return byArtist;
  if (key.length < 5) return null;
  return candidates.find((mine) => (artistsById.get(mine.id)?.size ?? 0) === 0) ?? null;
}

export async function ownedIndex(): Promise<Map<string, Track[]>> {
  if (index) return index;
  if (building) return building;

  building = (async () => {
    const rows = await listLocalTracks({ limit: 5000 }).catch(() => []);
    const map = new Map<string, Track[]>();
    const artists = new Map<string, Set<string>>();
    const add = (key: string, track: Track) => {
      if (!key) return;
      const list = map.get(key) ?? [];
      // Rescans keep the copy already indexed: the first one stays first.
      if (!list.some((t) => t.id === track.id)) list.push(track);
      map.set(key, list);
    };
    for (const row of rows) {
      const track = row.track;
      const known = artistsOf(track.artistName);
      add(titleKey(track.title), track);
      // Names written into the title or the file name count too.
      for (const named of [splitNamed(track.title), splitNamed(row.filename ?? '')]) {
        if (!named) continue;
        add(titleKey(named.title), track);
        for (const name of artistsOf(named.artist)) known.add(name);
      }
      const plainFile = (row.filename ?? '').replace(/\.[a-z0-9]{2,4}$/i, '');
      if (plainFile && !splitNamed(plainFile)) add(titleKey(plainFile), track);
      artists.set(track.id, known);
    }
    artistsById = artists;
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
  return findMine(await ownedIndex(), track);
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
    const mine = findMine(map, track);
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
  const unique = new Map([...owned.values()].flat().map((track) => [track.id, track]));
  for (const track of unique.values()) {
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

/** Songs on the phone by this artist, including ones they are featured on. */
export async function ownedByArtist(name: string): Promise<Track[]> {
  const wanted = artistsOf(name);
  if (wanted.size === 0) return [];
  const map = await ownedIndex();
  const out = new Map<string, Track>();
  for (const list of map.values()) {
    for (const track of list) {
      // Artists from the tag, the title or the file name all count.
      if ([...(artistsById.get(track.id) ?? [])].some((artist) => wanted.has(artist))) out.set(track.id, track);
    }
  }
  return [...out.values()].sort((a, b) => a.title.localeCompare(b.title));
}
