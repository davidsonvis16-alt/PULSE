import { getJson } from '@/src/core/http';
import { getJsonSetting, setJsonSetting } from '@/src/db/repos/settings';
import { normalise } from '@/src/ingestion/identify/text';
import {
  daysUntil,
  isInSeason,
  plannedEditions,
  seriesById,
  statusFrom,
  type AwardStatus,
} from '../../supabase/functions/_shared/award-series';
import {
  parseAwardCategories,
  parseInfobox,
  type AwardCategory,
  type AwardInfobox,
} from '@/src/news/wikitext';

export type { AwardCategory, AwardInfobox, Nominee } from '@/src/news/wikitext';
export { daysUntil, withThe, type AwardStatus } from '../../supabase/functions/_shared/award-series';

/**
 * Award season.
 *
 * Pulse keeps an eye on the ceremonies people actually talk about, and shows
 * an edition from the moment its page lists a date until a few weeks after the
 * winners are read out. Nominees and winners come from each ceremony's
 * encyclopedia page (see `wikitext.ts`), which is licensed for reuse with
 * credit, and the award screen gives that credit.
 */

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

export function statusOf(edition: AwardEdition, now = Date.now()): AwardStatus {
  const hasWinners = edition.categories.some((c) => c.nominees.some((n) => n.winner));
  return statusFrom(edition.info.date, hasWinners, edition.categories.length > 0, now);
}

function isCurrent(edition: AwardEdition, now: number): boolean {
  return isInSeason(edition.info.date, now);
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
  const wanted = plannedEditions(now);

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
      const planned = wanted.get(requested) ?? wanted.get(page.title);
      const series = planned ? seriesById(planned.seriesId) : undefined;
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (!planned || !series || !content) continue;
      seen.add(page.title);

      editions.push({
        id: page.title,
        seriesId: series.id,
        shortName: series.shortName,
        title: page.title,
        year: planned.year,
        tint: series.tint,
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
