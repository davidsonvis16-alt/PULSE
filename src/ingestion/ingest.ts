import { Store } from '@/src/core/store';
import { entityId, type Track } from '@/src/core/types';
import { estimateBitrate, readFileTags, type FileTags } from '@/src/ingestion/tags';
import {
  enumeratingScanner,
  pickerScanner,
  type MusicScanner,
  type ScannedFile,
} from '@/src/ingestion/scanner';
import {
  hasUsableTags,
  identify,
  type IdentificationStatus,
} from '@/src/ingestion/identify/identifier';
import { cleanFilename, splitArtistTitle } from '@/src/ingestion/identify/text';
import { artworkProvider, cacheEmbeddedArtwork } from '@/src/ingestion/artwork/provider';
import {
  getKnownFileUris,
  localTrackId,
  saveLocalTrack,
  LOCAL_PROVIDER_ID,
} from '@/src/db/repos/local';
import { rebuildGrooves } from '@/src/grooves/engine';
import { invalidateTasteProfile } from '@/src/discovery/taste';

/**
 * The import pipeline.
 *
 * Find files, read their own tags, identify the ones whose tags are not good
 * enough, get real artwork onto them, then rebuild the Grooves and the taste
 * profile from what was found.
 *
 * Two things shape the order of work. Reading tags is local and fast, so it
 * happens for everything up front and most collections need nothing more.
 * Identification and artwork lookups cost network round trips, so they run only
 * for the files that actually need them, and artwork is fetched once per album
 * rather than once per track.
 */

export type IngestPhase =
  | 'idle'
  | 'permission'
  | 'finding'
  | 'reading'
  | 'identifying'
  | 'artwork'
  | 'analyzing'
  | 'grooving'
  | 'done'
  | 'cancelled'
  | 'error';

export interface IngestState {
  phase: IngestPhase;
  /** Files discovered so far. */
  found: number;
  /** Files fully processed. */
  processed: number;
  /** Of those, how many needed looking up rather than having usable tags. */
  identified: number;
  needsIdentification: number;
  artworkFound: number;
  grooveCount: number;
  /** 0..1 across the whole run, for a single progress bar. */
  progress: number;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

const IDLE: IngestState = {
  phase: 'idle',
  found: 0,
  processed: 0,
  identified: 0,
  needsIdentification: 0,
  artworkFound: 0,
  grooveCount: 0,
  progress: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
};

export interface IngestOptions {
  /** 'device' enumerates the media store; 'picker' asks the user for files. */
  mode?: 'device' | 'picker';
  /** Re-read files Pulse already knows about. Off by default. */
  full?: boolean;
  limit?: number;
}

class IngestEngine extends Store<IngestState> {
  private controller: AbortController | null = null;
  private running = false;

  constructor() {
    super(IDLE);
  }

  get isRunning() {
    return this.running;
  }

  cancel() {
    this.controller?.abort();
  }

  reset() {
    if (this.running) return;
    this.replaceState(IDLE);
  }

  private replaceState(next: IngestState) {
    this.set(next);
  }

  async run(options: IngestOptions = {}): Promise<IngestState> {
    if (this.running) return this.getSnapshot();
    this.running = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;

    this.replaceState({ ...IDLE, phase: 'finding', startedAt: Date.now() });

    try {
      const scanner = await pickScanner(options.mode);
      if (!scanner) throw new Error('No way to read music on this device.');

      // 1. Find the files.
      this.set({ phase: 'finding' });
      const discovered = await scanner.scanLibrary({
        limit: options.limit,
        signal,
        onProgress: (found) => this.set({ found }),
      });
      this.set({ found: discovered.length });
      if (discovered.length === 0) {
        this.finish('done');
        return this.getSnapshot();
      }

      // Skip files already indexed unless the caller asked for a full pass.
      const known = options.full ? new Map<string, number | null>() : await getKnownFileUris();
      const pending = discovered.filter((file) => {
        const seen = known.get(file.uri);
        if (seen === undefined) return true;
        return file.modifiedAt !== null && seen !== null && file.modifiedAt > seen;
      });

      if (pending.length === 0) {
        this.set({ processed: discovered.length, progress: 1 });
        await this.analyze();
        this.finish('done');
        return this.getSnapshot();
      }

      // 2. Read what each file says about itself.
      this.set({ phase: 'reading' });
      const candidates: Candidate[] = [];
      for (let i = 0; i < pending.length; i += 1) {
        if (signal.aborted) break;
        const file = pending[i];
        const tags = await readFileTags(file.uri, file.sizeBytes || undefined);
        candidates.push({ file, tags });
        this.set({
          processed: i + 1,
          progress: ((i + 1) / pending.length) * 0.45,
        });
      }

      // 3. Identify the ones whose own tags are not enough.
      this.set({ phase: 'identifying', processed: 0 });
      const needsLookup = candidates.filter((candidate) => !hasUsableTags(candidate.tags));
      for (let i = 0; i < needsLookup.length; i += 1) {
        if (signal.aborted) break;
        const candidate = needsLookup[i];
        const result = await identify({
          filename: candidate.file.filename,
          tags: candidate.tags,
          durationMs: candidate.tags.durationMs ?? candidate.file.durationMs,
        });
        candidate.identification = result.status;
        candidate.confidence = result.confidence;
        candidate.match = result.match ?? undefined;
        if (result.status === 'identified') {
          this.set({ identified: this.getSnapshot().identified + 1 });
        } else {
          this.set({ needsIdentification: this.getSnapshot().needsIdentification + 1 });
        }
        this.set({
          processed: i + 1,
          progress: 0.45 + ((i + 1) / Math.max(1, needsLookup.length)) * 0.25,
        });
      }

      // 4. Find real artwork for anything that has none of its own.
      this.set({ phase: 'artwork', processed: 0 });
      const artworkCache = new Map<string, string | null>();
      const needsArtwork = candidates.filter(
        (candidate) => !candidate.tags.picture && !candidate.match?.artworkUrl,
      );
      for (let i = 0; i < needsArtwork.length; i += 1) {
        if (signal.aborted) break;
        const candidate = needsArtwork[i];
        // Fall back to what the filename says. A wrong cover is still ruled out
        // downstream: the provider only returns a match it is confident in.
        const guessed = splitArtistTitle(candidate.file.filename);
        const artist = candidate.tags.artist ?? candidate.match?.artistName ?? guessed.artist ?? '';
        const album = candidate.tags.album ?? candidate.match?.albumTitle ?? '';
        const title =
          candidate.tags.title ??
          candidate.match?.title ??
          guessed.title ??
          cleanFilename(candidate.file.filename);

        if (album || title) {
          const key = `${artist.toLowerCase()}|${album.toLowerCase()}`;
          if (album && artworkCache.has(key)) {
            candidate.artworkUrl = artworkCache.get(key) ?? undefined;
          } else {
            const found = await artworkProvider().getArtwork({ title, artist, album });
            if (album) artworkCache.set(key, found);
            candidate.artworkUrl = found ?? undefined;
          }
          if (candidate.artworkUrl) {
            this.set({ artworkFound: this.getSnapshot().artworkFound + 1 });
          }
        }
        this.set({
          processed: i + 1,
          progress: 0.7 + ((i + 1) / Math.max(1, needsArtwork.length)) * 0.15,
        });
      }

      // 5. Write everything to the library.
      this.set({ phase: 'analyzing', processed: 0 });
      for (let i = 0; i < candidates.length; i += 1) {
        if (signal.aborted) break;
        await persist(candidates[i]);
        this.set({
          processed: i + 1,
          progress: 0.85 + ((i + 1) / candidates.length) * 0.08,
        });
      }

      if (signal.aborted) {
        this.finish('cancelled');
        return this.getSnapshot();
      }

      await this.analyze();
      this.finish('done');
      return this.getSnapshot();
    } catch (error) {
      this.set({
        phase: 'error',
        error: error instanceof Error ? error.message : 'Importing your music failed.',
        finishedAt: Date.now(),
      });
      return this.getSnapshot();
    } finally {
      this.running = false;
      this.controller = null;
    }
  }

  /** Clusters the collection and refreshes the taste profile. */
  private async analyze() {
    this.set({ phase: 'grooving', progress: 0.94 });
    const grooves = await rebuildGrooves();
    invalidateTasteProfile();
    this.set({ grooveCount: grooves.length, progress: 1 });
  }

  private finish(phase: IngestPhase) {
    this.set({ phase, progress: phase === 'done' ? 1 : this.getSnapshot().progress, finishedAt: Date.now() });
  }
}

interface Candidate {
  file: ScannedFile;
  tags: FileTags;
  identification?: IdentificationStatus;
  confidence?: number;
  match?: Track;
  artworkUrl?: string;
}

async function pickScanner(mode: IngestOptions['mode']): Promise<MusicScanner | null> {
  if (mode === 'picker') return pickerScanner();
  const scanner = await enumeratingScanner();
  return scanner ?? pickerScanner();
}

/**
 * Turns everything known about a file into a track row.
 *
 * The file's own tags always win: they are what the user chose to have. A
 * confident identification fills gaps and supplies artwork. A weak one supplies
 * nothing at all beyond the "needs identification" flag.
 */
async function persist(candidate: Candidate) {
  const { file, tags, match } = candidate;
  const tagged = hasUsableTags(tags);
  const confident = candidate.identification === 'identified' && !!match;

  const guessed = splitArtistTitle(file.filename);
  const title = tags.title ?? (confident ? match!.title : null) ?? guessed.title ?? cleanFilename(file.filename);
  const artist =
    tags.artist ?? (confident ? match!.artistName : null) ?? guessed.artist ?? 'Unknown artist';
  const album = tags.album ?? (confident ? match!.albumTitle : null) ?? null;
  const genre = tags.genre ?? (confident ? match!.genre : null) ?? null;
  const year = tags.year ?? (confident ? match!.releaseDate?.slice(0, 4) : null) ?? null;

  const trackId = localTrackId(file.uri);

  // Artwork order: the file's own, then the identified release, then nothing.
  let artworkUrl: string | null = null;
  if (tags.picture) {
    artworkUrl = await cacheEmbeddedArtwork(trackId, tags.picture);
  }
  if (!artworkUrl && confident) artworkUrl = match!.artworkUrl;
  if (!artworkUrl && candidate.artworkUrl) artworkUrl = candidate.artworkUrl;

  const durationMs = tags.durationMs ?? file.durationMs ?? match?.durationMs ?? null;

  const status: IdentificationStatus = tagged
    ? 'tagged'
    : (candidate.identification ?? 'unidentified');

  const track: Track = {
    id: trackId,
    provider: LOCAL_PROVIDER_ID,
    providerTrackId: trackId.split(':').slice(2).join(':'),
    title,
    artistName: artist,
    artistId: artist !== 'Unknown artist' ? entityId(LOCAL_PROVIDER_ID, 'artist', slug(artist)) : null,
    albumTitle: album,
    albumId: album ? entityId(LOCAL_PROVIDER_ID, 'album', slug(`${artist} ${album}`)) : null,
    artworkUrl,
    durationMs,
    releaseDate: year ? `${year}-01-01` : null,
    genre,
    trackNumber: tags.trackNumber ?? null,
    discNumber: tags.discNumber ?? null,
    explicit: false,
    externalUrl: confident ? match!.externalUrl : null,
  };

  await saveLocalTrack(track, {
    assetId: file.assetId,
    fileUri: file.uri,
    filename: file.filename,
    container: tags.container,
    mimeType: tags.mimeType,
    fileSize: file.sizeBytes || null,
    bitrate: tags.bitrate ?? estimateBitrate(file.sizeBytes, durationMs ?? undefined) ?? null,
    sampleRate: tags.sampleRate ?? null,
    channels: tags.channels ?? null,
    albumArtist: tags.albumArtist ?? null,
    embeddedArtUri: tags.picture ? artworkUrl : null,
    identification: status,
    confidence: candidate.confidence ?? null,
    matchedTrackId: match?.id ?? null,
    source: file.source,
    addedAt: file.addedAt,
    scannedAt: Date.now(),
    modifiedAt: file.modifiedAt,
  });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';
}

export const ingestEngine = new IngestEngine();

export const PHASE_LABELS: Record<IngestPhase, string> = {
  idle: 'Ready',
  permission: 'Asking for access…',
  finding: 'Finding your music…',
  reading: 'Reading track details…',
  identifying: 'Identifying tracks…',
  artwork: 'Finding artwork…',
  analyzing: 'Analysing your collection…',
  grooving: 'Building your Grooves…',
  done: 'Your Pulse is ready.',
  cancelled: 'Import stopped',
  error: 'Import failed',
};
