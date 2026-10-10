import { buildUrl, getJson } from '@/src/core/http';
import { config } from '@/src/core/config';
import { entityId, parseEntityId, type GeoPoint, type MusicEvent, type TicketInfo } from '@/src/core/types';
import type { EventProvider, EventQuery } from '@/src/providers/events/types';

/**
 * Ticketmaster Discovery API, reached through Pulse's own server proxy.
 *
 * The app never holds the Ticketmaster key. It calls our edge function, which
 * attaches the key server-side, validates the query and rate-limits per user.
 * See supabase/functions/events/index.ts.
 *
 * Everything shown to the user — venue, date, on-sale status, price range and
 * the ticket link — is passed straight through from Ticketmaster. Pulse adds
 * nothing of its own to a listing.
 */

export const TICKETMASTER_PROVIDER_ID = 'ticketmaster';

const PROVIDER_ID = TICKETMASTER_PROVIDER_ID;

interface ProxyEventsResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalElements?: number };
}

interface TmEvent {
  id: string;
  name: string;
  url?: string;
  images?: { url: string; width: number; height: number; ratio?: string }[];
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string };
    status?: { code?: string };
  };
  sales?: { public?: { startDateTime?: string } };
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  classifications?: { genre?: { name?: string }; segment?: { name?: string } }[];
  _embedded?: {
    venues?: {
      name?: string;
      city?: { name?: string };
      state?: { name?: string; stateCode?: string };
      country?: { name?: string; countryCode?: string };
      location?: { latitude?: string; longitude?: string };
      distance?: number;
    }[];
    attractions?: { name?: string }[];
  };
}

function bestImage(images: TmEvent['images']): string | null {
  if (!images?.length) return null;
  // Prefer a wide, high-resolution still: event cards are landscape.
  const sorted = [...images].sort((a, b) => b.width * b.height - a.width * a.height);
  const wide = sorted.find((i) => i.ratio === '16_9' && i.width >= 640);
  return (wide ?? sorted[0]).url ?? null;
}

function mapTicket(raw: TmEvent): TicketInfo | null {
  if (!raw.url) return null;
  const price = raw.priceRanges?.[0];
  return {
    sellerName: 'Ticketmaster',
    url: raw.url,
    status: raw.dates?.status?.code ?? null,
    priceMin: typeof price?.min === 'number' ? price.min : null,
    priceMax: typeof price?.max === 'number' ? price.max : null,
    currency: price?.currency ?? null,
    onSaleAt: raw.sales?.public?.startDateTime ?? null,
  };
}

function mapEvent(raw: TmEvent): MusicEvent | null {
  if (!raw?.id || !raw?.name) return null;
  const venue = raw._embedded?.venues?.[0];
  const lat = venue?.location?.latitude ? Number(venue.location.latitude) : null;
  const lon = venue?.location?.longitude ? Number(venue.location.longitude) : null;
  return {
    id: entityId(PROVIDER_ID, 'event', raw.id),
    provider: PROVIDER_ID,
    providerEventId: raw.id,
    name: raw.name,
    artistNames: (raw._embedded?.attractions ?? [])
      .map((a) => a.name)
      .filter((n): n is string => !!n),
    venueName: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    region: venue?.state?.stateCode ?? venue?.state?.name ?? null,
    country: venue?.country?.countryCode ?? venue?.country?.name ?? null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    startsAt: raw.dates?.start?.dateTime ?? raw.dates?.start?.localDate ?? null,
    localTimeLabel: raw.dates?.start?.localTime?.slice(0, 5) ?? null,
    imageUrl: bestImage(raw.images),
    genre: raw.classifications?.[0]?.genre?.name ?? null,
    ticket: mapTicket(raw),
    distanceKm: typeof venue?.distance === 'number' ? venue.distance : null,
  };
}

function proxyUrl(path: string, params: Record<string, string | number | undefined | null>) {
  const base = config.events.proxyUrl;
  if (!base) throw new Error('Events proxy is not configured');
  return buildUrl(`${base.replace(/\/$/, '')}/${path}`, params);
}

function authHeaders(): Record<string, string> {
  // The anon key identifies the app to our own edge function; the provider key
  // it uses upstream is never sent from the device.
  const key = config.supabase.anonKey;
  return key ? { apikey: key, Authorization: `Bearer ${key}` } : {};
}

async function query(params: Record<string, string | number | undefined | null>, signal?: AbortSignal) {
  const data = await getJson<ProxyEventsResponse>(proxyUrl('search', params), {
    headers: authHeaders(),
    signal,
    ttlMs: 5 * 60 * 1000,
    rate: { capacity: 5, perSecond: 2 },
  });
  return (data?._embedded?.events ?? []).map(mapEvent).filter((e): e is MusicEvent => !!e);
}

export const ticketmasterProvider: EventProvider = {
  id: PROVIDER_ID,
  name: 'Ticketmaster',
  attribution: 'Event and ticket data from Ticketmaster Discovery',

  isConfigured() {
    return Boolean(config.events.proxyUrl);
  },

  setupHint() {
    return 'Deploy the Pulse events edge function with a Ticketmaster Discovery API key, then set EXPO_PUBLIC_EVENTS_PROXY_URL.';
  },

  async searchEvents(q: EventQuery) {
    if (!this.isConfigured()) return [];
    return query(
      {
        keyword: q.term ?? q.artistName,
        city: q.city,
        countryCode: q.countryCode,
        classificationName: q.genre ?? 'music',
        startDateTime: q.startDate ? `${q.startDate}T00:00:00Z` : undefined,
        endDateTime: q.endDate ? `${q.endDate}T23:59:59Z` : undefined,
        size: q.limit ?? 30,
      },
      q.signal,
    );
  },

  async nearbyEvents(point: GeoPoint, q: EventQuery = {}) {
    if (!this.isConfigured()) return [];
    return query(
      {
        latlong: `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`,
        radius: Math.round(q.radiusKm ?? 80),
        unit: 'km',
        classificationName: q.genre ?? 'music',
        keyword: q.term,
        startDateTime: q.startDate ? `${q.startDate}T00:00:00Z` : undefined,
        endDateTime: q.endDate ? `${q.endDate}T23:59:59Z` : undefined,
        size: q.limit ?? 30,
        sort: 'distance,asc',
      },
      q.signal,
    );
  },

  async getEvent(id: string) {
    if (!this.isConfigured()) return null;
    const raw = parseEntityId(id)?.raw ?? id;
    const data = await getJson<TmEvent>(proxyUrl('event', { id: raw }), {
      headers: authHeaders(),
      ttlMs: 10 * 60 * 1000,
    });
    return data ? mapEvent(data) : null;
  },

  async getTicketInformation(id: string) {
    const event = await this.getEvent(id);
    return event?.ticket ?? null;
  },
};
