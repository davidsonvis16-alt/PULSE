import { genreEnergy, MOODS } from '@/src/core/moods';
import type { Album, Artist, Track } from '@/src/core/types';
import { musicProvider } from '@/src/providers/music';
import { getRecentlyPlayed, getRepeatedTracks, getTopArtists } from '@/src/db/repos/history';
import { resolveOwnedAll } from '@/src/library/owned';
import {
  buildTasteProfile as buildTasteProfileInternal,
  ownedArtists,
  topGenreNames,
  withinTasteBoundary,
  type TasteProfile,
} from '@/src/discovery/taste';
import { currentRotation, recentlySuggested, rememberSuggested, rotate } from '@/src/discovery/rotation';

export {
  buildTasteProfile,
  invalidateTasteProfile,
  withinTasteBoundary,
  type TasteProfile,
} from '@/src/discovery/taste';

/**
 * Recommendations.
 *
 * Everything here starts from music the user already has. Seeds are their
 * artists and their genres; results are filtered back through the taste
 * boundary so a chart hit in a genre they never touch cannot leak in.
 *
 * Popularity is allowed as a tiebreaker between two candidates that both fit.
 * It is never the reason something appears.
 */

export type ShelfReason =
  | 'in_your_library'
  | 'sounds_like_collection'
  | 'related_artists'
  | 'similar_to_favorites'
  | 'from_imported'
  | 'you_might_like'
  | 'mood'
  | 'trending';

export interface RecommendationShelf {
  id: string;
  title: string;
  subtitle: string | null;
  reason: ShelfReason;
  /** The artist or genre this shelf was built from. */
  seed: string | null;
  tracks: Track[];
}

const SHELF_SIZE = 16;
/** A shelf with fewer than this is not worth a row on the screen. */
const MIN_SHELF = 4;

export async function getRecommendationShelves(
  profile: TasteProfile,
  options: { limit?: number; rotate?: number } = {},
): Promise<RecommendationShelf[]> {
  const perShelf = options.limit ?? SHELF_SIZE;
  const rotation = options.rotate ?? currentRotation();

  if (!profile.hasData) return coldStart(perShelf, rotation);

  const provider = musicProvider();
  const exclude = [...profile.knownTrackIds];
  // Seeds are drawn from a deeper pool than the shelves need and rotated
  // through it, so the fourth-favourite artist gets their turn at the top of
  // the page instead of the same three names holding it forever. Same profile,
  // different slice — which is what makes tomorrow's page new rather than
  // random.
  const genres = rotate(topGenreNames(profile, 10), rotation, 4);
  const owned = ownedArtists(profile, 10);
  // Falls back to played artists when nothing has been imported yet.
  const seedArtists = rotate(owned.length > 0 ? owned : profile.artists.slice(0, 10), rotation, 3);
  // Songs already put in front of this listener recently are pushed down the
  // shelf rather than dropped, so "more suggestions" means new ones.
  const shownRecently = await recentlySuggested();

  const [byArtist, likeCollection, related, likeFavourites, wider] = await Promise.all([
    Promise.all(
      seedArtists.slice(0, 2).map(async (artist) => {
        const tracks = await provider
          .getRecommendations(
            {
              artistNames: [artist.name],
              genres: genres.slice(0, 2),
              energy: profile.energy,
              excludeTrackIds: exclude,
            },
            perShelf,
          )
          .catch(() => [] as Track[]);
        return {
          id: `library-${slug(artist.name)}`,
          title: `More like ${artist.name}`,
          subtitle: null,
          reason: 'in_your_library' as const,
          seed: artist.name,
          tracks: rank(tracks, profile, shownRecently),
        };
      }),
    ),
    provider
      .getRecommendations(
        {
          artistNames: seedArtists.map((artist) => artist.name),
          genres,
          energy: profile.energy,
          excludeTrackIds: exclude,
        },
        perShelf,
      )
      .catch(() => [] as Track[]),
    relatedToCollection(profile, perShelf),
    provider
      .getRecommendations(
        {
          trackTitles: profile.repeatedTitles.slice(0, 2),
          artistNames: profile.artists.slice(0, 2).map((artist) => artist.name),
          genres: genres.slice(0, 2),
          energy: profile.energy,
          excludeTrackIds: exclude,
        },
        perShelf,
      )
      .catch(() => [] as Track[]),
    // Deliberately at the edge of their taste rather than outside it: still a
    // family they listen to, but the part of it they have not explored.
    provider
      .getRecommendations(
        {
          genres: topGenreNames(profile, 6).slice(2),
          energy: clamp(profile.energy + (profile.energy > 0.5 ? -0.22 : 0.22)),
          excludeTrackIds: exclude,
        },
        perShelf,
      )
      .catch(() => [] as Track[]),
  ]);

  const shelves: RecommendationShelf[] = [
    ...byArtist,
    {
      id: 'sounds-like-collection',
      title: 'Sounds like your collection',
      subtitle: genres.slice(0, 3).join(' · ') || null,
      reason: 'sounds_like_collection',
      seed: genres[0] ?? null,
      tracks: rank(likeCollection, profile, shownRecently),
    },
    {
      id: 'related-artists',
      title: 'Artists related to your music',
      subtitle: seedArtists.length
        ? `Close to ${seedArtists.map((artist) => artist.name).slice(0, 2).join(' and ')}`
        : null,
      reason: 'related_artists',
      seed: seedArtists[0]?.name ?? null,
      tracks: rank(related, profile, shownRecently),
    },
    {
      id: 'similar-to-favorites',
      title: 'Similar to your favourites',
      subtitle: profile.repeatedTitles.length ? 'From the songs you replay' : null,
      reason: 'similar_to_favorites',
      seed: profile.repeatedTitles[0] ?? null,
      tracks: rank(likeFavourites, profile, shownRecently),
    },
    {
      id: 'you-might-like',
      title: 'You might like these',
      subtitle: profile.ownedTrackCount > 0 ? 'Based on your imported music' : null,
      reason: 'you_might_like',
      seed: null,
      tracks: rank(wider, profile, shownRecently),
    },
  ];

  const kept = dedupeAcrossShelves(shelves).filter((shelf) => shelf.tracks.length >= MIN_SHELF);
  // Anything the listener already owns is handed back as their own file.
  const resolved = await Promise.all(
    kept.map(async (shelf) => ({ ...shelf, tracks: await resolveOwnedAll(shelf.tracks) })),
  );
  // Remember what was shown, so the next rotation can move past it.
  void rememberSuggested(resolved.flatMap((shelf) => shelf.tracks.map((track) => track.id)));
  return resolved;
}

/**
 * Nothing to go on yet.
 *
 * This is the only place charts appear, it is labelled as charts rather than as
 * a recommendation, and it disappears the moment there is a collection to
 * reason about.
 */
async function coldStart(perShelf: number, rotation: number): Promise<RecommendationShelf[]> {
  const provider = musicProvider();
  // With no collection to reason about there is nothing to personalise, so the
  // starting point moves through the moods instead of offering the same one
  // every time somebody opens the app before importing anything.
  const mood = MOODS[((rotation % MOODS.length) + MOODS.length) % MOODS.length];
  const [trendingAlbums, moodTracks] = await Promise.all([
    provider.getTrending(12).catch(() => [] as Album[]),
    provider.getMoodTracks(mood, perShelf).catch(() => [] as Track[]),
  ]);

  const shelves: RecommendationShelf[] = [];
  const trendingTracks = await tracksFromAlbums(trendingAlbums.slice(0, 6));
  if (trendingTracks.length) {
    shelves.push({
      id: 'trending',
      title: 'Charting right now',
      subtitle: 'Import your music and this page becomes about you instead',
      reason: 'trending',
      seed: null,
      tracks: trendingTracks.slice(0, perShelf),
    });
  }
  if (moodTracks.length) {
    shelves.push({
      id: `mood-${mood.id}`,
      title: 'Somewhere to start',
      subtitle: mood.name,
      reason: 'mood',
      seed: mood.id,
      tracks: moodTracks,
    });
  }
  return shelves;
}

/** Pulls the artists around the ones the user owns, then their best tracks. */
async function relatedToCollection(profile: TasteProfile, limit: number): Promise<Track[]> {
  const provider = musicProvider();
  const seeds = ownedArtists(profile, 3);
  const names = seeds.length ? seeds.map((a) => a.name) : profile.artists.slice(0, 3).map((a) => a.name);
  if (names.length === 0) return [];

  // Look the seed artists up in the catalogue so their real related artists can
  // be asked for, rather than inferring relationships from names alone.
  const batches = await Promise.all(
    names.slice(0, 2).map(async (name) => {
      const found = await provider.searchArtists(name, { limit: 1 }).catch(() => []);
      const artist = found[0];
      if (!artist) return [] as Track[];
      const related = await provider.getRelatedArtists(artist.id, 6).catch(() => []);
      const tracks = await Promise.all(
        related.slice(0, 4).map((candidate) =>
          provider.getArtistTopTracks(candidate.id, 4).catch(() => [] as Track[]),
        ),
      );
      return tracks.flat();
    }),
  );

  return batches.flat().slice(0, limit * 2);
}

/**
 * Orders candidates by how well they match this listener, and drops anything
 * outside the taste boundary or already in their library.
 */
function rank(tracks: Track[], profile: TasteProfile, shownRecently?: Set<string>): Track[] {
  const avoid = new Set(profile.avoidArtists.map((name) => name.toLowerCase()));
  const known = profile.knownTrackIds;
  const ownedArtistNames = new Set(
    profile.artists.filter((artist) => artist.ownedTracks > 0).map((a) => a.name.toLowerCase()),
  );

  const seen = new Set<string>();
  const scored: { track: Track; score: number }[] = [];

  for (const track of tracks) {
    if (known.has(track.id)) continue;
    if (avoid.has(track.artistName.toLowerCase())) continue;
    if (!withinTasteBoundary(track, profile)) continue;

    const key = `${track.title.toLowerCase()}|${track.artistName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // How close this sits to the energy of their collection.
    let score = 1 - Math.abs(genreEnergy(track.genre) - profile.energy);
    // An artist adjacent to one they own is a better bet than a stranger.
    if (ownedArtistNames.has(track.artistName.toLowerCase())) score += 0.25;
    // A familiar genre, but not so familiar it is the same three names.
    if (profile.genres.slice(0, 3).some((genre) => genre.genre === track.genre)) score += 0.1;
    // Era affinity, when the collection has one.
    if (profile.era && track.releaseDate) {
      const year = Number(track.releaseDate.slice(0, 4));
      if (Number.isFinite(year)) {
        const decades = Math.abs(Math.floor(year / 10) * 10 - profile.era) / 10;
        score += decades <= 1 ? 0.08 : decades >= 4 ? -0.12 : 0;
      }
    }

    // Seen on a shelf in the last few days: still a good match, just no longer
    // news. It sinks rather than vanishing, so a narrow library still fills.
    if (shownRecently?.has(track.id)) score -= 0.35;

    scored.push({ track, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.track);
}

/** Stops the same song leading three shelves in a row. */
function dedupeAcrossShelves(shelves: RecommendationShelf[]): RecommendationShelf[] {
  const used = new Set<string>();
  return shelves.map((shelf) => {
    const tracks: Track[] = [];
    for (const track of shelf.tracks) {
      if (used.has(track.id)) continue;
      used.add(track.id);
      tracks.push(track);
      if (tracks.length >= SHELF_SIZE) break;
    }
    return { ...shelf, tracks };
  });
}

/** "More like this" for one specific song. */
export async function getSimilarTracks(track: Track, limit = 20): Promise<Track[]> {
  const provider = musicProvider();
  const results = await provider.getRecommendations(
    {
      artistNames: [track.artistName],
      genres: track.genre ? [track.genre] : [],
      trackTitles: [track.title],
      energy: genreEnergy(track.genre),
      excludeTrackIds: [track.id],
    },
    limit,
  );
  return results.filter((candidate) => candidate.id !== track.id);
}

/**
 * Shelves built from songs the listener plays on repeat.
 *
 * Two plays of the same song is the clearest thing someone tells Pulse without
 * typing anything, so each repeated song earns a shelf of its own: more in its
 * vein, and the collaborations its artist appears on — the records a person
 * usually has to hunt for, because they are filed under somebody else's name.
 */
export async function getRepeatPlayShelves(
  options: { minPlays?: number; shelves?: number; perShelf?: number } = {},
): Promise<RecommendationShelf[]> {
  const { minPlays = 2, shelves: wanted = 2, perShelf = SHELF_SIZE } = options;
  const repeated = await getRepeatedTracks(minPlays, wanted);
  if (repeated.length === 0) return [];

  const built = await Promise.all(
    repeated.map(async ({ track, plays }) => {
      const [similar, collabs] = await Promise.all([
        getSimilarTracks(track, perShelf).catch(() => [] as Track[]),
        getCollaborations(track.artistName, perShelf).catch(() => [] as Track[]),
      ]);

      // Collaborations lead: they are the part the listener is least likely to
      // have found on their own.
      const seen = new Set<string>([track.id]);
      const tracks: Track[] = [];
      for (const candidate of [...collabs, ...similar]) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        tracks.push(candidate);
        if (tracks.length >= perShelf) break;
      }

      return {
        id: `repeat:${track.id}`,
        title: `More like ${track.title}`,
        subtitle: `You have played this ${plays} times — here is what sits next to it`,
        reason: 'similar_to_favorites' as ShelfReason,
        seed: track.title,
        tracks,
      } satisfies RecommendationShelf;
    }),
  );

  return built.filter((shelf) => shelf.tracks.length >= MIN_SHELF);
}

/**
 * Records where an artist appears alongside someone else — features, joint
 * singles, remixes. Matched on the credited names rather than guessed at.
 */
export async function getCollaborations(artistName: string, limit = 16): Promise<Track[]> {
  const name = artistName.trim();
  if (!name || name.toLowerCase() === 'unknown artist') return [];

  const provider = musicProvider();
  const [featured, joint] = await Promise.all([
    provider.searchTracks(`${name} feat`, { limit: 25 }).catch(() => [] as Track[]),
    provider.searchTracks(name, { limit: 25 }).catch(() => [] as Track[]),
  ]);

  const needle = name.toLowerCase();
  const seen = new Set<string>();
  const out: Track[] = [];

  for (const track of [...featured, ...joint]) {
    if (seen.has(track.id)) continue;
    const credits = `${track.artistName} ${track.title}`.toLowerCase();
    if (!credits.includes(needle)) continue;
    // A collaboration names more than one act: either in the credit line or in
    // the title's "(feat. …)" suffix.
    const isCollab =
      /\b(feat\.?|ft\.?|featuring|with)\b/.test(credits) ||
      /[,&]|\bx\b|\bvs\.?\b/.test(track.artistName.toLowerCase());
    if (!isCollab) continue;
    seen.add(track.id);
    out.push(track);
    if (out.length >= limit) break;
  }

  return out;
}

/** Songs that would sit naturally inside an existing playlist. */
export async function getPlaylistSuggestions(
  seed: { genres: string[]; artistNames: string[]; trackIds: string[] },
  limit = 20,
): Promise<Track[]> {
  if (seed.trackIds.length === 0) return [];
  const provider = musicProvider();
  const energy =
    seed.genres.length > 0
      ? seed.genres.reduce((total, genre) => total + genreEnergy(genre), 0) / seed.genres.length
      : 0.5;
  return provider.getRecommendations(
    {
      artistNames: seed.artistNames,
      genres: seed.genres,
      energy,
      excludeTrackIds: seed.trackIds,
    },
    limit,
  );
}

/**
 * The artists to put in front of someone who has not searched for anything yet.
 *
 * Their own artists first, as real catalogue entries with real pictures, so
 * tapping one opens everything that artist has rather than only the songs the
 * listener happens to own. Then the artists around them, which is how a
 * collection grows outward instead of in circles.
 */
export async function getArtistsFromLibrary(limit = 12): Promise<Artist[]> {
  const profile = await buildTasteProfileInternal();
  const mine = ownedArtists(profile, 8);
  const names = (mine.length ? mine : profile.artists.slice(0, 8)).map((artist) => artist.name);
  if (names.length === 0) return [];

  const provider = musicProvider();
  const found = await Promise.all(
    names.slice(0, 8).map((name) =>
      provider
        .searchArtists(name, { limit: 1 })
        .then((results) => results[0] ?? null)
        .catch(() => null),
    ),
  );

  const artists: Artist[] = [];
  const seen = new Set<string>();
  for (const artist of found) {
    if (!artist || seen.has(artist.id)) continue;
    seen.add(artist.id);
    artists.push(artist);
  }

  // Top up with neighbours so the row is never a short stub.
  if (artists.length < limit && artists[0]) {
    const related = await provider.getRelatedArtists(artists[0].id, limit).catch(() => [] as Artist[]);
    for (const artist of related) {
      if (artists.length >= limit) break;
      if (seen.has(artist.id)) continue;
      seen.add(artist.id);
      artists.push(artist);
    }
  }

  return artists.slice(0, limit);
}

/** Personalised tail for a search: artists this listener is likely to enjoy. */
export async function getRelatedToSearch(
  query: string,
  profile: TasteProfile,
  limit = 12,
): Promise<Track[]> {
  const provider = musicProvider();
  const results = await provider
    .getRecommendations(
      {
        artistNames: [query, ...profile.artists.slice(0, 2).map((artist) => artist.name)],
        genres: topGenreNames(profile, 2),
        energy: profile.energy,
        excludeTrackIds: [...profile.knownTrackIds],
      },
      limit * 2,
    )
    .catch(() => [] as Track[]);
  return rank(results, profile).slice(0, limit);
}

export async function getTopArtistsForHome(limit = 10) {
  return getTopArtists('month', limit);
}

export async function getContinueRail(limit = 12): Promise<Track[]> {
  return getRecentlyPlayed(limit);
}

async function tracksFromAlbums(albums: Album[]): Promise<Track[]> {
  const provider = musicProvider();
  const batches = await Promise.all(
    albums.map((album) => provider.getAlbumTracks(album.id, 3).catch(() => [] as Track[])),
  );
  return batches.flat();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
