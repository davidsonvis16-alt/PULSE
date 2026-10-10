import { parseFeed, type NewsItem } from '../_shared/rss.ts';
import { parseAwardCategories, parseInfobox } from '../_shared/wikitext.ts';
import { isInSeason, plannedEditions, seriesById } from '../_shared/award-series.ts';
import {
  artistStories,
  awardAlerts,
  breakingStories,
  recipientsFor,
  type Alert,
  type Device,
  type Edition,
} from '../_shared/alerts.ts';

/**
 * The push job.
 *
 * Runs on a schedule, looks at the same sources the app's news page uses, and
 * decides whether anything is worth interrupting someone for. It parses feeds
 * and award pages with the very same modules the app does, so a story is
 * classified identically on both sides.
 *
 * What earns a push, and nothing else does:
 *
 *  - a story at least three publications are running (that is what "breaking"
 *    means without anyone deciding it by hand);
 *  - a ceremony happening today, its nominees being announced, or its winners
 *    being read out;
 *  - for devices that turned personalisation on: their own artists nominated,
 *    winning, or named in a story.
 *
 * Every alert is keyed, and the key is written to `push_sent` before anything
 * is delivered, so a repeat run says nothing twice.
 *
 * Deploy:
 *   supabase functions deploy music-news-push
 *   supabase secrets set PUSH_JOB_SECRET=<a long random string>
 */

const FEEDS: { source: string; url: string }[] = [
  { source: 'Billboard', url: 'https://www.billboard.com/c/music/music-news/feed/' },
  { source: 'Pitchfork', url: 'https://pitchfork.com/feed/feed-news/rss' },
  { source: 'NME', url: 'https://www.nme.com/news/music/feed' },
  { source: 'Rolling Stone', url: 'https://www.rollingstone.com/music/music-news/feed/' },
  { source: 'Consequence', url: 'https://consequence.net/category/music/feed/' },
  { source: 'Stereogum', url: 'https://www.stereogum.com/category/news/feed/' },
];

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/** Ceiling on alerts actually delivered in one run, so a quiet night cannot
 *  turn into a burst. Alerts nobody is listening for do not count. */
const MAX_ALERTS = 8;

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const restHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function alreadySent(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const query = `key=in.(${keys.map((key) => `"${key.replace(/"/g, '')}"`).join(',')})`;
  const response = await fetch(`${url}/rest/v1/push_sent?select=key&${query}`, {
    headers: restHeaders,
  });
  if (!response.ok) return new Set();
  const rows = (await response.json()) as { key: string }[];
  return new Set(rows.map((row) => row.key));
}

async function recordSent(alert: Alert, recipients: number) {
  await fetch(`${url}/rest/v1/push_sent`, {
    method: 'POST',
    headers: { ...restHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ key: alert.key, kind: alert.kind, title: alert.title, recipients }),
  }).catch(() => {});
}

async function devices(): Promise<Device[]> {
  const response = await fetch(
    `${url}/rest/v1/push_devices?select=token,topics,artists&enabled=is.true`,
    { headers: restHeaders },
  );
  if (!response.ok) return [];
  return (await response.json()) as Device[];
}

/* --------------------------------------------------------------- sources */

async function headlines(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const response = await fetch(feed.url, {
        headers: { 'User-Agent': 'PulseMusic/1.0 (+news alerts)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`${feed.source} ${response.status}`);
      return parseFeed(await response.text(), feed.source);
    }),
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

async function awardEditions(now: number): Promise<Edition[]> {
  const planned = plannedEditions(now);
  const titles = [...planned.keys()];
  const editions: Edition[] = [];

  for (let i = 0; i < titles.length; i += 10) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      redirects: '1',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: titles.slice(i, i + 10).join('|'),
    });
    const response = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'Api-User-Agent': 'PulseMusic/1.0 (+news alerts)' },
      signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    if (!response?.ok) continue;

    const data = (await response.json().catch(() => null)) as {
      query?: {
        pages?: { title: string; missing?: boolean; revisions?: { slots?: { main?: { content?: string } } }[] }[];
        redirects?: { from: string; to: string }[];
      };
    } | null;

    for (const page of data?.query?.pages ?? []) {
      if (page.missing || !/\d/.test(page.title)) continue;
      const requested = data?.query?.redirects?.find((r) => r.to === page.title)?.from ?? page.title;
      const match = planned.get(requested) ?? planned.get(page.title);
      const series = match ? seriesById(match.seriesId) : undefined;
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (!series || !content) continue;

      const info = parseInfobox(content);
      if (!isInSeason(info.date, now)) continue;
      editions.push({
        id: page.title,
        shortName: series.shortName,
        title: page.title,
        date: info.date,
        mostNominations: info.mostNominations,
        categories: parseAwardCategories(content),
      });
    }
  }
  return editions;
}

async function deliver(alert: Alert, tokens: string[]): Promise<number> {
  let delivered = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const messages = tokens.slice(i, i + 100).map((to) => ({
      to,
      title: alert.title,
      body: alert.body,
      data: alert.data,
      sound: 'default',
      channelId: 'music-news',
      priority: alert.kind === 'breaking' ? 'high' : 'normal',
    }));
    const response = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    }).catch(() => null);
    if (response?.ok) delivered += messages.length;
  }
  return delivered;
}

Deno.serve(async (request) => {
  // The job is not public: it runs from the scheduler with a shared secret.
  const secret = Deno.env.get('PUSH_JOB_SECRET');
  const provided = request.headers.get('x-pulse-job-secret');
  if (!secret || provided !== secret) {
    return new Response(JSON.stringify({ error: 'Not authorised.' }), { status: 401 });
  }
  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server is not configured.' }), { status: 500 });
  }

  const now = Date.now();
  const registered = await devices();
  if (registered.length === 0) return new Response(JSON.stringify({ sent: 0, reason: 'no devices' }));

  const stories = await headlines().catch(() => [] as NewsItem[]);
  const editions = await awardEditions(now).catch(() => [] as Edition[]);

  const candidates = [
    ...awardAlerts(editions, now),
    ...breakingStories(stories, now),
    ...artistStories(stories, now),
  ];

  // A story that is both breaking and personal is one alert, not two.
  const unique = new Map<string, Alert>();
  for (const alert of candidates) if (!unique.has(alert.key)) unique.set(alert.key, alert);

  const fresh = await alreadySent([...unique.keys()]);
  // Everything unsent is considered; the cap applies to what actually goes out.
  const sending = [...unique.values()].filter((alert) => !fresh.has(alert.key));

  const report: { key: string; recipients: number }[] = [];
  let delivered = 0;
  for (const alert of sending) {
    const targets = recipientsFor(alert, registered, stories);
    if (targets.length === 0) {
      // Nobody is listening for this one. Recorded so it is not reconsidered
      // every run, and it does not use up this run's allowance.
      await recordSent(alert, 0);
      continue;
    }
    if (delivered >= MAX_ALERTS) break;
    delivered += 1;
    const count = await deliver(alert, targets.map((device) => device.token));
    await recordSent(alert, count);
    report.push({ key: alert.key, recipients: count });
  }

  return new Response(JSON.stringify({ considered: unique.size, sent: report.length, report }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
