import type { Track } from '@/src/core/types';
import { getArtistProfile } from '@/src/discovery/artists';
import { saveSystemPlaylist } from '@/src/db/repos/playlists';

/**
 * Hidden gems: songs by artists hardly anyone has found yet.
 *
 * An artist counts as hidden when every source that reports an audience
 * (Deezer fans, TheAudioDB followers, Last.fm listeners) puts it under ten
 * thousand. An artist no source knows at all is left out rather than guessed
 * at — unknown is not the same as small.
 */

export const HIDDEN_GEMS_ID = 'pl_hidden_gems';
export const HIDDEN_GEMS_NAME = 'Hidden Gems';
export const HIDDEN_GEMS_DESCRIPTION = 'Artists with under 10K listeners, picked from your taste.';
export const HIDDEN_AUDIENCE = 10_000;

const MAX_ARTISTS = 40;
const LOOKUPS_AT_ONCE = 4;

export async function findHiddenGems(candidates: Track[], limit = 30): Promise<Track[]> {
  const artists = [...new Set(candidates.map((t) => t.artistName))].slice(0, MAX_ARTISTS);
  const small = new Set<string>();
  for (let i = 0; i < artists.length; i += LOOKUPS_AT_ONCE) {
    const batch = artists.slice(i, i + LOOKUPS_AT_ONCE);
    const profiles = await Promise.all(batch.map((name) => getArtistProfile(name).catch(() => null)));
    profiles.forEach((profile, index) => {
      if (profile?.audience != null && profile.audience < HIDDEN_AUDIENCE) small.add(batch[index]);
    });
  }
  // One song per artist first, so the list is many discoveries, not one.
  const first: Track[] = [];
  const rest: Track[] = [];
  const used = new Set<string>();
  for (const track of candidates) {
    if (!small.has(track.artistName)) continue;
    (used.has(track.artistName) ? rest : first).push(track);
    used.add(track.artistName);
  }
  const gems = [...first, ...rest].slice(0, limit);
  if (gems.length > 0) {
    await saveSystemPlaylist(HIDDEN_GEMS_ID, HIDDEN_GEMS_NAME, HIDDEN_GEMS_DESCRIPTION, gems).catch(
      () => {},
    );
  }
  return gems;
}
