import { Store } from '@/src/core/store';
import type { Track } from '@/src/core/types';
import { addTrackToLibrary, getFavoriteIds, toggleFavorite } from '@/src/db/repos/library';

/**
 * Liked songs.
 *
 * Liking happens in a lot of places — a row, a card, the player — and every one
 * of them has to show the result immediately, so the set of liked ids lives
 * here rather than being re-read per screen. The database is still the truth;
 * this is a cache that writes through to it.
 *
 * A liked song is also saved to the library: liking something you do not have
 * and then not finding it anywhere would be a lie.
 */

interface LikesState {
  ids: Set<string>;
  ready: boolean;
}

class LikesStore extends Store<LikesState> {
  constructor() {
    super({ ids: new Set(), ready: false });
  }

  async load() {
    const ids = await getFavoriteIds('track').catch(() => new Set<string>());
    this.set({ ids, ready: true });
  }

  isLiked(trackId: string): boolean {
    return this.getSnapshot().ids.has(trackId);
  }

  /** Returns the new state: true when the song is now liked. */
  async toggle(track: Track): Promise<boolean> {
    const liked = await toggleFavorite('track', track.id);
    const ids = new Set(this.getSnapshot().ids);
    if (liked) {
      ids.add(track.id);
      await addTrackToLibrary(track).catch(() => {});
    } else {
      ids.delete(track.id);
    }
    this.set({ ids });
    return liked;
  }
}

export const likesStore = new LikesStore();
