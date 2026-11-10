import type { Track } from '@/src/core/types';
import { config } from '@/src/core/config';
import { musicProvider } from '@/src/providers/music';
import { cleanNames } from '@/src/ingestion/artwork/provider';
import { similarity } from '@/src/ingestion/identify/text';

/**
 * The catalogue's page for a song's album or artist, found by name.
 *
 * Songs from someone's own files, the charts, Deezer or Audius carry no link
 * to the catalogue's album and artist pages, so "Go to album" and "Go to
 * artist" look them up by the (cleaned) names instead.
 */

const MATCH = 0.7;

export async function findAlbumId(track: Track): Promise<string | null> {
  if (track.albumId && track.provider === 'itunes') return track.albumId;
  const { title, artist, album } = cleanNames({
    title: track.title,
    artist: track.artistName,
    album: track.albumTitle,
  });
  const provider = musicProvider();
  if (album) {
    const albums = await provider
      .searchAlbums(`${artist} ${album}`.trim(), { limit: 6, country: config.music.country })
      .catch(() => []);
    const hit = albums.find(
      (a) => similarity(a.title, album) >= MATCH && (!artist || similarity(a.artistName, artist) >= MATCH),
    );
    if (hit) return hit.id;
  }
  const songs = await provider
    .searchTracks(`${artist} ${title}`.trim(), { limit: 6, country: config.music.country })
    .catch(() => []);
  const song = songs.find(
    (s) => similarity(s.title, title) >= MATCH && (!artist || similarity(s.artistName, artist) >= MATCH),
  );
  return song?.albumId ?? null;
}

export async function findArtistId(track: Track): Promise<string | null> {
  if (track.artistId && track.provider === 'itunes') return track.artistId;
  const { artist } = cleanNames({ title: track.title, artist: track.artistName });
  const lead = artist.split(/\s*(?:,|&|\+|;)\s*|\s+(?:feat\.?|ft\.?|featuring|with|x)\s+/i)[0]?.trim();
  if (!lead) return null;
  const artists = await musicProvider().searchArtists(lead, { limit: 4 }).catch(() => []);
  return artists.find((a) => similarity(a.name, lead) >= MATCH)?.id ?? null;
}
