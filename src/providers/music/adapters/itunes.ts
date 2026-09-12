import { buildUrl, getJson } from '@/src/core/http';
import { genreEnergy } from '@/src/core/moods';
import {
  entityId,
  parseEntityId,
  type Album,
  type Artist,
  type DownloadableSource,
  type Mood,
  type PlayableSource,
  type SearchResults,
  type Track,
} from '@/src/core/types';
import type {
  MusicProvider,
  MusicProviderCapabilities,
  NewReleaseOptions,
  RecommendationSeed,
  SearchOptions,
} from '@/src/providers/music/types';

/**
 * Apple iTunes Search API adapter.
 *
 * Why this is Pulse's default source: it is a real, public catalogue that needs
 * no key, and every field Pulse renders — title, artist, album, release date,
 * genre, duration, cover art — comes back from Apple rather than from us. It
 * also serves official 30-second preview streams, which is real audio Pulse can
 * both play and store offline.
 *
 * What it will not do: hand over full-length recordings. Those are licensed,
 * and this adapter reports `excerptsOnly: true` so the rest of Pulse labels
 * every track honestly instead of pretending otherwise.
 *
 * Docs: https://performance-partners.apple.com/search-api
 */

const SEARCH_BASE = 'https://itunes.apple.com/search';
const LOOKUP_BASE = 'https://itunes.apple.com/lookup';
const CHARTS_BASE = 'https://rss.marketingtools.apple.com/api/v2';

export const ITUNES_PROVIDER_ID = 'itunes';

const RATE = { capacity: 6, perSecond: 3 };

type ItunesEntity = Record<string, any>;

interface ItunesResponse {
  resultCount: number;
  results: ItunesEntity[];
}

interface ChartsResponse {
  feed?: {
    results?: {
      id: string;
      name: string;
      artistName: string;
      artistId?: string;
      releaseDate?: string;
      artworkUrl100?: string;
      url?: string;
      genres?: { name: string }[];
      contentAdvisoryRating?: string;
    }[];
  };
}

/* ------------------------------------------------------------------ mapping */

/**
 * Apple serves artwork from a path that encodes the rendered size.
 * Swapping the segment gives us a crisp image at whatever size we draw it,
 * instead of upscaling a 100px thumbnail.
 */
function artworkAt(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  const target = Math.max(64, Math.min(3000, Math.round(size)));
  return url.replace(/\/\d+x\d+([a-z-]*)\.(jpg|png)/i, `/${target}x${target}$1.$2`);
}

function albumTypeOf(title: string, trackCount: number | null): Album['albumType'] {
  if (/-\s*single\s*$/i.test(title)) return 'single';
  if (/-\s*ep\s*$/i.test(title)) return 'ep';
  if (trackCount === 1) return 'single';
  if (trackCount !== null && trackCount > 1 && trackCount <= 6) return 'ep';
  return 'album';
}

function mapTrack(raw: ItunesEntity): Track | null {
  if (!raw?.trackId || !raw?.trackName) return null;
  return {
    id: entityId(ITUNES_PROVIDER_ID, 'track', raw.trackId),
    provider: ITUNES_PROVIDER_ID,
    providerTrackId: String(raw.trackId),
    title: raw.trackName,
    artistName: raw.artistName ?? 'Unknown artist',
    artistId: raw.artistId ? entityId(ITUNES_PROVIDER_ID, 'artist', raw.artistId) : null,
    albumTitle: raw.collectionName ?? null,
    albumId: raw.collectionId ? entityId(ITUNES_PROVIDER_ID, 'album', raw.collectionId) : null,
    artworkUrl: artworkAt(raw.artworkUrl100 ?? raw.artworkUrl60, 600),
    durationMs: typeof raw.trackTimeMillis === 'number' ? raw.trackTimeMillis : null,
    releaseDate: raw.releaseDate ?? null,
    genre: raw.primaryGenreName ?? null,
    trackNumber: raw.trackNumber ?? null,
    discNumber: raw.discNumber ?? null,
    explicit: raw.trackExplicitness === 'explicit',
    externalUrl: raw.trackViewUrl ?? null,
  };
}

function mapAlbum(raw: ItunesEntity): Album | null {
  if (!raw?.collectionId || !raw?.collectionName) return null;
  const trackCount = typeof raw.trackCount === 'number' ? raw.trackCount : null;
  return {
    id: entityId(ITUNES_PROVIDER_ID, 'album', raw.collectionId),
    provider: ITUNES_PROVIDER_ID,
    providerAlbumId: String(raw.collectionId),
    title: raw.collectionName,
    artistName: raw.artistName ?? 'Unknown artist',
    artistId: raw.artistId ? entityId(ITUNES_PROVIDER_ID, 'artist', raw.artistId) : null,
    artworkUrl: artworkAt(raw.artworkUrl100 ?? raw.artworkUrl60, 600),
    releaseDate: raw.releaseDate ?? null,
    trackCount,
    genre: raw.primaryGenreName ?? null,
    copyright: raw.copyright ?? null,
    externalUrl: raw.collectionViewUrl ?? null,
    albumType: albumTypeOf(raw.collectionName, trackCount),
  };
}

function mapArtist(raw: ItunesEntity, imageUrl: string | null = null): Artist | null {
  if (!raw?.artistId || !raw?.artistName) return null;
  return {
    id: entityId(ITUNES_PROVIDER_ID, 'artist', raw.artistId),
    provider: ITUNES_PROVIDER_ID,
    providerArtistId: String(raw.artistId),
    name: raw.artistName,
    imageUrl,
    genre: raw.primaryGenreName ?? null,
    externalUrl: raw.artistLinkUrl ?? raw.artistViewUrl ?? null,
  };
}

function rawIdOf(id: string): string {
  return parseEntityId(id)?.raw ?? id;
}

function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    const key = `${t.title.toLowerCase()}|${t.artistName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/* ----------------------------------------------------------------- requests */

async function search(
  term: string,
  entity: 'song' | 'album' | 'musicArtist',
  options: SearchOptions = {},
): Promise<ItunesEntity[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const url = buildUrl(SEARCH_BASE, {
    term: trimmed,
    media: 'music',
    entity,
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    country: options.country ?? 'US',
  });
  const data = await getJson<ItunesResponse>(url, { signal: options.signal, rate: RATE });
  return data?.results ?? [];
}

async function lookup(
  id: string | number,
  params: Record<string, string | number | undefined> = {},
): Promise<ItunesEntity[]> {
  const url = buildUrl(LOOKUP_BASE, { id, ...params });
  const data = await getJson<ItunesResponse>(url, { rate: RATE });
  return data?.results ?? [];
}

/* ------------------------------------------------------------------ adapter */

const capabilities: MusicProviderCapabilities = {
  search: true,
  streaming: true,
  download: true,
  excerptsOnly: true,
  recommendations: true,
  newReleases: true,
  charts: true,
  relatedArtists: true,
};

/** Length of an Apple preview asset. Apple serves 30s clips (occasionally 90s). */
const PREVIEW_MS = 30_000;

export const itunesProvider: MusicProvider = {
  id: ITUNES_PROVIDER_ID,
  name: 'Pulse catalogue',
  attribution: 'Catalogue details and previews from the Pulse music catalogue',
  capabilities,

  async searchTracks(query, options) {
    const results = await search(query, 'song', options);
    return dedupeTracks(results.map(mapTrack).filter((t): t is Track => !!t));
  },

  async searchAlbums(query, options) {
    const results = await search(query, 'album', options);
    return results.map(mapAlbum).filter((a): a is Album => !!a);
  },

  async searchArtists(query, options) {
    const results = await search(query, 'musicArtist', options);
    const artists = results.map((r) => mapArtist(r)).filter((a): a is Artist => !!a);

    // The artist entity carries no image, so borrow real cover art: look up the
    // top few artists' newest releases and use that official artwork.
    const hydrated = await Promise.all(
      artists.slice(0, 6).map(async (artist) => {
        const image = await newestArtworkForArtist(artist.providerArtistId, options?.country);
        return image ? { ...artist, imageUrl: image } : artist;
      }),
    );
    return [...hydrated, ...artists.slice(6)];
  },

  async searchAll(query, options) {
    const limit = options?.limit ?? 20;
    const [tracks, artists, albums] = await Promise.all([
      this.searchTracks(query, { ...options, limit }),
      this.searchArtists(query, { ...options, limit: Math.min(limit, 10) }),
      this.searchAlbums(query, { ...options, limit: Math.min(limit, 12) }),
    ]);
    return { tracks, artists, albums } satisfies SearchResults;
  },

  async getTrack(id) {
    const results = await lookup(rawIdOf(id));
    const raw = results.find((r) => r.wrapperType === 'track') ?? results[0];
    return raw ? mapTrack(raw) : null;
  },

  async getAlbum(id) {
    const results = await lookup(rawIdOf(id));
    const raw = results.find((r) => r.wrapperType === 'collection') ?? results[0];
    return raw ? mapAlbum(raw) : null;
  },

  async getArtist(id) {
    const artistId = rawIdOf(id);
    const [results, image] = await Promise.all([
      lookup(artistId),
      newestArtworkForArtist(artistId),
    ]);
    const raw = results.find((r) => r.wrapperType === 'artist') ?? results[0];
    return raw ? mapArtist(raw, image) : null;
  },

  async getArtistTopTracks(artistId, limit = 20) {
    const results = await lookup(rawIdOf(artistId), { entity: 'song', limit: limit + 1 });
    const tracks = results
      .filter((r) => r.wrapperType === 'track')
      .map(mapTrack)
      .filter((t): t is Track => !!t);
    // Apple returns an artist's songs in popularity order.
    return dedupeTracks(tracks).slice(0, limit);
  },

  async getArtistAlbums(artistId, limit = 24) {
    const albums = await artistReleases(rawIdOf(artistId), limit + 12);
    return albums.filter((a) => a.albumType === 'album').slice(0, limit);
  },

  async getArtistSingles(artistId, limit = 24) {
    const albums = await artistReleases(rawIdOf(artistId), limit + 12);
    return albums.filter((a) => a.albumType !== 'album').slice(0, limit);
  },

  async getAlbumTracks(albumId, limit = 60) {
    const results = await lookup(rawIdOf(albumId), { entity: 'song', limit });
    return results
      .filter((r) => r.wrapperType === 'track')
      .map(mapTrack)
      .filter((t): t is Track => !!t)
      .sort((a, b) => {
        const disc = (a.discNumber ?? 1) - (b.discNumber ?? 1);
        return disc !== 0 ? disc : (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
      });
  },

  async getRelatedArtists(artistId, limit = 12) {
    const artist = await this.getArtist(artistId);
    if (!artist) return [];
    const genre = artist.genre ?? '';
    const [byGenre, byName] = await Promise.all([
      genre ? search(genre, 'song', { limit: 50 }) : Promise.resolve([]),
      search(artist.name, 'song', { limit: 50 }),
    ]);

    const seen = new Map<string, Artist>();
    for (const raw of [...byName, ...byGenre]) {
      if (!raw.artistId || String(raw.artistId) === artist.providerArtistId) continue;
      const key = String(raw.artistId);
      if (seen.has(key)) continue;
      const mapped = mapArtist(raw, artworkAt(raw.artworkUrl100, 400));
      // Song results expose artistViewUrl rather than artistLinkUrl.
      if (mapped) seen.set(key, mapped);
    }
    return [...seen.values()].slice(0, limit);
  },

  async getRecommendations(seed, limit = 24) {
    const country = seed.country ?? 'US';
    const terms = buildSeedTerms(seed);
    if (terms.length === 0) return [];

    const batches = await Promise.all(
      terms.map((term) =>
        search(term, 'song', { limit: 25, country }).catch(() => [] as ItunesEntity[]),
      ),
    );

    const exclude = new Set(seed.excludeTrackIds ?? []);
    const wantedEnergy = seed.energy ?? 0.5;

    const candidates = dedupeTracks(
      batches.flat().map(mapTrack).filter((t): t is Track => !!t),
    ).filter((t) => !exclude.has(t.id));

    const seedArtists = new Set((seed.artistNames ?? []).map((n) => n.toLowerCase()));

    // Rank on how close the track sits to the listener's energy, nudged toward
    // artists they have not already saturated their history with.
    const scored = candidates.map((track) => {
      const energyGap = Math.abs(genreEnergy(track.genre) - wantedEnergy);
      const familiarity = seedArtists.has(track.artistName.toLowerCase()) ? 0.18 : 0;
      const recency = track.releaseDate ? recencyBoost(track.releaseDate) : 0;
      return { track, score: 1 - energyGap - familiarity + recency };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.track);
  },

  async getMoodTracks(mood: Mood, limit = 30) {
    const batches = await Promise.all(
      mood.seeds.map((seedTerm) =>
        search(seedTerm, 'song', { limit: 25 }).catch(() => [] as ItunesEntity[]),
      ),
    );
    const tracks = dedupeTracks(batches.flat().map(mapTrack).filter((t): t is Track => !!t));
    const scored = tracks.map((track) => ({
      track,
      score: 1 - Math.abs(genreEnergy(track.genre) - mood.energy),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.track);
  },

  async getNewReleases(options: NewReleaseOptions = {}) {
    const limit = options.limit ?? 20;

    if (options.artistIds?.length) {
      // Real "new from artists you follow": ask Apple for each followed
      // artist's most recent releases and keep what is genuinely new.
      const perArtist = await Promise.all(
        options.artistIds.slice(0, 12).map((id) =>
          artistReleases(rawIdOf(id), 6).catch(() => [] as Album[]),
        ),
      );
      const all = perArtist.flat();
      const since = options.since ? Date.parse(options.since) : null;
      return all
        .filter((a) => {
          if (!a.releaseDate) return false;
          const ts = Date.parse(a.releaseDate);
          if (Number.isNaN(ts)) return false;
          if (ts > Date.now()) return false;
          return since === null || ts >= since;
        })
        .sort((a, b) => Date.parse(b.releaseDate!) - Date.parse(a.releaseDate!))
        .slice(0, limit);
    }

    const charted = await this.getTrending(limit);
    if (!options.genre) return charted;
    const genre = options.genre.toLowerCase();
    const filtered = charted.filter((a) => (a.genre ?? '').toLowerCase().includes(genre));
    return filtered.length ? filtered : charted;
  },

  async getTrending(limit = 20) {
    const country = 'us';
    const url = `${CHARTS_BASE}/${country}/music/most-played/${Math.min(limit, 50)}/albums.json`;
    const data = await getJson<ChartsResponse>(url, { ttlMs: 30 * 60 * 1000, rate: RATE });
    const rows = data?.feed?.results ?? [];
    return rows.map((row) => ({
      id: entityId(ITUNES_PROVIDER_ID, 'album', row.id),
      provider: ITUNES_PROVIDER_ID,
      providerAlbumId: String(row.id),
      title: row.name,
      artistName: row.artistName,
      artistId: row.artistId ? entityId(ITUNES_PROVIDER_ID, 'artist', row.artistId) : null,
      artworkUrl: artworkAt(row.artworkUrl100, 600),
      releaseDate: row.releaseDate ?? null,
      trackCount: null,
      genre: row.genres?.find((g) => g.name !== 'Music')?.name ?? null,
      copyright: null,
      externalUrl: row.url ?? null,
      albumType: albumTypeOf(row.name, null),
    })) satisfies Album[];
  },

  getArtwork(url, size) {
    return artworkAt(url, size);
  },

  async getPlayableSource(track) {
    const previewUrl = await previewUrlFor(track);
    if (!previewUrl) return null;
    return {
      uri: previewUrl,
      mimeType: 'audio/mp4',
      durationMs: PREVIEW_MS,
      isExcerpt: true,
      label: '30-second preview',
    } satisfies PlayableSource;
  },

  async getDownloadSource(track) {
    const source = await previewUrlFor(track);
    if (!source) return null;
    return {
      uri: source,
      mimeType: 'audio/mp4',
      durationMs: PREVIEW_MS,
      isExcerpt: true,
      label: '30-second preview',
      fileExtension: 'm4a',
      // Apple previews are consistently around a megabyte; used only to show a
      // size estimate before the real byte count arrives from the download.
      estimatedBytes: 1_000_000,
    } satisfies DownloadableSource;
  },
};

/* ------------------------------------------------------------------ helpers */

/** Preview URLs expire from our cache, so always resolve them at play time. */
async function previewUrlFor(track: Track): Promise<string | null> {
  const results = await lookup(track.providerTrackId);
  const raw = results.find((r) => r.wrapperType === 'track') ?? results[0];
  return raw?.previewUrl ?? null;
}

async function artistReleases(artistId: string, limit: number): Promise<Album[]> {
  const results = await lookup(artistId, { entity: 'album', limit, sort: 'recent' });
  const albums = results
    .filter((r) => r.wrapperType === 'collection')
    .map(mapAlbum)
    .filter((a): a is Album => !!a);
  return albums.sort((a, b) => {
    const at = a.releaseDate ? Date.parse(a.releaseDate) : 0;
    const bt = b.releaseDate ? Date.parse(b.releaseDate) : 0;
    return bt - at;
  });
}

async function newestArtworkForArtist(
  artistId: string,
  country?: string,
): Promise<string | null> {
  try {
    const results = await lookup(artistId, {
      entity: 'album',
      limit: 5,
      sort: 'recent',
      country,
    });
    const withArt = results.find((r) => r.artworkUrl100);
    return artworkAt(withArt?.artworkUrl100, 900);
  } catch {
    return null;
  }
}

function buildSeedTerms(seed: RecommendationSeed): string[] {
  const terms: string[] = [];
  (seed.artistNames ?? []).slice(0, 3).forEach((name) => terms.push(name));
  (seed.genres ?? []).slice(0, 3).forEach((genre) => terms.push(genre));
  (seed.trackTitles ?? []).slice(0, 2).forEach((title) => terms.push(title));
  return [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 6);
}

/** Small nudge toward recent music so recommendations do not feel like a museum. */
function recencyBoost(releaseDate: string): number {
  const ts = Date.parse(releaseDate);
  if (Number.isNaN(ts)) return 0;
  const years = (Date.now() - ts) / (365.25 * 24 * 3600 * 1000);
  if (years < 1) return 0.12;
  if (years < 3) return 0.06;
  if (years < 8) return 0.02;
  return 0;
}
