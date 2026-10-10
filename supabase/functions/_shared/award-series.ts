/**
 * The ceremonies Pulse follows.
 *
 * Shared by the app and by the push server, so both look for the same shows,
 * on the same dates, under the same page titles.
 *
 * Award pages are filed under a few different title patterns — a year, an
 * ordinal, or a name with the year after it — so each series lists every
 * pattern it might be under and whichever page exists is the one used.
 */

export interface AwardSeries {
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

const AWARD_SERIES: AwardSeries[] = [
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

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long before a ceremony it starts to show, and how long after it stays. */
export const SHOW_BEFORE_DAYS = 150;
export const SHOW_AFTER_DAYS = 45;

/** "the VMAs", but "The Headies" rather than "the The Headies". */
export function withThe(name: string): string {
  return /^the\s/i.test(name) ? name : `the ${name}`;
}

export function seriesById(id: string): AwardSeries | undefined {
  return AWARD_SERIES.find((series) => series.id === id);
}

/**
 * Every page title worth asking for right now, and what each one would be.
 *
 * Last year's ceremonies can still be in their afterglow in January and
 * February; next year's start to appear from late summer.
 */
export function plannedEditions(now: number): Map<string, { seriesId: string; year: number }> {
  const today = new Date(now);
  const year = today.getFullYear();
  const years = [
    ...(today.getMonth() <= 1 ? [year - 1] : []),
    year,
    ...(today.getMonth() >= 7 ? [year + 1] : []),
  ];
  const planned = new Map<string, { seriesId: string; year: number }>();
  for (const series of AWARD_SERIES) {
    for (const y of years) {
      for (const title of series.titles(y)) planned.set(title, { seriesId: series.id, year: y });
    }
  }
  return planned;
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

export function statusFrom(
  date: string | null,
  hasWinners: boolean,
  hasCategories: boolean,
  now = Date.now(),
): AwardStatus {
  const days = daysUntil(date, now);
  if (days === 0) return hasWinners ? 'winners' : 'today';
  if (days !== null && days < 0) return hasWinners ? 'winners' : 'awaiting-winners';
  return hasCategories ? 'nominees' : 'upcoming';
}

/** True while an edition is close enough to the present to be worth showing. */
export function isInSeason(date: string | null, now = Date.now()): boolean {
  const days = daysUntil(date, now);
  return days !== null && days <= SHOW_BEFORE_DAYS && days >= -SHOW_AFTER_DAYS;
}
