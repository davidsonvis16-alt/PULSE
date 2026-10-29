import type { Mood, Track } from '@/src/core/types';
import { MOODS } from '@/src/core/moods';
import { musicProvider } from '@/src/providers/music';
import { deezerProvider } from '@/src/providers/music/adapters/deezer';
import { getPlaylist, getPlaylistTracks, saveSystemPlaylist } from '@/src/db/repos/playlists';
import { getPlayedTrackIds } from '@/src/db/repos/history';
import { getArtistProfile } from '@/src/discovery/artists';

/**
 * A playlist for every mood, kept for each listener.
 *
 * It is saved as a real playlist, so it can be opened, downloaded and played
 * like any other, and it keeps moving:
 *
 *  - A song the listener has really played makes way for a new one the next
 *    time the mix is opened, so the mood keeps offering music they have not
 *    heard yet.
 *  - Once a day the oldest third is replaced even if nothing was played, so a
 *    mood someone has not opened for a while is not the same list as before.
 *
 * Everything else stays where it is, so a song someone saw yesterday and meant
 * to play is still there today.
 */

export const MOOD_MIX_SIZE = 30;
const POOL_SIZE = 120;
const DAY = 24 * 60 * 60 * 1000;

export function moodMixId(moodId: string): string {
  return `mood-mix-${moodId}`;
}

export interface MoodMix {
  mood: Mood;
  tracks: Track[];
  /** Songs swapped in since the mix was last opened. */
  fresh: number;
}

export async function refreshMoodMix(mood: Mood, now = Date.now()): Promise<MoodMix> {
  const id = moodMixId(mood.id);
  const [saved, previous] = await Promise.all([
    getPlaylist(id).catch(() => null),
    getPlaylistTracks(id).catch(() => [] as Track[]),
  ]);

  // Two catalogues, so an artist one of them lacks still turns up.
  const [apple, deezer] = await Promise.all([
    musicProvider().getMoodTracks(mood, POOL_SIZE).catch(() => [] as Track[]),
    deezerProvider.getMoodTracks(mood, POOL_SIZE).catch(() => [] as Track[]),
  ]);
  const pool = interleave(apple, deezer);
  // Offline, with nothing new to swap in, the mix stays exactly as it was.
  if (pool.length === 0) return { mood, tracks: previous, fresh: 0 };

  const played = await getPlayedTrackIds([...previous, ...pool].map((t) => t.id));

  let keep = previous.filter((track) => !played.has(track.id));
  const stale = !saved || now - saved.updatedAt >= DAY;
  if (stale && keep.length > 0) keep = keep.slice(Math.ceil(keep.length / 3));

  const kept = new Set(keep.map((t) => t.id));
  const shown = new Set(previous.map((t) => t.id));
  // New songs first come from what the listener has never been shown, in an
  // order that changes every day, then from anything not yet played.
  const day = Math.floor(now / DAY);
  const candidates = shuffled(
    pool.filter((t) => !played.has(t.id) && !kept.has(t.id)),
    day + mood.id.length,
  ).sort((a, b) => Number(shown.has(a.id)) - Number(shown.has(b.id)));

  const fresh = candidates.slice(0, Math.max(0, MOOD_MIX_SIZE - keep.length));
  const tracks = [...keep, ...fresh];
  await saveSystemPlaylist(id, `${mood.name} mix`, mood.tagline, tracks).catch(() => {});
  return { mood, tracks, fresh: fresh.length };
}

/** The mix as last saved, without going online. */
export async function savedMoodMix(mood: Mood): Promise<Track[]> {
  return getPlaylistTracks(moodMixId(mood.id)).catch(() => [] as Track[]);
}

export interface MoodCover {
  moodId: string;
  /** A photo of an artist in the mix, else the cover of its first song. */
  imageUrl: string | null;
  artistName: string | null;
}

/**
 * The picture for each mood's card: a real artist from that listener's mix.
 * Moods without a saved mix yet are built first, one at a time, so opening
 * Home never fires dozens of catalogue searches at once.
 */
export async function loadMoodCovers(): Promise<MoodCover[]> {
  const covers: MoodCover[] = [];
  for (const mood of MOODS) {
    let tracks = await savedMoodMix(mood);
    if (tracks.length === 0) tracks = (await refreshMoodMix(mood)).tracks;
    const lead = tracks[0] ?? null;
    const profile = lead ? await getArtistProfile(lead.artistName).catch(() => null) : null;
    covers.push({
      moodId: mood.id,
      imageUrl: profile?.pictureUrl ?? lead?.artworkUrl ?? null,
      artistName: lead?.artistName ?? null,
    });
  }
  return covers;
}

/** Alternates between two lists, dropping a song the first already has. */
function interleave(a: Track[], b: Track[]): Track[] {
  const key = (t: Track) => `${t.title}|${t.artistName}`.toLowerCase().replace(/[^a-z0-9|]/g, '');
  const seen = new Set<string>();
  const out: Track[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    for (const track of [a[i], b[i]]) {
      if (!track || seen.has(key(track))) continue;
      seen.add(key(track));
      out.push(track);
    }
  }
  return out;
}

/** A shuffle that gives the same order for the same seed. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = (seed * 2654435761) >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
