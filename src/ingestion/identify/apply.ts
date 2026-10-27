import type { Track } from '@/src/core/types';
import {
  listTracksNeedingIdentification,
  updateIdentification,
  type LocalTrack,
} from '@/src/db/repos/local';
import { upsertTrack } from '@/src/db/repos/catalog';
import { CONFIDENT_THRESHOLD, identify } from '@/src/ingestion/identify/identifier';
import { rebuildGrooves } from '@/src/grooves/engine';
import { invalidateTasteProfile } from '@/src/discovery/taste';

/**
 * Puts a catalogue match onto one of the user's own files.
 *
 * The catalogue entry supplies metadata and artwork; the file stays put and
 * the local id is kept so playback still points at the same audio.
 */
export async function applyMatch(local: LocalTrack, match: Track, confidence = 1) {
  await upsertTrack({
    ...match,
    id: local.trackId,
    provider: local.track.provider,
    providerTrackId: local.track.providerTrackId,
    durationMs: local.track.durationMs ?? match.durationMs,
  });
  await updateIdentification(local.trackId, {
    identification: 'identified',
    confidence,
    matchedTrackId: match.id,
  });
}

let catchingUp: Promise<number> | null = null;

/**
 * Applies every waiting match that clears today's bar.
 *
 * Songs imported while the bar was higher are sitting in "needs identifying"
 * with a good match already found. They should not need a person to confirm
 * what Pulse would now apply by itself, so they are looked up again and
 * settled. Anything still below the bar stays where it is.
 */
export function applyConfidentMatches(): Promise<number> {
  catchingUp ??= (async () => {
    const waiting = (await listTracksNeedingIdentification(500)).filter(
      (local) => (local.confidence ?? 0) >= CONFIDENT_THRESHOLD,
    );
    let applied = 0;
    for (const local of waiting) {
      const result = await identify({
        filename: local.filename,
        tags: {
          container: local.container,
          mimeType: local.mimeType,
          // What the row reads as now came from the filename when the file had
          // no tags, so "Unknown artist" is a placeholder, not a clue.
          title: local.track.title,
          artist: local.track.artistName !== 'Unknown artist' ? local.track.artistName : undefined,
          album: local.track.albumTitle ?? undefined,
        },
        durationMs: local.track.durationMs,
      }).catch(() => null);
      if (result?.status === 'identified' && result.match) {
        await applyMatch(local, result.match, result.confidence);
        applied += 1;
      }
    }
    if (applied > 0) {
      invalidateTasteProfile();
      await rebuildGrooves();
    }
    return applied;
  })().finally(() => {
    catchingUp = null;
  });
  return catchingUp;
}
