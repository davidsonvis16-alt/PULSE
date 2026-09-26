import type { Track } from '@/src/core/types';
import { settleWithin } from '@/src/core/http';
import { Store } from '@/src/core/store';
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
 *
 * Twelve markets means twelve public endpoints, and a public endpoint that has
 * stopped answering is an ordinary Tuesday rather than an emergency. So the
 * board is never assembled with `Promise.all`: it is assembled from whatever
 * arrived inside a deadline, the last good board is kept on disk and shown
 * immediately while a new one is built behind it, and a market that keeps
 * timing out is rested instead of being waited on again every single load.
 * A dead storefront costs the deadline once, not twenty-five seconds forever.
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

const BOARD_KEY = 'charts.global.board';
const SNAPSHOT_KEY = 'charts.global.snapshot';
const HEALTH_KEY = 'charts.markets.health';

const PER_COUNTRY = 50;
/** One market's own budget. Short: it is one of twelve, not the whole page. */
const MARKET_TIMEOUT_MS = 4500;
/**
 * The board is assembled from whatever has answered by now.
 *
 * Wider than one market's budget because the HTTP layer rate-limits per host:
 * the last market in the queue waits for a token before its own clock starts,
 * and the deadline has to leave room for that or the tail of the list can never
 * arrive. Only a first run ever waits on this — after that the saved board is
 * on screen while the new one is built behind it.
 */
const BOARD_DEADLINE_MS = 7000;
/** Fewer markets than this is not a worldwide board, so the old one is kept. */
const MIN_MARKETS = 4;
/** A board this old is still shown, but a fresh one is fetched behind it. */
const BOARD_MAX_AGE_MS = 45 * 60 * 1000;
/** Movement is day-over-day; a fresher snapshot is not overwritten. */
const SNAPSHOT_MAX_AGE_MS = 20 * 60 * 60 * 1000;
/** Consecutive misses before a market is rested. */
const MARKET_STRIKES = 2;
/** How long a rested market is left alone. */
const MARKET_REST_MS = 6 * 60 * 60 * 1000;

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

export interface GlobalChart {
  entries: ChartEntry[];
  /** When this board was assembled. */
  builtAt: number;
  /** How many markets were actually counted into it. */
  markets: number;
  /** How many were asked — `markets` short of this means some did not answer. */
  marketsAsked: number;
}

interface Snapshot {
  savedAt: number;
  positions: Record<string, number>;
}

/** Stored without the owned-file swap: local ids change, chart positions do not. */
interface StoredBoard {
  builtAt: number;
  markets: number;
  marketsAsked: number;
  entries: ChartEntry[];
}

type Health = Record<string, { misses: number; restedUntil: number }>;

// ---------------------------------------------------------------------------
// Assembling a board
// ---------------------------------------------------------------------------

/**
 * Which markets to ask for, best-first.
 *
 * Order matters beyond politeness: the HTTP layer rate-limits per host, so the
 * markets asked first are the ones that get a token immediately. Healthy
 * markets go first, and exactly one rested market is let back in each time —
 * rotated — so a storefront that recovers is noticed without the whole board
 * paying to re-check every broken one on every load.
 */
function marketsToAsk(health: Health, now: number): string[] {
  const healthy: string[] = [];
  const rested: string[] = [];

  for (const country of STOREFRONTS) {
    const record = health[country];
    if (record && record.restedUntil > now) rested.push(country);
    else healthy.push(country);
  }

  if (rested.length === 0) return healthy;

  // Normally one probe is enough. But if resting has left too few markets to
  // build a board at all — a total outage, or a phone that was offline for a
  // while and struck everything out — then resting is the thing standing
  // between the listener and a chart, so enough of them come back to try with.
  const probes = Math.max(1, MIN_MARKETS + 2 - healthy.length);
  const start = Math.floor(now / MARKET_REST_MS) % rested.length;
  const letBackIn = Array.from(
    { length: Math.min(probes, rested.length) },
    (_, i) => rested[(start + i) % rested.length],
  );
  return [...healthy, ...letBackIn];
}

function recordHealth(health: Health, country: string, answered: boolean, now: number): Health {
  if (answered) {
    const { [country]: _dropped, ...rest } = health;
    return rest;
  }
  const misses = (health[country]?.misses ?? 0) + 1;
  return {
    ...health,
    [country]: {
      misses,
      restedUntil: misses >= MARKET_STRIKES ? now + MARKET_REST_MS : 0,
    },
  };
}

/**
 * The worldwide board.
 *
 * Scoring is a points system, not an average: a song at number three in nine
 * countries beats one at number one in a single country, which is what "global"
 * should mean. Points are per market, so a board built from eight markets that
 * answered is ranked exactly as it would have been from twelve — just narrower,
 * which is why `markets` is carried out to the screen rather than hidden.
 */
async function assembleBoard(): Promise<StoredBoard | null> {
  const provider = musicProvider();
  if (!provider.capabilities.charts) return null;

  const now = Date.now();
  const health = await getJsonSetting<Health>(HEALTH_KEY, {});
  const asked = marketsToAsk(health, now);

  const boards = await settleWithin(
    asked.map((country) =>
      provider.getChartTracks({
        country,
        limit: PER_COUNTRY,
        timeoutMs: MARKET_TIMEOUT_MS,
        // One of twelve: a retry here doubles what a dead market costs.
        retries: 0,
      }),
    ),
    BOARD_DEADLINE_MS,
  );

  let nextHealth = health;
  asked.forEach((country, index) => {
    nextHealth = recordHealth(nextHealth, country, !!boards[index]?.length, now);
  });
  void setJsonSetting<Health>(HEALTH_KEY, nextHealth).catch(() => {});

  const counted = boards.filter((board): board is Track[] => !!board?.length);
  if (counted.length < MIN_MARKETS) return null;

  const scored = new Map<
    string,
    { track: Track; points: number; countries: number; peak: number }
  >();

  for (const board of counted) {
    board.forEach((track, index) => {
      const rank = index + 1;
      const points = PER_COUNTRY - index;
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
  const entries: ChartEntry[] = ranked.slice(0, 100).map((row, index) => {
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

  return { builtAt: now, markets: counted.length, marketsAsked: asked.length, entries };
}

/** Swaps in the listener's own file wherever they already own a charting song. */
async function withOwned(board: StoredBoard): Promise<GlobalChart> {
  const tracks = await resolveOwnedAll(board.entries.map((entry) => entry.track)).catch(() =>
    board.entries.map((entry) => entry.track),
  );
  return {
    builtAt: board.builtAt,
    markets: board.markets,
    marketsAsked: board.marketsAsked,
    entries: board.entries.map((entry, index) => ({ ...entry, track: tracks[index] })),
  };
}

// ---------------------------------------------------------------------------
// The shared board
// ---------------------------------------------------------------------------

export interface ChartState {
  board: GlobalChart | null;
  /** True only when there is nothing to show yet. */
  loading: boolean;
  /** True while a new board is being built behind one already on screen. */
  refreshing: boolean;
  error: Error | null;
}

/**
 * One board, shared by every screen that shows a chart.
 *
 * Home's top ten and the charts page are the same twelve requests, so they are
 * made once. Whoever opens first pays for it; the other gets it instantly.
 */
class ChartsStore extends Store<ChartState> {
  private inflight: Promise<void> | null = null;
  private hydrating: Promise<void> | null = null;
  private hydrated = false;

  /** Reads the saved board off disk exactly once, however many screens ask. */
  private hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydrating) return this.hydrating;

    this.hydrating = (async () => {
      const saved = await getJsonSetting<StoredBoard | null>(BOARD_KEY, null).catch(() => null);
      if (saved?.entries?.length && !this.getSnapshot().board) {
        this.set({ board: await withOwned(saved), loading: false });
      }
      this.hydrated = true;
      this.hydrating = null;
    })();

    return this.hydrating;
  }

  /**
   * Called when a screen showing charts appears.
   *
   * Paints the saved board straight from disk, then rebuilds it only if it has
   * aged out. Opening the charts page twice in a minute costs nothing.
   */
  async open(): Promise<void> {
    await this.hydrate();

    const { board } = this.getSnapshot();
    if (board && Date.now() - board.builtAt < BOARD_MAX_AGE_MS) {
      this.set({ loading: false });
      return;
    }
    return this.refresh();
  }

  /** Rebuilds the board. Concurrent callers share the one build. */
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;

    const hadBoard = !!this.getSnapshot().board;
    this.set({ loading: !hadBoard, refreshing: hadBoard, error: null });

    this.inflight = (async () => {
      try {
        const built = await assembleBoard();
        if (built) {
          await setJsonSetting<StoredBoard>(BOARD_KEY, built).catch(() => {});
          this.set({ board: await withOwned(built), error: null });
        } else if (!this.getSnapshot().board) {
          // Nothing saved and nothing reachable: the screen has to say so.
          this.set({ error: new Error('The charts could not be reached.') });
        }
        // Too few markets but a board already on screen: it stays. A narrower
        // board is worse than yesterday's complete one.
      } catch (error) {
        if (!this.getSnapshot().board) {
          this.set({ error: error instanceof Error ? error : new Error('The charts could not be reached.') });
        }
      } finally {
        this.set({ loading: false, refreshing: false });
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  /** The library changed, so owned-file swaps in the board are out of date. */
  async reresolveOwned(): Promise<void> {
    const saved = await getJsonSetting<StoredBoard | null>(BOARD_KEY, null).catch(() => null);
    if (saved?.entries?.length) this.set({ board: await withOwned(saved) });
  }
}

export const chartsStore = new ChartsStore({
  board: null,
  loading: true,
  refreshing: false,
  error: null,
});

/** One market's published chart, in order. */
export async function getCountryChart(country: string, limit = 50): Promise<ChartEntry[]> {
  const provider = musicProvider();
  if (!provider.capabilities.charts) return [];
  const fetched = await provider.getChartTracks({
    country,
    limit,
    timeoutMs: 8000,
    // A single market is the whole screen here, so one retry is worth it.
    retries: 1,
  });
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

/** How many markets the worldwide board is assembled from at full strength. */
export const CHART_MARKET_COUNT = STOREFRONTS.length;

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
