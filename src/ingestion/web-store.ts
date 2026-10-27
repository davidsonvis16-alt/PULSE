/**
 * Music files for the web version.
 *
 * A browser has no file system Pulse can keep copies in, and the address a
 * picked file arrives under dies with the tab. So on the web, picked music is
 * kept in the browser's Cache Storage under a `pulse-web:` address, which is
 * what the library stores. The tag readers read slices of it, and the player
 * gets a short-lived object URL for it when the song is played.
 *
 * Everything stays in this browser. Nothing here is uploaded.
 */

export const WEB_FILE_SCHEME = 'pulse-web:';
const CACHE_NAME = 'pulse-music-v1';

export function isWebFile(uri: string | null | undefined): uri is string {
  return !!uri && uri.startsWith(WEB_FILE_SCHEME);
}

function requestFor(uri: string): Request {
  const path = encodeURIComponent(uri.slice(WEB_FILE_SCHEME.length));
  return new Request(`${window.location.origin}/__pulse-music/${path}`);
}

async function open(): Promise<Cache> {
  if (typeof caches === 'undefined') {
    throw new Error('This browser cannot keep music for Pulse. Try Chrome, Edge or Firefox.');
  }
  return caches.open(CACHE_NAME);
}

/** Keeps a picked file and returns the address the library should store. */
export async function storeWebFile(name: string, body: Blob): Promise<{ uri: string; size: number }> {
  const cache = await open();
  const uri = `${WEB_FILE_SCHEME}${Date.now().toString(36)}-${name}`;
  await cache.put(
    requestFor(uri),
    new Response(body, { headers: { 'content-type': body.type || 'application/octet-stream' } }),
  );
  // Ask the browser not to clear it under storage pressure. A refusal is fine.
  void navigator.storage?.persist?.().catch(() => false);
  return { uri, size: body.size };
}

const blobs = new Map<string, Blob>();

export async function webFileBlob(uri: string): Promise<Blob | null> {
  const known = blobs.get(uri);
  if (known) return known;
  const cache = await open();
  const response = await cache.match(requestFor(uri));
  if (!response) return null;
  const blob = await response.blob();
  blobs.set(uri, blob);
  return blob;
}

export async function readWebFileSlice(uri: string, position: number, length: number): Promise<Uint8Array> {
  const blob = await webFileBlob(uri);
  if (!blob) throw new Error('That file is no longer in this browser.');
  return new Uint8Array(await blob.slice(position, position + length).arrayBuffer());
}

export async function webFileSize(uri: string): Promise<number> {
  return (await webFileBlob(uri))?.size ?? 0;
}

const objectUrls = new Map<string, string>();

/** An address the audio element can play. */
export async function webFilePlaybackUrl(uri: string): Promise<string | null> {
  const existing = objectUrls.get(uri);
  if (existing) return existing;
  const blob = await webFileBlob(uri);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(uri, url);
  return url;
}

export async function clearWebFiles() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  blobs.clear();
  if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
}
