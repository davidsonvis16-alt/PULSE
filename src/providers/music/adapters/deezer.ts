import { buildUrl, getJson } from '@/src/core/http';
import { genreEnergy } from '@/src/core/moods';
import {
  entityId,
  type Album,
  type Artist,
  type DownloadableSource,
  type Mood,
  type PlayableSource,
  type Track,
} from '@/src/core/types';
import type { MusicProvider, MusicProviderCapabilities } from '@/src/providers/music/types';

/**
 * Deezer as a second catalogue.
 *
 * Apple's catalogue is the one Pulse searches, but no single catalogue knows
 * every artist — Deezer is especially strong on African, French and Latin
 * music. Mood mixes and discoveries draw from both, so a song is not missed
 * just because one shop does not carry it. Like Apple, Deezer licenses
 * 30-second previews to anyone, with no key.
 *
 * Preview addresses are signed and expire, so they are resolved at play time.
 */

export const DEEZER_PROVIDER_ID = 'deezer';

const API = 'https://api.deezer.com';
const PREVIEW_MS = 30_000;
const DAY = 24 * 60 * 60 * 1000;

const capabilities: MusicProviderCapabilities = {
  // Never the active catalogue; it supplies discovery alongside it.
  search: false,
  streaming: true,
  download: true,
  excerptsOnly: true,
  recommendations: false,
  newReleases: false,
  charts: false,
  relatedArtists: false,
};

interface DeezerTrack {
  id: number;
  title: string;
  duration?: number;
  preview?: string;
  explicit_lyrics?: boolean;
  link?: string;
  artist?: { id: number; name: string };
  album?: { id: number; title: string; cover_xl?: string; cover_big?: string };
}

function mapTrack(raw: DeezerTrack, genre: string | null): Track | null {
  if (!raw?.id || !raw.title || !raw.preview) return null;
  return {
    id: entityId(DEEZER_PROVIDER_ID, 'track', raw.id),
    provider: DEEZER_PROVIDER_ID,
    providerTrackId: String(raw.id),
    title: raw.title,
    artistName: raw.artist?.name ?? 'Unknown artist',
    artistId: null,
    albumTitle: raw.album?.title ?? null,
    albumId: null,
    artworkUrl: raw.album?.cover_xl ?? raw.album?.cover_big ?? null,
    durationMs: typeof raw.duration === 'number' ? raw.duration * 1000 : null,
    releaseDate: null,
    genre,
    trackNumber: null,
    discNumber: null,
    explicit: !!raw.explicit_lyrics,
    externalUrl: raw.link ?? null,
  };
}

/** Songs on Deezer for a search, labelled with the genre that was asked for. */
export async function searchDeezerTracks(query: string, limit = 25, genre: string | null = null) {
  const data = await getJson<{ data?: DeezerTrack[] }>(
    buildUrl(`${API}/search`, { q: query, limit }),
    { ttlMs: DAY },
  );
  return (data?.data ?? []).map((raw) => mapTrack(raw, genre)).filter((t): t is Track => !!t);
}

async function freshPreview(track: Track): Promise<string | null> {
  const data = await getJson<DeezerTrack>(`${API}/track/${track.providerTrackId}`).catch(() => null);
  return data?.preview || null;
}

const none = async () => [];

export const deezerProvider: MusicProvider = {
  id: DEEZER_PROVIDER_ID,
  name: 'Deezer',
  attribution: '30-second preview from Deezer',
  capabilities,

  searchTracks: (query, options) => searchDeezerTracks(query, options?.limit ?? 25),
  searchArtists: none as () => Promise<Artist[]>,
  searchAlbums: none as () => Promise<Album[]>,
  async searchAll(query) {
    return { tracks: await searchDeezerTracks(query, 20), artists: [], albums: [] };
  },

  getTrack: async () => null,
  getArtist: async () => null,
  getAlbum: async () => null,

  getArtistTopTracks: none as () => Promise<Track[]>,
  getArtistAlbums: none as () => Promise<Album[]>,
  getArtistSingles: none as () => Promise<Album[]>,
  getRelatedArtists: none as () => Promise<Artist[]>,
  getAlbumTracks: none as () => Promise<Track[]>,
  getRecommendations: none as () => Promise<Track[]>,

  async getMoodTracks(mood: Mood, limit = 30) {
    const batches = await Promise.all(
      mood.seeds.map((seed) => searchDeezerTracks(seed, 25, seed).catch(() => [] as Track[])),
    );
    return batches
      .flat()
      .map((track) => ({ track, score: 1 - Math.abs(genreEnergy(track.genre) - mood.energy) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.track);
  },

  getNewReleases: none as () => Promise<Album[]>,
  getTrending: none as () => Promise<Album[]>,
  getChartTracks: none as () => Promise<Track[]>,

  getArtwork(url) {
    return url ?? null;
  },

  async getPlayableSource(track: Track): Promise<PlayableSource | null> {
    const uri = await freshPreview(track);
    if (!uri) return null;
    return {
      uri,
      mimeType: 'audio/mpeg',
      durationMs: PREVIEW_MS,
      isExcerpt: true,
      label: '30-second preview · Deezer',
    };
  },

  async getDownloadSource(track: Track): Promise<DownloadableSource | null> {
    const uri = await freshPreview(track);
    if (!uri) return null;
    return {
      uri,
      mimeType: 'audio/mpeg',
      durationMs: PREVIEW_MS,
      isExcerpt: true,
      label: '30-second preview · Deezer',
      fileExtension: 'mp3',
      estimatedBytes: 500_000,
    };
  },
};
