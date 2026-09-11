import { genreEnergy, MOODS } from '@/src/core/moods';
import type { Album, Track } from '@/src/core/types';
import { musicProvider } from '@/src/providers/music';
import { getRecentlyPlayed, getTopArtists } from '@/src/db/repos/history';
import {
  ownedArtists,
  topGenreNames,
  withinTasteBoundary,
  type TasteProfile,
} from '@/src/discovery/taste';

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
  options: { limit?: number } = {},
): Promise<RecommendationShelf[]> {
  const perShelf = options.limit ?? SHELF_SIZE;

  if (!profile.hasData) return coldStart(perShelf);

  const provider = musicProvider();
  const exclude = [...profile.knownTrackIds];
  const genres = topGenreNames(profile, 4);
  const owned = ownedArtists(profile, 3);
  // Falls back to played artists when nothing has been imported yet.
  const seedArtists = owned.length > 0 ? owned : profile.artists.slice(0, 3);

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
          title:
            artist.ownedTracks > 0
              ? `Because ${artist.name} is in your library`
              : `Because you listen to ${artist.name}`,
          subtitle:
            artist.ownedTracks > 0
              ? `You have ${artist.ownedTracks} of their track${artist.ownedTracks === 1 ? '' : 's'}`
              : null,
          reason: 'in_your_library' as const,
          seed: artist.name,
          tracks: rank(tracks, profile),
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
      tracks: rank(likeCollection, profile),
    },
    {
      id: 'related-artists',
      title: 'Artists related to your music',
      subtitle: seedArtists.length
        ? `Close to ${seedArtists.map((artist) => artist.name).slice(0, 2).join(' and ')}`
        : null,
      reason: 'related_artists',
      seed: seedArtists[0]?.name ?? null,
      tracks: rank(related, profile),
    },
    {
      id: 'similar-to-favorites',
      title: 'Similar to your favourites',
      subtitle: profile.repeatedTitles.length ? 'From the songs you replay' : null,
      reason: 'similar_to_favorites',
      seed: profile.repeatedTitles[0] ?? null,
      tracks: rank(likeFavourites, profile),
    },
    {
      id: 'you-might-like',
      title: 'You might like these',
      subtitle: profile.ownedTrackCount > 0 ? 'Based on your imported music' : null,
      reason: 'you_might_like',
      seed: null,
      tracks: rank(wider, profile),
    },
  ];

  return dedupeAcrossShelves(shelves).filter((shelf) => shelf.tracks.length >= MIN_SHELF);
}

/**
 * Nothing to go on yet.
 *
 * This is the only place charts appear, it is labelled as charts rather than as
 * a recommendation, and it disappears the moment there is a collection to
 * reason about.
 */
async function coldStart(perShelf: number): Promise<RecommendationShelf[]> {
  const provider = musicProvider();
  const [trendingAlbums, chill] = await Promise.all([
    provider.getTrending(12).catch(() => [] as Album[]),
    provider.getMoodTracks(MOODS[1], perShelf).catch(() => [] as Track[]),
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
  if (chill.length) {
    shelves.push({
      id: 'mood-chill',
      title: 'Somewhere to start',
      subtitle: null,
      reason: 'mood',
      seed: 'chill',
      tracks: chill,
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
function rank(tracks: Track[], profile: TasteProfile): Track[] {
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
