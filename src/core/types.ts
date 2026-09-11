/**
 * Pulse domain model.
 *
 * Every entity Pulse shows on screen is normalised into one of these shapes,
 * no matter which MusicProvider it came from. Screens never see provider JSON.
 *
 * Ids are provider-qualified so two providers can coexist in one library:
 *   "itunes:track:1708673518"   "local:track:8f2c..."
 */

export type ProviderId = string;

export type EntityKind = 'track' | 'album' | 'artist' | 'playlist' | 'event';

export function entityId(provider: ProviderId, kind: EntityKind, raw: string | number): string {
  return `${provider}:${kind}:${raw}`;
}

export function parseEntityId(id: string): { provider: ProviderId; kind: EntityKind; raw: string } | null {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  return { provider: parts[0], kind: parts[1] as EntityKind, raw: parts.slice(2).join(':') };
}

export interface Artist {
  id: string;
  provider: ProviderId;
  providerArtistId: string;
  name: string;
  /** Real artwork from the provider. Never a generated placeholder. */
  imageUrl: string | null;
  genre: string | null;
  /** Official page on the source service (opened via the system browser). */
  externalUrl: string | null;
  /** Provider-reported audience size, when the source exposes one. */
  followerLabel?: string | null;
}

export interface Album {
  id: string;
  provider: ProviderId;
  providerAlbumId: string;
  title: string;
  artistName: string;
  artistId: string | null;
  artworkUrl: string | null;
  releaseDate: string | null;
  trackCount: number | null;
  genre: string | null;
  copyright: string | null;
  externalUrl: string | null;
  /** "album" | "single" | "ep" — derived from the source's track count/title. */
  albumType: 'album' | 'single' | 'ep';
}

export interface Track {
  id: string;
  provider: ProviderId;
  providerTrackId: string;
  title: string;
  artistName: string;
  artistId: string | null;
  albumTitle: string | null;
  albumId: string | null;
  artworkUrl: string | null;
  /** Duration of the full recording as published by the source. */
  durationMs: number | null;
  releaseDate: string | null;
  genre: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  explicit: boolean;
  externalUrl: string | null;
}

/**
 * What the configured source will actually give Pulse to play or store.
 * A Track is metadata; a PlayableSource is bytes.
 */
export interface PlayableSource {
  uri: string;
  mimeType: string;
  /** Length of *this asset*, which may be shorter than the full recording. */
  durationMs: number | null;
  /** True when the source only licenses an excerpt (e.g. a 30s preview). */
  isExcerpt: boolean;
  /** Shown verbatim in the UI so the user always knows what they are hearing. */
  label: string;
}

export interface DownloadableSource extends PlayableSource {
  /** File extension to store on disk, without the dot. */
  fileExtension: string;
  /** Approximate size when the source advertises one. */
  estimatedBytes: number | null;
}

export interface SearchResults {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
}

export type MoodId = 'calm' | 'chill' | 'energetic' | 'rock' | 'focus' | 'party';

export interface Mood {
  id: MoodId;
  name: string;
  tagline: string;
  /** Genres/terms this mood maps onto when querying the provider. */
  seeds: string[];
  /** 0..1 — used as an extra ranking signal by the discovery engine. */
  energy: number;
  accent: string;
}

export interface MusicEvent {
  id: string;
  provider: ProviderId;
  providerEventId: string;
  name: string;
  artistNames: string[];
  venueName: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  /** ISO 8601. */
  startsAt: string | null;
  localTimeLabel: string | null;
  imageUrl: string | null;
  genre: string | null;
  /** Official ticketing, straight from the provider. Never invented. */
  ticket: TicketInfo | null;
  /** Distance from the user's chosen location in km, when known. */
  distanceKm?: number | null;
}

export interface TicketInfo {
  /** Name of the legitimate ticket seller, e.g. "Ticketmaster". */
  sellerName: string;
  url: string;
  status: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  onSaleAt: string | null;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface PlaceRef extends Partial<GeoPoint> {
  label: string;
  city?: string | null;
  countryCode?: string | null;
}

/** A page of results plus the cursor needed to ask for more. */
export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}
