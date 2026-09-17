import { getJson } from '@/src/core/http';
import { getJsonSetting, setJsonSetting } from '@/src/db/repos/settings';
import { normalise } from '@/src/ingestion/identify/text';
import {
  parseAwardCategories,
  parseInfobox,
  type AwardCategory,
  type AwardInfobox,
} from '@/src/news/wikitext';

export type { AwardCategory, AwardInfobox, Nominee } from '@/src/news/wikitext';

/**
 * Award season.
 *
 * Pulse keeps an eye on the ceremonies people actually talk about, and shows
 * an edition from the moment its page lists a date until a few weeks after the
 * winners are read out. Nominees and winners come from each ceremony's
 * encyclopedia page (see `wikitext.ts`), which is licensed for reuse with
 * credit, and the award screen gives that credit.
 */

interface AwardSeries {
  id: string;
  /** How the ceremony is known in conversation. */
  shortName: string;
  /** Two colours for the poster, loosely after each show's own look. */
  tint: [string, string];
  /** Page titles an edition held in `year` may be filed under. */
  titles: (year: number) => string[];
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

const SERIES: AwardSeries[] = [
  {
    id: 'grammys',
    shortName: 'GRAMMYs',
    tint: ['#D9B45A', '#2A1E08'],
    titles: (y) => [`${ordinal(y - 1958)} Annual Grammy Awards`],
  },
  {
    id: 'vmas',
    shortName: 'VMAs',
    tint: ['#B7B9C9', '#17152B'],
    titles: (y) => [`${y} MTV Video Music Awards`],
  },
  {
    id: 'bet',
    shortName: 'BET Awards',
    tint: ['#E8C14B', '#1A1405'],
    titles: (y) => [`BET Awards ${y}`, `${y} BET Awards`],
  },
  {
    id: 'brits',
    shortName: 'BRITs',
    tint: ['#FF5FA2', '#2A0A1C'],
    titles: (y) => [`Brit Awards ${y}`, `${y} Brit Awards`],
  },
  {
    id: 'headies',
    shortName: 'The Headies',
    tint: ['#3CD08A', '#062116'],
    titles: (y) => [`${ordinal(y - 2008)} Headies Awards`, `The Headies ${y}`],
  },
  {
    id: 'latin-grammys',
    shortName: 'Latin GRAMMYs',
    tint: ['#FF8A3D', '#2B1204'],
    titles: (y) => [`${ordinal(y - 1999)} Annual Latin Grammy Awards`],
  },
  {
    id: 'amas',
    shortName: 'AMAs',
    tint: ['#FF4D4D', '#2A0808'],
    titles: (y) => [`${y} American Music Awards`, `${ordinal(y - 1973)} American Music Awards`],
  },
  {
    id: 'bbmas',
    shortName: 'Billboard Music Awards',
    tint: ['#5AA8FF', '#07182B'],
    titles: (y) => [`${y} Billboard Music Awards`],
  },
  {
    id: 'iheart',
    shortName: 'iHeartRadio Music Awards',
    tint: ['#FF4F6D', '#2A0710'],
    titles: (y) => [`${y} iHeartRadio Music Awards`],
  },
  {
    id: 'cmas',
    shortName: 'CMA Awards',
    tint: ['#C9A46A', '#231A0C'],
    titles: (y) => [`${ordinal(y - 1966)} Annual Country Music Association Awards`],
  },
  {
    id: 'mobos',
    shortName: 'MOBO Awards',
    tint: ['#F5D04C', '#221B05'],
    titles: (y) => [`${y} MOBO Awards`],
  },
  {
    id: 'ema',
    shortName: 'MTV EMAs',
    tint: ['#FF6BD6', '#240A20'],
    titles: (y) => [`${y} MTV Europe Music Awards`],
  },
  {
    id: 'mama',
    shortName: 'MAMA Awards',
    tint: ['#9B7BFF', '#130C2B'],
    titles: (y) => [`${y} MAMA Awards`],
  },
  {
    id: 'soul-train',
    shortName: 'Soul Train Awards',
    tint: ['#FFB547', '#2A1904'],
    titles: (y) => [`${y} Soul Train Music Awards`],
  },
];

export type AwardStatus = 'today' | 'nominees' | 'awaiting-winners' | 'winners' | 'upcoming';

export interface AwardEdition {
  /** The page title, which also addresses the edition in routes. */
  id: string;
  seriesId: string;
  shortName: string;
  /** "2026 MTV Video Music Awards". */
  title: string;
  year: number;
  tint: [string, string];
  info: AwardInfobox;
  categories: AwardCategory[];
  sourceUrl: string;
}

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const CACHE_KEY = 'news.awards.v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long before a ceremony it starts to show, and how long after it stays. */
const SHOW_BEFORE_DAYS = 150;
const SHOW_AFTER_DAYS = 45;

interface Cached {
  savedAt: number;
  editions: AwardEdition[];
}

let memory: Cached | null = null;

interface QueryResponse {
  query?: {
    pages?: {
      title: string;
      missing?: boolean;
      revisions?: { slots?: { main?: { content?: string } } }[];
    }[];
    redirects?: { from: string; to: string }[];
  };
}

/** Whole days from today to the ceremony; negative once it has happened. */
export function daysUntil(date: string | null, now = Date.now()): number | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const ceremony = Date.UTC(y, m - 1, d);
  const today = new Date(now);
  const midnight = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((ceremony - midnight) / DAY_MS);
}

export function statusOf(edition: AwardEdition, now = Date.now()): AwardStatus {
  const days = daysUntil(edition.info.date, now);
  const hasWinners = edition.categories.some((c) => c.nominees.some((n) => n.winner));
  if (days === 0) return hasWinners ? 'winners' : 'today';
  if (days !== null && days < 0) return hasWinners ? 'winners' : 'awaiting-winners';
  return edition.categories.length ? 'nominees' : 'upcoming';
}

function isCurrent(edition: AwardEdition, now: number): boolean {
  const days = daysUntil(edition.info.date, now);
  return days !== null && days <= SHOW_BEFORE_DAYS && days >= -SHOW_AFTER_DAYS;
}

const STATUS_ORDER: Record<AwardStatus, number> = {
  today: 0,
  'awaiting-winners': 1,
  nominees: 2,
  winners: 3,
  upcoming: 4,
};

function sortEditions(editions: AwardEdition[], now: number): AwardEdition[] {
  return [...editions].sort((a, b) => {
    const order = STATUS_ORDER[statusOf(a, now)] - STATUS_ORDER[statusOf(b, now)];
    if (order) return order;
    return Math.abs(daysUntil(a.info.date, now)!) - Math.abs(daysUntil(b.info.date, now)!);
  });
}

async function fetchEditions(now: number): Promise<AwardEdition[]> {
  const today = new Date(now);
  const year = today.getFullYear();
  // Last year's ceremonies can still be in their afterglow in January and
  // February; next year's start to appear from late summer.
  const years = [
    ...(today.getMonth() <= 1 ? [year - 1] : []),
    year,
    ...(today.getMonth() >= 7 ? [year + 1] : []),
  ];
  const wanted = new Map<string, { series: AwardSeries; year: number }>();
  for (const series of SERIES) {
    for (const y of years) {
      for (const title of series.titles(y)) wanted.set(title, { series, year: y });
    }
  }

  const titles = [...wanted.keys()];
  const editions: AwardEdition[] = [];
  const seen = new Set<string>();

  // Content for many pages comes back in one request, but big pages share a
  // response budget, so the list is asked for in small groups.
  for (let i = 0; i < titles.length; i += 10) {
    const group = titles.slice(i, i + 10);
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      redirects: '1',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      origin: '*',
      titles: group.join('|'),
    });
    const data = await getJson<QueryResponse>(`${WIKI_API}?${params}`, {
      ttlMs: CACHE_TTL_MS,
      timeoutMs: 20000,
      headers: { 'Api-User-Agent': 'Pulse/1.0 (music app)' },
    }).catch(() => null);
    const pages = data?.query?.pages ?? [];
    const redirects = data?.query?.redirects ?? [];

    for (const page of pages) {
      if (page.missing || seen.has(page.title)) continue;
      // A redirect to the series' general article is not an edition.
      if (!/\d/.test(page.title)) continue;
      const requested = redirects.find((r) => r.to === page.title)?.from ?? page.title;
      const match = wanted.get(requested) ?? wanted.get(page.title);
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (!match || !content) continue;
      seen.add(page.title);

      editions.push({
        id: page.title,
        seriesId: match.series.id,
        shortName: match.series.shortName,
        title: page.title,
        year: match.year,
        tint: match.series.tint,
        info: parseInfobox(content),
        categories: parseAwardCategories(content),
        sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      });
    }
  }

  return editions.filter((edition) => isCurrent(edition, now));
}

/** Ceremonies coming up, happening today, or just past, soonest and liveliest first. */
export async function getAwardSeason(options: { fresh?: boolean } = {}): Promise<AwardEdition[]> {
  const now = Date.now();
  if (!memory) memory = await getJsonSetting<Cached | null>(CACHE_KEY, null).catch(() => null);

  const stale = !memory || now - memory.savedAt > CACHE_TTL_MS;
  if (options.fresh || stale) {
    const editions = await fetchEditions(now).catch(() => null);
    // A failed refresh keeps what was already known rather than emptying the page.
    if (editions && (editions.length || !memory)) {
      memory = { savedAt: now, editions };
      await setJsonSetting(CACHE_KEY, memory).catch(() => {});
    }
  }

  return sortEditions((memory?.editions ?? []).filter((e) => isCurrent(e, now)), now);
}

export async function getAwardEdition(id: string): Promise<AwardEdition | null> {
  const season = await getAwardSeason();
  return season.find((edition) => edition.id === id) ?? null;
}

export interface LibraryNomination {
  artist: string;
  categories: { name: string; work: string | null; winner: boolean }[];
}

/** Which of the listener's artists are in the running, and for what. */
export function nominationsFor(edition: AwardEdition, artistNames: string[]): LibraryNomination[] {
  const wanted = new Map(artistNames.map((name) => [normalise(name), name]));
  const found = new Map<string, LibraryNomination>();

  for (const category of edition.categories) {
    for (const nominee of category.nominees) {
      for (const artist of nominee.artists) {
        const name = wanted.get(normalise(artist));
        if (!name) continue;
        const entry = found.get(name) ?? { artist: name, categories: [] };
        if (!entry.categories.some((c) => c.name === category.name)) {
          entry.categories.push({ name: category.name, work: nominee.work, winner: nominee.winner });
        }
        found.set(name, entry);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.categories.length - a.categories.length);
}

/** True when any credited artist on this nominee is in the listener's library. */
export function isLibraryNominee(artists: string[], artistNames: Set<string>): boolean {
  return artists.some((artist) => artistNames.has(normalise(artist)));
}
