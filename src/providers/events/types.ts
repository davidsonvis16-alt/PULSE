import type { GeoPoint, MusicEvent, TicketInfo } from '@/src/core/types';

/**
 * Everything Pulse asks a live-events source for.
 *
 * Pulse never invents a concert or a ticket price. If no provider is
 * configured, `isConfigured` is false and the Events screen says so plainly
 * instead of filling itself with plausible-looking nonsense.
 */
export interface EventProvider {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;
  /** False until the deployment supplies credentials for this source. */
  isConfigured(): boolean;
  /** Human-readable reason shown in the empty state when not configured. */
  setupHint(): string;

  searchEvents(query: EventQuery): Promise<MusicEvent[]>;
  nearbyEvents(point: GeoPoint, query?: EventQuery): Promise<MusicEvent[]>;
  getEvent(id: string): Promise<MusicEvent | null>;
  getTicketInformation(id: string): Promise<TicketInfo | null>;
}

export interface EventQuery {
  /** Free text: artist, festival or event name. */
  term?: string;
  artistName?: string;
  city?: string;
  countryCode?: string;
  genre?: string | null;
  /** ISO date strings, inclusive. */
  startDate?: string | null;
  endDate?: string | null;
  radiusKm?: number;
  limit?: number;
  signal?: AbortSignal;
}
