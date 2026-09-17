/**
 * Reading music news feeds.
 *
 * Publishers syndicate their headlines as RSS: a title, a link back to the
 * article, a short standfirst and usually a picture. Pulse shows exactly that
 * and nothing more. The full story always opens on the publisher's own site,
 * with the publisher named on every card.
 *
 * Feeds are regular enough that a small, forgiving reader beats pulling in an
 * XML library: each <item> is cut out and its few fields read by pattern.
 */

export type NewsTopic = 'new-music' | 'awards' | 'tours' | 'charts' | 'memoriam' | 'news';

export interface NewsItem {
  /** The article's own address, which is also what makes it unique. */
  id: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string | null;
  /** Epoch ms; 0 when the feed gave no usable date. */
  publishedAt: number;
  source: string;
  author: string | null;
  topic: NewsTopic;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(point)) return match;
      const char = String.fromCodePoint(point);
      return char === ' ' ? ' ' : char;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** Text with markup, entities and runs of whitespace removed. */
export function plainText(value: string): string {
  return decodeEntities(
    unwrapCdata(value)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function field(item: string, tag: string): string | null {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1] : null;
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? decodeEntities(match[1]) : null;
}

/**
 * The best picture a feed item offers: its declared media first, then the
 * first real image inside the article body. Lazy-loading sites leave `src`
 * empty and put the address in `data-lazy-src`, so both are read.
 */
function imageOf(item: string): string | null {
  const media = item.match(/<media:(?:thumbnail|content)\b[^>]*\burl\s*=\s*"[^"]+"[^>]*>/gi) ?? [];
  for (const tag of media) {
    const medium = attribute(tag, 'medium');
    const type = attribute(tag, 'type');
    if (medium && medium !== 'image') continue;
    if (type && !type.startsWith('image')) continue;
    const url = attribute(tag, 'url');
    if (url) return fullSizeImage(url);
  }

  const enclosure = item.match(/<enclosure\b[^>]*>/i)?.[0];
  if (enclosure && (attribute(enclosure, 'type') ?? '').startsWith('image')) {
    const url = attribute(enclosure, 'url');
    if (url) return fullSizeImage(url);
  }

  const body = unwrapCdata(field(item, 'content:encoded') ?? field(item, 'description') ?? '');
  for (const img of body.match(/<img\b[^>]*>/gi) ?? []) {
    const url = attribute(img, 'data-lazy-src') || attribute(img, 'src');
    if (url && /^https?:\/\//.test(url)) return fullSizeImage(url);
  }
  return null;
}

/**
 * Feeds often point at a thumbnail. WordPress serves the original at the same
 * address without the resize query, which is what a full-width poster needs.
 */
function fullSizeImage(url: string): string {
  if (/\/wp-content\/uploads\//.test(url)) return url.split('?')[0];
  return url;
}

const TOPIC_RULES: { topic: NewsTopic; pattern: RegExp }[] = [
  { topic: 'memoriam', pattern: /\b(dies|died|dead|death|passed away|rip|in memoriam|obituary|funeral)\b/i },
  {
    topic: 'awards',
    pattern: /\b(grammys?|awards?(?!-winning)|nominat\w*|nominees?|vmas?|brits?|bet awards|headies|amas|cmas|mobos?|oscars?)\b/i,
  },
  { topic: 'charts', pattern: /\b(charts?|hot 100|billboard 200|no\. ?1|number one|debuts at|tops the)\b/i },
  { topic: 'tours', pattern: /\b(tour|tours|touring|concerts?|festivals?|residency|shows|live dates|lineup)\b/i },
  {
    topic: 'new-music',
    pattern: /\b(album|albums|single|ep|lp|mixtape|new song|new music|debut|releases?|drops?|shares new|surprise-releases?)\b/i,
  },
];

export function topicOf(title: string, summary = ''): NewsTopic {
  // The headline decides; the standfirst only breaks a tie.
  for (const text of [title, `${title} ${summary}`]) {
    for (const rule of TOPIC_RULES) {
      if (rule.pattern.test(text)) return rule.topic;
    }
  }
  return 'news';
}

export function parseFeed(xml: string, source: string, limit = 30): NewsItem[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const parsed: NewsItem[] = [];

  for (const item of items.slice(0, limit)) {
    const title = plainText(field(item, 'title') ?? '');
    const url = plainText(field(item, 'link') ?? '') || plainText(field(item, 'guid') ?? '');
    if (!title || !/^https?:\/\//.test(url)) continue;

    let summary = plainText(field(item, 'description') ?? '');
    // Some feeds put the whole article in the description.
    if (summary.length > 260) summary = `${summary.slice(0, 250).replace(/\s+\S*$/, '')}…`;
    // …and some end it with "The post X appeared first on Y".
    summary = summary.replace(/\s*The post .* appeared first on .*$/i, '').trim();

    const date = Date.parse(plainText(field(item, 'pubDate') ?? field(item, 'dc:date') ?? ''));
    const author = plainText(field(item, 'dc:creator') ?? '') || null;

    parsed.push({
      id: url,
      title,
      summary,
      url,
      imageUrl: imageOf(item),
      publishedAt: Number.isFinite(date) ? date : 0,
      source,
      author,
      topic: topicOf(title, summary),
    });
  }
  return parsed;
}

/** True when a headline or standfirst names this artist as a whole word. */
export function mentionsArtist(item: Pick<NewsItem, 'title' | 'summary'>, artist: string): boolean {
  const name = artist.trim();
  if (name.length < 3) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(
    `${item.title} ${item.summary}`,
  );
}
