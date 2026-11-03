import * as Network from 'expo-network';
import { Store } from '@/src/core/store';

/**
 * Online or not, and whether Pulse is in offline mode.
 *
 * When the connection drops, Pulse asks once (a card in the middle of the
 * screen) and, on "Go to offline mode", rearranges itself around what still
 * works without the internet: the listener's own files, downloads, playlists
 * and an offline radio. When the internet comes back it switches back on its
 * own — offline mode is never something to remember to turn off.
 */

interface ConnectionState {
  online: boolean;
  /** The app is laid out for no internet. */
  offlineMode: boolean;
  /** The "you're offline" card is showing. */
  asking: boolean;
  /** Set for a moment after coming back, so the app can say so. */
  justReconnected: boolean;
}

/** The connection must stay down this long before Pulse calls it offline. */
const OFFLINE_AFTER_MS = 6000;
/** And stay up this long before offline mode ends. */
const ONLINE_AFTER_MS = 2500;

class ConnectionStore extends Store<ConnectionState> {
  private started = false;
  private pending: ReturnType<typeof setTimeout> | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    void Network.getNetworkStateAsync()
      .then((state) => this.report(isOnline(state)))
      .catch(() => {});
    Network.addNetworkStateListener((state) => this.report(isOnline(state)));
  }

  /**
   * Phones report reachability in flickers — yes, unknown, no, yes — several
   * times a second while a signal settles. Acting on each one rebuilt Home
   * over and over, so a change only counts once it has held for a moment.
   */
  private report(online: boolean) {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    if (online === this.getSnapshot().online) return;
    this.pending = setTimeout(() => this.apply(online), online ? ONLINE_AFTER_MS : OFFLINE_AFTER_MS);
  }

  private apply(online: boolean) {
    const before = this.getSnapshot();
    if (online === before.online) return;
    if (online) {
      // Back: offline mode ends by itself.
      this.set({ online: true, offlineMode: false, asking: false, justReconnected: before.offlineMode });
      if (before.offlineMode) setTimeout(() => this.set({ justReconnected: false }), 4000);
    } else {
      this.set({ online: false, asking: !before.offlineMode });
    }
  }

  goOffline() {
    this.set({ offlineMode: true, asking: false });
  }

  /** "Not now": stay as is; the card does not come back until the next drop. */
  dismiss() {
    this.set({ asking: false });
  }
}

function isOnline(state: Network.NetworkState): boolean {
  // No network at all is offline. Reachability alone is too jumpy to trust:
  // it reads "no" for a moment on every handover between cell towers.
  return state.isConnected !== false;
}

export const connection = new ConnectionStore({
  online: true,
  offlineMode: false,
  asking: false,
  justReconnected: false,
});
