import { db, now } from '@/src/db/client';
import type { MusicEvent } from '@/src/core/types';

/**
 * Cache of provider event results.
 *
 * Purely a cache: it lets the Events screen show the last known listings when
 * the device is offline, clearly marked as such. Nothing is ever synthesised.
 */

export async function cacheEvents(events: MusicEvent[]) {
  if (events.length === 0) return;
  const instance = await db();
  await instance.withTransactionAsync(async () => {
    for (const event of events) {
      await instance.runAsync(
        `INSERT OR REPLACE INTO events_cache
           (id, provider, name, artist_names, venue_name, city, country, starts_at, image_url,
            genre, latitude, longitude, payload, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          event.id,
          event.provider,
          event.name,
          event.artistNames.join(', '),
          event.venueName,
          event.city,
          event.country,
          event.startsAt,
          event.imageUrl,
          event.genre,
          event.latitude,
          event.longitude,
          JSON.stringify(event),
          now(),
        ],
      );
      if (event.ticket) {
        await instance.runAsync(
          `INSERT OR REPLACE INTO ticket_sources
             (event_id, seller_name, url, status, price_min, price_max, currency, on_sale_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            event.id,
            event.ticket.sellerName,
            event.ticket.url,
            event.ticket.status,
            event.ticket.priceMin,
            event.ticket.priceMax,
            event.ticket.currency,
            event.ticket.onSaleAt,
          ],
        );
      }
    }
  });
}

export async function getCachedEvents(options: { city?: string | null; limit?: number } = {}) {
  const instance = await db();
  const rows = options.city
    ? await instance.getAllAsync<{ payload: string }>(
        'SELECT payload FROM events_cache WHERE city = ? COLLATE NOCASE ORDER BY starts_at ASC LIMIT ?;',
        [options.city, options.limit ?? 40],
      )
    : await instance.getAllAsync<{ payload: string }>(
        'SELECT payload FROM events_cache ORDER BY starts_at ASC LIMIT ?;',
        [options.limit ?? 40],
      );
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.payload) as MusicEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is MusicEvent => !!e);
}

export async function getCachedEvent(id: string): Promise<MusicEvent | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM events_cache WHERE id = ?;',
    [id],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as MusicEvent;
  } catch {
    return null;
  }
}

export async function pruneStaleEvents(maxAgeMs = 24 * 3600 * 1000) {
  const instance = await db();
  await instance.runAsync('DELETE FROM events_cache WHERE cached_at < ?;', [now() - maxAgeMs]);
}
