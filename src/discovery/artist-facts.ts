import { buildUrl, getJson } from '@/src/core/http';
import { config } from '@/src/core/config';
import { similarity } from '@/src/ingestion/identify/text';
import { findDeezerArtist } from '@/src/providers/music/adapters/deezer';

/** What the open music sources know about an artist, gathered in one place. */
export interface ArtistFacts {
  country: string | null;
  /** The year they started (a band's formed year, a solo artist's debut era). */
  since: number | null;
  born: number | null;
  genre: string | null;
  style: string | null;
  label: string | null;
  biography: string | null;
  website: string | null;
  /** Fans on Deezer. */
  fans: number | null;
  /** People who have listened on Last.fm, and how many times in all. */
  listeners: number | null;
  plays: number | null;
  /** Releases Deezer lists. */
  releases: number | null;
  /** One line describing them, e.g. "American singer and actress". */
  description: string | null;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const memo = new Map<string, Promise<ArtistFacts>>();

const year = (value: string | null | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 1000 ? n : null;
};

export function getArtistFacts(name: string): Promise<ArtistFacts> {
  const key = name.trim().toLowerCase();
  if (!memo.has(key)) memo.set(key, gather(name.trim()));
  return memo.get(key)!;
}

async function gather(name: string): Promise<ArtistFacts> {
  const [audio, deezer, lastfm, wiki] = await Promise.all([
    getJson<{
      artists?:
        | {
            strArtist: string;
            strCountry?: string | null;
            intFormedYear?: string | null;
            intBornYear?: string | null;
            strGenre?: string | null;
            strStyle?: string | null;
            strLabel?: string | null;
            strBiographyEN?: string | null;
            strWebsite?: string | null;
          }[]
        | null;
    }>(buildUrl('https://www.theaudiodb.com/api/v1/json/123/search.php', { s: name }), { ttlMs: WEEK })
      .then((d) => (d?.artists ?? []).find((a) => similarity(a.strArtist, name) >= 0.85) ?? null)
      .catch(() => null),
    findDeezerArtist(name).catch(() => null),
    config.popularity.lastfmKey
      ? getJson<{ artist?: { stats?: { listeners?: string; playcount?: string } } }>(
          buildUrl('https://ws.audioscrobbler.com/2.0/', {
            method: 'artist.getInfo',
            artist: name,
            api_key: config.popularity.lastfmKey,
            autocorrect: 1,
            format: 'json',
          }),
          { ttlMs: WEEK },
        ).catch(() => null)
      : Promise.resolve(null),
    getJson<{ type?: string; description?: string }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
      { ttlMs: WEEK },
    ).catch(() => null),
  ]);

  const number = (value: string | undefined) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const musician = /\b(singer|rapper|musician|band|songwriter|producer|dj|duo|group|vocalist|artist)\b/i;

  return {
    country: audio?.strCountry || null,
    since: year(audio?.intFormedYear),
    born: year(audio?.intBornYear),
    genre: audio?.strGenre || null,
    style: audio?.strStyle || null,
    label: audio?.strLabel || null,
    biography: audio?.strBiographyEN?.trim() || null,
    website: audio?.strWebsite ? (audio.strWebsite.startsWith('http') ? audio.strWebsite : `https://${audio.strWebsite}`) : null,
    fans: deezer?.fans || null,
    releases: deezer?.albums || null,
    listeners: number(lastfm?.artist?.stats?.listeners),
    plays: number(lastfm?.artist?.stats?.playcount),
    description:
      wiki?.type === 'standard' && musician.test(wiki.description ?? '') ? (wiki.description ?? null) : null,
  };
}

const playsMemo = new Map<string, Promise<Map<string, number>>>();

/** A song title reduced to what two sources would agree on. */
const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s*-\s*.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * How many times each of an artist's songs has been played, by title key, from
 * Last.fm's listeners — the only open source with per-song counts. Empty when
 * no Last.fm key is set.
 */
export function getArtistPlayCounts(name: string): Promise<Map<string, number>> {
  const key = name.trim().toLowerCase();
  if (!playsMemo.has(key)) {
    playsMemo.set(
      key,
      (async () => {
        const counts = new Map<string, number>();
        if (!config.popularity.lastfmKey) return counts;
        const data = await getJson<{
          toptracks?: { track?: { name: string; playcount?: string }[] };
        }>(
          buildUrl('https://ws.audioscrobbler.com/2.0/', {
            method: 'artist.getTopTracks',
            artist: name,
            api_key: config.popularity.lastfmKey,
            autocorrect: 1,
            limit: 100,
            format: 'json',
          }),
          { ttlMs: WEEK },
        ).catch(() => null);
        for (const row of data?.toptracks?.track ?? []) {
          const n = Number(row.playcount);
          if (Number.isFinite(n) && n > 0) counts.set(titleKey(row.name), n);
        }
        return counts;
      })(),
    );
  }
  return playsMemo.get(key)!;
}

export const playCountKey = titleKey;
