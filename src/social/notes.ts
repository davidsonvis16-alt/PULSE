import { Store } from '@/src/core/store';
import type { Track } from '@/src/core/types';
import { musicProvider } from '@/src/providers/music';
import { config } from '@/src/core/config';
import {
  getRepeatedTracks,
  getTopGenres,
  getTopTracks,
  type TopTrack,
} from '@/src/db/repos/history';
import { getFavoriteTracks } from '@/src/db/repos/library';
import { getJsonSetting, setJsonSetting } from '@/src/db/repos/settings';
import { saveSystemPlaylist } from '@/src/db/repos/playlists';
import { getNewReleasesFromFollowed } from '@/src/discovery/releases';
import { buildTasteProfile, type TasteProfile } from '@/src/discovery/taste';
import { familyForGenre } from '@/src/grooves/genres';

/**
 * Song notes.
 *
 * A note is one song someone wants their friends to see — the song of their
 * day or their week — with a feeling attached ("nostalgic", "sad"). It sits
 * over their picture the way a note does on Instagram, and their picture gets
 * a ring while there is a note you have not opened yet.
 *
 * A note can be written by hand, or posted automatically: with auto-post on,
 * Pulse picks from what the listener actually did — the song they repeated
 * most, one they liked, their top genre this week, or something new from an
 * artist they follow — so the note says something true about them.
 *
 * The friends in this build are a demo cast, labelled as such in the interface.
 * Their songs are real catalogue songs, looked up live, so the covers, previews
 * and links are genuine; the people and their play counts are not.
 */

// ---------------------------------------------------------------------------
// Feelings

export interface Feeling {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

export const FEELINGS: Feeling[] = [
  { id: 'nostalgic', label: 'Nostalgic', emoji: '🌅', color: '#F2A65A' },
  { id: 'sad', label: 'Sad', emoji: '🌧️', color: '#5B7CFA' },
  { id: 'in-love', label: 'In love', emoji: '💗', color: '#FF5C8A' },
  { id: 'hyped', label: 'Hyped', emoji: '⚡', color: '#C9F62B' },
  { id: 'calm', label: 'Calm', emoji: '🌊', color: '#31C4A8' },
  { id: 'heartbroken', label: 'Heartbroken', emoji: '💔', color: '#E13300' },
  { id: 'euphoric', label: 'Euphoric', emoji: '✨', color: '#B17BFF' },
  { id: 'late-night', label: 'Late night', emoji: '🌙', color: '#4D6BD6' },
  { id: 'focused', label: 'Focused', emoji: '🎧', color: '#4FA3C0' },
  { id: 'homesick', label: 'Homesick', emoji: '🏡', color: '#D9822B' },
  { id: 'grateful', label: 'Grateful', emoji: '🙏', color: '#2FA27B' },
  { id: 'confident', label: 'Confident', emoji: '😎', color: '#E5389B' },
];

export function feelingById(id: string | null | undefined): Feeling {
  return FEELINGS.find((feeling) => feeling.id === id) ?? FEELINGS[3];
}

/** The card colours used across the notes UI — mixed, like a music app's browse grid. */
export const CARD_COLORS = [
  '#E8115B',
  '#1E3264',
  '#8D67AB',
  '#E13300',
  '#148A08',
  '#BA5D07',
  '#0D73EC',
  '#27856A',
  '#477D95',
  '#AF2896',
  '#DC148C',
  '#503750',
];

export function cardColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return CARD_COLORS[Math.abs(hash) % CARD_COLORS.length];
}

// ---------------------------------------------------------------------------
// Notes

export type NoteScope = 'day' | 'week';

/** Why an auto-posted note picked the song it did. */
export type AutoReason = 'most-repeated' | 'most-liked' | 'top-genre' | 'new-release';

export const AUTO_REASON_LABEL: Record<AutoReason, string> = {
  'most-repeated': 'Most repeated',
  'most-liked': 'Most liked',
  'top-genre': 'Top genre',
  'new-release': 'New release',
};

export interface SongNote {
  id: string;
  /** 'me' for the listener's own note. */
  authorId: string;
  track: Track;
  feeling: string;
  scope: NoteScope;
  caption: string | null;
  /** Null when written by hand. */
  auto: AutoReason | null;
  /** How many times the author played it in the note's scope, when known. */
  plays: number | null;
  /** Extra context for an auto note, e.g. the genre it stands for. */
  detail: string | null;
  createdAt: number;
}

export interface NoteFriend {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string;
  city: string;
  bio: string;
  /** Artists they play most — used for taste match and blends. */
  topArtists: string[];
  topGenres: string[];
  /** Minutes listened this week. */
  minutesThisWeek: number;
  autoPost: boolean;
  note: SongNote | null;
  /** Their recent repeats, for the profile page. */
  repeats: { track: Track; plays: number }[];
  /** True while they are listening right now. */
  live: boolean;
}

// ---------------------------------------------------------------------------
// The demo cast

interface DemoSong {
  query: string;
  plays: number;
}

interface DemoFriend {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string;
  city: string;
  bio: string;
  topArtists: string[];
  topGenres: string[];
  minutesThisWeek: number;
  autoPost: boolean;
  live: boolean;
  note:
    | {
        song: DemoSong | 'new-release';
        feeling: string;
        scope: NoteScope;
        caption: string | null;
        auto: AutoReason | null;
        detail?: string;
        minutesAgo: number;
      }
    | null;
  repeats: DemoSong[];
}

/**
 * Seven friends for the demo. Portraits are real photographs from the
 * randomuser.me open portrait set; the songs are real and resolved against
 * the live catalogue when the app opens.
 */
const DEMO_FRIENDS: DemoFriend[] = [
  {
    id: 'demo-wanjiru',
    name: 'Wanjiru Kamau',
    handle: 'wanjiru.k',
    avatarUrl: 'https://randomuser.me/api/portraits/women/44.jpg',
    city: 'Nairobi',
    bio: 'Afrobeats on loop. Ask me for a playlist.',
    topArtists: ['Wizkid', 'Tems', 'Burna Boy', 'Rema', 'Ayra Starr'],
    topGenres: ['Afrobeats', 'R&B/Soul', 'Afro-Pop'],
    minutesThisWeek: 812,
    autoPost: true,
    live: true,
    note: {
      song: { query: 'Essence Wizkid Tems', plays: 13 },
      feeling: 'in-love',
      scope: 'day',
      caption: null,
      auto: 'most-repeated',
      minutesAgo: 22,
    },
    repeats: [
      { query: 'Essence Wizkid Tems', plays: 13 },
      { query: 'Calm Down Rema', plays: 9 },
      { query: 'Rush Ayra Starr', plays: 6 },
    ],
  },
  {
    id: 'demo-brian',
    name: 'Brian Otieno',
    handle: 'b.otieno',
    avatarUrl: 'https://randomuser.me/api/portraits/men/32.jpg',
    city: 'Kisumu',
    bio: 'Bars first. Beats second. Sleep third.',
    topArtists: ['Kendrick Lamar', 'J. Cole', 'Drake', 'Travis Scott', 'Burna Boy'],
    topGenres: ['Hip-Hop/Rap', 'Rap'],
    minutesThisWeek: 1044,
    autoPost: false,
    live: false,
    note: {
      song: { query: 'Not Like Us Kendrick Lamar', plays: 21 },
      feeling: 'hyped',
      scope: 'week',
      caption: 'gym anthem, no debate',
      auto: null,
      minutesAgo: 95,
    },
    repeats: [
      { query: 'Not Like Us Kendrick Lamar', plays: 21 },
      { query: 'No Role Modelz J. Cole', plays: 11 },
      { query: 'SICKO MODE Travis Scott', plays: 7 },
    ],
  },
  {
    id: 'demo-achieng',
    name: 'Achieng Odhiambo',
    handle: 'achie',
    avatarUrl: 'https://randomuser.me/api/portraits/women/68.jpg',
    city: 'Mombasa',
    bio: 'Sauti Sol forever. Coast girl.',
    topArtists: ['Sauti Sol', 'Bien', 'Nviiri the Storyteller', 'Diamond Platnumz', 'Nikita Kering'],
    topGenres: ['Afro-Pop', 'Bongo Flava', 'African'],
    minutesThisWeek: 655,
    autoPost: true,
    live: false,
    note: {
      song: { query: 'Suzanna Sauti Sol', plays: 8 },
      feeling: 'nostalgic',
      scope: 'day',
      caption: 'campus days 🥲',
      auto: 'most-liked',
      minutesAgo: 140,
    },
    repeats: [
      { query: 'Suzanna Sauti Sol', plays: 8 },
      { query: 'Melanin Sauti Sol', plays: 6 },
      { query: 'Jeje Diamond Platnumz', plays: 5 },
    ],
  },
  {
    id: 'demo-kevin',
    name: 'Kevin Mwangi',
    handle: 'kev.mwangi',
    avatarUrl: 'https://randomuser.me/api/portraits/men/75.jpg',
    city: 'Nakuru',
    bio: 'Indie kid stuck in a matatu playlist.',
    topArtists: ['The Neighbourhood', 'Arctic Monkeys', 'Tame Impala', 'Cigarettes After Sex', 'The Weeknd'],
    topGenres: ['Alternative', 'Indie Rock', 'Rock'],
    minutesThisWeek: 930,
    autoPost: true,
    live: true,
    note: {
      song: { query: 'Sweater Weather The Neighbourhood', plays: 11 },
      feeling: 'sad',
      scope: 'week',
      caption: null,
      auto: 'top-genre',
      detail: 'Alternative',
      minutesAgo: 260,
    },
    repeats: [
      { query: 'Sweater Weather The Neighbourhood', plays: 11 },
      { query: '505 Arctic Monkeys', plays: 9 },
      { query: 'The Less I Know The Better Tame Impala', plays: 4 },
    ],
  },
  {
    id: 'demo-nadia',
    name: 'Nadia Hassan',
    handle: 'nadia.h',
    avatarUrl: 'https://randomuser.me/api/portraits/women/90.jpg',
    city: 'Nairobi',
    bio: 'Pop girlie. New music Fridays only.',
    topArtists: ['Sabrina Carpenter', 'Taylor Swift', 'Dua Lipa', 'Olivia Rodrigo', 'Tems'],
    topGenres: ['Pop'],
    minutesThisWeek: 702,
    autoPost: true,
    live: false,
    note: {
      song: 'new-release',
      feeling: 'euphoric',
      scope: 'day',
      caption: 'out today!!',
      auto: 'new-release',
      minutesAgo: 35,
    },
    repeats: [
      { query: 'Espresso Sabrina Carpenter', plays: 10 },
      { query: 'Levitating Dua Lipa', plays: 7 },
      { query: 'Cruel Summer Taylor Swift', plays: 5 },
    ],
  },
  {
    id: 'demo-ian',
    name: 'Ian Kiprop',
    handle: 'ian.kip',
    avatarUrl: 'https://randomuser.me/api/portraits/men/46.jpg',
    city: 'Eldoret',
    bio: 'Running 10k a day, Davido in my ears.',
    topArtists: ['Davido', 'Burna Boy', 'Asake', 'Wizkid', 'Diamond Platnumz'],
    topGenres: ['Afrobeats', 'African'],
    minutesThisWeek: 540,
    autoPost: false,
    live: false,
    note: {
      song: { query: 'Unavailable Davido', plays: 7 },
      feeling: 'confident',
      scope: 'day',
      caption: 'morning run fuel',
      auto: null,
      minutesAgo: 410,
    },
    repeats: [
      { query: 'Unavailable Davido', plays: 7 },
      { query: 'Last Last Burna Boy', plays: 6 },
      { query: 'Lonely At The Top Asake', plays: 4 },
    ],
  },
  {
    id: 'demo-faith',
    name: 'Faith Njeri',
    handle: 'faithnjeri',
    avatarUrl: 'https://randomuser.me/api/portraits/women/21.jpg',
    city: 'Thika',
    bio: 'R&B, journaling and too much tea.',
    topArtists: ['SZA', 'Frank Ocean', 'Daniel Caesar', 'H.E.R.', 'The Weeknd'],
    topGenres: ['R&B/Soul', 'Alternative R&B'],
    minutesThisWeek: 1210,
    autoPost: true,
    live: true,
    note: {
      song: { query: 'Kill Bill SZA', plays: 16 },
      feeling: 'heartbroken',
      scope: 'week',
      caption: null,
      auto: 'most-repeated',
      minutesAgo: 75,
    },
    repeats: [
      { query: 'Kill Bill SZA', plays: 16 },
      { query: 'Best Part Daniel Caesar', plays: 9 },
      { query: 'Pink + White Frank Ocean', plays: 6 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Persistence

const KEYS = {
  mine: 'notes.mine',
  autoPost: 'notes.autoPost',
  seen: 'notes.seen',
  reactions: 'notes.reactions',
  resolved: 'notes.resolvedSongs',
} as const;

/** Songs looked up once and kept, so the row draws instantly next time. */
type ResolvedCache = Record<string, Track>;

async function resolveSong(query: string, cache: ResolvedCache): Promise<Track | null> {
  if (cache[query]) return cache[query];
  try {
    const results = await musicProvider().searchTracks(query, {
      limit: 3,
      country: config.music.country,
    });
    const track = results.find((candidate) => !!candidate.artworkUrl) ?? results[0] ?? null;
    if (track) cache[query] = track;
    return track;
  } catch {
    return null;
  }
}

async function resolveNewRelease(): Promise<Track | null> {
  try {
    const albums = await musicProvider().getNewReleases({ limit: 6, country: config.music.country });
    for (const album of albums) {
      const tracks = await musicProvider().getAlbumTracks(album.id, 1).catch(() => []);
      if (tracks[0]) return tracks[0];
    }
  } catch {
    /* no new release reachable */
  }
  return null;
}

function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function pick<T>(items: T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

// ---------------------------------------------------------------------------
// Auto-post

interface AutoCandidate {
  reason: AutoReason;
  track: Track;
  plays: number | null;
  detail: string | null;
}

/**
 * What auto-post could say about this listener today. Every candidate comes
 * from their own history; a reason with nothing behind it is left out.
 */
async function autoCandidates(): Promise<AutoCandidate[]> {
  const [repeated, top, liked, genres, followed] = await Promise.all([
    getRepeatedTracks(2, 10, 'week').catch(() => [] as TopTrack[]),
    getTopTracks('week', 40).catch(() => [] as TopTrack[]),
    getFavoriteTracks(60).catch(() => [] as Track[]),
    getTopGenres('week', 3).catch(() => []),
    getNewReleasesFromFollowed(4).catch(() => []),
  ]);

  const candidates: AutoCandidate[] = [];

  const mostRepeated = [...repeated].sort((a, b) => b.plays - a.plays)[0];
  if (mostRepeated) {
    candidates.push({
      reason: 'most-repeated',
      track: mostRepeated.track,
      plays: mostRepeated.plays,
      detail: null,
    });
  }

  if (liked.length) {
    const plays = new Map(top.map((entry) => [entry.track.id, entry.plays]));
    const ranked = [...liked].sort((a, b) => (plays.get(b.id) ?? 0) - (plays.get(a.id) ?? 0));
    const choice = ranked[0];
    candidates.push({
      reason: 'most-liked',
      track: choice,
      plays: plays.get(choice.id) ?? null,
      detail: null,
    });
  }

  const genre = genres[0]?.genre;
  if (genre) {
    const inGenre = top.filter((entry) => entry.track.genre === genre);
    const choice = inGenre[0] ?? pick(top.filter((entry) => familyForGenre(entry.track.genre).id === familyForGenre(genre).id));
    if (choice) {
      candidates.push({ reason: 'top-genre', track: choice.track, plays: choice.plays, detail: genre });
    }
  }

  const release = followed[0];
  if (release) {
    const tracks = await musicProvider().getAlbumTracks(release.id, 1).catch(() => []);
    if (tracks[0]) {
      candidates.push({
        reason: 'new-release',
        track: tracks[0],
        plays: null,
        detail: release.artistName,
      });
    }
  }

  return candidates;
}

const AUTO_FEELING: Record<AutoReason, string[]> = {
  'most-repeated': ['hyped', 'in-love', 'euphoric', 'confident'],
  'most-liked': ['in-love', 'grateful', 'nostalgic', 'calm'],
  'top-genre': ['focused', 'calm', 'late-night', 'confident'],
  'new-release': ['euphoric', 'hyped'],
};

// ---------------------------------------------------------------------------
// Taste match and blends

export interface TasteMatch {
  percent: number;
  sharedArtists: string[];
  sharedGenres: string[];
}

export function tasteMatch(friend: NoteFriend, taste: TasteProfile | null): TasteMatch {
  if (!taste || !taste.hasData) {
    return { percent: 0, sharedArtists: [], sharedGenres: [] };
  }
  const mine = new Set(taste.artists.slice(0, 40).map((artist) => artist.name.toLowerCase()));
  const sharedArtists = friend.topArtists.filter((name) => mine.has(name.toLowerCase()));

  const myFamilies = new Set(taste.genres.slice(0, 12).map((genre) => genre.family.id));
  const myGenres = new Set(taste.genres.slice(0, 12).map((genre) => genre.genre.toLowerCase()));
  const sharedGenres = friend.topGenres.filter(
    (genre) => myGenres.has(genre.toLowerCase()) || myFamilies.has(familyForGenre(genre).id),
  );

  const artistShare = sharedArtists.length / friend.topArtists.length;
  const genreShare = friend.topGenres.length ? sharedGenres.length / friend.topGenres.length : 0;
  const percent = Math.round(Math.min(99, 18 + artistShare * 52 + genreShare * 30));
  return { percent, sharedArtists, sharedGenres };
}

export const BLEND_PREFIX = 'pulse:blend:';

/**
 * A blend: the listener's own favourites woven with the friend's, one for one,
 * saved as a real playlist so it can be opened, played and kept.
 */
export async function buildBlend(friend: NoteFriend): Promise<{ id: string; name: string; tracks: Track[] }> {
  const [mine, theirs] = await Promise.all([
    getTopTracks('month', 15).then((rows) => rows.map((row) => row.track)).catch(() => [] as Track[]),
    Promise.all(
      friend.topArtists.slice(0, 4).map((artist) =>
        musicProvider()
          .searchTracks(artist, { limit: 4, country: config.music.country })
          .catch(() => [] as Track[]),
      ),
    ).then((lists) => [...friend.repeats.map((entry) => entry.track), ...lists.flat()]),
  ]);

  const seen = new Set<string>();
  const tracks: Track[] = [];
  const longest = Math.max(mine.length, theirs.length);
  for (let i = 0; i < longest && tracks.length < 40; i++) {
    for (const track of [mine[i], theirs[i]]) {
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        tracks.push(track);
      }
    }
  }

  const id = `${BLEND_PREFIX}${friend.id}`;
  const name = `You + ${friend.name.split(' ')[0]}`;
  if (tracks.length) {
    await saveSystemPlaylist(
      id,
      name,
      `A blend of your favourites and ${friend.name.split(' ')[0]}'s, one for one.`,
      tracks,
    ).catch(() => {});
  }
  return { id, name, tracks };
}

// ---------------------------------------------------------------------------
// The store

export interface NotesState {
  ready: boolean;
  loading: boolean;
  friends: NoteFriend[];
  mine: SongNote | null;
  autoPost: boolean;
  seen: Set<string>;
  /** noteId -> the emoji the listener reacted with. */
  reactions: Record<string, string>;
  taste: TasteProfile | null;
}

class NotesStore extends Store<NotesState> {
  private loadingPromise: Promise<void> | null = null;

  constructor() {
    super({
      ready: false,
      loading: false,
      friends: [],
      mine: null,
      autoPost: true,
      seen: new Set(),
      reactions: {},
      taste: null,
    });
  }

  /** Loads once; later calls reuse it. Pass fresh to re-read everything. */
  load(fresh = false): Promise<void> {
    if (this.loadingPromise && !fresh) return this.loadingPromise;
    this.loadingPromise = this.doLoad().finally(() => {
      this.set({ loading: false });
    });
    return this.loadingPromise;
  }

  private async doLoad() {
    this.set({ loading: true });
    const [mine, autoPost, seen, reactions, cache] = await Promise.all([
      getJsonSetting<SongNote | null>(KEYS.mine, null),
      getJsonSetting<boolean>(KEYS.autoPost, true),
      getJsonSetting<string[]>(KEYS.seen, []),
      getJsonSetting<Record<string, string>>(KEYS.reactions, {}),
      getJsonSetting<ResolvedCache>(KEYS.resolved, {}),
    ]);

    // Draw what is cached straight away, then fill in the rest.
    this.set({
      mine: isCurrent(mine) ? mine : null,
      autoPost,
      seen: new Set(seen),
      reactions,
      friends: await this.buildFriends(cache, true),
    });

    const [friends, taste] = await Promise.all([
      this.buildFriends(cache, false),
      buildTasteProfile().catch(() => null),
    ]);
    await setJsonSetting(KEYS.resolved, cache).catch(() => {});
    this.set({ friends, taste, ready: true });

    if (autoPost && !isCurrent(this.getSnapshot().mine)) {
      await this.autoPostNow().catch(() => {});
    }
  }

  private async buildFriends(cache: ResolvedCache, cachedOnly: boolean): Promise<NoteFriend[]> {
    const now = Date.now();
    const resolve = (query: string) =>
      cachedOnly ? Promise.resolve(cache[query] ?? null) : resolveSong(query, cache);
    let newRelease: Track | null = null;

    return Promise.all(
      DEMO_FRIENDS.map(async (demo) => {
        const repeats = (
          await Promise.all(
            demo.repeats.map(async (song) => {
              const track = await resolve(song.query);
              return track ? { track, plays: song.plays } : null;
            }),
          )
        ).filter((entry): entry is { track: Track; plays: number } => !!entry);

        let note: SongNote | null = null;
        if (demo.note) {
          let track: Track | null = null;
          let plays: number | null = null;
          if (demo.note.song === 'new-release') {
            if (!cachedOnly) {
              newRelease = newRelease ?? (await resolveNewRelease());
              track = newRelease;
              if (track) cache['__new_release__'] = track;
            } else {
              track = cache['__new_release__'] ?? null;
            }
          } else {
            track = await resolve(demo.note.song.query);
            plays = demo.note.song.plays;
          }
          if (track) {
            note = {
              id: `${demo.id}:${dayKey()}`,
              authorId: demo.id,
              track,
              feeling: demo.note.feeling,
              scope: demo.note.scope,
              caption: demo.note.caption,
              auto: demo.note.auto,
              plays,
              detail: demo.note.detail ?? (demo.note.song === 'new-release' ? track.artistName : null),
              createdAt: now - demo.note.minutesAgo * 60_000,
            };
          }
        }

        return {
          id: demo.id,
          name: demo.name,
          handle: demo.handle,
          avatarUrl: demo.avatarUrl,
          city: demo.city,
          bio: demo.bio,
          topArtists: demo.topArtists,
          topGenres: demo.topGenres,
          minutesThisWeek: demo.minutesThisWeek,
          autoPost: demo.autoPost,
          live: demo.live,
          note,
          repeats,
        } satisfies NoteFriend;
      }),
    ).then((friends) =>
      // Unopened notes first, newest first — the order a stories row uses.
      friends.sort((a, b) => {
        const aSeen = a.note ? this.getSnapshot().seen.has(a.note.id) : true;
        const bSeen = b.note ? this.getSnapshot().seen.has(b.note.id) : true;
        if (aSeen !== bSeen) return aSeen ? 1 : -1;
        return (b.note?.createdAt ?? 0) - (a.note?.createdAt ?? 0);
      }),
    );
  }

  friend(id: string): NoteFriend | undefined {
    return this.getSnapshot().friends.find((friend) => friend.id === id);
  }

  async postNote(input: {
    track: Track;
    feeling: string;
    scope: NoteScope;
    caption: string | null;
    plays?: number | null;
  }) {
    const note: SongNote = {
      id: `me:${Date.now()}`,
      authorId: 'me',
      track: input.track,
      feeling: input.feeling,
      scope: input.scope,
      caption: input.caption?.trim() || null,
      auto: null,
      plays: input.plays ?? null,
      detail: null,
      createdAt: Date.now(),
    };
    await setJsonSetting(KEYS.mine, note);
    this.set({ mine: note });
  }

  async clearNote() {
    await setJsonSetting(KEYS.mine, null);
    this.set({ mine: null });
  }

  async setAutoPost(on: boolean) {
    await setJsonSetting(KEYS.autoPost, on);
    this.set({ autoPost: on });
    if (on && !isCurrent(this.getSnapshot().mine)) await this.autoPostNow().catch(() => {});
  }

  /**
   * Picks a song for the listener: a random one of the reasons that actually
   * has something behind it today. Returns null when there is no history yet.
   */
  async autoPostNow(): Promise<SongNote | null> {
    const candidates = await autoCandidates();
    const choice = pick(candidates);
    if (!choice) return null;
    const note: SongNote = {
      id: `me:auto:${Date.now()}`,
      authorId: 'me',
      track: choice.track,
      feeling: pick(AUTO_FEELING[choice.reason]) ?? 'hyped',
      scope: 'day',
      caption: null,
      auto: choice.reason,
      plays: choice.plays,
      detail: choice.detail,
      createdAt: Date.now(),
    };
    await setJsonSetting(KEYS.mine, note);
    this.set({ mine: note });
    return note;
  }

  async markSeen(noteId: string) {
    const seen = new Set(this.getSnapshot().seen);
    if (seen.has(noteId)) return;
    seen.add(noteId);
    this.set({ seen });
    // Only today's ids matter; older ones are dropped as the list grows.
    await setJsonSetting(KEYS.seen, [...seen].slice(-200)).catch(() => {});
  }

  async react(noteId: string, emoji: string | null) {
    const reactions = { ...this.getSnapshot().reactions };
    if (emoji) reactions[noteId] = emoji;
    else delete reactions[noteId];
    this.set({ reactions });
    await setJsonSetting(KEYS.reactions, reactions).catch(() => {});
  }
}

/** A day note lasts the day it was written, a week note seven days. */
export function isCurrent(note: SongNote | null | undefined): note is SongNote {
  if (!note) return false;
  const age = Date.now() - note.createdAt;
  if (note.scope === 'week') return age < 7 * 24 * 3_600_000;
  return dayKey(new Date(note.createdAt)) === dayKey();
}

export const notesStore = new NotesStore();
