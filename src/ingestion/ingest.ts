import { Store } from '@/src/core/store';
import { mapConcurrent } from '@/src/core/concurrency';
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
import { displayNameFromFilename } from '@/src/ingestion/identify/text';
import { artworkProvider, cacheEmbeddedArtwork } from '@/src/ingestion/artwork/provider';
import {
  getKnownFileUris,
  localTrackId,
  saveLocalTrack,
  LOCAL_PROVIDER_ID,
} from '@/src/db/repos/local';
import { rebuildGrooves } from '@/src/grooves/engine';
import { invalidateTasteProfile } from '@/src/discovery/taste';
import { invalidateOwnedIndex } from '@/src/library/owned';
import { chartsStore } from '@/src/discovery/charts';
import { refreshPushRegistration } from '@/src/notifications/push';

/**
 * The import pipeline.
 *
 * Find files, read their own tags, identify the ones whose tags are not good
 * enough, get real artwork onto them, then rebuild the Grooves and the taste
 * profile from what was found.
 *
 * Three things shape the order of work:
 *
 *  - The first songs matter most. The first FIRST_BATCH files go all the way
 *    through — tags, identification, covers, saved, Grooves built — before
 *    anything else is touched, so a listener is looking at their own music in
 *    seconds instead of waiting for a whole collection. The rest follow in
 *    larger batches while they listen.
 *  - Work runs side by side. Files are read a few at a time and lookups run in
 *    parallel; the HTTP layer's per-host rate limiter is what keeps the
 *    catalogue from being flooded, not a one-at-a-time loop.
 *  - Network only where it is needed. Identification runs only for files whose
 *    own tags are not enough, and artwork is fetched once per album, with
 *    concurrent requests for the same album sharing one lookup.
 */

/** Songs taken all the way through before the rest of the collection. */
export const FIRST_BATCH = 20;
/** Size of each batch after the first. */
const BATCH = 60;
/**
 * New songs taken in by one import. A big collection all at once kept the
 * phone busy for minutes; the rest come in whenever the listener adds more.
 */
export const MAX_PER_IMPORT = 100;
/** Files read from storage at once. Reading tags runs on the UI thread, so few. */
const READ_CONCURRENCY = 2;
/** Counters change for every song; the screen hears about them this often. */
const UPDATE_EVERY_MS = 300;
/** Catalogue lookups in flight at once. */
const LOOKUP_CONCURRENCY = 6;

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
  /** Files that needed importing this run (new or changed). */
  total: number;
  /**
   * The first batch is saved and the Grooves are built from it — the library
   * is usable while the rest of the collection keeps importing.
   */
  firstBatchReady: boolean;
  /** Files fully processed. */
  processed: number;
  /** New songs found but left for next time, past MAX_PER_IMPORT. */
  remaining: number;
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
  total: 0,
  firstBatchReady: false,
  processed: 0,
  remaining: 0,
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
  private pending: Partial<IngestState> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Every change goes out at once, carrying any counters still waiting with it.
   * Phase changes use this, so the screen never shows a step late.
   */
  protected override set(patch: Partial<IngestState> | ((prev: IngestState) => Partial<IngestState>)) {
    const waiting = this.pending;
    this.pending = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!waiting) {
      super.set(patch);
      return;
    }
    super.set((prev) => ({
      ...waiting,
      ...(typeof patch === 'function' ? patch({ ...prev, ...waiting }) : patch),
    }));
  }

  /**
   * Per-song counters. Telling every screen about each one re-rendered them
   * hundreds of times a minute, which is what made importing lag; these are
   * gathered and sent a few times a second instead.
   */
  private soon(patch: Partial<IngestState>) {
    this.pending = { ...this.pending, ...patch };
    this.timer ??= setTimeout(() => this.set({}), UPDATE_EVERY_MS);
  }

  /** A counter's latest value, including one not yet sent. */
  private latest<K extends keyof IngestState>(key: K): IngestState[K] {
    return (this.pending?.[key] ?? this.getSnapshot()[key]) as IngestState[K];
  }

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
        // Picked files are copied into Pulse as they are found, so the cap
        // applies while picking; a device scan lists everything (cheap) and
        // the cap applies below, so the next import picks up where this ended.
        limit: options.limit ?? (scanner.id === 'file-picker' ? MAX_PER_IMPORT : undefined),
        signal,
        onProgress: (found) => this.soon({ found }),
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

      const taking = pending.slice(0, MAX_PER_IMPORT);
      this.set({ total: taking.length, remaining: pending.length - taking.length });
      const artworkLookups = new Map<string, Promise<string | null>>();
      const batches = [taking.slice(0, FIRST_BATCH)];
      for (let i = FIRST_BATCH; i < taking.length; i += BATCH) {
        batches.push(taking.slice(i, i + BATCH));
      }

      let done = 0;
      for (let b = 0; b < batches.length; b += 1) {
        if (signal.aborted) break;
        await this.importBatch(batches[b], artworkLookups, signal, (count) => {
          this.soon({
            processed: Math.floor(done + count),
            progress: Math.min(0.93, ((done + count) / taking.length) * 0.93),
          });
        });
        done += batches[b].length;

        // The first songs are in: build Grooves from them so the library is
        // worth opening now, then carry on with the rest.
        if (b === 0 && batches.length > 1 && !signal.aborted) {
          await this.analyze(false);
          this.set({ firstBatchReady: true });
        }
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

  /**
   * Takes one batch of files all the way into the library: read, identify
   * what needs it, find covers, save.
   */
  private async importBatch(
    files: ScannedFile[],
    artworkLookups: Map<string, Promise<string | null>>,
    signal: AbortSignal,
    onProgress: (count: number) => void,
  ) {
    // 1. Read what each file says about itself.
    this.set({ phase: 'reading' });
    let read = 0;
    const candidates = await mapConcurrent(files, READ_CONCURRENCY, signal, async (file) => {
      const tags = await readFileTags(file.uri, file.sizeBytes || undefined);
      // Let the screen draw a frame between files.
      await breathe();
      read += 1;
      onProgress(read * 0.4);
      return { file, tags } as Candidate;
    });

    // 2. Identify the ones whose own tags are not enough.
    this.set({ phase: 'identifying' });
    const needsLookup = candidates.filter((candidate) => !hasUsableTags(candidate.tags));
    await mapConcurrent(needsLookup, LOOKUP_CONCURRENCY, signal, async (candidate) => {
      const result = await identify({
        filename: candidate.file.filename,
        tags: candidate.tags,
        durationMs: candidate.tags.durationMs ?? candidate.file.durationMs,
      });
      candidate.identification = result.status;
      candidate.confidence = result.confidence;
      candidate.match = result.match ?? undefined;
      if (result.status === 'identified') this.soon({ identified: this.latest('identified') + 1 });
      else this.soon({ needsIdentification: this.latest('needsIdentification') + 1 });
    });

    // 3. Find real artwork for anything that has none of its own.
    this.set({ phase: 'artwork' });
    const needsArtwork = candidates.filter(
      (candidate) => !candidate.tags.picture && !candidate.match?.artworkUrl,
    );
    await mapConcurrent(needsArtwork, LOOKUP_CONCURRENCY, signal, async (candidate) => {
      // Fall back to what the filename says. A wrong cover is still ruled out
      // downstream: the provider only returns a match it is confident in.
      const named = displayNameFromFilename(candidate.file.filename);
      const artist = candidate.tags.artist ?? candidate.match?.artistName ?? named.artist ?? '';
      const album = candidate.tags.album ?? candidate.match?.albumTitle ?? '';
      const title = candidate.tags.title ?? candidate.match?.title ?? named.title;
      if (!album && !title) return;

      // Songs from one album share one lookup, even when they are in flight together.
      const key = album ? `${artist.toLowerCase()}|${album.toLowerCase()}` : null;
      let lookup = key ? artworkLookups.get(key) : undefined;
      if (!lookup) {
        lookup = artworkProvider()
          .getArtwork({ title, artist, album })
          .catch(() => null);
        if (key) artworkLookups.set(key, lookup);
      }
      candidate.artworkUrl = (await lookup) ?? undefined;
      if (candidate.artworkUrl) {
        this.soon({ artworkFound: this.latest('artworkFound') + 1 });
      }
    });

    // 4. Write everything to the library.
    for (let i = 0; i < candidates.length; i += 1) {
      if (signal.aborted) break;
      await persist(candidates[i]);
      if (i % 5 === 4) await breathe();
      onProgress(0.4 * candidates.length + 0.6 * (i + 1));
    }
  }

  /** Clusters the collection and refreshes the taste profile. */
  private async analyze(final = true) {
    if (final) this.set({ phase: 'grooving', progress: 0.94 });
    const grooves = await rebuildGrooves();
    invalidateTasteProfile();
    invalidateOwnedIndex();
    // A charting song the listener now owns should play from their own file,
    // so the board on screen is re-matched against the grown library.
    void chartsStore.reresolveOwned().catch(() => {});
    // New artists in the library mean new things worth being told about.
    void refreshPushRegistration().catch(() => {});
    this.set({ grooveCount: grooves.length, ...(final ? { progress: 1 } : {}) });
  }

  private finish(phase: IngestPhase) {
    this.set({
      phase,
      firstBatchReady: phase === 'done' || this.getSnapshot().firstBatchReady,
      progress: phase === 'done' ? 1 : this.getSnapshot().progress,
      finishedAt: Date.now(),
    });
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

/** Hands the thread back for a moment, so taps and scrolling stay smooth. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

  // A file Pulse could not place still deserves a proper name. The audio is
  // untouched and the row is kept either way; this only decides what it reads
  // as in the library.
  const named = displayNameFromFilename(file.filename);
  const title = tags.title ?? (confident ? match!.title : null) ?? named.title;
  const artist =
    tags.artist ?? (confident ? match!.artistName : null) ?? named.artist ?? 'Unknown artist';
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
