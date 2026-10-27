import type { Album, Artist, DownloadableSource, Mood, PlayableSource, Track } from '@/src/core/types';
import { config } from '@/src/core/config';
import type { MusicProvider, MusicProviderCapabilities } from '@/src/providers/music/types';

/**
 * Freestyles as a music source.
 *
 * A freestyle is a recording someone on Pulse uploaded to the radio. It is a
 * Track like any other so the player, the mini player and the lock screen
 * handle it without special cases; this adapter only knows how to turn one
 * into a stream address. The id's raw part is the file's path in storage.
 */

export const FREESTYLE_PROVIDER_ID = 'freestyle';
export const FREESTYLE_BUCKET = 'freestyles';

const capabilities: MusicProviderCapabilities = {
  search: false,
  streaming: true,
  // Someone's freestyle is theirs; it is heard on the radio, not kept.
  download: false,
  excerptsOnly: false,
  recommendations: false,
  newReleases: false,
  charts: false,
  relatedArtists: false,
};

/** Public address of an uploaded freestyle. */
export function freestyleUrl(storagePath: string): string | null {
  if (!config.supabase.url) return null;
  const path = storagePath.split('/').map(encodeURIComponent).join('/');
  return `${config.supabase.url}/storage/v1/object/public/${FREESTYLE_BUCKET}/${path}`;
}

const none = async () => [];

export const freestyleProvider: MusicProvider = {
  id: FREESTYLE_PROVIDER_ID,
  name: 'Pulse Radio',
  attribution: 'A freestyle uploaded to Pulse Radio',
  capabilities,

  searchTracks: none,
  searchArtists: none,
  searchAlbums: none,
  async searchAll() {
    return { tracks: [], artists: [], albums: [] };
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
    const uri = freestyleUrl(track.providerTrackId);
    if (!uri) return null;
    return {
      uri,
      mimeType: 'audio/mp4',
      durationMs: track.durationMs,
      isExcerpt: false,
      label: 'Pulse Radio · Freestyle',
    };
  },

  async getDownloadSource(): Promise<DownloadableSource | null> {
    return null;
  },
};
