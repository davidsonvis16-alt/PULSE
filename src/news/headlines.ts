import { getText } from '@/src/core/http';
import { parseFeed, mentionsArtist, type NewsItem } from '@/src/news/rss';

/**
 * The day's music headlines.
 *
 * Several publications cover the same big story, so stories are grouped: one
 * card per story, keeping the version with a picture, and noting how many
 * outlets ran it. That count is a real signal of how big a story is.
 */

const FEEDS: { source: string; url: string }[] = [
  { source: 'Billboard', url: 'https://www.billboard.com/c/music/music-news/feed/' },
  { source: 'Pitchfork', url: 'https://pitchfork.com/feed/feed-news/rss' },
  { source: 'NME', url: 'https://www.nme.com/news/music/feed' },
  { source: 'Rolling Stone', url: 'https://www.rollingstone.com/music/music-news/feed/' },
  { source: 'Consequence', url: 'https://consequence.net/category/music/feed/' },
  { source: 'Stereogum', url: 'https://www.stereogum.com/category/news/feed/' },
];

const MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;
const TTL_MS = 20 * 60 * 1000;

export interface Story extends NewsItem {
  /** Every outlet that ran this story, the card's own source first. */
  sources: string[];
  /** Artists from the listener's library the story names. */
  mentions: string[];
}

const STOP = new Set(
  'the a an and or of to in on for with at by from after over as is are was his her their its new says'.split(' '),
);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

function sameStory(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.45;
}

/** Groups near-identical headlines from different outlets into one story. */
export function groupStories(items: NewsItem[], artistNames: string[] = []): Story[] {
  const sorted = [...items].sort((a, b) => b.publishedAt - a.publishedAt);
  const groups: { story: Story; words: Set<string> }[] = [];

  for (const item of sorted) {
    const itemWords = words(item.title);
    const group = groups.find((g) => sameStory(g.words, itemWords));
    if (group) {
      if (!group.story.sources.includes(item.source)) group.story.sources.push(item.source);
      // Prefer a version with a picture for the card.
      if (!group.story.imageUrl && item.imageUrl) {
        const sources = group.story.sources;
        group.story = { ...item, sources: [item.source, ...sources.filter((s) => s !== item.source)], mentions: [] };
      }
      continue;
    }
    groups.push({ story: { ...item, sources: [item.source], mentions: [] }, words: itemWords });
  }

  return groups.map(({ story }) => ({
    ...story,
    mentions: artistNames.filter((name) => mentionsArtist(story, name)).slice(0, 3),
  }));
}

export async function getHeadlines(
  options: { artistNames?: string[]; fresh?: boolean } = {},
): Promise<Story[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) =>
      parseFeed(
        await getText(feed.url, { ttlMs: options.fresh ? 0 : TTL_MS, timeoutMs: 15000 }),
        feed.source,
      ),
    ),
  );
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  if (items.length === 0 && results.every((r) => r.status === 'rejected')) {
    throw new Error('Could not reach the news right now.');
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  const recent = items.filter((item) => !item.publishedAt || item.publishedAt >= cutoff);
  return groupStories(recent, options.artistNames ?? []);
}
