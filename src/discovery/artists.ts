import { config } from '@/src/core/config';
import { buildUrl, getJson } from '@/src/core/http';
import { similarity } from '@/src/ingestion/identify/text';

/**
 * A face and a following for an artist, from every free source that has one.
 *
 * No single service knows everyone, so each is asked and the answers are
 * combined:
 *
 *  - Deezer — a photo and its fan count, no key.
 *  - TheAudioDB — photos and follower counts for many artists the shops
 *    lack, on its free public key.
 *  - Wikipedia — the lead picture of the artist's article, used only when the
 *    article really is about a musician.
 *  - Last.fm — listener counts, when a key is configured.
 *
 * The first real photo wins. For the following, the largest figure any source
 * reports is kept, so an artist is only called little-known when nobody
 * reports a big audience.
 */

export interface ArtistProfile {
  name: string;
  /** A photo of the artist, or null when no source has one. */
  pictureUrl: string | null;
  /** The largest audience any source reports, or null when none report one. */
  audience: number | null;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const MATCH_THRESHOLD = 0.8;
const memo = new Map<string, Promise<ArtistProfile | null>>();

export function getArtistProfile(name: string): Promise<ArtistProfile | null> {
  const clean = name.trim();
  if (!clean) return Promise.resolve(null);
  const key = clean.toLowerCase();
  if (!memo.has(key)) memo.set(key, lookUp(clean));
  return memo.get(key)!;
}

async function lookUp(name: string): Promise<ArtistProfile | null> {
  const [deezer, audioDb, lastfm] = await Promise.all([
    fromDeezer(name).catch(() => null),
    fromAudioDb(name).catch(() => null),
    fromLastfm(name).catch(() => null),
  ]);
  const pictureUrl =
    deezer?.picture ?? audioDb?.picture ?? (await fromWikipedia(name).catch(() => null));
  const counts = [deezer?.fans, audioDb?.followers, lastfm?.listeners].filter((n): n is number => typeof n === 'number');
  if (!pictureUrl && counts.length === 0) return null;
  return { name, pictureUrl, audience: counts.length ? Math.max(...counts) : null };
}

async function fromDeezer(name: string): Promise<{ picture: string | null; fans: number } | null> {
  const data = await getJson<{
    data?: { name: string; picture_xl?: string; picture_big?: string; nb_fan?: number }[];
  }>(buildUrl('https://api.deezer.com/search/artist', { q: name, limit: 5 }), { ttlMs: WEEK });
  // Several artists can share a name; the real one is nearly always the one
  // with the following.
  const match = (data?.data ?? [])
    .filter((row) => similarity(row.name, name) >= MATCH_THRESHOLD)
    .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0];
  if (!match) return null;
  const picture = match.picture_xl ?? match.picture_big ?? null;
  return {
    // Deezer serves a grey silhouette for artists without a photo; its address
    // has an empty image id ("/artist//").
    picture: picture && !picture.includes('/artist//') ? picture : null,
    fans: match.nb_fan ?? 0,
  };
}

async function fromAudioDb(
  name: string,
): Promise<{ picture: string | null; followers: number | null } | null> {
  const data = await getJson<{
    artists?: { strArtist: string; strArtistThumb?: string | null; intFollowers?: string | null }[] | null;
  }>(buildUrl('https://www.theaudiodb.com/api/v1/json/123/search.php', { s: name }), {
    ttlMs: WEEK,
  });
  const match = (data?.artists ?? []).find((row) => similarity(row.strArtist, name) >= MATCH_THRESHOLD);
  if (!match) return null;
  const followers = Number(match.intFollowers ?? NaN);
  return {
    picture: match.strArtistThumb || null,
    followers: Number.isFinite(followers) && followers > 0 ? followers : null,
  };
}

async function fromLastfm(name: string): Promise<{ listeners: number } | null> {
  const key = config.popularity.lastfmKey;
  if (!key) return null;
  const data = await getJson<{ artist?: { stats?: { listeners?: string } } }>(
    buildUrl('https://ws.audioscrobbler.com/2.0/', {
      method: 'artist.getInfo',
      artist: name,
      api_key: key,
      autocorrect: 1,
      format: 'json',
    }),
    { ttlMs: WEEK },
  );
  const listeners = Number(data?.artist?.stats?.listeners ?? NaN);
  return Number.isFinite(listeners) ? { listeners } : null;
}

const MUSICIAN = /\b(singer|rapper|musician|band|songwriter|producer|dj|duo|group|vocalist|artist)\b/i;

async function fromWikipedia(name: string): Promise<string | null> {
  const data = await getJson<{
    type?: string;
    description?: string;
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
  }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, {
    ttlMs: WEEK,
  });
  // A name shared with a place or a footballer must not put their face on a song.
  if (data?.type !== 'standard' || !MUSICIAN.test(data.description ?? '')) return null;
  return data.originalimage?.source ?? data.thumbnail?.source ?? null;
}
