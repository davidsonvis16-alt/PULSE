import * as Linking from 'expo-linking';
import { config } from '@/src/core/config';

export type ShareableKind = 'track' | 'album' | 'artist' | 'playlist' | 'event' | 'stats';

/**
 * Share links are dual: a pulse:// deep link that opens the exact screen for
 * people who have the app, and an https fallback for everyone else.
 */
export function deepLink(kind: ShareableKind, id: string): string {
  return Linking.createURL(`/${kind}/${encodeURIComponent(id)}`);
}

export function webLink(kind: ShareableKind, id: string): string {
  const base = config.share.webBaseUrl.replace(/\/$/, '');
  return `${base}/${kind}/${encodeURIComponent(id)}`;
}

export function shareUrl(kind: ShareableKind, id: string): string {
  return webLink(kind, id);
}
