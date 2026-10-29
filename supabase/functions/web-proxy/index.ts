/**
 * Pulse web relay.
 *
 * The phone apps call the catalogue, charts and music-press feeds directly.
 * A browser cannot: most of those services do not send the CORS headers a web
 * page needs, so the web version of Pulse asks this function instead, and this
 * function asks them.
 *
 * It is deliberately narrow: GET only, a fixed list of hosts, small responses,
 * and a per-caller rate limit, so it cannot be used as a general open proxy.
 *
 * Deploy:
 *   supabase functions deploy web-proxy
 */

const ALLOWED_HOSTS = new Set([
  'itunes.apple.com',
  'rss.marketingtools.apple.com',
  'rss.applemarketingtools.com',
  'en.wikipedia.org',
  'api.deezer.com',
  'www.theaudiodb.com',
  'www.rollingstone.com',
  'www.stereogum.com',
  'www.nme.com',
  'www.billboard.com',
  'pitchfork.com',
  'consequence.net',
]);

const MAX_BYTES = 3 * 1024 * 1024;
const RATE_LIMIT = 240;
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
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  // The web app is cross-origin isolated; this lets it read the answer.
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function fail(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'GET') return fail('Method not allowed', 405);

  const caller = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anonymous';
  if (rateLimited(caller)) return fail('Too many requests. Try again in a minute.', 429);

  let target: URL;
  try {
    target = new URL(new URL(request.url).searchParams.get('url') ?? '');
  } catch {
    return fail('Missing or invalid url', 400);
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return fail('That address is not one Pulse uses', 403);
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        Accept: request.headers.get('accept') ?? '*/*',
        'User-Agent': 'Pulse/1.0 (web relay)',
      },
      redirect: 'follow',
    });
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return fail('Response too large', 502);
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=300',
        ...CORS_HEADERS,
      },
    });
  } catch {
    return fail('The source did not answer', 502);
  }
});
