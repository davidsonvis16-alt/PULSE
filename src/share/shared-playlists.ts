import { supabase } from '@/lib/supabase';
import { entityId, type Track } from '@/src/core/types';
import { getJsonSetting, setJsonSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { searchDeezerTracks } from '@/src/providers/music/adapters/deezer';
import { cleanNames } from '@/src/ingestion/artwork/provider';
import { similarity } from '@/src/ingestion/identify/text';
import { webLink } from '@/src/share/links';

/**
 * Playlists anyone can open from a link.
 *
 * A playlist lives on the phone that made it, so a link to it means nothing on
 * anyone else's. Sharing one publishes a copy to the Pulse server — its name,
 * cover and songs, in order — and the link opens that copy. Songs from the
 * sharer's own files are matched to the catalogue first so others can hear
 * them; sharing the same playlist again updates the same copy and link.
 */

const MAX_SONGS = 100;
const LOCAL = 'local';

export interface SharedPlaylist {
  id: string;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  ownerName: string;
  tracks: Track[];
}

function client() {
  if (!supabase) throw new Error('Sharing playlists needs the Pulse server. This build is not connected to one.');
  return supabase;
}

/** A song from someone's own files, matched to the catalogue so others can play it. */
async function playableForOthers(track: Track): Promise<Track> {
  if (track.provider !== LOCAL) return track;
  const { title, artist } = cleanNames({ title: track.title, artist: track.artistName });
  if (!title) return track;
  const found = await searchDeezerTracks(`${artist} ${title}`.trim(), 5).catch(() => [] as Track[]);
  const match = found.find(
    (candidate) =>
      similarity(candidate.title, title) >= 0.7 && (!artist || similarity(candidate.artistName, artist) >= 0.6),
  );
  return match ? { ...match, artworkUrl: match.artworkUrl ?? track.artworkUrl } : track;
}

/** Publishes (or updates) the shared copy of a playlist; resolves to its link. */
export async function publishPlaylist(input: {
  localId: string;
  name: string;
  description?: string | null;
  artworkUrl?: string | null;
  tracks: Track[];
}): Promise<string> {
  const sb = client();
  const { data: auth } = await sb.auth.getUser();
  const owner = auth.user?.id;
  if (!owner) throw new Error('Sign in to share playlists.');

  const known = await getJsonSetting<Record<string, string>>(SETTINGS_KEYS.sharedPlaylistIds, {});
  const songs = await Promise.all(input.tracks.slice(0, MAX_SONGS).map(playableForOthers));
  const artworkUrl = input.artworkUrl?.startsWith('http')
    ? input.artworkUrl
    : (songs.find((s) => s.artworkUrl?.startsWith('http'))?.artworkUrl ?? null);

  const row = {
    owner_id: owner,
    name: input.name.slice(0, 80),
    description: input.description?.slice(0, 300) ?? null,
    visibility: 'public',
    artwork_url: artworkUrl,
    updated_at: new Date().toISOString(),
  };

  let id = known[input.localId];
  if (id) {
    const { error } = await sb.from('shared_playlists').update(row).eq('id', id);
    if (error) id = '';
  }
  if (!id) {
    const { data, error } = await sb.from('shared_playlists').insert(row).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'Could not share that playlist.');
    id = data.id as string;
    await setJsonSetting(SETTINGS_KEYS.sharedPlaylistIds, { ...known, [input.localId]: id });
  }

  await sb.from('shared_playlist_tracks').delete().eq('playlist_id', id);
  const seen = new Set<string>();
  const rows = songs
    .filter((song) => {
      const key = `${song.provider}:${song.providerTrackId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((song, position) => ({
      playlist_id: id,
      position,
      provider: song.provider,
      track_ref: song.provider === LOCAL ? song.id : song.providerTrackId,
      title: song.title,
      artist_name: song.artistName,
      album_title: song.albumTitle,
      artwork_url: song.artworkUrl?.startsWith('http') ? song.artworkUrl : null,
      duration_ms: song.durationMs,
    }));
  if (rows.length) {
    const { error } = await sb.from('shared_playlist_tracks').insert(rows);
    if (error) throw new Error(error.message);
  }
  return webLink('shared', id);
}

export async function fetchSharedPlaylist(id: string): Promise<SharedPlaylist> {
  const sb = client();
  const { data: list, error } = await sb
    .from('shared_playlists')
    .select('id, name, description, artwork_url, owner_id, profiles(display_name, handle)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!list) throw new Error('That playlist is no longer shared.');

  const { data: rows } = await sb
    .from('shared_playlist_tracks')
    .select('*')
    .eq('playlist_id', id)
    .order('position', { ascending: true });

  const owner = (list as { profiles?: { display_name?: string | null; handle?: string | null } | null }).profiles;
  return {
    id,
    name: list.name as string,
    description: (list.description as string | null) ?? null,
    artworkUrl: (list.artwork_url as string | null) ?? null,
    ownerName: owner?.display_name ?? (owner?.handle ? `@${owner.handle}` : 'someone on Pulse'),
    tracks: (rows ?? []).map((row) => {
      const provider = row.provider as string;
      const ref = row.track_ref as string;
      return {
        id: provider === LOCAL ? ref : entityId(provider, 'track', ref),
        provider,
        providerTrackId: provider === LOCAL ? ref.split(':').slice(2).join(':') : ref,
        title: row.title as string,
        artistName: row.artist_name as string,
        artistId: null,
        albumTitle: (row.album_title as string | null) ?? null,
        albumId: null,
        artworkUrl: (row.artwork_url as string | null) ?? null,
        durationMs: (row.duration_ms as number | null) ?? null,
        releaseDate: null,
        genre: null,
        trackNumber: null,
        discNumber: null,
        explicit: false,
        externalUrl: null,
      } satisfies Track;
    }),
  };
}
