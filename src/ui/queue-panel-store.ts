import { Store } from '@/src/core/store';

export type QueuePanelTab = 'queue' | 'recent';

interface QueuePanelState {
  /** The panel is showing on the right of the window (laptops only). */
  open: boolean;
  tab: QueuePanelTab;
}

const KEY = 'pulse-queue-panel';

function remembered(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'open';
  } catch {
    return false;
  }
}

/** Whether the queue panel is open, remembered between visits on the web. */
class QueuePanelStore extends Store<QueuePanelState> {
  constructor() {
    super({ open: remembered(), tab: 'queue' });
  }

  toggle() {
    this.setOpen(!this.getSnapshot().open);
  }

  setOpen(open: boolean) {
    this.set({ open });
    try {
      globalThis.localStorage?.setItem(KEY, open ? 'open' : 'closed');
    } catch {
      // Private windows and blocked storage: the panel simply starts closed next time.
    }
  }

  setTab(tab: QueuePanelTab) {
    this.set({ tab });
  }
}

export const queuePanel = new QueuePanelStore();
