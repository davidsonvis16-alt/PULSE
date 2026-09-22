import { mentionsArtist, type NewsItem } from './rss.ts';
import { type AwardCategory } from './wikitext.ts';
import { statusFrom, withThe } from './award-series.ts';

/**
 * Deciding what is worth interrupting someone for.
 *
 * Kept apart from the job that fetches and sends so the decisions can be
 * exercised directly: given today's feeds and award pages, exactly these
 * alerts and no others.
 *
 * The rules are deliberately strict. An alert has to be either something
 * everyone in music is talking about — measured by how many publications are
 * running it, not by anyone's opinion — or something about this particular
 * listener's own artists.
 */

/** A story must be this widely covered before it counts as breaking. */
export const BREAKING_OUTLETS = 3;
/** Nothing older than this is ever pushed, however big. */
export const MAX_STORY_AGE_MS = 12 * 60 * 60 * 1000;

export interface Device {
  token: string;
  topics: string[];
  artists: string[];
}

export interface Edition {
  id: string;
  shortName: string;
  title: string;
  date: string | null;
  mostNominations: string | null;
  categories: AwardCategory[];
}

export type Topic = 'breaking' | 'awards' | 'new-music';

export interface Alert {
  key: string;
  kind: string;
  topic: Topic;
  title: string;
  body: string;
  /** Where tapping it should land in the app. */
  data: Record<string, string>;
  /** When set, only devices listing one of these artists are told. */
  forArtists?: string[];
}

export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function breakingStories(items: NewsItem[], now: number): Alert[] {
  const byStory = new Map<string, { item: NewsItem; sources: Set<string> }>();
  for (const item of items) {
    if (!item.publishedAt || now - item.publishedAt > MAX_STORY_AGE_MS) continue;
    const words = normalise(item.title).split(' ').filter((word) => word.length > 3);
    const key = words.slice(0, 6).sort().join(' ');
    let group = byStory.get(key);
    if (!group) {
      // Stories are matched loosely: the same event, different wording.
      group = [...byStory.values()].find((candidate) => {
        const other = new Set(normalise(candidate.item.title).split(' '));
        const shared = words.filter((word) => other.has(word)).length;
        return shared >= 3;
      });
    }
    if (group) {
      group.sources.add(item.source);
      if (!group.item.imageUrl && item.imageUrl) group.item = item;
    } else {
      byStory.set(key, { item, sources: new Set([item.source]) });
    }
  }

  return [...byStory.values()]
    .filter((group) => group.sources.size >= BREAKING_OUTLETS)
    .map(({ item, sources }) => ({
      key: `story:${item.url}`,
      kind: 'breaking',
      topic: 'breaking' as Topic,
      title: item.title,
      body: `${[...sources].slice(0, 3).join(', ')} and others are running this story.`,
      data: { url: item.url, tab: 'news' },
    }));
}

export function artistStories(items: NewsItem[], now: number): Alert[] {
  const alerts: Alert[] = [];
  for (const item of items) {
    if (!item.publishedAt || now - item.publishedAt > MAX_STORY_AGE_MS) continue;
    alerts.push({
      key: `story:${item.url}`,
      kind: 'artist-story',
      topic: 'breaking',
      title: item.title,
      body: `${item.source} · about an artist you listen to`,
      data: { url: item.url, tab: 'news' },
      // Filled in per device: the story is only sent to someone whose own
      // artists it names.
      forArtists: ['*'],
    });
  }
  return alerts;
}

export function awardAlerts(editions: Edition[], now: number): Alert[] {
  const alerts: Alert[] = [];

  for (const edition of editions) {
    const hasWinners = edition.categories.some((c) => c.nominees.some((n) => n.winner));
    const status = statusFrom(edition.date, hasWinners, edition.categories.length > 0, now);
    const route = `/awards/${encodeURIComponent(edition.id)}`;

    if (status === 'today') {
      alerts.push({
        key: `award:${edition.id}|today`,
        kind: 'award-today',
        topic: 'awards',
        title: `${withThe(edition.shortName).replace(/^the\b/, 'The')} are on today`,
        body: edition.categories.length
          ? `${edition.categories.length} categories. See who is nominated.`
          : 'Tonight is the night.',
        data: { route, tab: 'news' },
      });
    }

    if (status === 'winners') {
      alerts.push({
        key: `award:${edition.id}|winners`,
        kind: 'award-winners',
        topic: 'awards',
        title: `Winners are in from the ${edition.title}`,
        body: 'Every category, and who took it.',
        data: { route, tab: 'news' },
      });
      // Personal: an artist they listen to actually won.
      for (const category of edition.categories) {
        for (const nominee of category.nominees.filter((n) => n.winner)) {
          alerts.push({
            key: `award:${edition.id}|won|${normalise(nominee.artists[0] ?? nominee.credit)}`,
            kind: 'award-won',
            topic: 'awards',
            title: `${nominee.artists[0] ?? nominee.credit} won ${category.name}`,
            body: `At the ${edition.title}.`,
            data: { route, tab: 'news' },
            forArtists: nominee.artists,
          });
        }
      }
    }

    if (status === 'nominees') {
      alerts.push({
        key: `award:${edition.id}|nominees`,
        kind: 'award-nominees',
        topic: 'awards',
        title: `Nominees are out for the ${edition.title}`,
        body: edition.mostNominations
          ? `Most nominated: ${edition.mostNominations}.`
          : `${edition.categories.length} categories announced.`,
        data: { route, tab: 'news' },
      });

      const nominated = new Map<string, string[]>();
      for (const category of edition.categories) {
        for (const nominee of category.nominees) {
          for (const artist of nominee.artists) {
            const list = nominated.get(artist) ?? [];
            if (!list.includes(category.name)) list.push(category.name);
            nominated.set(artist, list);
          }
        }
      }
      for (const [artist, categories] of nominated) {
        alerts.push({
          key: `award:${edition.id}|nominated|${normalise(artist)}`,
          kind: 'award-nominated',
          topic: 'awards',
          title: `${artist} is nominated at ${withThe(edition.shortName)}`,
          body:
            categories.length > 1
              ? `${categories.length} nominations, including ${categories[0]}.`
              : categories[0],
          data: { route, tab: 'news' },
          forArtists: [artist],
        });
      }
    }
  }

  return alerts;
}

/** Who should get this alert: the topic they asked for, and their own artists. */
export function recipientsFor(alert: Alert, all: Device[], stories: NewsItem[]): Device[] {
  return all.filter((device) => {
    if (!device.topics.includes(alert.topic)) return false;
    if (!alert.forArtists) return true;
    if (device.artists.length === 0) return false;

    if (alert.forArtists[0] === '*') {
      // An artist story: it is personal only if it names one of theirs.
      const item = stories.find((story) => story.url === alert.data.url);
      return !!item && device.artists.some((artist) => mentionsArtist(item, artist));
    }
    const wanted = new Set(alert.forArtists.map(normalise));
    return device.artists.some((artist) => wanted.has(normalise(artist)));
  });
}
