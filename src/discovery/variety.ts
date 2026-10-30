import type { Track } from '@/src/core/types';

/**
 * One song per album in a row of covers.
 *
 * Suggestions often bring several songs off the same record, and a row of six
 * identical covers reads as a broken page. The first song from each album (or,
 * without an album, each cover image) stays; the rest are left for the full
 * playlist, where a list of titles makes repeats harmless.
 */
export function oneCoverEach(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    // The same picture under another name still repeats: a cast album credits
    // each singer separately but shares one cover.
    const keys = [
      track.albumTitle ? `album:${track.albumTitle.toLowerCase()}` : null,
      track.artworkUrl ? `cover:${track.artworkUrl.replace(/\/\d+x\d+bb\./, '/')}` : null,
    ].filter((key): key is string => !!key);
    if (keys.length === 0) return true;
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}
