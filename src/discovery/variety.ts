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
    const key =
      (track.albumTitle && `${track.albumTitle}|${track.artistName}`.toLowerCase()) ||
      track.artworkUrl ||
      track.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
