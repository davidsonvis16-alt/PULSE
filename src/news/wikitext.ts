import { decodeEntities } from '@/src/news/rss';

/**
 * Reading award nominees out of encyclopedia pages.
 *
 * No awards body publishes its nominations in a form an app can read, but
 * every major ceremony has a well-kept encyclopedia page that lists each
 * category and its nominees within hours of the announcement, and marks the
 * winners on the night. That is the source here.
 *
 * The pages are written by different editors and laid out three ways:
 *
 * - the category named inside each cell, above its list (Grammys, VMAs);
 * - a header row naming the categories, then a row of lists beneath (BRITs,
 *   Headies, BET);
 * - the winner as a top-level bullet with the other nominees indented under it,
 *   rather than every nominee at the top level.
 *
 * This reader handles all three and throws away everything that is not a
 * category with nominees, such as performer and presenter tables.
 */

export interface Nominee {
  /** Who is nominated, as the page credits them. */
  credit: string;
  /** The song, album or video, when the category is for a work. */
  work: string | null;
  /** Every linked person or act in the credit, for matching against a library. */
  artists: string[];
  winner: boolean;
}

export interface AwardCategory {
  name: string;
  nominees: Nominee[];
}

export interface AwardInfobox {
  /** ISO date of the ceremony, or null when the page does not say yet. */
  date: string | null;
  host: string | null;
  location: string | null;
  mostNominations: string | null;
  mostAwards: string | null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function iso(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "February 1, 2026", "1 February 2026", "November 28–29, 2025" or {{start date|2026|02|28}}. */
export function parseWikiDate(raw: string): string | null {
  const template = raw.match(/\{\{\s*start date(?: and age)?\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
  if (template) return iso(+template[1], +template[2], +template[3]);

  const monthNames = MONTHS.join('|');
  const american = raw.match(new RegExp(`(${monthNames})\\s+(\\d{1,2})(?:\\s*[–-]\\s*\\d{1,2})?,?\\s+(\\d{4})`, 'i'));
  if (american) return iso(+american[3], MONTHS.indexOf(american[1].toLowerCase()) + 1, +american[2]);

  const british = raw.match(new RegExp(`(\\d{1,2})(?:\\s*[–-]\\s*\\d{1,2})?\\s+(${monthNames}),?\\s+(\\d{4})`, 'i'));
  if (british) return iso(+british[3], MONTHS.indexOf(british[2].toLowerCase()) + 1, +british[1]);

  return null;
}

/** Removes comments and references, which can hold any markup at all. */
function stripNoise(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
}

/** Templates whose last parameter is the text they wrap. */
const WRAPPERS = /^(nowrap|small|nobold|lang|nobr|abbr|sortname|interlanguage link|ill|flagicon)$/i;

/** Plain readable text from a fragment of wiki markup. */
export function cleanWiki(fragment: string): string {
  let text = stripNoise(fragment);

  // Innermost templates first, so nesting unwinds cleanly.
  for (let guard = 0; guard < 20 && /\{\{[^{}]*\}\}/.test(text); guard += 1) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const parts = body.split('|').map((part) => part.trim());
      const name = parts[0];
      if (WRAPPERS.test(name) && parts.length > 1) {
        const kept = parts.slice(1).filter((part) => !/^[a-z-]+\s*=/.test(part));
        return kept[kept.length - 1] ?? '';
      }
      return '';
    });
  }

  return decodeEntities(
    text
      .replace(/\[\[(?:file|image):[^\]]*\]\]/gi, '')
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/'''|''/g, ''),
  )
    .replace(/[‡†*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Link text of every [[link]] in a fragment: the people and acts it names. */
function linkedNames(fragment: string): string[] {
  const names: string[] = [];
  for (const match of fragment.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    const shown = cleanWiki(match[2] ?? match[1]);
    if (shown && !/^(file|image):/i.test(match[1])) names.push(shown);
  }
  return names;
}

export function parseInfobox(wikitext: string): AwardInfobox {
  const text = stripNoise(wikitext);
  const read = (name: string) => {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*\\|\\s*${name}\\s*=([^\\n]*)`, 'i'));
    if (!match) return null;
    const value = cleanWiki(match[1]);
    return value || null;
  };
  const rawDate = text.match(/(?:^|\n)\s*\|\s*date\s*=([^\n]*)/i)?.[1] ?? '';
  return {
    date: parseWikiDate(rawDate),
    host: read('host'),
    location: read('location'),
    mostNominations: read('most_nominations'),
    mostAwards: read('most_awards'),
  };
}

/* ------------------------------------------------------------- tables --- */

interface Row {
  headers: string[];
  cells: string[];
}

/**
 * A cell may open with attributes: `style="…" | content`. The separator is the
 * first pipe that is not inside a link or template.
 */
function cellContent(segment: string): string {
  let depth = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const pair = segment.slice(i, i + 2);
    if (pair === '[[' || pair === '{{') {
      depth += 1;
      i += 1;
    } else if (pair === ']]' || pair === '}}') {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (segment[i] === '|' && depth === 0) {
      const before = segment.slice(0, i);
      if (/=/.test(before) && !/[*[{]/.test(before)) return segment.slice(i + 1);
      return segment;
    }
  }
  return segment;
}

/** Splits `a || b` without breaking the pipes inside links and templates. */
function splitTopLevel(line: string, separator: '||' | '!!'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < line.length; i += 1) {
    const pair = line.slice(i, i + 2);
    if (pair === '[[' || pair === '{{') {
      depth += 1;
      i += 1;
    } else if (pair === ']]' || pair === '}}') {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (pair === separator && depth === 0) {
      parts.push(line.slice(start, i));
      start = i + 2;
      i += 1;
    }
  }
  parts.push(line.slice(start));
  return parts;
}

function readTables(wikitext: string): Row[][] {
  const tables: Row[][] = [];
  let rows: Row[] | null = null;
  let row: Row | null = null;
  let last: { list: string[]; index: number } | null = null;
  let depth = 0;

  const newRow = () => {
    row = { headers: [], cells: [] };
    rows!.push(row);
    last = null;
  };

  for (const rawLine of stripNoise(wikitext).split('\n')) {
    const line = rawLine.trim();

    if (line.startsWith('{|')) {
      depth += 1;
      if (depth === 1) {
        rows = [];
        newRow();
      }
      continue;
    }
    if (!rows) continue;

    if (line.startsWith('|}')) {
      depth -= 1;
      if (depth === 0) {
        tables.push(rows.filter((r) => r.headers.length || r.cells.length));
        rows = null;
        row = null;
        last = null;
      }
      continue;
    }
    // Nested tables are rare and never hold nominee lists; skip their lines.
    if (depth > 1) continue;

    if (line.startsWith('|-')) {
      newRow();
      continue;
    }
    if (line.startsWith('|+')) continue;

    const current = row as Row | null;
    if (!current) continue;

    if (line.startsWith('!')) {
      for (const segment of splitTopLevel(line.slice(1), '!!')) {
        current.headers.push(cellContent(segment).trim());
      }
      last = { list: current.headers, index: current.headers.length - 1 };
      continue;
    }
    if (line.startsWith('|')) {
      for (const segment of splitTopLevel(line.slice(1), '||')) {
        current.cells.push(cellContent(segment));
      }
      last = { list: current.cells, index: current.cells.length - 1 };
      continue;
    }

    const target = last as { list: string[]; index: number } | null;
    if (target) target.list[target.index] += `\n${rawLine}`;
  }

  return tables;
}

/* ----------------------------------------------------------- nominees --- */

const WINNER_MARK = /\{\{\s*(blue ribbon|double[- ]dagger|won|winner)\s*\}\}|‡/i;

/** Whether a fragment opens with a quoted or italic title rather than a name. */
function looksLikeWork(side: string): boolean {
  const opening = side.replace(/^\s*(?:<[^>]+>|\{\{[^}]*\}\}|\s)*/, '').replace(/^'''(?!')/, '');
  return /^("|“|''(?!')|'''''(?!'))/.test(opening);
}

/** "Artist – "Song"" or ""Song" – Artist": whichever side is quoted or italic is the work. */
function splitCredit(raw: string): { creditRaw: string; workRaw: string | null } {
  const parts = raw.split(/\s+'*[–—-]'*\s+/);
  if (parts.length < 2) {
    return looksLikeWork(raw) ? { creditRaw: '', workRaw: raw } : { creditRaw: raw, workRaw: null };
  }
  const left = parts[0];
  const right = parts.slice(1).join(' – ');
  if (looksLikeWork(left) && !looksLikeWork(right)) return { creditRaw: right, workRaw: left };
  return { creditRaw: left, workRaw: right };
}

const ROLES = /,\s*(?:songwriters?|producers?|composers?|lyricists?|engineers?|mixers?|arrangers?)\b[^(]*/i;

/**
 * Songwriting and production categories credit the people behind a record:
 * "Edgar Barrera & Karol G, songwriters (Karol G)". The performer in brackets is
 * who a listener knows, so they lead; otherwise the roles are trimmed off.
 */
function tidyCredit(raw: string): { credit: string; artists: string[] } {
  const first = raw.split(';')[0];
  const performer = first.match(new RegExp(`${ROLES.source}\\s*\\(([\\s\\S]+)\\)\\s*'*\\s*$`, 'i'));
  const source = performer ? performer[1] : first.replace(ROLES, '');
  const credit = cleanWiki(source);
  const linked = linkedNames(source);
  return { credit, artists: linked.length ? linked : credit ? [credit] : [] };
}

function toNominee(line: string, detail: string | null): Nominee | null {
  const body = line.replace(/^\*+\s*/, '');
  const winner = WINNER_MARK.test(body) || /^\s*(?:\{\{[^}]*\}\}\s*)*'''/.test(body);
  const split = splitCredit(body);
  let creditRaw = split.creditRaw;
  // A title on its own, with who made it on the indented line below.
  if (!cleanWiki(creditRaw) && detail) creditRaw = detail.replace(/^\*+\s*/, '');
  const { credit, artists } = tidyCredit(creditRaw);
  const work = split.workRaw ? cleanWiki(split.workRaw).replace(/^["“]|["”]$/g, '') || null : null;
  if (!credit && !work) return null;
  return { credit: credit || work!, work: credit ? work : null, artists, winner };
}

function nomineesIn(cell: string): Nominee[] {
  const bullets = cell
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('*'));
  const isTop = (line: string) => /^\*[^*]/.test(line);
  const isNested = (line: string) => /^\*\*[^*]/.test(line);
  const top = bullets.filter(isTop);
  const nested = bullets.filter(isNested);

  // A single winner up top with the rest of the field indented beneath it.
  if (top.length === 1 && nested.length >= 2) {
    const nominees = [top[0], ...nested]
      .map((line) => toNominee(line, null))
      .filter((n): n is Nominee => !!n);
    if (nominees.length) nominees[0].winner = true;
    return nominees;
  }

  const nominees: Nominee[] = [];
  bullets.forEach((line, index) => {
    if (!isTop(line)) return;
    const next = bullets[index + 1];
    const nominee = toNominee(line, next && isNested(next) ? next : null);
    if (nominee) nominees.push(nominee);
  });
  return nominees;
}

function categoryInCell(cell: string): string | null {
  const match = cell.match(/\{\{\s*award category\s*\|[^|]*\|([\s\S]*?)\}\}\s*\n/i);
  if (!match) return null;
  return cleanWiki(match[1].split(/<br\s*\/?>/i)[0]) || null;
}

function categoryName(header: string): string {
  return cleanWiki(header.split(/<br\s*\/?>/i)[0]);
}

export function parseAwardCategories(wikitext: string): AwardCategory[] {
  const categories: AwardCategory[] = [];
  const seen = new Set<string>();

  for (const table of readTables(wikitext)) {
    let headers: string[] = [];
    for (const row of table) {
      if (row.headers.length) headers = row.headers;
      row.cells.forEach((cell, index) => {
        const name = categoryInCell(cell) ?? (headers[index] ? categoryName(headers[index]) : null);
        if (!name) return;
        const nominees = nomineesIn(cell);
        if (nominees.length < 2 && !nominees.some((n) => n.winner)) return;
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        categories.push({ name, nominees });
      });
    }
  }
  return categories;
}
