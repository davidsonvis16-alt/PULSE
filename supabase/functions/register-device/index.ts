/**
 * Registering a phone for music news.
 *
 * The app sends its push token here rather than writing to the database, so
 * that no device can ever read or change another device's row: the table is
 * closed to the anon key and only this function, holding the service role,
 * touches it.
 *
 * What a device may send is deliberately small: a token, a platform, which
 * kinds of alert it wants, and — only if the person turned personalisation on
 * — the names of the artists in their library. No listening history, no track
 * ids, no account required. Turning personalisation off sends an empty list,
 * which erases what was stored.
 *
 * Deploy:
 *   supabase functions deploy register-device
 */

const TOPICS = new Set(['breaking', 'awards', 'new-music']);
const MAX_ARTISTS = 300;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Expo tokens look like ExponentPushToken[xxxxxxxx] or ExpoPushToken[...]. */
function isExpoToken(value: unknown): value is string {
  return typeof value === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(value);
}

function cleanArtists(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim().slice(0, 80))
    .filter((name) => name.length > 1);
  return [...new Set(names)].slice(0, MAX_ARTISTS);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Server is not configured.' }, 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }

  const token = body.token;
  if (!isExpoToken(token)) return json({ error: 'That is not an Expo push token.' }, 400);

  const platform = body.platform;
  if (platform !== 'ios' && platform !== 'android' && platform !== 'web') {
    return json({ error: 'Unknown platform.' }, 400);
  }

  const topics = Array.isArray(body.topics)
    ? body.topics.filter((topic): topic is string => typeof topic === 'string' && TOPICS.has(topic))
    : [...TOPICS];

  const row = {
    token,
    platform,
    enabled: body.enabled === false ? false : true,
    topics,
    artists: cleanArtists(body.artists),
    country: typeof body.country === 'string' ? body.country.slice(0, 2).toLowerCase() : null,
    last_seen_at: new Date().toISOString(),
  };

  // A signed-in user's id, when the app sent its session, so the row can be
  // tidied away if the account is deleted. Never required.
  let userId: string | null = null;
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: serviceKey },
    }).catch(() => null);
    if (response?.ok) {
      const user = (await response.json().catch(() => null)) as { id?: string } | null;
      userId = user?.id ?? null;
    }
  }

  const upsert = await fetch(`${url}/rest/v1/push_devices?on_conflict=token`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ ...row, user_id: userId }),
  });

  if (!upsert.ok) {
    return json({ error: 'Could not save this device.', detail: await upsert.text() }, 502);
  }
  return json({ ok: true });
});
