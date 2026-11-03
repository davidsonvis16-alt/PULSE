import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { Album, Artist } from '@/src/core/types';
import { config } from '@/src/core/config';
import { musicProvider } from '@/src/providers/music';
import { similarity } from '@/src/ingestion/identify/text';
import { buildUrl, getJson } from '@/src/core/http';
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
const DAY = 24 * 60 * 60 * 1000;

/**
 * The real song and artist behind a file's tags.
 *
 * Songs saved from video sites carry the channel as the artist
 * ("MylesSmithVEVO", "Marco Casarotto") and the real names in the title
 * ("Myles Smith - Betting on Us (Visualiser)"). Searching the tags as they are
 * finds nothing, so the names are taken from the title when it is written that
 * way, and the video-site extras are dropped from both.
 */
export function cleanNames(query: ArtworkQuery): ArtworkQuery {
  const tidy = (text: string) =>
    text
      .replace(/[([][^)\]]*\b(official|audio|video|lyrics?|visuali[sz]er|music video|prod\.?|produced|hd|hq|explicit|remaster(ed)?|slowed|sped up|reverb)\b[^)\]]*[)\]]/gi, ' ')
      .replace(/\b(official (music )?video|official audio|lyric video|lyrics)\b/gi, ' ')
      .replace(/[“”"«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const channel = (name: string) =>
    name
      .replace(/vevo$/i, '')
      .replace(/\s*-\s*topic$/i, '')
      .replace(/\bofficial\b/gi, '')
      // "MylesSmith" → "Myles Smith"
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

  let title = tidy(query.title.replace(/^\s*\d{1,3}\s*[.)_-]?\s+/, '').replace(/_/g, ' '));
  let artist = channel(query.artist);
  const named = title.split(/\s+[-–—]\s+/);
  if (named.length >= 2) {
    artist = named[0].trim();
    title = named.slice(1).join(' - ').trim();
  }
  if (/^unknown( artist)?$/i.test(artist)) artist = '';
  return { title, artist, album: query.album ? tidy(query.album) : query.album };
}

/** Deezer first: it answers fast, has no tight limit and carries large covers. */
async function deezerArtwork({ title, artist, album }: ArtworkQuery): Promise<string | null> {
  type Hit = { title: string; artist?: { name?: string }; cover_xl?: string; album?: { title?: string; cover_xl?: string } };
  const fits = (found: string, wanted: string) => !wanted || similarity(found, wanted) >= ARTWORK_MATCH_THRESHOLD;

  if (album?.trim()) {
    const data = await getJson<{ data?: Hit[] }>(
      buildUrl('https://api.deezer.com/search/album', { q: `${artist} ${album}`.trim(), limit: 5 }),
      { ttlMs: DAY },
    ).catch(() => null);
    const hit = data?.data?.find((row) => fits(row.title, album) && fits(row.artist?.name ?? '', artist));
    if (hit?.cover_xl) return hit.cover_xl;
  }
  if (!title.trim()) return null;
  const data = await getJson<{ data?: Hit[] }>(
    buildUrl('https://api.deezer.com/search', { q: `${artist} ${title}`.trim(), limit: 6 }),
    { ttlMs: DAY },
  ).catch(() => null);
  const hit = data?.data?.find((row) => fits(row.title, title) && fits(row.artist?.name ?? '', artist));
  return hit?.album?.cover_xl ?? null;
}

export const catalogArtworkProvider: ArtworkProvider = {
  id: 'catalog',

  async getArtwork(raw) {
    const { title, artist, album } = cleanNames(raw);
    const fromDeezer = await deezerArtwork({ title, artist, album });
    if (fromDeezer) return fromDeezer;
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
  // A browser has nowhere to write a file; the cover travels inline instead.
  if (Platform.OS === 'web') return `data:${picture.mimeType || 'image/jpeg'};base64,${picture.base64}`;
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
