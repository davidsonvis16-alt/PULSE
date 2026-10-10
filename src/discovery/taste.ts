import { genreEnergy } from '@/src/core/moods';
import { familyForGenre, type GenreFamily } from '@/src/grooves/genres';
import { getLocalTasteRows } from '@/src/db/repos/local';
import { getFavoriteTracks, getFollowedArtists, getLibraryTracks } from '@/src/db/repos/library';
import { getTasteSignals, getStatsSummary } from '@/src/db/repos/history';

/**
 * TasteEngine.
 *
 * Pulse's position is that the music someone already owns says more about them
 * than anything they are likely to click in the first week. So the imported
 * collection is the foundation of the profile, and listening behaviour adjusts
 * it — gaining influence as there is more of it to trust.
 *
 * The practical consequence: a brand-new user with 300 imported songs gets
 * recommendations that are about *their* music from the first screen, not a
 * chart of what happens to be popular this week.
 */

export interface ArtistAffinity {
  name: string;
  /** Combined score. Arbitrary units; only the ordering matters. */
  score: number;
  /** How many of this artist's tracks the user actually owns. */
  ownedTracks: number;
  msPlayed: number;
  followed: boolean;
}

export interface GenreAffinity {
  genre: string;
  family: GenreFamily;
  score: number;
  ownedTracks: number;
  msPlayed: number;
}

export interface TasteProfile {
  /** True once there is anything at all to reason about. */
  hasData: boolean;
  /** True when the profile rests on imported music rather than guesswork. */
  hasLibrary: boolean;
  hasHistory: boolean;

  artists: ArtistAffinity[];
  genres: GenreAffinity[];
  /** Genre families the recommendations are allowed to stay within. */
  families: string[];
  /** Centre of gravity of the collection, 0 (still) to 1 (relentless). */
  energy: number;
  /** Median release decade, used to avoid recommending the wrong era. */
  era: number | null;

  /** Titles the user returns to, used as seeds. */
  repeatedTitles: string[];
  /** Artists they consistently skip. Kept out of recommendations. */
  avoidArtists: string[];
  /** Everything they already have, so nothing is recommended back to them. */
  knownTrackIds: Set<string>;
  ownedTrackCount: number;

  /**
   * How much of the profile comes from behaviour rather than the collection.
   * Starts low and rises as listening accumulates.
   */
  behaviourWeight: number;
}

/** A track the user owns counts for this much artist affinity. */
const OWNED_TRACK_WEIGHT = 100;
/** A minute of listening counts for this much. */
const PLAY_MINUTE_WEIGHT = 12;
const FAVOURITE_WEIGHT = 220;
const FOLLOW_WEIGHT = 300;

/** Listening minutes at which behaviour and collection carry equal weight. */
const BEHAVIOUR_HALF_LIFE_MINUTES = 600;

let cached: { profile: TasteProfile; at: number } | null = null;
const CACHE_MS = 60_000;

export function invalidateTasteProfile() {
  cached = null;
}

export async function buildTasteProfile(options: { fresh?: boolean } = {}): Promise<TasteProfile> {
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.profile;

  const [localRows, libraryTracks, favorites, followed, signals, summary] = await Promise.all([
    getLocalTasteRows(),
    getLibraryTracks({ limit: 2000 }),
    getFavoriteTracks(200),
    getFollowedArtists(),
    getTasteSignals(120),
    getStatsSummary('all'),
  ]);

  const artistScores = new Map<string, ArtistAffinity>();
  const genreScores = new Map<string, GenreAffinity>();
  const knownTrackIds = new Set<string>();

  const bumpArtist = (name: string, patch: Partial<ArtistAffinity> & { score: number }) => {
    const key = name.trim();
    if (!key || key.toLowerCase() === 'unknown artist') return;
    const existing = artistScores.get(key) ?? {
      name: key,
      score: 0,
      ownedTracks: 0,
      msPlayed: 0,
      followed: false,
    };
    artistScores.set(key, {
      ...existing,
      score: existing.score + patch.score,
      ownedTracks: existing.ownedTracks + (patch.ownedTracks ?? 0),
      msPlayed: existing.msPlayed + (patch.msPlayed ?? 0),
      followed: existing.followed || !!patch.followed,
    });
  };

  const bumpGenre = (genre: string | null, patch: { score: number; owned?: number; ms?: number }) => {
    if (!genre) return;
    const key = genre.trim();
    if (!key) return;
    const existing = genreScores.get(key) ?? {
      genre: key,
      family: familyForGenre(key),
      score: 0,
      ownedTracks: 0,
      msPlayed: 0,
    };
    genreScores.set(key, {
      ...existing,
      score: existing.score + patch.score,
      ownedTracks: existing.ownedTracks + (patch.owned ?? 0),
      msPlayed: existing.msPlayed + (patch.ms ?? 0),
    });
  };

  // --- The collection: what they actually have ------------------------------
  const decades: number[] = [];
  for (const row of localRows) {
    knownTrackIds.add(row.trackId);
    bumpArtist(row.artistName, { score: OWNED_TRACK_WEIGHT, ownedTracks: 1 });
    bumpGenre(row.genre, { score: OWNED_TRACK_WEIGHT, owned: 1 });
    const year = row.releaseDate ? Number(row.releaseDate.slice(0, 4)) : NaN;
    if (Number.isFinite(year) && year > 1900) decades.push(Math.floor(year / 10) * 10);
  }

  // Saved and downloaded tracks are deliberate too, if a little less telling
  // than music someone already owned before Pulse existed.
  for (const track of libraryTracks) {
    knownTrackIds.add(track.id);
    if (track.provider === 'local') continue;
    bumpArtist(track.artistName, { score: OWNED_TRACK_WEIGHT * 0.6 });
    bumpGenre(track.genre, { score: OWNED_TRACK_WEIGHT * 0.6 });
  }

  for (const track of favorites) {
    knownTrackIds.add(track.id);
    bumpArtist(track.artistName, { score: FAVOURITE_WEIGHT });
    bumpGenre(track.genre, { score: FAVOURITE_WEIGHT });
  }

  for (const artist of followed) {
    bumpArtist(artist.name, { score: FOLLOW_WEIGHT, followed: true });
    bumpGenre(artist.genre, { score: FOLLOW_WEIGHT * 0.5 });
  }

  // --- Behaviour: what they keep going back to ------------------------------
  const listeningMinutes = summary.totalMs / 60000;
  const behaviourWeight = clamp(
    listeningMinutes / (listeningMinutes + BEHAVIOUR_HALF_LIFE_MINUTES),
    0,
    0.85,
  );

  for (const artist of signals.artists) {
    bumpArtist(artist.name, {
      score: (artist.msPlayed / 60000) * PLAY_MINUTE_WEIGHT * (1 + behaviourWeight),
      msPlayed: artist.msPlayed,
    });
  }
  for (const genre of signals.genres) {
    bumpGenre(genre.genre, {
      score: (genre.msPlayed / 60000) * PLAY_MINUTE_WEIGHT * (1 + behaviourWeight),
      ms: genre.msPlayed,
    });
  }
  signals.recentTrackIds.forEach((id) => knownTrackIds.add(id));

  // Skipping something repeatedly is a real signal; act on it.
  for (const name of signals.skippedArtists) {
    const existing = artistScores.get(name);
    if (existing) artistScores.set(name, { ...existing, score: existing.score * 0.35 });
  }

  const artists = [...artistScores.values()].sort((a, b) => b.score - a.score);
  const genres = [...genreScores.values()].sort((a, b) => b.score - a.score);

  const weightedEnergy = genres.reduce(
    (total, genre) => total + genreEnergy(genre.genre) * genre.score,
    0,
  );
  const totalGenreScore = genres.reduce((total, genre) => total + genre.score, 0);

  const families = rankFamilies(genres);

  return cache({
    hasData: artists.length > 0,
    hasLibrary: localRows.length > 0 || libraryTracks.length > 0,
    hasHistory: signals.artists.length > 0,
    artists,
    genres,
    families,
    energy: totalGenreScore > 0 ? weightedEnergy / totalGenreScore : 0.55,
    era: median(decades),
    repeatedTitles: signals.repeated.map((entry) => entry.title),
    avoidArtists: signals.skippedArtists,
    knownTrackIds,
    ownedTrackCount: localRows.length,
    behaviourWeight,
  });
}

function cache(profile: TasteProfile): TasteProfile {
  cached = { profile, at: Date.now() };
  return profile;
}

/**
 * The families a recommendation may come from.
 *
 * This is the boundary the product asks for: someone who listens to R&B,
 * Afrobeats and pop should not be handed a metal record because it is charting.
 * Families are kept while they account for the bulk of the profile, and at
 * least two are always allowed so taste can still widen.
 */
function rankFamilies(genres: GenreAffinity[]): string[] {
  if (genres.length === 0) return [];
  const byFamily = new Map<string, number>();
  for (const genre of genres) {
    byFamily.set(genre.family.id, (byFamily.get(genre.family.id) ?? 0) + genre.score);
  }
  const ordered = [...byFamily.entries()].sort((a, b) => b[1] - a[1]);
  const total = ordered.reduce((sum, [, score]) => sum + score, 0);

  const kept: string[] = [];
  let running = 0;
  for (const [family, score] of ordered) {
    kept.push(family);
    running += score;
    if (running / total >= 0.88 && kept.length >= 2) break;
  }
  return kept;
}

/** True when a candidate sits inside what the profile says this person likes. */
export function withinTasteBoundary(
  candidate: { genre?: string | null; artistName?: string },
  profile: TasteProfile,
): boolean {
  if (profile.families.length === 0) return true;
  if (candidate.artistName) {
    const known = profile.artists.some(
      (artist) => artist.name.toLowerCase() === candidate.artistName!.toLowerCase(),
    );
    // An artist already in their collection is inside the boundary by definition.
    if (known) return true;
  }
  if (!candidate.genre) return true; // unknown genre is not evidence against
  return profile.families.includes(familyForGenre(candidate.genre).id);
}

export function topArtistNames(profile: TasteProfile, count: number): string[] {
  return profile.artists.slice(0, count).map((artist) => artist.name);
}

export function topGenreNames(profile: TasteProfile, count: number): string[] {
  return profile.genres.slice(0, count).map((genre) => genre.genre);
}

/** Artists the user owns music by, which is what "your collection" means. */
export function ownedArtists(profile: TasteProfile, count: number): ArtistAffinity[] {
  return profile.artists.filter((artist) => artist.ownedTracks > 0).slice(0, count);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
