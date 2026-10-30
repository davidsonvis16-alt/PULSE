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

class ConnectionStore extends Store<ConnectionState> {
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    void Network.getNetworkStateAsync()
      .then((state) => this.apply(isOnline(state)))
      .catch(() => {});
    Network.addNetworkStateListener((state) => this.apply(isOnline(state)));
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
  if (state.isConnected === false) return false;
  // "Connected" to a network that does not reach the internet is still offline.
  return state.isInternetReachable !== false;
}

export const connection = new ConnectionStore({
  online: true,
  offlineMode: false,
  asking: false,
  justReconnected: false,
});
