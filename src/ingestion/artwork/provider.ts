import * as FileSystem from 'expo-file-system/legacy';
import type { Album, Artist } from '@/src/core/types';
import { config } from '@/src/core/config';
import { musicProvider } from '@/src/providers/music';
import { similarity } from '@/src/ingestion/identify/text';
import type { EmbeddedPicture } from '@/src/ingestion/tags';

/**
 * ArtworkProvider: gets a real cover onto every track Pulse can.
 *
 * Order of preference, and it matters:
 *
 *  1. Artwork embedded in the user's own file. It is already correct and needs
 *     no network.
 *  2. Official artwork for a track Pulse identified confidently.
 *  3. Nothing. A cover that might belong to a different record is worse than no
 *     cover, so a weak match leaves the track as it was.
 */

const ARTWORK_DIR = `${FileSystem.documentDirectory}pulse/local-art/`;

export interface ArtworkProvider {
  readonly id: string;
  /** Cover for a specific recording. */
  getArtwork(query: ArtworkQuery): Promise<string | null>;
  getAlbumArtwork(album: string, artist: string): Promise<string | null>;
  getArtistImage(artist: string): Promise<string | null>;
}

export interface ArtworkQuery {
  title: string;
  artist: string;
  album?: string | null;
}

/** Below this, the artwork probably belongs to a different record. */
const ARTWORK_MATCH_THRESHOLD = 0.7;

export const catalogArtworkProvider: ArtworkProvider = {
  id: 'catalog',

  async getArtwork({ title, artist, album }) {
    if (album?.trim()) {
      const fromAlbum = await this.getAlbumArtwork(album, artist);
      if (fromAlbum) return fromAlbum;
    }
    if (!title.trim()) return null;

    try {
      const results = await musicProvider().searchTracks(`${artist} ${title}`.trim(), {
        limit: 6,
        country: config.music.country,
      });
      const match = results.find(
        (candidate) =>
          similarity(candidate.title, title) >= ARTWORK_MATCH_THRESHOLD &&
          (!artist || similarity(candidate.artistName, artist) >= ARTWORK_MATCH_THRESHOLD),
      );
      return match?.artworkUrl ?? null;
    } catch {
      return null;
    }
  },

  async getAlbumArtwork(album, artist) {
    if (!album.trim()) return null;
    try {
      const results: Album[] = await musicProvider().searchAlbums(`${artist} ${album}`.trim(), {
        limit: 6,
        country: config.music.country,
      });
      const match = results.find(
        (candidate) =>
          similarity(candidate.title, album) >= ARTWORK_MATCH_THRESHOLD &&
          (!artist || similarity(candidate.artistName, artist) >= ARTWORK_MATCH_THRESHOLD),
      );
      return match?.artworkUrl ?? null;
    } catch {
      return null;
    }
  },

  async getArtistImage(artist) {
    if (!artist.trim()) return null;
    try {
      const results: Artist[] = await musicProvider().searchArtists(artist, { limit: 4 });
      const match = results.find(
        (candidate) => similarity(candidate.name, artist) >= ARTWORK_MATCH_THRESHOLD,
      );
      return match?.imageUrl ?? null;
    } catch {
      return null;
    }
  },
};

let active: ArtworkProvider = catalogArtworkProvider;

export function setArtworkProvider(provider: ArtworkProvider) {
  active = provider;
}

export function artworkProvider(): ArtworkProvider {
  return active;
}

/**
 * Writes cover art lifted out of a file's tags to Pulse's cache and returns a
 * URI the image components can render. The user's file is not touched.
 */
export async function cacheEmbeddedArtwork(
  trackId: string,
  picture: EmbeddedPicture,
): Promise<string | null> {
  try {
    await ensureDir();
    const extension = picture.mimeType.includes('png') ? 'png' : 'jpg';
    const target = `${ARTWORK_DIR}${safeName(trackId)}.${extension}`;
    const existing = await FileSystem.getInfoAsync(target);
    if (existing.exists) return target;
    await FileSystem.writeAsStringAsync(target, picture.base64, { encoding: 'base64' });
    return target;
  } catch {
    return null;
  }
}

export async function clearCachedArtwork() {
  try {
    await FileSystem.deleteAsync(ARTWORK_DIR, { idempotent: true });
  } catch {
    /* nothing cached */
  }
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(ARTWORK_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(ARTWORK_DIR, { intermediates: true });
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}
