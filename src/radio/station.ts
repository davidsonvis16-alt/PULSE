import { Store } from '@/src/core/store';
import type { Track } from '@/src/core/types';
import { playerStore } from '@/src/audio/player';
import {
  fetchClockOffset,
  fetchRotation,
  freestyleTrack,
  livePosition,
  type Freestyle,
} from '@/src/radio/freestyles';

/**
 * Pulse Radio.
 *
 * A live station of freestyles people on Pulse uploaded. It is always on:
 * tuning in drops you into whatever is playing right now, part-way through,
 * and everyone listening hears the same freestyle at the same moment. There is
 * no going back and no scrubbing — it is radio.
 *
 * There is no broadcast server. The rotation is every freestyle on air in
 * upload order, looping end to end from a fixed point in time, and each phone
 * works out where "now" falls from a clock they all share. The queue itself
 * lives in the player, so this stays a thin thing that tunes in and tops the
 * queue up before it runs dry.
 */

export interface RadioState {
  /** True once the rotation has been fetched, whether or not it is playing. */
  ready: boolean;
  /** The station is what the player is currently playing. */
  live: boolean;
  tuning: boolean;
  /** Freestyles on air. */
  rotation: Freestyle[];
  /** Heard in this session, newest first. Read-only by design. */
  history: Track[];
  error: string | null;
}

/** Keep at least this many freestyles queued ahead of the listener. */
const LOOKAHEAD = 3;
/** How many to queue each time. */
const BATCH = 10;

class RadioStation extends Store<RadioState> {
  private clockOffset = 0;
  /** Index in the rotation of the last freestyle put in the queue. */
  private cursor = -1;
  private unsubscribe: (() => void) | null = null;
  private topping = false;

  constructor() {
    super({ ready: false, live: false, tuning: false, rotation: [], history: [], error: null });
  }

  /** Fetches what is on air. Safe to call repeatedly. */
  async load(): Promise<Freestyle[]> {
    try {
      const [rotation, offset] = await Promise.all([fetchRotation(), fetchClockOffset()]);
      this.clockOffset = offset;
      this.set({ rotation, ready: true, error: null });
      return rotation;
    } catch (error) {
      this.set({
        ready: true,
        error: error instanceof Error ? error.message : 'Could not reach Pulse Radio.',
      });
      return this.getSnapshot().rotation;
    }
  }

  /**
   * Tunes in: joins whatever is on air now, at the point everyone else is at.
   * Also used to resume after a pause, so a listener always comes back live
   * rather than lagging behind the station.
   */
  async tuneIn(): Promise<boolean> {
    this.set({ tuning: true });
    try {
      const rotation = await this.load();
      const now = livePosition(rotation, Date.now() + this.clockOffset);
      // An empty station is not an error; the screen already says so. A
      // problem reaching the server, set by `load`, is left showing.
      if (!now) return false;

      // Everyone hears the end of the current freestyle; joining in its last
      // couple of seconds is just a click, so start the next one instead.
      const remaining = rotation[now.index].durationMs - now.offsetMs;
      const startIndex = remaining < 2500 ? (now.index + 1) % rotation.length : now.index;
      const offsetMs = startIndex === now.index ? now.offsetMs : 0;

      this.cursor = startIndex - 1;
      const queue = this.nextFromRotation(BATCH);
      await playerStore.playTrack(queue[0], {
        queue,
        context: 'radio',
        contextLabel: 'Pulse Radio',
        startPositionMs: offsetMs,
      });
      this.set({ live: true, error: null, history: [queue[0]] });
      this.watch();
      return true;
    } finally {
      this.set({ tuning: false });
    }
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    playerStore.pause();
    playerStore.clearQueue();
    this.set({ live: false });
  }

  /** The next freestyles after the cursor, looping round the rotation. */
  private nextFromRotation(count: number): Track[] {
    const { rotation } = this.getSnapshot();
    if (rotation.length === 0) return [];
    const tracks: Track[] = [];
    for (let i = 0; i < count; i += 1) {
      this.cursor = (this.cursor + 1) % rotation.length;
      tracks.push(freestyleTrack(rotation[this.cursor]));
    }
    return tracks;
  }

  /**
   * Watches the player so the queue is topped up before it empties, and keeps
   * the session's history. The station stops being "on" the moment something
   * else is played.
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

      if (index >= 0 && queue.length - index <= LOOKAHEAD && !this.topping) {
        void this.topUp();
      }
    });
  }

  /**
   * Picks up new uploads before adding more. The cursor is re-found by id so a
   * freestyle added or taken down mid-session does not knock the order out.
   */
  private async topUp() {
    this.topping = true;
    try {
      const { rotation: before } = this.getSnapshot();
      const lastId = before[this.cursor]?.id;
      const rotation = await fetchRotation().catch(() => before);
      if (rotation !== before) {
        this.set({ rotation });
        const found = rotation.findIndex((item) => item.id === lastId);
        this.cursor = found >= 0 ? found : Math.min(this.cursor, rotation.length - 1);
      }
      const next = this.nextFromRotation(BATCH);
      if (next.length && playerStore.getSnapshot().context === 'radio') playerStore.addToQueue(next);
    } finally {
      this.topping = false;
    }
  }

  /** What is queued after the freestyle playing now. */
  upcoming(limit = 8): Track[] {
    const { context, queue, index } = playerStore.getSnapshot();
    if (context !== 'radio' || index < 0) return [];
    return queue.slice(index + 1, index + 1 + limit);
  }
}

export const radioStation = new RadioStation();
