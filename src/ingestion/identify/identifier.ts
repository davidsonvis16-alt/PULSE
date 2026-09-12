import type { Track } from '@/src/core/types';
import { config } from '@/src/core/config';
import { musicProvider } from '@/src/providers/music';
import {
  cleanFilename,
  coreTitle,
  isLowInformationName,
  similarity,
  splitArtistTitle,
} from '@/src/ingestion/identify/text';
import type { FileTags } from '@/src/ingestion/tags';

/**
 * MusicIdentifier: works out what a file actually is.
 *
 * The rule that shapes all of this is "do not guess". A confident match fills
 * in the title, artist, album and artwork. Anything less is recorded as a
 * suggestion and the track is marked as needing identification, so the user
 * sees the truth rather than a plausible-looking wrong answer.
 */

export type IdentificationStatus =
  | 'tagged' // the file's own tags were good enough
  | 'identified' // matched to a catalogue entry with high confidence
  | 'needs_identification' // a candidate exists, but not a confident one
  | 'unidentified'; // nothing came back worth showing

export interface IdentificationResult {
  status: IdentificationStatus;
  /** The catalogue entry we matched, confident or not. */
  match: Track | null;
  confidence: number;
  /** What was searched for, useful when explaining a miss to the user. */
  query: string | null;
}

/** Above this, Pulse applies the match without asking. */
export const CONFIDENT_THRESHOLD = 0.8;
/**
 * The bar for a file whose own name is worthless — "03.mp3", "AUD-0002.mp3".
 *
 * There is nothing to protect in a name like that, so a decent match is
 * allowed to replace it outright rather than sitting in a review queue. The bar
 * is still high enough that a random result cannot take a song's name, and a
 * junk filename produces a junk query, which scores below it anyway.
 */
export const RENAME_THRESHOLD = 0.62;
/** Below this, a candidate is not even worth offering. */
export const SUGGESTION_THRESHOLD = 0.52;

export interface IdentifyInput {
  filename: string;
  tags: FileTags;
  /** Duration from the file or the platform, used to corroborate a match. */
  durationMs: number | null;
}

export interface MusicIdentifier {
  readonly id: string;
  identifyByMetadata(input: IdentifyInput): Promise<IdentificationResult>;
  /**
   * Content-based matching. Needs a fingerprinting library Expo does not have,
   * so the shipped implementation reports that plainly instead of pretending.
   */
  identifyByFingerprint(input: IdentifyInput): Promise<IdentificationResult>;
  readonly supportsFingerprinting: boolean;
  confidenceScore(input: IdentifyInput, candidate: Track): number;
}

/** True when a file's own tags already tell us what we need. */
export function hasUsableTags(tags: FileTags): boolean {
  return Boolean(tags.title?.trim() && tags.artist?.trim());
}

export const catalogIdentifier: MusicIdentifier = {
  id: 'catalog',
  supportsFingerprinting: false,

  confidenceScore(input, candidate) {
    const { artist: guessedArtist, title: guessedTitle } = splitArtistTitle(input.filename);
    const title = input.tags.title ?? guessedTitle ?? '';
    const artist = input.tags.artist ?? guessedArtist ?? '';

    const titleScore = title ? similarity(coreTitle(title), coreTitle(candidate.title)) : 0;
    const artistScore = artist ? similarity(artist, candidate.artistName) : 0;

    // With no artist to go on, the title has to carry the whole decision, so it
    // is held to a higher bar by counting for less.
    let score = artist ? titleScore * 0.6 + artistScore * 0.4 : titleScore * 0.72;

    if (input.tags.album && candidate.albumTitle) {
      score += similarity(input.tags.album, candidate.albumTitle) * 0.1;
    }

    // Duration is the strongest corroborating signal available without audio.
    if (input.durationMs && candidate.durationMs) {
      const deltaSeconds = Math.abs(input.durationMs - candidate.durationMs) / 1000;
      if (deltaSeconds <= 2) score += 0.14;
      else if (deltaSeconds <= 5) score += 0.07;
      else if (deltaSeconds > 20) score -= 0.35;
      else if (deltaSeconds > 10) score -= 0.12;
    }

    return Math.max(0, Math.min(1, score));
  },

  async identifyByMetadata(input) {
    const query = buildQuery(input);
    if (!query) return { status: 'unidentified', match: null, confidence: 0, query: null };

    let candidates: Track[] = [];
    try {
      candidates = await musicProvider().searchTracks(query, {
        limit: 12,
        country: config.music.country,
      });
    } catch {
      // Offline or the source is down: not a failed identification, just one we
      // could not attempt. It stays queued as needing identification.
      return { status: 'needs_identification', match: null, confidence: 0, query };
    }

    if (candidates.length === 0) {
      return { status: 'unidentified', match: null, confidence: 0, query };
    }

    let best: Track | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = this.confidenceScore(input, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (!best || bestScore < SUGGESTION_THRESHOLD) {
      return { status: 'unidentified', match: null, confidence: bestScore, query };
    }
    if (bestScore >= CONFIDENT_THRESHOLD) {
      return { status: 'identified', match: best, confidence: bestScore, query };
    }
    // A file named after nothing is better off carrying the catalogue's name
    // and cover than a number the user never chose.
    if (bestScore >= RENAME_THRESHOLD && !hasUsableTags(input.tags) && isLowInformationName(input.filename)) {
      return { status: 'identified', match: best, confidence: bestScore, query };
    }
    return { status: 'needs_identification', match: best, confidence: bestScore, query };
  },

  async identifyByFingerprint(input) {
    // Audio fingerprinting needs a native Chromaprint build, which is not
    // available to an Expo app. Declaring that here keeps the interface honest
    // for a future adapter that can do it.
    void input;
    return { status: 'unidentified', match: null, confidence: 0, query: null };
  },
};

/** Builds the best search string the available signals allow. */
function buildQuery(input: IdentifyInput): string | null {
  const title = input.tags.title?.trim();
  const artist = input.tags.artist?.trim();
  if (title && artist) return `${artist} ${title}`;
  if (title) return title;

  const guessed = splitArtistTitle(input.filename);
  if (guessed.artist && guessed.title) return `${guessed.artist} ${guessed.title}`;

  const cleaned = cleanFilename(input.filename);
  return cleaned.length >= 3 ? cleaned : null;
}

let activeIdentifier: MusicIdentifier = catalogIdentifier;

export function setMusicIdentifier(identifier: MusicIdentifier) {
  activeIdentifier = identifier;
}

export function musicIdentifier(): MusicIdentifier {
  return activeIdentifier;
}

/**
 * Runs the identification chain: metadata first, fingerprinting second when a
 * capable identifier is registered.
 */
export async function identify(input: IdentifyInput): Promise<IdentificationResult> {
  const identifier = musicIdentifier();
  const byMetadata = await identifier.identifyByMetadata(input);
  if (byMetadata.status === 'identified' || !identifier.supportsFingerprinting) return byMetadata;

  const byFingerprint = await identifier.identifyByFingerprint(input);
  return byFingerprint.confidence > byMetadata.confidence ? byFingerprint : byMetadata;
}
