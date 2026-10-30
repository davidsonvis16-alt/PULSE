import { buildUrl, getJson } from '@/src/core/http';
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
 * Audius: independent music, uploaded by the artists themselves.
 *
 * Every song on Audius was put there by whoever made it, to be streamed in
 * full, so Pulse can play whole songs here rather than the 30-second previews
 * the shops license. No key is needed; requests carry the app's name, which is
 * all Audius asks for.
 */

export const AUDIUS_PROVIDER_ID = 'audius';

const API = 'https://api.audius.co/v1';
const APP_NAME = 'PULSE';
const HOUR = 60 * 60 * 1000;

const capabilities: MusicProviderCapabilities = {
  // Its own page in Pulse, not the catalogue general searches run against.
  search: false,
  streaming: true,
  // Artists choose whether a song can be downloaded; Pulse streams only.
  download: false,
  excerptsOnly: false,
  recommendations: false,
  newReleases: false,
  charts: false,
  relatedArtists: false,
};

interface AudiusTrack {
  id: string;
  title: string;
  genre?: string | null;
  mood?: string | null;
  duration?: number;
  release_date?: string | null;
  permalink?: string;
  play_count?: number;
  is_streamable?: boolean;
  artwork?: { '480x480'?: string; '1000x1000'?: string; '150x150'?: string } | null;
  user?: { id: string; name: string; handle?: string; follower_count?: number };
}

export interface IndieTrack extends Track {
  plays: number | null;
  followers: number | null;
}

function mapTrack(raw: AudiusTrack): IndieTrack | null {
  if (!raw?.id || !raw.title || raw.is_streamable === false) return null;
  return {
    id: entityId(AUDIUS_PROVIDER_ID, 'track', raw.id),
    provider: AUDIUS_PROVIDER_ID,
    providerTrackId: raw.id,
    title: raw.title,
    artistName: raw.user?.name ?? 'Independent artist',
    artistId: null,
    albumTitle: null,
    albumId: null,
    artworkUrl: raw.artwork?.['480x480'] ?? raw.artwork?.['1000x1000'] ?? null,
    durationMs: typeof raw.duration === 'number' ? raw.duration * 1000 : null,
    releaseDate: raw.release_date?.slice(0, 10) ?? null,
    genre: raw.genre || null,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    externalUrl: raw.permalink ? `https://audius.co${raw.permalink}` : null,
    plays: raw.play_count ?? null,
    followers: raw.user?.follower_count ?? null,
  };
}

async function list(path: string, params: Record<string, string | number | undefined> = {}) {
  const data = await getJson<{ data?: AudiusTrack[] }>(
    buildUrl(`${API}${path}`, { app_name: APP_NAME, ...params }),
    { ttlMs: HOUR },
  );
  return (data?.data ?? []).map(mapTrack).filter((t): t is IndieTrack => !!t);
}

/** What independent listeners are playing this week, optionally in one genre. */
export function indieTrending(genre?: string, limit = 30) {
  return list('/tracks/trending', { time: 'week', genre, limit });
}

/** Rising artists without a big following yet. */
export function indieUnderground(limit = 30) {
  return list('/tracks/trending/underground', { limit });
}

export function searchIndie(query: string, limit = 30) {
  return list('/tracks/search', { query, limit });
}

/** Genres as Audius names them, offered as filters on the Indie page. */
export const INDIE_GENRES = [
  'Hip-Hop/Rap',
  'Electronic',
  'R&B/Soul',
  'Alternative',
  'Pop',
  'Afrobeats',
  'Lo-Fi',
  'House',
  'Rock',
  'Jazz',
  'Reggae',
  'Acoustic',
];

const none = async () => [];

export const audiusProvider: MusicProvider = {
  id: AUDIUS_PROVIDER_ID,
  name: 'Audius',
  attribution: 'Independent music on Audius',
  capabilities,

  searchTracks: (query, options) => searchIndie(query, options?.limit ?? 30),
  searchArtists: none as () => Promise<Artist[]>,
  searchAlbums: none as () => Promise<Album[]>,
  async searchAll(query) {
    return { tracks: await searchIndie(query, 20), artists: [], albums: [] };
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
  getMoodTracks: none as (mood: Mood) => Promise<Track[]>,
  getNewReleases: none as () => Promise<Album[]>,
  getTrending: none as () => Promise<Album[]>,
  getChartTracks: none as () => Promise<Track[]>,

  getArtwork(url) {
    return url ?? null;
  },

  async getPlayableSource(track: Track): Promise<PlayableSource | null> {
    return {
      // Audius answers with a short redirect to wherever the song is stored.
      uri: buildUrl(`${API}/tracks/${encodeURIComponent(track.providerTrackId)}/stream`, {
        app_name: APP_NAME,
      }),
      mimeType: 'audio/mpeg',
      durationMs: track.durationMs,
      isExcerpt: false,
      label: 'Full song · Audius',
    };
  },

  async getDownloadSource(): Promise<DownloadableSource | null> {
    return null;
  },
};
