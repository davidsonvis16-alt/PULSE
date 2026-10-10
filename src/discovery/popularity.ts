import type { Track } from '@/src/core/types';
import { config } from '@/src/core/config';
import { buildUrl, getJson } from '@/src/core/http';
import { similarity } from '@/src/ingestion/identify/text';
import { getTrackPlayCount } from '@/src/db/repos/history';

/**
 * How big is this song?
 *
 * The honest answer is complicated, and this module refuses to simplify it into
 * a made-up number. Of the platforms people ask about:
 *
 *  - YouTube publishes real view counts, through its API, with a key.
 *  - Last.fm publishes real listener and scrobble counts, with a key.
 *  - Deezer publishes a popularity rank, not a play count, and no key.
 *  - Spotify publishes play counts on its own pages but in no API, and its
 *    charts API was withdrawn.
 *  - Apple Music publishes nothing per song.
 *
 * So every figure here is labelled with what it actually measures and where it
 * came from, the platforms that publish nothing say so, and each one links out
 * to the song so the real page is one tap away. Nothing is estimated.
 */

export type PlatformId = 'youtube' | 'spotify' | 'deezer' | 'apple' | 'lastfm' | 'pulse';

export interface PlatformStat {
  id: PlatformId;
  label: string;
  icon: 'logo-youtube' | 'musical-notes' | 'headset' | 'radio' | 'person';
  /** The figure, already formatted. Null when the platform publishes none. */
  value: string | null;
  /** What the figure counts, or why there is not one. */
  note: string;
  /** Where to see it on the platform itself. */
  url: string | null;
}

export interface SongPopularity {
  stats: PlatformStat[];
  /** True when at least one real figure came back. */
  hasFigures: boolean;
}

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const DEEZER_API = 'https://api.deezer.com/search';
const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';
const MATCH_THRESHOLD = 0.7;
const TTL = 6 * 60 * 60 * 1000;

export async function getSongPopularity(track: Track): Promise<SongPopularity> {
  const query = `${track.artistName} ${track.title}`.trim();
  const [youtube, deezer, lastfm, mine] = await Promise.all([
    youtubeViews(query).catch(() => null),
    deezerRank(track).catch(() => null),
    lastfmPlays(track).catch(() => null),
    getTrackPlayCount(track.id).catch(() => 0),
  ]);

  const stats: PlatformStat[] = [
    {
      id: 'youtube',
      label: 'YouTube',
      icon: 'logo-youtube',
      value: youtube ? `${formatCount(youtube.views)} views` : null,
      note: youtube
        ? 'Views on the most-watched upload of this song'
        : config.popularity.youtubeKey
          ? 'No upload matched this song closely enough'
          : 'Needs a YouTube API key to read view counts',
      url: youtube?.url ?? searchUrl('youtube', query),
    },
    {
      id: 'spotify',
      label: 'Spotify',
      icon: 'musical-notes',
      value: null,
      note: 'Publishes play counts on its own pages, but not through any API',
      url: searchUrl('spotify', query),
    },
    {
      id: 'deezer',
      label: 'Deezer',
      icon: 'headset',
      value: deezer ? `${formatCount(deezer.rank)} popularity` : null,
      note: deezer
        ? 'Deezer publishes a popularity rank rather than a play count'
        : 'No close match on Deezer',
      url: deezer?.url ?? searchUrl('deezer', query),
    },
    {
      id: 'apple',
      label: 'Apple Music',
      icon: 'radio',
      value: null,
      note: 'Publishes chart positions, never a per-song play count',
      url: track.externalUrl ?? searchUrl('apple', query),
    },
    {
      id: 'lastfm',
      label: 'Last.fm',
      icon: 'headset',
      value: lastfm ? `${formatCount(lastfm.listeners)} listeners` : null,
      note: lastfm
        ? `${formatCount(lastfm.playcount)} scrobbled plays across its users`
        : config.popularity.lastfmKey
          ? 'Not scrobbled enough to have figures'
          : 'Needs a Last.fm API key to read listener counts',
      url: lastfm?.url ?? null,
    },
    {
      id: 'pulse',
      label: 'You',
      icon: 'person',
      value: mine > 0 ? `${mine} play${mine === 1 ? '' : 's'}` : null,
      note: mine > 0 ? 'Counted on this device, by you' : 'You have not played this yet',
      url: null,
    },
  ];

  return { stats, hasFigures: stats.some((stat) => stat.value !== null) };
}

/* ---------------------------------------------------------------- platforms */

async function youtubeViews(query: string): Promise<{ views: number; url: string } | null> {
  const key = config.popularity.youtubeKey;
  if (!key) return null;

  const search = await getJson<{
    items?: { id?: { videoId?: string }; snippet?: { title?: string } }[];
  }>(
    buildUrl(`${YOUTUBE_API}/search`, {
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: 10,
      maxResults: 3,
      key,
    }),
    { ttlMs: TTL },
  );

  const videoId = search?.items?.find((item) => item.id?.videoId)?.id?.videoId;
  if (!videoId) return null;

  const details = await getJson<{ items?: { statistics?: { viewCount?: string } }[] }>(
    buildUrl(`${YOUTUBE_API}/videos`, { part: 'statistics', id: videoId, key }),
    { ttlMs: TTL },
  );

  const views = Number(details?.items?.[0]?.statistics?.viewCount ?? 0);
  if (!Number.isFinite(views) || views <= 0) return null;
  return { views, url: `https://www.youtube.com/watch?v=${videoId}` };
}

async function deezerRank(track: Track): Promise<{ rank: number; url: string } | null> {
  const data = await getJson<{
    data?: { title: string; rank: number; link: string; artist?: { name?: string } }[];
  }>(
    buildUrl(DEEZER_API, { q: `${track.artistName} ${track.title}`.trim(), limit: 5 }),
    { ttlMs: TTL },
  );

  const match = (data?.data ?? []).find(
    (row) =>
      similarity(row.title, track.title) >= MATCH_THRESHOLD &&
      similarity(row.artist?.name ?? '', track.artistName) >= MATCH_THRESHOLD,
  );
  if (!match?.rank) return null;
  return { rank: match.rank, url: match.link };
}

async function lastfmPlays(
  track: Track,
): Promise<{ listeners: number; playcount: number; url: string } | null> {
  const key = config.popularity.lastfmKey;
  if (!key) return null;

  const data = await getJson<{
    track?: { listeners?: string; playcount?: string; url?: string };
  }>(
    buildUrl(LASTFM_API, {
      method: 'track.getInfo',
      api_key: key,
      artist: track.artistName,
      track: track.title,
      autocorrect: 1,
      format: 'json',
    }),
    { ttlMs: TTL },
  );

  const listeners = Number(data?.track?.listeners ?? 0);
  const playcount = Number(data?.track?.playcount ?? 0);
  if (!listeners) return null;
  return { listeners, playcount, url: data?.track?.url ?? '' };
}

/* ------------------------------------------------------------------ helpers */

function searchUrl(platform: PlatformId, query: string): string {
  const q = encodeURIComponent(query);
  switch (platform) {
    case 'youtube':
      return `https://www.youtube.com/results?search_query=${q}`;
    case 'spotify':
      return `https://open.spotify.com/search/${q}`;
    case 'deezer':
      return `https://www.deezer.com/search/${q}`;
    case 'apple':
      return `https://music.apple.com/search?term=${q}`;
    default:
      return '';
  }
}

function formatCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}
