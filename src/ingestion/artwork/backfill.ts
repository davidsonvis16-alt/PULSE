import { Store } from '@/src/core/store';
import { mapConcurrent } from '@/src/core/concurrency';
import { setTrackArtwork } from '@/src/db/repos/catalog';
import { listLocalTracksMissingArtwork } from '@/src/db/repos/local';
import { artworkProvider, cacheEmbeddedArtwork } from '@/src/ingestion/artwork/provider';
import { readFileTags } from '@/src/ingestion/tags';

/**
 * Covers for music that came in without one.
 *
 * The import pass only looks at files it has just read, so a track that was
 * offline at the time, or was imported before Pulse could read its tags, keeps
 * an empty cover forever. This pass goes back over exactly those tracks: it
 * re-reads the file for embedded art first, then asks the catalogue, and asks
 * once per album rather than once per track — several tracks at a time, with
 * tracks from the same album sharing one lookup.
 */

/** Tracks worked on at once. The HTTP layer rate-limits the catalogue itself. */
const CONCURRENCY = 6;

export interface ArtworkRepairState {
  running: boolean;
  /** Tracks still without a cover, as of the last count. */
  missing: number;
  checked: number;
  found: number;
  total: number;
}

const IDLE: ArtworkRepairState = { running: false, missing: 0, checked: 0, found: 0, total: 0 };

class ArtworkRepair extends Store<ArtworkRepairState> {
  private controller: AbortController | null = null;

  constructor() {
    super(IDLE);
  }

  cancel() {
    this.controller?.abort();
  }

  /** Refreshes the "how many covers are missing" count without fetching any. */
  async count(): Promise<number> {
    const missing = (await listLocalTracksMissingArtwork()).length;
    this.set({ missing });
    return missing;
  }

  async run(options: { limit?: number } = {}): Promise<ArtworkRepairState> {
    if (this.getSnapshot().running) return this.getSnapshot();

    const pending = await listLocalTracksMissingArtwork(options.limit ?? 500);
    this.set({ running: true, checked: 0, found: 0, total: pending.length, missing: pending.length });
    if (pending.length === 0) {
      this.set({ running: false });
      return this.getSnapshot();
    }

    this.controller = new AbortController();
    const { signal } = this.controller;
    const byAlbum = new Map<string, Promise<string | null>>();
    let checked = 0;

    try {
      await mapConcurrent(pending, CONCURRENCY, signal, async (entry) => {
        const { track } = entry;
        const album = track.albumTitle ?? '';
        const key = `${track.artistName.toLowerCase()}|${album.toLowerCase()}`;

        let found: string | null = null;

        // The file itself is the best source, and costs no network.
        const tags = await readFileTags(entry.fileUri, entry.fileSize ?? undefined).catch(() => null);
        if (tags?.picture) found = await cacheEmbeddedArtwork(track.id, tags.picture);

        if (!found) {
          let lookup = album ? byAlbum.get(key) : undefined;
          if (!lookup) {
            lookup = artworkProvider()
              .getArtwork({ title: track.title, artist: track.artistName, album })
              .catch(() => null);
            if (album) byAlbum.set(key, lookup);
          }
          found = await lookup;
        }

        if (found) {
          await setTrackArtwork(track.id, found);
          this.set({ found: this.getSnapshot().found + 1 });
        }
        checked += 1;
        this.set({ checked, missing: Math.max(0, pending.length - this.getSnapshot().found) });
      });
    } finally {
      this.controller = null;
      this.set({ running: false });
      await this.count();
    }

    return this.getSnapshot();
  }
}

export const artworkRepair = new ArtworkRepair();
