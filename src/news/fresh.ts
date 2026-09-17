import type { Album } from '@/src/core/types';
import { musicProvider } from '@/src/providers/music';
import { getArtistsFromLibrary } from '@/src/discovery/engine';
import { libraryArtistNames } from '@/src/library/owned';
import { normalise } from '@/src/ingestion/identify/text';

/**
 * New music worth a poster.
 *
 * Two real sources: the latest releases from the artists in your library (and
 * the ones closest to them), and records charting within weeks of coming out.
 * Every word on a poster is derived from the release itself: its type, its
 * date, and why it is here.
 */

export type FreshReason = 'your-artist' | 'similar' | 'charting';

export interface FreshRelease {
  album: Album;
  reason: FreshReason;
}

export interface PosterWords {
  /** "NEW SINGLE" */
  kicker: string;
  /** "Out today", "Out Friday", "Out 12 Sep" */
  when: string;
  /** "From your library" */
  why: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function posterWords(release: FreshRelease, now = Date.now()): PosterWords {
  const { album } = release;
  const kicker = album.albumType === 'single' ? 'NEW SINGLE' : album.albumType === 'ep' ? 'NEW EP' : 'NEW ALBUM';

  let when = 'Out now';
  if (album.releaseDate) {
    const released = new Date(album.releaseDate);
    const today = new Date(now);
    const days = Math.round(
      (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
        Date.UTC(released.getUTCFullYear(), released.getUTCMonth(), released.getUTCDate())) /
        DAY_MS,
    );
    if (days <= 0) when = 'Out today';
    else if (days === 1) when = 'Out yesterday';
    else if (days < 7) when = `Out ${WEEKDAYS[released.getUTCDay()]}`;
    else when = `Out ${released.getUTCDate()} ${MONTHS[released.getUTCMonth()]}`;
  }

  const why =
    release.reason === 'your-artist'
      ? 'From your library'
      : release.reason === 'charting'
        ? 'Already charting'
        : 'Like what you play';

  return { kicker, when, why };
}

export async function getFreshReleases(limit = 16): Promise<FreshRelease[]> {
  const provider = musicProvider();
  const since = Date.now() - 45 * DAY_MS;

  const [artists, owned, trending] = await Promise.all([
    getArtistsFromLibrary(12).catch(() => []),
    libraryArtistNames().catch(() => [] as string[]),
    provider.getTrending(50).catch(() => [] as Album[]),
  ]);
  const ownedKeys = new Set(owned.map(normalise));

  const fromArtists = artists.length
    ? await provider
        .getNewReleases({ artistIds: artists.map((a) => a.id), limit: 30, since: new Date(since).toISOString() })
        .catch(() => [] as Album[])
    : [];

  const releases: FreshRelease[] = [
    ...fromArtists.map((album) => ({
      album,
      reason: (ownedKeys.has(normalise(album.artistName)) ? 'your-artist' : 'similar') as FreshReason,
    })),
    ...trending
      .filter((album) => {
        const at = album.releaseDate ? Date.parse(album.releaseDate) : NaN;
        return Number.isFinite(at) && at >= Date.now() - 30 * DAY_MS && at <= Date.now();
      })
      .map((album) => ({ album, reason: 'charting' as FreshReason })),
  ];

  const rank: Record<FreshReason, number> = { 'your-artist': 0, charting: 1, similar: 2 };
  const seen = new Set<string>();
  return releases
    .sort(
      (a, b) =>
        rank[a.reason] - rank[b.reason] ||
        Date.parse(b.album.releaseDate ?? '0') - Date.parse(a.album.releaseDate ?? '0'),
    )
    .filter((release) => {
      const key = `${normalise(release.album.title)}|${normalise(release.album.artistName)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
