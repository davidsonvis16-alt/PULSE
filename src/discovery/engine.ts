import { genreEnergy, MOODS } from '@/src/core/moods';
import type { Album, Track } from '@/src/core/types';
import { musicProvider } from '@/src/providers/music';
import { getFollowedArtists, getFavoriteTracks, getLibraryTracks } from '@/src/db/repos/library';
import { getTasteSignals, getTopArtists, getRecentlyPlayed } from '@/src/db/repos/history';

/**
 * Pulse's discovery engine.
 *
 * It builds a taste profile from what the user actually did — time spent per
 * artist, genres they return to, songs they repeat, artists they skip — and
 * turns that into seeds for the provider. Every shelf carries the reason it
 * exists, because "Because you listened to Ariana Grande" is only worth showing
 * if it is true.
 *
 * With no history yet, it falls back to what the source is genuinely charting
 * rather than inventing a personality for a new user.
 */

export interface TasteProfile {
  topArtists: string[];
  topGenres: string[];
  repeatedTitles: string[];
  /** 0..1, the centre of gravity of what they listen to. */
  energy: number;
  /** Artists they consistently skip, kept out of recommendations. */
  avoidArtists: string[];
  knownTrackIds: Set<string>;
  hasHistory: boolean;
}

export async function buildTasteProfile(): Promise<TasteProfile> {
  const [signals, library, favorites, followed] = await Promise.all([
    getTasteSignals(),
    getLibraryTracks({ limit: 300 }),
    getFavoriteTracks(100),
    getFollowedArtists(),
  ]);

  const artistWeights = new Map<string, number>();
  signals.artists.forEach((a) => artistWeights.set(a.name, a.msPlayed));
  // A follow or a favourite is a deliberate signal, worth roughly ten minutes
  // of passive listening.
  followed.forEach((a) => artistWeights.set(a.name, (artistWeights.get(a.name) ?? 0) + 600_000));
  favorites.forEach((t) =>
    artistWeights.set(t.artistName, (artistWeights.get(t.artistName) ?? 0) + 300_000),
  );

  const genreWeights = new Map<string, number>();
  signals.genres.forEach((g) => genreWeights.set(g.genre, g.msPlayed));
  library.forEach((t) => {
    if (t.genre) genreWeights.set(t.genre, (genreWeights.get(t.genre) ?? 0) + 120_000);
  });

  const topArtists = rank(artistWeights).slice(0, 8);
  const topGenres = rank(genreWeights).slice(0, 6);

  const energyTotal = [...genreWeights.entries()].reduce(
    (acc, [genre, weight]) => acc + genreEnergy(genre) * weight,
    0,
  );
  const weightTotal = [...genreWeights.values()].reduce((a, b) => a + b, 0);

  const knownTrackIds = new Set<string>([
    ...signals.recentTrackIds,
    ...library.map((t) => t.id),
    ...favorites.map((t) => t.id),
  ]);

  return {
    topArtists,
    topGenres,
    repeatedTitles: signals.repeated.slice(0, 6).map((r) => r.title),
    energy: weightTotal > 0 ? energyTotal / weightTotal : 0.55,
    avoidArtists: signals.skippedArtists,
    knownTrackIds,
    hasHistory: signals.artists.length > 0,
  };
}

function rank(weights: Map<string, number>): string[] {
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

export type ShelfReason =
  | 'because_artist'
  | 'similar_taste'
  | 'next_obsession'
  | 'from_library'
  | 'new_to_you'
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

/**
 * Builds the personalised shelves shown on Home and Discover.
 * Shelves that come back empty are dropped rather than shown as empty rows.
 */
export async function getRecommendationShelves(
  profile: TasteProfile,
  options: { limit?: number } = {},
): Promise<RecommendationShelf[]> {
  const provider = musicProvider();
  const perShelf = options.limit ?? 16;
  const exclude = [...profile.knownTrackIds];

  if (!profile.hasHistory) {
    // Cold start: real charts, plus two mood shelves so there is something to
    // press. Nothing here pretends to be personalised.
    const [trendingAlbums, chill] = await Promise.all([
      provider.getTrending(12).catch(() => [] as Album[]),
      provider.getMoodTracks(MOODS[1], perShelf).catch(() => [] as Track[]),
    ]);
    const trendingTracks = await tracksFromAlbums(trendingAlbums.slice(0, 6));
    const shelves: RecommendationShelf[] = [];
    if (trendingTracks.length) {
      shelves.push({
        id: 'trending',
        title: 'Charting right now',
        subtitle: `What is being played most on ${provider.name}`,
        reason: 'trending',
        seed: null,
        tracks: trendingTracks.slice(0, perShelf),
      });
    }
    if (chill.length) {
      shelves.push({
        id: 'mood-chill',
        title: 'Ease into it',
        subtitle: 'Start somewhere, and Pulse will learn from there',
        reason: 'mood',
        seed: 'chill',
        tracks: chill,
      });
    }
    return shelves;
  }

  const seedArtists = profile.topArtists.slice(0, 3);

  const [becauseShelves, nextObsession, fromLibrary, newToYou] = await Promise.all([
    Promise.all(
      seedArtists.map(async (artistName) => {
        const tracks = await provider
          .getRecommendations(
            {
              artistNames: [artistName],
              genres: profile.topGenres.slice(0, 2),
              energy: profile.energy,
              excludeTrackIds: exclude,
            },
            perShelf,
          )
          .catch(() => [] as Track[]);
        return {
          id: `because-${slug(artistName)}`,
          title: `Because you listened to ${artistName}`,
          subtitle: null,
          reason: 'because_artist' as const,
          seed: artistName,
          tracks: filterAvoided(tracks, profile),
        };
      }),
    ),
    provider
      .getRecommendations(
        {
          artistNames: profile.topArtists.slice(0, 2),
          genres: profile.topGenres.slice(0, 3),
          trackTitles: profile.repeatedTitles.slice(0, 2),
          energy: clamp(profile.energy + 0.1),
          excludeTrackIds: exclude,
        },
        perShelf,
      )
      .catch(() => [] as Track[]),
    provider
      .getRecommendations(
        { genres: profile.topGenres.slice(0, 4), energy: profile.energy, excludeTrackIds: exclude },
        perShelf,
      )
      .catch(() => [] as Track[]),
    provider
      .getRecommendations(
        {
          // Deliberately away from the centre of their taste.
          genres: profile.topGenres.slice(2, 5),
          energy: clamp(profile.energy > 0.5 ? profile.energy - 0.35 : profile.energy + 0.35),
          excludeTrackIds: exclude,
        },
        perShelf,
      )
      .catch(() => [] as Track[]),
  ]);

  const shelves: RecommendationShelf[] = [
    ...becauseShelves,
    {
      id: 'next-obsession',
      title: 'Your next obsession',
      subtitle: 'Built from the songs you keep going back to',
      reason: 'next_obsession',
      seed: profile.repeatedTitles[0] ?? null,
      tracks: filterAvoided(nextObsession, profile),
    },
    {
      id: 'from-library',
      title: 'Based on your library',
      subtitle: profile.topGenres.slice(0, 3).join(' · ') || null,
      reason: 'from_library',
      seed: profile.topGenres[0] ?? null,
      tracks: filterAvoided(fromLibrary, profile),
    },
    {
      id: 'new-to-you',
      title: 'Discover something new',
      subtitle: 'Further from your usual, on purpose',
      reason: 'new_to_you',
      seed: null,
      tracks: filterAvoided(newToYou, profile),
    },
  ];

  return shelves.filter((shelf) => shelf.tracks.length >= 4);
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
  return results.filter((t) => t.id !== track.id);
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
      ? seed.genres.reduce((acc, g) => acc + genreEnergy(g), 0) / seed.genres.length
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

/** The "Your top artists" rail, straight from measured listening time. */
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

function filterAvoided(tracks: Track[], profile: TasteProfile): Track[] {
  if (profile.avoidArtists.length === 0) return tracks;
  const avoid = new Set(profile.avoidArtists.map((a) => a.toLowerCase()));
  return tracks.filter((t) => !avoid.has(t.artistName.toLowerCase()));
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
