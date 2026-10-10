import type { Album } from '@/src/core/types';
import { musicProvider } from '@/src/providers/music';
import { getFollowedArtists, getFollowState, markArtistChecked } from '@/src/db/repos/library';
import { pushNotification } from '@/src/db/repos/notifications';
import { getNotificationPrefs, getSetting, setSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';

/**
 * New-release tracking for followed artists.
 *
 * Pulse remembers the newest release it has already told the user about for
 * each artist, so an artist with nothing new produces no notification at all.
 * This is what keeps the notification centre worth opening.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function getNewReleasesFromFollowed(limit = 20): Promise<Album[]> {
  const followed = await getFollowedArtists();
  if (followed.length === 0) return [];
  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  return musicProvider()
    .getNewReleases({ artistIds: followed.map((a) => a.id), limit, since })
    .catch(() => []);
}

export async function checkForNewReleases(options: { force?: boolean } = {}): Promise<Album[]> {
  const lastChecked = Number((await getSetting(SETTINGS_KEYS.lastReleaseCheck)) ?? 0);
  if (!options.force && Date.now() - lastChecked < CHECK_INTERVAL_MS) return [];

  const [followed, state, prefs] = await Promise.all([
    getFollowedArtists(),
    getFollowState(),
    getNotificationPrefs(),
  ]);
  if (followed.length === 0) return [];

  const seenByArtist = new Map(state.map((s) => [s.artistId, s]));
  const provider = musicProvider();
  const announced: Album[] = [];

  for (const artist of followed) {
    const releases = await provider
      .getNewReleases({ artistIds: [artist.id], limit: 4 })
      .catch(() => [] as Album[]);
    if (releases.length === 0) continue;

    const latest = releases[0];
    const previous = seenByArtist.get(artist.id);
    const isNew =
      !!latest.releaseDate &&
      (!previous?.lastSeenReleaseDate ||
        Date.parse(latest.releaseDate) > Date.parse(previous.lastSeenReleaseDate));

    if (isNew) {
      announced.push(latest);
      if (prefs.newReleases && previous?.notify !== false) {
        await pushNotification({
          type: 'new_release',
          title: `New from ${artist.name}`,
          body: `${latest.title}${latest.albumType === 'single' ? ' (single)' : ''}`,
          entityType: 'album',
          entityId: latest.id,
          imageUrl: latest.artworkUrl,
        });
      }
    }
    await markArtistChecked(artist.id, latest.releaseDate);
  }

  await setSetting(SETTINGS_KEYS.lastReleaseCheck, String(Date.now()));
  return announced;
}
