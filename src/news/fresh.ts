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
 *
 * New music has a shelf life, and this rail enforces one rather than letting a
 * record sit under a "new" heading for a month and a half. A release is new for
 * `RELEASE_WINDOW_DAYS`; inside that window it is ranked by how recently it
 * came out, so it drifts down the rail day by day, is marked as on its way out
 * for the last stretch, and then leaves. Nothing has to be cleared by hand —
 * the rail is a function of today's date, so it is different every morning.
 */

export type FreshReason = 'your-artist' | 'similar' | 'charting';

export interface FreshRelease {
  album: Album;
  reason: FreshReason;
  /** Whole days since it came out. 0 is today. */
  daysOut: number;
  /** True for the last stretch of the window, before it drops off the rail. */
  leavingSoon: boolean;
}

export interface PosterWords {
  /** "New single" */
  kicker: string;
  /** "Out today", "Out Friday", "Out 12 Sep" */
  when: string;
  /** "From your library" */
  why: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a record counts as new. After this it is simply a record. */
export const RELEASE_WINDOW_DAYS = 28;
/** The tail of the window, where a release is on its way off the rail. */
const LEAVING_SOON_DAYS = 7;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole days between a release date and now, in UTC so a timezone cannot shift it. */
export function daysSinceRelease(releaseDate: string | null | undefined, now = Date.now()): number | null {
  if (!releaseDate) return null;
  const released = new Date(releaseDate);
  const ts = released.getTime();
  if (!Number.isFinite(ts)) return null;
  const today = new Date(now);
  return Math.round(
    (Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
      Date.UTC(released.getUTCFullYear(), released.getUTCMonth(), released.getUTCDate())) /
      DAY_MS,
  );
}

export function posterWords(release: FreshRelease, now = Date.now()): PosterWords {
  const { album } = release;
  const kicker = album.albumType === 'single' ? 'New single' : album.albumType === 'ep' ? 'New EP' : 'New album';

  let when = 'Out now';
  const days = daysSinceRelease(album.releaseDate, now);
  if (album.releaseDate && days !== null) {
    const released = new Date(album.releaseDate);
    if (days <= 0) when = 'Out today';
    else if (days === 1) when = 'Out yesterday';
    else if (days < 7) when = `Out ${WEEKDAYS[released.getUTCDay()]}`;
    else if (days < 14) when = 'Out last week';
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

/**
 * How high a release sits on the rail.
 *
 * Recency is the spine of it — this is a new-music rail, so the newest record
 * leads — and the reason it is here breaks ties. A release from an artist in
 * your library is worth about a week's head start over one that is merely
 * charting, which is enough to lead the rail on the day it lands without
 * keeping it there once something newer of yours arrives.
 */
function freshnessScore(reason: FreshReason, daysOut: number): number {
  const recency = Math.max(0, RELEASE_WINDOW_DAYS - daysOut) / RELEASE_WINDOW_DAYS;
  const weight = reason === 'your-artist' ? 1.25 : reason === 'charting' ? 1.05 : 1;
  return recency * weight;
}

export async function getFreshReleases(limit = 16): Promise<FreshRelease[]> {
  const provider = musicProvider();
  const now = Date.now();
  const since = now - RELEASE_WINDOW_DAYS * DAY_MS;

  const [artists, owned, trending] = await Promise.all([
    getArtistsFromLibrary(12).catch(() => []),
    libraryArtistNames().catch(() => [] as string[]),
    provider.getTrending(50).catch(() => [] as Album[]),
  ]);
  const ownedKeys = new Set(owned.map(normalise));

  const fromArtists = artists.length
    ? await provider
        .getNewReleases({
          artistIds: artists.map((a) => a.id),
          limit: 30,
          since: new Date(since).toISOString(),
        })
        .catch(() => [] as Album[])
    : [];

  const candidates: { album: Album; reason: FreshReason }[] = [
    ...fromArtists.map((album) => ({
      album,
      reason: (ownedKeys.has(normalise(album.artistName)) ? 'your-artist' : 'similar') as FreshReason,
    })),
    ...trending.map((album) => ({ album, reason: 'charting' as FreshReason })),
  ];

  const seen = new Set<string>();
  const inWindow: FreshRelease[] = [];

  for (const candidate of candidates) {
    const daysOut = daysSinceRelease(candidate.album.releaseDate, now);
    // No date means no place on a rail that is entirely about dates, and a
    // release the window has passed has stopped being news.
    if (daysOut === null || daysOut < 0 || daysOut > RELEASE_WINDOW_DAYS) continue;

    const key = `${normalise(candidate.album.title)}|${normalise(candidate.album.artistName)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    inWindow.push({
      album: candidate.album,
      reason: candidate.reason,
      daysOut,
      leavingSoon: daysOut > RELEASE_WINDOW_DAYS - LEAVING_SOON_DAYS,
    });
  }

  return inWindow
    .sort(
      (a, b) =>
        freshnessScore(b.reason, b.daysOut) - freshnessScore(a.reason, a.daysOut) ||
        a.daysOut - b.daysOut,
    )
    .slice(0, limit);
}
