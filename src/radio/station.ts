import { Store } from '@/src/core/store';
import type { Track } from '@/src/core/types';
import { playerStore } from '@/src/audio/player';
import { listLocalTracks } from '@/src/db/repos/local';
import { getLibraryTracks } from '@/src/db/repos/library';

/**
 * Pulse Radio.
 *
 * A station rather than a playlist: it plays forward and only forward. There is
 * no going back, no scrubbing and nothing is played twice while there is
 * anything left unplayed — which is what makes hearing a song on it feel like
 * catching it rather than choosing it.
 *
 * Everything it plays comes from music that is actually on the device. Adding a
 * song to the station is the ordinary import, so a file someone drops in is
 * theirs and the station's at the same time.
 *
 * The queue itself lives in the player, so the station stays a thin thing that
 * decides what goes in next and tops the queue up before it can run dry.
 */

export interface RadioState {
  /** True once a pool has been built, whether or not it is playing. */
  ready: boolean;
  /** The station is what the player is currently playing. */
  live: boolean;
  /** Songs available to the station. */
  poolSize: number;
  /** Played in this session, newest first. Read-only by design. */
  history: Track[];
  startedAt: number | null;
  error: string | null;
}

/** Keep at least this many songs queued ahead of the listener. */
const LOOKAHEAD = 5;
/** How many to add each time the queue is topped up. */
const BATCH = 12;

class RadioStation extends Store<RadioState> {
  private pool: Track[] = [];
  /** Ids already sent out, so nothing repeats while anything is unplayed. */
  private used = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({ ready: false, live: false, poolSize: 0, history: [], startedAt: null, error: null });
  }

  /** Loads the station's music. Safe to call repeatedly. */
  async load(): Promise<number> {
    const local = await listLocalTracks({ limit: 1000 }).catch(() => []);
    const pool = local.length
      ? local.map((entry) => entry.track)
      : await getLibraryTracks({ sort: 'recent', limit: 1000 }).catch(() => []);

    this.pool = pool;
    this.set({ poolSize: pool.length, ready: true });
    return pool.length;
  }

  /** Starts the station, or resumes listening if it is already on air. */
  async start(): Promise<boolean> {
    if (this.pool.length === 0) await this.load();
    if (this.pool.length === 0) {
      this.set({ error: 'There is no music on this device to play yet.' });
      return false;
    }

    const first = this.take(BATCH);
    if (first.length === 0) return false;

    await playerStore.playQueue(first, { context: 'radio', contextLabel: 'Pulse Radio' });
    this.set({
      live: true,
      error: null,
      startedAt: Date.now(),
      history: [first[0]].filter(Boolean),
    });
    this.watch();
    return true;
  }

  /** Moves the dial on. The only control a radio has besides volume. */
  async skip() {
    if (!this.getSnapshot().live) return;
    await playerStore.next();
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    playerStore.clearQueue();
    this.set({ live: false, startedAt: null });
  }

  /**
   * Watches the player so the queue is topped up before it empties, and keeps
   * the session's history. Listening stops the moment something else is played,
   * because then the station is no longer what is on.
   */
  private watch() {
    this.unsubscribe?.();
    this.unsubscribe = playerStore.subscribe(() => {
      const { context, queue, index, current } = playerStore.getSnapshot();

      if (context !== 'radio') {
        if (this.getSnapshot().live) this.set({ live: false });
        return;
      }

      if (current) {
        const history = this.getSnapshot().history;
        if (history[0]?.id !== current.id) {
          this.set({ history: [current, ...history].slice(0, 60) });
        }
      }

      if (index >= 0 && queue.length - index <= LOOKAHEAD) {
        const next = this.take(BATCH);
        if (next.length) playerStore.addToQueue(next);
      }
    });
  }

  /**
   * Pulls the next songs out of the pool at random without repeating. When
   * everything has been played the pool reopens, minus what is still in the
   * listener's recent memory, so the station can run forever without looping.
   */
  private take(count: number): Track[] {
    const remaining = this.pool.filter((track) => !this.used.has(track.id));
    if (remaining.length === 0) {
      const recent = new Set(this.getSnapshot().history.slice(0, 20).map((t) => t.id));
      this.used = new Set(recent);
      return this.take(count);
    }

    const picked: Track[] = [];
    const bag = [...remaining];
    while (picked.length < count && bag.length > 0) {
      const at = Math.floor(Math.random() * bag.length);
      const [track] = bag.splice(at, 1);
      this.used.add(track.id);
      picked.push(track);
    }
    return picked;
  }

  /** What is queued after the song playing now. */
  upcoming(limit = 8): Track[] {
    const { context, queue, index } = playerStore.getSnapshot();
    if (context !== 'radio' || index < 0) return [];
    return queue.slice(index + 1, index + 1 + limit);
  }
}

export const radioStation = new RadioStation();
