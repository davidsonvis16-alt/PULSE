import type { Album, Artist, DownloadableSource, Mood, PlayableSource, Track } from '@/src/core/types';
import { getLocalFileUri, getLocalTrack, LOCAL_PROVIDER_ID } from '@/src/db/repos/local';
import { getCachedAlbum, getCachedArtist, getCachedTrack } from '@/src/db/repos/catalog';
import type { MusicProvider, MusicProviderCapabilities } from '@/src/providers/music/types';

/**
 * The user's own music, exposed through the same interface as any catalogue.
 *
 * This adapter is never the active provider — it does no searching and knows
 * nothing about music that is not already on the device. It exists so the
 * player, the library and the download manager can treat an imported file
 * exactly like a catalogue track: `providerFor('local')` resolves here, and
 * `getPlayableSource` hands back the file on disk.
 */

const capabilities: MusicProviderCapabilities = {
  search: false,
  streaming: true,
  // There is nothing to download: the audio is already on the device.
  download: false,
  excerptsOnly: false,
  recommendations: false,
  newReleases: false,
  charts: false,
  relatedArtists: false,
};

const none = async () => [];

export const localProvider: MusicProvider = {
  id: LOCAL_PROVIDER_ID,
  name: 'Your device',
  attribution: 'From your own music library',
  capabilities,

  searchTracks: none,
  searchArtists: none,
  searchAlbums: none,
  async searchAll() {
    return { tracks: [], artists: [], albums: [] };
  },

  getTrack: (id: string) => getCachedTrack(id),
  getArtist: (id: string) => getCachedArtist(id),
  getAlbum: (id: string) => getCachedAlbum(id),

  getArtistTopTracks: none as () => Promise<Track[]>,
  getArtistAlbums: none as () => Promise<Album[]>,
  getArtistSingles: none as () => Promise<Album[]>,
  getRelatedArtists: none as () => Promise<Artist[]>,
  getAlbumTracks: none as () => Promise<Track[]>,
  getRecommendations: none as () => Promise<Track[]>,
  getMoodTracks: none as (mood: Mood) => Promise<Track[]>,
  getNewReleases: none as () => Promise<Album[]>,
  getTrending: none as () => Promise<Album[]>,

  getArtwork(url) {
    // Local artwork is a file on disk at whatever size the tag held.
    return url ?? null;
  },

  async getPlayableSource(track: Track): Promise<PlayableSource | null> {
    const record = await getLocalTrack(track.id);
    const uri = record?.fileUri ?? (await getLocalFileUri(track.id));
    if (!uri) return null;
    return {
      uri,
      mimeType: record?.mimeType ?? 'audio/mpeg',
      durationMs: track.durationMs,
      // The user's own file: the whole recording, not an excerpt.
      isExcerpt: false,
      label: record?.container
        ? `Your library · ${record.container.toUpperCase()}`
        : 'Your library',
    };
  },

  async getDownloadSource(): Promise<DownloadableSource | null> {
    return null;
  },
};
