import type { Track } from '@/src/core/types';
import { listLocalTracks } from '@/src/db/repos/local';
import { getAllDownloads } from '@/src/db/repos/downloads';
import { playerStore } from '@/src/audio/player';

/** Every song that plays with no internet: the listener's own files, then downloads. */
export async function offlineTracks(): Promise<Track[]> {
  const [local, downloads] = await Promise.all([listLocalTracks({ limit: 2000 }), getAllDownloads()]);
  const own = local.map((entry) => entry.track);
  const seen = new Set(own.map((t) => t.id));
  const downloaded = downloads
    .filter((d) => d.status === 'completed' && !seen.has(d.track.id))
    .map((d) => d.track);
  return [...own, ...downloaded];
}

/** Offline Radio: everything on the phone, shuffled, nonstop. Resolves false when there is nothing. */
export async function playOfflineRadio(): Promise<boolean> {
  const tracks = await offlineTracks();
  if (tracks.length === 0) return false;
  await playerStore.playQueue(tracks, { context: 'library', contextLabel: 'Offline Radio', shuffle: true });
  return true;
}
