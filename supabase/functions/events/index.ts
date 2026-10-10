/**
 * Pulse events proxy.
 *
 * The Ticketmaster Discovery key must never reach a phone, so the app calls
 * this function instead and this function calls Ticketmaster. It also:
 *
 *  - validates every query parameter before forwarding anything,
 *  - rate-limits per caller so one device cannot burn the shared quota,
 *  - passes the provider's response through untouched, so Pulse renders real
 *    listings and never anything this layer invented.
 *
 * Deploy:
 *   supabase secrets set TICKETMASTER_API_KEY=...
 *   supabase functions deploy events
 *
 * Then set EXPO_PUBLIC_EVENTS_PROXY_URL to the function URL (or just set
 * EXPO_PUBLIC_SUPABASE_URL and Pulse will derive it).
 */

const TICKETMASTER_BASE = 'https://app.ticketmaster.com/discovery/v2';

const ALLOWED_PARAMS = new Set([
  'keyword',
  'city',
  'countryCode',
  'classificationName',
  'startDateTime',
  'endDateTime',
  'latlong',
  'radius',
  'unit',
  'size',
  'page',
  'sort',
]);

const MAX_SIZE = 50;

/** Requests allowed per caller per window. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Rejects anything that is not a plain, short, single-line value. */
function sanitize(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  if (/[\r\n<>]/.test(trimmed)) return null;
  return trimmed;
}

function buildQuery(url: URL, apiKey: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, raw] of url.searchParams.entries()) {
    if (!ALLOWED_PARAMS.has(key)) continue;
    const value = sanitize(raw);
    if (value === null) continue;
    if (key === 'size') {
      const size = Math.min(MAX_SIZE, Math.max(1, Number(value) || 20));
      params.set('size', String(size));
      continue;
    }
    if (key === 'latlong' && !/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(value)) continue;
    if (key === 'radius' && !/^\d{1,4}$/.test(value)) continue;
    params.set(key, value);
  }
  // Music only: Pulse is not a general ticketing app.
  if (!params.has('classificationName')) params.set('classificationName', 'music');
  params.set('apikey', apiKey);
  return params;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const apiKey = Deno.env.get('TICKETMASTER_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'The events provider is not configured. Set TICKETMASTER_API_KEY.' },
      503,
    );
  }

  const callerKey =
    request.headers.get('authorization')?.slice(-24) ??
    request.headers.get('x-forwarded-for') ??
    'anonymous';
  if (rateLimited(callerKey)) {
    return json({ error: 'Too many requests. Try again in a minute.' }, 429);
  }

  const url = new URL(request.url);
  const action = url.pathname.split('/').filter(Boolean).pop();

  try {
    if (action === 'event') {
      const id = sanitize(url.searchParams.get('id') ?? '');
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return json({ error: 'Invalid event id' }, 400);
      const response = await fetch(
        `${TICKETMASTER_BASE}/events/${encodeURIComponent(id)}.json?apikey=${apiKey}`,
      );
      if (!response.ok) return json({ error: 'Event lookup failed' }, response.status);
      return json(await response.json());
    }

    // Default: search.
    const params = buildQuery(url, apiKey);
    const response = await fetch(`${TICKETMASTER_BASE}/events.json?${params.toString()}`);
    if (!response.ok) {
      return json({ error: 'Event search failed' }, response.status);
    }
    return json(await response.json());
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unexpected proxy error' },
      502,
    );
  }
});
