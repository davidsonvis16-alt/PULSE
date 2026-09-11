import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { Store } from '@/src/core/store';
import type { PlayableSource, Track } from '@/src/core/types';
import { providerFor } from '@/src/providers/music';
import { downloadManager } from '@/src/downloads/manager';
import { beginPlay, updatePlay, type PlayContext } from '@/src/db/repos/history';
import { getPlaybackPrefs, setPlaybackPrefs } from '@/src/db/repos/settings';
import { publishListening } from '@/src/social/sync';

/**
 * The global player.
 *
 * It lives outside React because audio outlives screens: navigating away from a
 * song must not interrupt it. Screens subscribe to two separate snapshots —
 * `playerStore` for what is playing, `progressStore` for where it is — so a
 * twice-a-second progress tick does not re-render the whole app.
 *
 * Downloaded audio always wins over the network: if a track is on the device,
 * that is the file we play, which is what makes offline playback work without
 * a separate "offline mode".
 */

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  queue: Track[];
  index: number;
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  /** Where the audio came from, shown verbatim in the player. */
  source: PlayableSource | null;
  /** True when the file is local, so we are not using the network. */
  isOffline: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  error: string | null;
  context: PlayContext;
  contextLabel: string | null;
  moodId: string | null;
}

export interface ProgressState {
  positionMs: number;
  durationMs: number;
}

const EMPTY: PlayerState = {
  queue: [],
  index: -1,
  current: null,
  isPlaying: false,
  isLoading: false,
  isBuffering: false,
  source: null,
  isOffline: false,
  repeat: 'off',
  shuffle: false,
  volume: 1,
  error: null,
  context: 'library',
  contextLabel: null,
  moodId: null,
};

class ProgressStore extends Store<ProgressState> {
  constructor() {
    super({ positionMs: 0, durationMs: 0 });
  }
  update(positionMs: number, durationMs: number) {
    const prev = this.getSnapshot();
    // Ignore sub-250ms jitter so we are not waking subscribers for nothing.
    if (Math.abs(prev.positionMs - positionMs) < 250 && prev.durationMs === durationMs) return;
    this.set({ positionMs, durationMs });
  }
  reset() {
    this.set({ positionMs: 0, durationMs: 0 });
  }
}

export const progressStore = new ProgressStore();

class PlayerStore extends Store<PlayerState> {
  private player: AudioPlayer | null = null;
  private subscription: { remove: () => void } | null = null;
  /** Queue order before shuffle, so turning shuffle off restores it. */
  private unshuffled: Track[] = [];
  private playId = 0;
  private lastReportedMs = 0;
  private historyTimer: ReturnType<typeof setInterval> | null = null;
  private loadToken = 0;

  constructor() {
    super(EMPTY);
  }

  async init() {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});

    const prefs = await getPlaybackPrefs();
    this.set({ repeat: prefs.repeat, shuffle: prefs.shuffle, volume: prefs.volume });

    this.player = createAudioPlayer(null, { updateInterval: 500 });
    this.player.volume = prefs.volume;
    this.subscription = this.player.addListener('playbackStatusUpdate', (status) =>
      this.onStatus(status),
    );
  }

  private onStatus(status: AudioStatus) {
    progressStore.update(
      Math.max(0, Math.round(status.currentTime * 1000)),
      Math.max(0, Math.round((status.duration || 0) * 1000)),
    );

    const state = this.getSnapshot();
    if (state.isPlaying !== status.playing || state.isBuffering !== status.isBuffering) {
      this.set({ isPlaying: status.playing, isBuffering: status.isBuffering });
    }
    if (status.isLoaded && state.isLoading) this.set({ isLoading: false });

    if (status.didJustFinish) void this.onTrackFinished();
  }

  /* ------------------------------------------------------------- listening */

  private startHistory(track: Track, offline: boolean) {
    this.stopHistory(false);
    const state = this.getSnapshot();
    void beginPlay(track, {
      context: state.context,
      moodId: state.moodId,
      offline,
    }).then((id) => {
      this.playId = id;
    });
    this.lastReportedMs = 0;
    this.historyTimer = setInterval(() => {
      const { positionMs } = progressStore.getSnapshot();
      if (positionMs > this.lastReportedMs) {
        this.lastReportedMs = positionMs;
        void updatePlay(this.playId, positionMs);
      }
    }, 5000);
  }

  private stopHistory(completed: boolean, skipped = false) {
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = null;
    }
    if (!this.playId) return;
    const { positionMs } = progressStore.getSnapshot();
    void updatePlay(this.playId, Math.max(positionMs, this.lastReportedMs), { completed, skipped });
    this.playId = 0;
  }

  /* ----------------------------------------------------------------- queue */

  async playTrack(
    track: Track,
    options: {
      queue?: Track[];
      context?: PlayContext;
      contextLabel?: string | null;
      moodId?: string | null;
      startPositionMs?: number;
    } = {},
  ) {
    const queue = options.queue?.length ? options.queue : [track];
    const index = Math.max(
      0,
      queue.findIndex((t) => t.id === track.id),
    );
    this.unshuffled = queue;
    const ordered = this.getSnapshot().shuffle ? shuffleAround(queue, index) : queue;
    const orderedIndex = ordered.findIndex((t) => t.id === track.id);

    this.set({
      queue: ordered,
      index: orderedIndex,
      context: options.context ?? 'library',
      contextLabel: options.contextLabel ?? null,
      moodId: options.moodId ?? null,
    });
    await this.load(ordered[orderedIndex], { startPositionMs: options.startPositionMs });
  }

  async playQueue(
    tracks: Track[],
    options: { startIndex?: number; context?: PlayContext; contextLabel?: string | null; shuffle?: boolean } = {},
  ) {
    if (tracks.length === 0) return;
    if (options.shuffle !== undefined) await this.setShuffle(options.shuffle);
    const startIndex = options.startIndex ?? 0;
    await this.playTrack(tracks[startIndex], {
      queue: tracks,
      context: options.context,
      contextLabel: options.contextLabel,
    });
  }

  private async load(track: Track, options: { startPositionMs?: number } = {}) {
    if (!this.player) await this.init();
    const token = ++this.loadToken;

    this.stopHistory(false, true);
    progressStore.reset();
    this.set({ current: track, isLoading: true, error: null, source: null, isOffline: false });

    try {
      const localUri = downloadManager.localUri(track.id);
      let source: PlayableSource | null = null;
      let offline = false;

      if (localUri) {
        const record = downloadManager.getSnapshot().byTrackId[track.id];
        source = {
          uri: localUri,
          mimeType: 'audio/mp4',
          durationMs: null,
          isExcerpt: !!record?.isExcerpt,
          label: record?.sourceLabel ? `Downloaded · ${record.sourceLabel}` : 'Downloaded',
        };
        offline = true;
      } else {
        source = await providerFor(track.provider).getPlayableSource(track);
      }

      if (token !== this.loadToken) return;

      if (!source) {
        this.set({
          isLoading: false,
          isPlaying: false,
          error: 'This source has no playable audio for that track.',
        });
        return;
      }

      this.player!.replace({ uri: source.uri });
      this.player!.volume = this.getSnapshot().volume;
      this.player!.loop = this.getSnapshot().repeat === 'one';
      if (options.startPositionMs) {
        await this.player!.seekTo(options.startPositionMs / 1000).catch(() => {});
      }
      this.player!.play();

      this.set({ source, isOffline: offline, isLoading: false, isPlaying: true });
      this.startHistory(track, offline);
      this.updateLockScreen(track, source);
      // Shares this play only if the user turned activity sharing on.
      void publishListening(track).catch(() => {});
    } catch (error) {
      if (token !== this.loadToken) return;
      this.set({
        isLoading: false,
        isPlaying: false,
        error: error instanceof Error ? error.message : 'Could not start playback.',
      });
    }
  }

  private updateLockScreen(track: Track, source: PlayableSource) {
    try {
      this.player?.setActiveForLockScreen(true, {
        title: track.title,
        artist: track.artistName,
        albumTitle: track.albumTitle ?? undefined,
        artworkUrl: track.artworkUrl ?? undefined,
      });
    } catch {
      // Lock-screen controls are a bonus, never a reason to fail playback.
      void source;
    }
  }

  /* -------------------------------------------------------------- controls */

  play() {
    this.player?.play();
    this.set({ isPlaying: true });
  }

  pause() {
    this.player?.pause();
    this.set({ isPlaying: false });
    const { positionMs } = progressStore.getSnapshot();
    if (this.playId) void updatePlay(this.playId, positionMs);
  }

  toggle() {
    if (this.getSnapshot().isPlaying) this.pause();
    else this.play();
  }

  async seekTo(ms: number) {
    await this.player?.seekTo(Math.max(0, ms) / 1000).catch(() => {});
    progressStore.update(ms, progressStore.getSnapshot().durationMs);
  }

  async skipForward(seconds = 15) {
    const { positionMs, durationMs } = progressStore.getSnapshot();
    await this.seekTo(Math.min(positionMs + seconds * 1000, durationMs || positionMs));
  }

  async skipBackward(seconds = 15) {
    const { positionMs } = progressStore.getSnapshot();
    await this.seekTo(Math.max(0, positionMs - seconds * 1000));
  }

  async next(userInitiated = true) {
    const { queue, index, repeat } = this.getSnapshot();
    if (queue.length === 0) return;
    this.stopHistory(false, userInitiated);

    let nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (repeat === 'all') nextIndex = 0;
      else {
        this.pause();
        return;
      }
    }
    this.set({ index: nextIndex });
    await this.load(queue[nextIndex]);
  }

  async previous() {
    const { queue, index } = this.getSnapshot();
    const { positionMs } = progressStore.getSnapshot();
    // Standard behaviour: restart the track unless we are near the beginning.
    if (positionMs > 4000) {
      await this.seekTo(0);
      return;
    }
    if (queue.length === 0) return;
    const prevIndex = index - 1 < 0 ? queue.length - 1 : index - 1;
    this.stopHistory(false, true);
    this.set({ index: prevIndex });
    await this.load(queue[prevIndex]);
  }

  private async onTrackFinished() {
    this.stopHistory(true);
    const { repeat } = this.getSnapshot();
    if (repeat === 'one') {
      await this.seekTo(0);
      this.play();
      return;
    }
    await this.next(false);
  }

  async setRepeat(mode: RepeatMode) {
    this.set({ repeat: mode });
    if (this.player) this.player.loop = mode === 'one';
    await this.persistPrefs();
  }

  cycleRepeat() {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const next = order[(order.indexOf(this.getSnapshot().repeat) + 1) % order.length];
    void this.setRepeat(next);
  }

  async setShuffle(on: boolean) {
    const { queue, index } = this.getSnapshot();
    if (on) {
      if (this.unshuffled.length === 0) this.unshuffled = queue;
      const reordered = shuffleAround(this.unshuffled, this.unshuffled.findIndex((t) => t.id === queue[index]?.id));
      const newIndex = Math.max(0, reordered.findIndex((t) => t.id === queue[index]?.id));
      this.set({ shuffle: true, queue: reordered, index: newIndex });
    } else {
      const restored = this.unshuffled.length ? this.unshuffled : queue;
      const newIndex = Math.max(0, restored.findIndex((t) => t.id === queue[index]?.id));
      this.set({ shuffle: false, queue: restored, index: newIndex });
    }
    await this.persistPrefs();
  }

  toggleShuffle() {
    void this.setShuffle(!this.getSnapshot().shuffle);
  }

  async setVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    if (this.player) this.player.volume = clamped;
    this.set({ volume: clamped });
    await this.persistPrefs();
  }

  /* ----------------------------------------------------------- queue edits */

  addToQueue(tracks: Track[], position: 'next' | 'end' = 'end') {
    const { queue, index } = this.getSnapshot();
    const fresh = tracks.filter((t) => !queue.some((q) => q.id === t.id));
    if (fresh.length === 0) return;
    const next =
      position === 'next'
        ? [...queue.slice(0, index + 1), ...fresh, ...queue.slice(index + 1)]
        : [...queue, ...fresh];
    this.unshuffled = next;
    this.set({ queue: next });
  }

  removeFromQueue(trackId: string) {
    const { queue, index } = this.getSnapshot();
    const position = queue.findIndex((t) => t.id === trackId);
    if (position === -1 || position === index) return;
    const next = queue.filter((t) => t.id !== trackId);
    this.unshuffled = this.unshuffled.filter((t) => t.id !== trackId);
    this.set({ queue: next, index: position < index ? index - 1 : index });
  }

  async jumpTo(indexInQueue: number) {
    const { queue } = this.getSnapshot();
    if (indexInQueue < 0 || indexInQueue >= queue.length) return;
    this.stopHistory(false, true);
    this.set({ index: indexInQueue });
    await this.load(queue[indexInQueue]);
  }

  clearQueue() {
    this.stopHistory(false);
    this.player?.pause();
    this.unshuffled = [];
    progressStore.reset();
    this.set({ queue: [], index: -1, current: null, isPlaying: false, source: null });
  }

  private async persistPrefs() {
    const { repeat, shuffle, volume } = this.getSnapshot();
    const prefs = await getPlaybackPrefs();
    await setPlaybackPrefs({ ...prefs, repeat, shuffle, volume });
  }

  dispose() {
    this.stopHistory(false);
    this.subscription?.remove();
    this.player?.remove();
    this.player = null;
  }
}

/** Fisher-Yates over everything except the track being played right now. */
function shuffleAround(tracks: Track[], keepIndex: number): Track[] {
  if (tracks.length <= 1) return [...tracks];
  const rest = tracks.filter((_, i) => i !== keepIndex);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const head = keepIndex >= 0 && keepIndex < tracks.length ? [tracks[keepIndex]] : [];
  return [...head, ...rest];
}

export const playerStore = new PlayerStore();
