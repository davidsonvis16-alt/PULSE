import type { Track } from '@/src/core/types';
import { musicProvider } from '@/src/providers/music';
import { getJsonSetting, setJsonSetting } from '@/src/db/repos/settings';
import { resolveOwnedAll } from '@/src/library/owned';

/**
 * Charts.
 *
 * What Pulse can honestly show here is a chart position, not a stream count.
 * Per-song global play figures are not published in any form an app can read,
 * so nothing in this file invents one: every number on screen is either a real
 * published position, a count of the charts a song appears in, or a movement
 * worked out from Pulse's own snapshot of yesterday's board.
 *
 * Charts are published per country, and there is no worldwide feed, so the
 * global board is assembled here: a song scores points for how high it sits in
 * each market, and the markets are spread across regions so the result is not
 * simply the American chart wearing a different hat.
 */

/** The markets the worldwide board is built from. */
const STOREFRONTS = [
  'us',
  'gb',
  'de',
  'fr',
  'es',
  'br',
  'mx',
  'ng',
  'za',
  'in',
  'jp',
  'au',
] as const;

const SNAPSHOT_KEY = 'charts.global.snapshot';
/** Movement is day-over-day; a fresher snapshot is not overwritten. */
const SNAPSHOT_MAX_AGE_MS = 20 * 60 * 60 * 1000;
const MEMORY_TTL_MS = 60 * 60 * 1000;

export type ChartMovement = 'new' | 'up' | 'down' | 'same';

export interface ChartEntry {
  track: Track;
  /** 1 is the top of the chart. */
  position: number;
  /** How many of the markets this song is charting in right now. */
  countries: number;
  /** Its best position in any single market. */
  peak: number;
  movement: ChartMovement;
  /** Places gained or lost since the last snapshot; 0 when new or unchanged. */
  change: number;
}

interface Snapshot {
  savedAt: number;
  positions: Record<string, number>;
}

let cache: { at: number; entries: ChartEntry[] } | null = null;

/**
 * The worldwide board.
 *
 * Scoring is a points system, not an average: a song at number three in nine
 * countries beats one at number one in a single country, which is what "global"
 * should mean.
 */
export async function getGlobalChart(options: { limit?: number; fresh?: boolean } = {}): Promise<
  ChartEntry[]
> {
  const limit = options.limit ?? 50;

  if (!options.fresh && cache && Date.now() - cache.at < MEMORY_TTL_MS) {
    return cache.entries.slice(0, limit);
  }

  const provider = musicProvider();
  if (!provider.capabilities.charts) return [];

  const perCountry = 50;
  const boards = await Promise.all(
    STOREFRONTS.map((country) =>
      provider.getChartTracks({ country, limit: perCountry }).catch(() => [] as Track[]),
    ),
  );

  const scored = new Map<
    string,
    { track: Track; points: number; countries: number; peak: number }
  >();

  for (const board of boards) {
    board.forEach((track, index) => {
      const rank = index + 1;
      const points = perCountry - index;
      const key = chartKey(track);
      const existing = scored.get(key);
      if (existing) {
        existing.points += points;
        existing.countries += 1;
        existing.peak = Math.min(existing.peak, rank);
      } else {
        scored.set(key, { track, points, countries: 1, peak: rank });
      }
    });
  }

  const ranked = [...scored.values()].sort(
    (a, b) => b.points - a.points || b.countries - a.countries || a.peak - b.peak,
  );

  const previous = await getJsonSetting<Snapshot | null>(SNAPSHOT_KEY, null);
  // A charting song the listener owns plays from their own file.
  const owned = await resolveOwnedAll(ranked.map((row) => row.track));
  ranked.forEach((row, index) => {
    row.track = owned[index];
  });

  const entries: ChartEntry[] = ranked.map((row, index) => {
    const position = index + 1;
    const before = previous?.positions[chartKey(row.track)];
    return {
      track: row.track,
      position,
      countries: row.countries,
      peak: row.peak,
      movement: movementOf(before, position),
      change: before ? before - position : 0,
    };
  });

  await rememberPositions(entries, previous);

  cache = { at: Date.now(), entries };
  return entries.slice(0, limit);
}

/** One market's published chart, in order. */
export async function getCountryChart(country: string, limit = 50): Promise<ChartEntry[]> {
  const provider = musicProvider();
  if (!provider.capabilities.charts) return [];
  const fetched = await provider.getChartTracks({ country, limit }).catch(() => [] as Track[]);
  const tracks = await resolveOwnedAll(fetched);
  return tracks.map((track, index) => ({
    track,
    position: index + 1,
    countries: 1,
    peak: index + 1,
    movement: 'same' as ChartMovement,
    change: 0,
  }));
}

/** The markets offered in the chart screen's picker. */
export const CHART_MARKETS: { code: string; name: string }[] = [
  { code: 'global', name: 'Worldwide' },
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'ng', name: 'Nigeria' },
  { code: 'za', name: 'South Africa' },
  { code: 'in', name: 'India' },
  { code: 'br', name: 'Brazil' },
  { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' },
  { code: 'jp', name: 'Japan' },
];

/**
 * Songs are matched across markets by name rather than by id, because the same
 * recording carries a different catalogue id in every storefront.
 */
function chartKey(track: Track): string {
  return `${track.title}|${track.artistName}`
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function movementOf(before: number | undefined, now: number): ChartMovement {
  if (!before) return 'new';
  if (before === now) return 'same';
  return before > now ? 'up' : 'down';
}

/** Keeps one snapshot a day, so movement means something. */
async function rememberPositions(entries: ChartEntry[], previous: Snapshot | null) {
  if (previous && Date.now() - previous.savedAt < SNAPSHOT_MAX_AGE_MS) return;
  const positions: Record<string, number> = {};
  for (const entry of entries.slice(0, 100)) {
    positions[chartKey(entry.track)] = entry.position;
  }
  await setJsonSetting<Snapshot>(SNAPSHOT_KEY, { savedAt: Date.now(), positions }).catch(() => {});
}
