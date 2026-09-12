import type {
  Album,
  Artist,
  DownloadableSource,
  Mood,
  PlayableSource,
  ProviderId,
  SearchResults,
  Track,
} from '@/src/core/types';

/**
 * Everything Pulse is allowed to ask a music source for.
 *
 * Screens, the player, the download manager and the discovery engine all talk
 * to this interface only. Swapping Pulse onto a different catalogue means
 * writing one new adapter — nothing above this line changes.
 */
export interface MusicProvider {
  readonly id: ProviderId;
  readonly name: string;
  /** Shown in the UI wherever we tell the user where audio came from. */
  readonly attribution: string;
  readonly capabilities: MusicProviderCapabilities;

  searchTracks(query: string, options?: SearchOptions): Promise<Track[]>;
  searchArtists(query: string, options?: SearchOptions): Promise<Artist[]>;
  searchAlbums(query: string, options?: SearchOptions): Promise<Album[]>;
  searchAll(query: string, options?: SearchOptions): Promise<SearchResults>;

  getTrack(id: string): Promise<Track | null>;
  getArtist(id: string): Promise<Artist | null>;
  getAlbum(id: string): Promise<Album | null>;

  getArtistTopTracks(artistId: string, limit?: number): Promise<Track[]>;
  getArtistAlbums(artistId: string, limit?: number): Promise<Album[]>;
  getArtistSingles(artistId: string, limit?: number): Promise<Album[]>;
  getRelatedArtists(artistId: string, limit?: number): Promise<Artist[]>;
  getAlbumTracks(albumId: string, limit?: number): Promise<Track[]>;

  /** Tracks similar to a set of seeds the user actually listened to. */
  getRecommendations(seed: RecommendationSeed, limit?: number): Promise<Track[]>;
  /** Genre/term-driven discovery used by the mood screens. */
  getMoodTracks(mood: Mood, limit?: number): Promise<Track[]>;
  /** Latest releases overall, or for specific artists the user follows. */
  getNewReleases(options?: NewReleaseOptions): Promise<Album[]>;
  /** What the source is currently charting, used as a cold-start fallback. */
  getTrending(limit?: number): Promise<Album[]>;
  /**
   * The source's most-played songs for one storefront, in chart order. The
   * position is the index: entry 0 is number one.
   */
  getChartTracks(options?: ChartOptions): Promise<Track[]>;

  /** Resize/normalise an artwork URL for a given rendered size. */
  getArtwork(url: string | null | undefined, size: number): string | null;

  /** null when this source will not stream the track. */
  getPlayableSource(track: Track): Promise<PlayableSource | null>;
  /** null when this source does not permit keeping a copy. */
  getDownloadSource(track: Track): Promise<DownloadableSource | null>;
}

export interface ChartOptions {
  /** Two-letter storefront code. Charts are published per country. */
  country?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface MusicProviderCapabilities {
  search: boolean;
  streaming: boolean;
  /** False means Pulse hides download affordances for this source entirely. */
  download: boolean;
  /** True when the source only licenses excerpts (e.g. 30-second previews). */
  excerptsOnly: boolean;
  recommendations: boolean;
  newReleases: boolean;
  charts: boolean;
  relatedArtists: boolean;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** ISO-3166 alpha-2. Storefronts differ, so this changes real results. */
  country?: string;
  signal?: AbortSignal;
}

export interface RecommendationSeed {
  artistNames?: string[];
  genres?: string[];
  trackTitles?: string[];
  /** 0..1 preference for higher-energy material. */
  energy?: number;
  /** Provider track ids the user already has — filtered out of results. */
  excludeTrackIds?: string[];
  country?: string;
}

export interface NewReleaseOptions {
  artistIds?: string[];
  genre?: string | null;
  limit?: number;
  country?: string;
  /** Only return releases at or after this ISO date. */
  since?: string | null;
}
