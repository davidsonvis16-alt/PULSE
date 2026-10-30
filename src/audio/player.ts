import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { Store } from '@/src/core/store';
import type { PlayableSource, Track } from '@/src/core/types';
import { providerFor } from '@/src/providers/music';
import { LOCAL_PROVIDER_ID } from '@/src/db/repos/local';
import { downloadManager } from '@/src/downloads/manager';
import { beginPlay, updatePlay, type PlayContext } from '@/src/db/repos/history';
import { getPlaybackPrefs, setPlaybackPrefs } from '@/src/db/repos/settings';
import { publishListening } from '@/src/social/sync';
import { ownedMatchOf } from '@/src/library/owned';
import { FREESTYLE_PROVIDER_ID } from '@/src/radio/freestyle-provider';

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
  /** True while Pulse is sharing the phone's audio with other apps. */
  mixWithOtherApps: boolean;
  /** True for the moment the audio session is being reconfigured. */
  retuning: boolean;
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
  mixWithOtherApps: false,
  retuning: false,
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

/**
 * How Pulse asks for the phone's audio.
 *
 * `duckOthers` is what a music app should normally do: take focus, and let
 * whatever else was playing drop under it. `mixWithOthers` asks for no focus at
 * all, so Pulse plays alongside another app instead of taking over from it —
 * over a podcast, a game, or a call's background noise.
 *
 * Background playback is on either way. That is the setting that keeps a song
 * going after the app is left, and it is not something a listener should have
 * to find.
 */
async function applyAudioMode(mixWithOtherApps: boolean) {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    // Off by default, Pulse asks other apps to stop rather than play quietly underneath.
    interruptionMode: mixWithOtherApps ? 'mixWithOthers' : 'doNotMix',
    allowsRecording: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => {});
}

/** How long a song may take to make a sound before Pulse calls it a failure. */
const START_TIMEOUT_MS = 15_000;
/** After this many songs fail back to back, Pulse stops skipping and says so. */
const MAX_FAILED_IN_A_ROW = 3;
/** The same, for a file already on the phone, which should start at once. */
const LOCAL_START_TIMEOUT_MS = 4_000;

class PlayerStore extends Store<PlayerState> {
  private player: AudioPlayer | null = null;
  private subscription: { remove: () => void } | null = null;
  /** Queue order before shuffle, so turning shuffle off restores it. */
  private unshuffled: Track[] = [];
  private playId = 0;
  private lastReportedMs = 0;
  private historyTimer: ReturnType<typeof setInterval> | null = null;
  private loadToken = 0;
  /** Set while a song has been asked to play and has not made a sound yet. */
  private startWatch: { token: number; track: Track; since: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** Other addresses for the song loading now, tried if the first stays silent. */
  private alternates: string[] = [];
  /** Songs that failed back to back, so a broken queue cannot skip forever. */
  private failedInARow = 0;

  constructor() {
    super(EMPTY);
  }

  async init() {
    const prefs = await getPlaybackPrefs();
    await applyAudioMode(prefs.mixWithOtherApps);
    this.set({
      repeat: prefs.repeat,
      shuffle: prefs.shuffle,
      volume: prefs.volume,
      mixWithOtherApps: prefs.mixWithOtherApps,
    });

    this.player = createAudioPlayer(null, { updateInterval: 500 });
    this.player.volume = prefs.volume;
    this.subscription = this.player.addListener('playbackStatusUpdate', (status) =>
      this.onStatus(status),
    );
  }

  /** Where the last status update put the song, and when it arrived. */
  private lastSeen: { ms: number; at: number } | null = null;
  /** Until this time, position jumps are Pulse's own doing (seeks, new songs). */
  private ownJumpUntil = 0;

  /**
   * The phone's media notification only offers "10 seconds back" and "10
   * seconds forward" (expo-audio keeps the queue in JS, out of its reach).
   * Pulse turns them into previous and next: a jump of about ten seconds that
   * Pulse did not make itself came from those buttons.
   */
  private notificationSkip(status: AudioStatus) {
    const ms = Math.round(status.currentTime * 1000);
    const now = Date.now();
    const last = this.lastSeen;
    this.lastSeen = { ms, at: now };
    if (!last || now < this.ownJumpUntil || this.isRadio || !status.isLoaded) return;
    const expected = status.playing ? now - last.at : 0;
    const jump = ms - last.ms - expected;
    const TEN = 10_000;
    if (jump > TEN - 2000 && jump < TEN + 2000) {
      this.ownJumpUntil = now + 2000;
      void this.next();
    } else if (jump < -(TEN - 2000) && jump > -(TEN + 2000)) {
      this.ownJumpUntil = now + 2000;
      void this.previous();
    } else if (ms < 1000 && last.ms > 1500 && last.ms < TEN + 2000 && jump < -1000) {
      // "Back" in the first ten seconds lands on zero instead of ten back.
      this.ownJumpUntil = now + 2000;
      void this.previous();
    }
  }

  /** A song change or a seek Pulse made: the jump it causes is not a button. */
  private markOwnJump() {
    this.ownJumpUntil = Date.now() + 3000;
    this.lastSeen = null;
  }

  private onStatus(status: AudioStatus) {
    this.notificationSkip(status);
    progressStore.update(
      Math.max(0, Math.round(status.currentTime * 1000)),
      Math.max(0, Math.round((status.duration || 0) * 1000)),
    );

    const state = this.getSnapshot();
    if (state.isPlaying !== status.playing || state.isBuffering !== status.isBuffering) {
      this.set({ isPlaying: status.playing, isBuffering: status.isBuffering });
    }
    if (status.isLoaded && state.isLoading) this.set({ isLoading: false });

    if (this.startWatch) {
      if (status.playing) {
        this.clearStartWatch();
        this.failedInARow = 0;
      } else if (
        status.playbackState === 'idle' &&
        Date.now() - this.startWatch.since > 1500
      ) {
        // The native player drops back to idle when it cannot open the audio,
        // and says nothing else. Treat that as the failure it is.
        void this.failedToStart(this.startWatch.token, this.startWatch.track);
      }
    }

    if (status.didJustFinish) void this.onTrackFinished();
  }

  /* ------------------------------------------------------------- listening */

  private startHistory(track: Track, offline: boolean) {
    this.stopHistory(false);
    // Freestyles are people's own takes, not music from the listener's taste:
    // they stay out of listening history, statistics and recommendations.
    if (track.provider === FREESTYLE_PROVIDER_ID) return;
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
    // The radio runs to a schedule everyone shares, so shuffle never applies to it.
    const shuffle = this.getSnapshot().shuffle && options.context !== 'radio';
    const ordered = shuffle ? shuffleAround(queue, index) : queue;
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

  private async load(requested: Track, options: { startPositionMs?: number } = {}) {
    if (!this.player) await this.init();
    const token = ++this.loadToken;

    this.stopHistory(false, true);
    progressStore.reset();
    this.set({ current: requested, isLoading: true, error: null, source: null, isOffline: false });

    try {
      // A suggestion the listener already owns is played from their own file:
      // the whole song instead of a preview, and no network at all.
      const track =
        requested.provider === FREESTYLE_PROVIDER_ID
          ? requested
          : ((await ownedMatchOf(requested).catch(() => null)) ?? requested);
      if (track.id !== requested.id) {
        if (token !== this.loadToken) return;
        this.set({ current: track });
        this.replaceInQueue(requested.id, track);
      }

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
        const provider = providerFor(track.provider);
        source = await provider.getPlayableSource(track);
        // A file already on the device needs no network, so it counts as
        // offline playback just as a download does.
        offline = provider.id === LOCAL_PROVIDER_ID;
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

      this.alternates = [...(source.alternates ?? [])];
      this.markOwnJump();
      this.player!.replace({ uri: source.uri });
      this.player!.volume = this.getSnapshot().volume;
      this.player!.loop = this.getSnapshot().repeat === 'one';
      // Silent until positioned, so joining part-way does not open with a blip
      // of the first second.
      if (options.startPositionMs) this.player!.volume = 0;
      this.player!.play();
      if (options.startPositionMs) {
        // A stream cannot be positioned until it has loaded; seeking straight
        // after `replace` is silently dropped on some platforms.
        const player = this.player!;
        for (let waited = 0; !player.isLoaded && waited < 8000; waited += 100) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (token !== this.loadToken) return;
        }
        this.markOwnJump();
        await player.seekTo(options.startPositionMs / 1000).catch(() => {});
        player.volume = this.getSnapshot().volume;
      }
      this.watchStart(token, track, source.uri);

      this.set({ source, isOffline: offline, isLoading: false, isPlaying: true });
      this.startHistory(track, offline);
      this.showNotification(track);
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

  /**
   * Notices a song that never starts.
   *
   * The native player reports nothing when a file cannot be opened or a stream
   * cannot be reached: it simply stays silent while the screen says it is
   * playing. So every load is watched until the first moment of real playback.
   */
  private watchStart(token: number, track: Track, uri: string) {
    this.clearStartWatch();
    // A file on the phone opens at once; only the network deserves patience.
    const wait = /^https?:/.test(uri) ? START_TIMEOUT_MS : LOCAL_START_TIMEOUT_MS;
    const timer = setTimeout(() => void this.failedToStart(token, track), wait);
    this.startWatch = { token, track, since: Date.now(), timer };
  }

  private clearStartWatch() {
    if (this.startWatch) clearTimeout(this.startWatch.timer);
    this.startWatch = null;
  }

  private async failedToStart(token: number, track: Track) {
    if (!this.startWatch || this.startWatch.token !== token || token !== this.loadToken) return;
    this.clearStartWatch();

    // Same song, another way in.
    const next = this.alternates.shift();
    if (next && this.player) {
      this.markOwnJump();
      this.player.replace({ uri: next });
      this.player.play();
      this.watchStart(token, track, next);
      return;
    }

    this.player?.pause();
    this.stopHistory(false);
    this.failedInARow += 1;
    this.set({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      error:
        track.provider === LOCAL_PROVIDER_ID
          ? `Couldn't open "${track.title}" on this phone.`
          : `Couldn't play "${track.title}". Check your connection.`,
    });

    // Move on rather than leave the listener in silence, but only a few times:
    // a whole queue that will not play needs a person, not an endless skip.
    const { queue, index } = this.getSnapshot();
    if (this.failedInARow < MAX_FAILED_IN_A_ROW && index + 1 < queue.length) {
      this.set({ index: index + 1 });
      await this.load(queue[index + 1]);
    }
  }

  /** Keeps the queue pointing at the copy that is actually playing. */
  private replaceInQueue(oldId: string, track: Track) {
    const { queue } = this.getSnapshot();
    const at = queue.findIndex((item) => item.id === oldId);
    if (at === -1) return;
    const next = [...queue];
    next[at] = track;
    this.unshuffled = this.unshuffled.map((item) => (item.id === oldId ? track : item));
    this.set({ queue: next });
  }

  /**
   * The playback notification.
   *
   * Android draws this in the shade and on the lock screen, iOS on the lock
   * screen and in Control Centre: cover, title, artist and transport controls
   * that drive this same player, so pausing from outside the app is reflected
   * back here through `playbackStatusUpdate` without any extra plumbing.
   *
   * It is a bonus, never a reason to fail playback, so every call is guarded.
   *
   * What is on it is what the audio session offers: play/pause, and ten
   * seconds either way — which Pulse turns into previous and next (see
   * notificationSkip), since the queue lives here in JS, not in the session.
   */
  private showNotification(track: Track) {
    try {
      this.player?.setActiveForLockScreen(
        true,
        {
          title: track.title,
          artist: track.artistName,
          albumTitle: track.albumTitle ?? undefined,
          // The notification and lock screen draw it large: ask for a bigger cut.
          artworkUrl: track.artworkUrl?.replace(/\/\d+x\d+bb\./, '/1000x1000bb.') ?? undefined,
        },
        { showSeekForward: true, showSeekBackward: true },
      );
    } catch {
      /* no media session on this platform */
    }
  }

  private hideNotification() {
    try {
      this.player?.clearLockScreenControls();
    } catch {
      /* nothing to clear */
    }
  }

  /* -------------------------------------------------------------- controls */

  play() {
    this.player?.play();
    this.set({ isPlaying: true });
  }

  pause() {
    this.clearStartWatch();
    this.player?.pause();
    this.set({ isPlaying: false });
    const { positionMs } = progressStore.getSnapshot();
    if (this.playId) void updatePlay(this.playId, positionMs);
  }

  toggle() {
    if (this.getSnapshot().isPlaying) this.pause();
    else this.play();
  }

  /** True while the radio is what is playing: forward only, no scrubbing. */
  get isRadio() {
    return this.getSnapshot().context === 'radio';
  }

  async seekTo(ms: number) {
    // A radio has no scrub bar. Nothing to rewind to and nothing to skip past.
    if (this.isRadio) return;
    this.markOwnJump();
    await this.player?.seekTo(Math.max(0, ms) / 1000).catch(() => {});
    progressStore.update(ms, progressStore.getSnapshot().durationMs);
  }

  async skipForward(seconds = 15) {
    const { positionMs, durationMs } = progressStore.getSnapshot();
    await this.seekTo(Math.min(positionMs + seconds * 1000, durationMs || positionMs));
  }

  async skipBackward(seconds = 15) {
    if (this.isRadio) return;
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
    // The radio only goes forward; a song that has played is gone.
    if (this.isRadio) return;
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

  /**
   * Shares the phone's audio with other apps, or takes it back.
   *
   * The audio session has to be torn down and rebuilt to change this, and the
   * OS stops playback while that happens — so rather than let the music cut out
   * and stay out, Pulse pauses deliberately, retunes, and picks the song back
   * up exactly where it was. `retuning` is true for that moment so the control
   * can show what it is doing instead of looking broken.
   */
  /**
   * Puts the playback audio session back after something else (the freestyle
   * recorder) changed it.
   */
  async restoreAudioMode() {
    await applyAudioMode(this.getSnapshot().mixWithOtherApps);
  }

  async setMixWithOtherApps(mix: boolean) {
    if (this.getSnapshot().mixWithOtherApps === mix) return;

    const wasPlaying = this.getSnapshot().isPlaying;
    const { positionMs } = progressStore.getSnapshot();

    this.set({ retuning: true });
    if (wasPlaying) this.pause();

    await applyAudioMode(mix);
    this.set({ mixWithOtherApps: mix });
    await this.persistPrefs();

    if (wasPlaying) {
      // Some platforms drop the playhead when the session is rebuilt.
      await this.seekTo(positionMs);
      this.play();
    }
    this.set({ retuning: false });
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
    const { queue, index } = this.getSnapshot();
    if (indexInQueue < 0 || indexInQueue >= queue.length) return;
    // On the radio you can let it run on, but you cannot go back for something.
    if (this.isRadio && indexInQueue <= index) return;
    this.stopHistory(false, true);
    this.set({ index: indexInQueue });
    await this.load(queue[indexInQueue]);
  }

  clearQueue() {
    this.stopHistory(false);
    this.player?.pause();
    this.hideNotification();
    this.unshuffled = [];
    progressStore.reset();
    this.set({ queue: [], index: -1, current: null, isPlaying: false, source: null });
  }

  private async persistPrefs() {
    const { repeat, shuffle, volume, mixWithOtherApps } = this.getSnapshot();
    const prefs = await getPlaybackPrefs();
    await setPlaybackPrefs({ ...prefs, repeat, shuffle, volume, mixWithOtherApps });
  }

  dispose() {
    this.clearStartWatch();
    this.stopHistory(false);
    this.hideNotification();
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
