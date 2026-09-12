import { db } from '@/src/db/client';
import { downloadManager } from '@/src/downloads/manager';
import { playerStore } from '@/src/audio/player';
import { config } from '@/src/core/config';
import { setActiveMusicProvider } from '@/src/providers/music';
import { getProfile, saveProfile } from '@/src/db/repos/social';
import { pruneStaleEvents } from '@/src/db/repos/events';
import { checkForNewReleases } from '@/src/discovery/releases';
import { startLibraryWatch } from '@/src/ingestion/watch';
import { artworkRepair } from '@/src/ingestion/artwork/backfill';
import { likesStore } from '@/src/ui/likes';

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

  void pruneStaleEvents();
  void checkForNewReleases().catch(() => {});
  // Quietly finds covers for anything imported without one, including music
  // that came in before Pulse could reach the catalogue.
  void artworkRepair.run({ limit: 200 }).catch(() => {});
  // Picks up music added to the device since last launch, if the user has
  // already granted access and imported something.
  void startLibraryWatch().catch(() => {});
}
