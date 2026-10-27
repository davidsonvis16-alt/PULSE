import { AppState } from 'react-native';
import { db } from '@/src/db/client';
import { downloadManager } from '@/src/downloads/manager';
import { playerStore } from '@/src/audio/player';
import { config } from '@/src/core/config';
import { setActiveMusicProvider } from '@/src/providers/music';
import { getProfile, saveProfile } from '@/src/db/repos/social';
import { pruneStaleEvents } from '@/src/db/repos/events';
import { pruneStaleNotifications } from '@/src/db/repos/notifications';
import { checkForNewReleases } from '@/src/discovery/releases';
import { startLibraryWatch } from '@/src/ingestion/watch';
import { applyConfidentMatches } from '@/src/ingestion/identify/apply';
import { artworkRepair } from '@/src/ingestion/artwork/backfill';
import { likesStore } from '@/src/ui/likes';
import { checkMusicWorld } from '@/src/news/notify';

/**
 * App start-up, in the order things depend on each other:
 * database first, then anything that reads it.
 *
 * Nothing here blocks on the network. Release checking runs in the background
 * so a slow connection never holds up the first screen.
 */
export async function initializePulse(): Promise<void> {
  await db();

  try {
    setActiveMusicProvider(config.music.provider);
  } catch {
    // An unknown provider id in configuration falls back to the default rather
    // than taking the app down.
  }

  const profile = await getProfile();
  if (!profile) {
    await saveProfile({
      handle: null,
      displayName: null,
      activityPublic: false,
      statsPublic: false,
      libraryPublic: false,
    });
  }

  await downloadManager.init();
  await playerStore.init();
  await likesStore.load();

  startBackgroundWork();
  // Quietly finds covers for anything imported without one, including music
  // that came in before Pulse could reach the catalogue.
  void artworkRepair.run({ limit: 200 }).catch(() => {});
  // Songs left waiting on a match that is now good enough get it applied.
  void applyConfidentMatches().catch(() => {});
  // Picks up music added to the device since last launch, if the user has
  // already granted access and imported something.
  void startLibraryWatch().catch(() => {});
}

/**
 * The work that keeps the app current.
 *
 * New releases, award news and the notification centre are not things that
 * happen once at launch. Running them only on a cold start meant an app left
 * open all day — or resumed from the background, which is most of the time —
 * never noticed that a record had come out. So they run at launch and again
 * whenever the app comes back to the foreground after being away a while.
 *
 * Each one is cheap to call needlessly: every check keeps its own last-run
 * timestamp and returns immediately if it is too soon, so this is a trigger
 * rather than a schedule.
 */
let backgroundWorkStarted = false;

function startBackgroundWork() {
  const run = () => {
    void pruneStaleEvents().catch(() => {});
    // Announcements that have stopped being news leave the notification centre.
    void pruneStaleNotifications().catch(() => {});
    void checkForNewReleases().catch(() => {});
    // Nominations, winners and headlines about the artists in the library.
    void checkMusicWorld().catch(() => {});
  };

  run();

  // Start-up can be retried from the error screen, and one listener is enough.
  if (backgroundWorkStarted) return;
  backgroundWorkStarted = true;

  /** Below this, coming back is flicking between apps rather than returning. */
  const AWAY_MS = 5 * 60 * 1000;
  let leftAt = 0;

  AppState.addEventListener('change', (state) => {
    if (state !== 'active') {
      if (!leftAt) leftAt = Date.now();
      return;
    }
    const away = leftAt ? Date.now() - leftAt : 0;
    leftAt = 0;
    if (away >= AWAY_MS) run();
  });
}
