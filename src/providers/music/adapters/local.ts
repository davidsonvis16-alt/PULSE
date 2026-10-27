import { Platform } from 'react-native';
import type { Album, Artist, DownloadableSource, Mood, PlayableSource, Track } from '@/src/core/types';
import { getLocalFileUri, getLocalTrack, LOCAL_PROVIDER_ID } from '@/src/db/repos/local';
import { getCachedAlbum, getCachedArtist, getCachedTrack } from '@/src/db/repos/catalog';
import type { MusicProvider, MusicProviderCapabilities } from '@/src/providers/music/types';
import { isWebFile, webFilePlaybackUrl } from '@/src/ingestion/web-store';

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

/**
 * Every address the player could open a file by, best first.
 *
 * On Android the media library hands back `file://` + the raw path, unescaped,
 * so a song called "Track #1.mp3" reads as a URL with a fragment and points at
 * a file that does not exist; and on some phones a path in shared storage is
 * not readable by path at all. The media store's own content address avoids
 * both, so it goes first whenever the file came from there. The escaped path
 * and the path exactly as stored follow, and the player works down the list
 * until one of them makes a sound.
 */
export function playableUris(fileUri: string, assetId: string | null): string[] {
  const uris: string[] = [];
  if (Platform.OS === 'android' && assetId && /^\d+$/.test(assetId)) {
    uris.push(`content://media/external/audio/media/${assetId}`);
  }
  if (fileUri.startsWith('file://')) {
    const path = fileUri.slice('file://'.length);
    // Only escape what breaks parsing; a path that is already escaped is kept.
    const alreadyEncoded = /%[0-9A-Fa-f]{2}/.test(path);
    const escaped = alreadyEncoded
      ? path.replace(/#/g, '%23').replace(/\?/g, '%3F')
      : path.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');
    uris.push(`file://${escaped}`);
  }
  uris.push(fileUri);
  return [...new Set(uris)];
}

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
  getChartTracks: none as () => Promise<Track[]>,

  getArtwork(url) {
    // Local artwork is a file on disk at whatever size the tag held.
    return url ?? null;
  },

  async getPlayableSource(track: Track): Promise<PlayableSource | null> {
    const record = await getLocalTrack(track.id);
    const fileUri = record?.fileUri ?? (await getLocalFileUri(track.id));
    if (!fileUri) return null;
    const uris = isWebFile(fileUri)
      ? [await webFilePlaybackUrl(fileUri)].filter((uri): uri is string => !!uri)
      : playableUris(fileUri, record?.assetId ?? null);
    if (uris.length === 0) return null;
    return {
      uri: uris[0],
      alternates: uris.slice(1),
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
