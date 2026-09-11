import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import type { Album, Artist, MusicEvent, Track } from '@/src/core/types';
import type { Playlist } from '@/src/db/repos/playlists';
import { formatListeningTime } from '@/src/core/format';
import { shareUrl, type ShareableKind } from '@/src/share/links';

/**
 * Sharing.
 *
 * Pulse never sends a message on the user's behalf. Every path here opens the
 * operating system's own share sheet, and the user picks WhatsApp, Messages,
 * Instagram or anything else installed. We only decide what goes on the card.
 */

export interface SharePayload {
  kind: ShareableKind;
  id: string;
  title: string;
  subtitle: string;
  /** Extra line under the subtitle on the card, e.g. an album and year. */
  detail?: string | null;
  artworkUrl?: string | null;
  message: string;
  url: string;
}

export function trackShare(track: Track): SharePayload {
  const url = shareUrl('track', track.id);
  return {
    kind: 'track',
    id: track.id,
    title: track.title,
    subtitle: track.artistName,
    detail: track.albumTitle,
    artworkUrl: track.artworkUrl,
    message: `${track.title} — ${track.artistName}\nFound on Pulse\n${url}`,
    url,
  };
}

export function albumShare(album: Album): SharePayload {
  const url = shareUrl('album', album.id);
  return {
    kind: 'album',
    id: album.id,
    title: album.title,
    subtitle: album.artistName,
    detail: album.releaseDate ? new Date(album.releaseDate).getFullYear().toString() : null,
    artworkUrl: album.artworkUrl,
    message: `${album.title} — ${album.artistName}\nFound on Pulse\n${url}`,
    url,
  };
}

export function artistShare(artist: Artist): SharePayload {
  const url = shareUrl('artist', artist.id);
  return {
    kind: 'artist',
    id: artist.id,
    title: artist.name,
    subtitle: artist.genre ?? 'Artist',
    detail: null,
    artworkUrl: artist.imageUrl,
    message: `${artist.name} on Pulse\n${url}`,
    url,
  };
}

export function playlistShare(playlist: Playlist): SharePayload {
  const url = shareUrl('playlist', playlist.id);
  return {
    kind: 'playlist',
    id: playlist.id,
    title: playlist.name,
    subtitle: `${playlist.trackCount} song${playlist.trackCount === 1 ? '' : 's'}`,
    detail: playlist.description,
    artworkUrl: playlist.coverArtworkUrl,
    message: `${playlist.name} — a playlist on Pulse\n${url}`,
    url,
  };
}

export function eventShare(event: MusicEvent): SharePayload {
  const url = event.ticket?.url ?? shareUrl('event', event.id);
  const where = [event.venueName, event.city].filter(Boolean).join(', ');
  return {
    kind: 'event',
    id: event.id,
    title: event.name,
    subtitle: where || 'Live',
    detail: event.startsAt ? new Date(event.startsAt).toDateString() : null,
    artworkUrl: event.imageUrl,
    message: `${event.name}${where ? ` — ${where}` : ''}\n${url}`,
    url,
  };
}

export function statsShare(input: {
  periodLabel: string;
  totalMs: number;
  artistCount: number;
  trackCount: number;
  topArtist: string | null;
  artworkUrl?: string | null;
}): SharePayload {
  const url = shareUrl('stats', 'me');
  const lines = [
    `My ${input.periodLabel} on Pulse`,
    `${formatListeningTime(input.totalMs)} of listening`,
    `${input.artistCount} artists · ${input.trackCount} songs`,
    input.topArtist ? `Top artist: ${input.topArtist}` : null,
  ].filter(Boolean);
  return {
    kind: 'stats',
    id: 'me',
    title: `My ${input.periodLabel}`,
    subtitle: formatListeningTime(input.totalMs),
    detail: input.topArtist ? `Top artist · ${input.topArtist}` : null,
    artworkUrl: input.artworkUrl ?? null,
    message: `${lines.join('\n')}\n${url}`,
    url,
  };
}

/** Opens the OS share sheet with text and a link. */
export async function shareLink(payload: SharePayload): Promise<boolean> {
  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? { message: payload.message, url: payload.url, title: payload.title }
        : { message: payload.message, title: payload.title },
    );
    return result.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}

/**
 * Screen capture is loaded on demand.
 *
 * The module needs a native view-shot implementation, which is not present in
 * every runtime Pulse can run in (Expo Go and the web build, for two). Resolving
 * it lazily inside a try means those runtimes fall back to link sharing instead
 * of failing to start.
 */
async function captureCard(viewRef: React.RefObject<any>): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const viewShot = require('react-native-view-shot') as {
      captureRef?: (ref: unknown, options: Record<string, unknown>) => Promise<string>;
    };
    if (typeof viewShot?.captureRef !== 'function') return null;
    return await viewShot.captureRef(viewRef, {
      format: 'png',
      quality: 0.95,
      result: 'tmpfile',
    });
  } catch {
    return null;
  }
}

/**
 * Captures the rendered Pulse card and hands the image to the OS share sheet.
 * Falls back to sharing the link when image sharing is unavailable.
 */
export async function shareCard(
  viewRef: React.RefObject<any>,
  payload: SharePayload,
): Promise<boolean> {
  try {
    if (!viewRef.current) return shareLink(payload);
    const uri = await captureCard(viewRef);
    if (!uri) return shareLink(payload);
    if (!(await Sharing.isAvailableAsync())) return shareLink(payload);
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: payload.title,
      UTI: 'public.png',
    });
    return true;
  } catch {
    return shareLink(payload);
  }
}

export async function copyLink(payload: SharePayload): Promise<void> {
  await Clipboard.setStringAsync(payload.url);
}
