import type { Track } from '@/src/core/types';
import { rotate } from '@/src/discovery/rotation';

/**
 * Your Mix: the listener's own songs with new ones woven in.
 *
 * Two of theirs, then one they do not have yet, all the way down. Their own
 * music keeps it familiar enough to put on and leave; the new songs sit
 * between songs they already like, which is where a new song gets a fair hearing.
 */

export const YOUR_MIX_ID = 'pl_your_mix';
export const YOUR_MIX_NAME = 'Your Mix';
export const YOUR_MIX_DESCRIPTION = 'Your songs, with new ones picked for you mixed in.';

/** How long the mix is. About an hour and a half. */
export const MIX_SIZE = 30;
/** Own songs between each new one. */
const OWN_PER_NEW = 2;

/**
 * Builds the running order. Pure, so it can be tested.
 *
 * `own` is the listener's library, most-played first. `fresh` is lists of
 * suggestions, one per shelf, taken in turn so one artist cannot fill the mix.
 * `rotation` moves the window through the library so the mix changes over the
 * day instead of always opening with the same songs.
 */
export function buildMix(own: Track[], fresh: Track[][], rotation: number, size = MIX_SIZE): Track[] {
  const ownIds = new Set(own.map((track) => track.id));
  const seen = new Set<string>();
  const key = (track: Track) =>
    `${track.title.toLowerCase().trim()}|${track.artistName.toLowerCase().trim()}`;

  const newOnes: Track[] = [];
  const longest = Math.max(0, ...fresh.map((list) => list.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of fresh) {
      const track = list[i];
      if (!track || ownIds.has(track.id) || seen.has(key(track))) continue;
      seen.add(key(track));
      newOnes.push(track);
    }
  }

  // Two thirds theirs, unless there are not enough new songs to fill the rest
  // (offline, say), in which case their own music makes up the difference.
  const ownCount = Math.min(
    own.length,
    Math.max(Math.ceil((size * OWN_PER_NEW) / (OWN_PER_NEW + 1)), size - newOnes.length),
  );
  const mine = rotate(own, rotation * ownCount, ownCount).filter((track) => {
    if (seen.has(key(track))) return false;
    seen.add(key(track));
    return true;
  });

  const mix: Track[] = [];
  let m = 0;
  let n = 0;
  while (mix.length < size && (m < mine.length || n < newOnes.length)) {
    for (let i = 0; i < OWN_PER_NEW && m < mine.length && mix.length < size; i += 1) {
      mix.push(mine[m++]);
    }
    if (n < newOnes.length && mix.length < size) mix.push(newOnes[n++]);
    // Run out of their own and the rest is new, and the other way round.
    if (m >= mine.length && n < newOnes.length) {
      while (n < newOnes.length && mix.length < size) mix.push(newOnes[n++]);
    }
  }
  return mix;
}
