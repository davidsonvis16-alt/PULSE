/**
 * Minimal observable store.
 *
 * The player and the download manager live outside React (audio and file
 * transfers outlive any screen), so components subscribe to them through
 * useSyncExternalStore. Snapshots are replaced, never mutated, so React can
 * tell what changed.
 */
export class Store<T> {
  private listeners = new Set<() => void>();
  private state: T;

  constructor(initial: T) {
    this.state = initial;
  }

  getSnapshot = (): T => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  protected set(patch: Partial<T> | ((prev: T) => Partial<T>)) {
    const next = typeof patch === 'function' ? (patch as (p: T) => Partial<T>)(this.state) : patch;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  protected replace(next: T) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
