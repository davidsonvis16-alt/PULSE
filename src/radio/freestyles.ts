import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer } from 'expo-audio';
import { supabase } from '@/lib/supabase';
import { delay } from '@/src/core/http';
import { entityId, type Track } from '@/src/core/types';
import { readFileTags } from '@/src/ingestion/tags';
import { base64ToBytes } from '@/src/ingestion/tags/bytes';
import { FREESTYLE_BUCKET, FREESTYLE_PROVIDER_ID } from '@/src/radio/freestyle-provider';

export { livePosition } from '@/src/radio/schedule';

/**
 * Freestyles on the server: what is in rotation, putting one on air, taking
 * one down, and reporting one.
 *
 * The rotation is everything on air in upload order. Because every listener
 * reads the same list and the same clock, every phone can work out on its own
 * which freestyle is playing right now and how far into it — that is what
 * makes it a station rather than a playlist.
 */

export interface Freestyle {
  id: string;
  userId: string;
  title: string;
  storagePath: string;
  durationMs: number;
  createdAt: number;
  artistName: string;
  handle: string | null;
  avatarUrl: string | null;
}

/** How many freestyles the station rotates through, newest kept. */
const ROTATION_LIMIT = 500;
export const MIN_FREESTYLE_MS = 5_000;
export const MAX_FREESTYLE_MS = 10 * 60_000;
export const MAX_TITLE_LENGTH = 80;

function client() {
  if (!supabase) throw new Error('Pulse Radio needs the Pulse server. This build is not connected to one.');
  return supabase;
}

export function freestyleTrack(freestyle: Freestyle): Track {
  return {
    id: entityId(FREESTYLE_PROVIDER_ID, 'track', freestyle.id),
    provider: FREESTYLE_PROVIDER_ID,
    providerTrackId: freestyle.storagePath,
    title: freestyle.title,
    artistName: freestyle.artistName,
    artistId: null,
    albumTitle: 'Pulse Radio',
    albumId: null,
    artworkUrl: freestyle.avatarUrl,
    durationMs: freestyle.durationMs,
    releaseDate: new Date(freestyle.createdAt).toISOString().slice(0, 10),
    genre: 'Freestyle',
    trackNumber: null,
    discNumber: null,
    explicit: false,
    externalUrl: null,
  };
}

function fromRow(row: Record<string, unknown>): Freestyle {
  const handle = (row.handle as string | null) ?? null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    storagePath: row.storage_path as string,
    durationMs: row.duration_ms as number,
    createdAt: new Date(row.created_at as string).getTime(),
    artistName: (row.display_name as string | null) ?? (handle ? `@${handle}` : 'Someone on Pulse'),
    handle,
    avatarUrl: (row.avatar_url as string | null) ?? null,
  };
}

/** Everything on air, oldest first — the order the station plays them in. */
export async function fetchRotation(): Promise<Freestyle[]> {
  const { data, error } = await client()
    .from('radio_rotation')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ROTATION_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow).reverse();
}

/**
 * The server's clock, as an offset from this phone's. Every listener measures
 * against the same time, so they all land on the same second.
 */
export async function fetchClockOffset(): Promise<number> {
  const sent = Date.now();
  const { data, error } = await client().rpc('radio_clock');
  if (error || typeof data !== 'number') return 0;
  const received = Date.now();
  // Assume the answer was given halfway through the round trip.
  return data - (sent + received) / 2;
}

/** The signed-in listener's own freestyles, newest first, including any taken off air. */
export async function listMyFreestyles(): Promise<(Freestyle & { hidden: boolean })[]> {
  const db = client();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await db
    .from('freestyles')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...fromRow(row), artistName: 'You', hidden: !!row.hidden }));
}

/**
 * How long a recording is. The file's own header first, which costs nothing;
 * failing that, load it into a silent player and ask.
 */
export async function measureDuration(uri: string): Promise<number | null> {
  if (Platform.OS !== 'web') {
    const tags = await readFileTags(uri).catch(() => null);
    if (tags?.durationMs) return tags.durationMs;
  }
  const probe = createAudioPlayer({ uri });
  try {
    for (let waited = 0; waited < 8000; waited += 200) {
      if (probe.isLoaded && probe.duration > 0) return Math.round(probe.duration * 1000);
      await delay(200);
    }
    return null;
  } finally {
    probe.remove();
  }
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web' || /^(blob|https?):/.test(uri)) {
    const response = await fetch(uri);
    return response.arrayBuffer();
  }
  const encoded = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const bytes = base64ToBytes(encoded);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
};

export function validateFreestyle(title: string, durationMs: number | null): string | null {
  const clean = title.trim();
  if (clean.length === 0) return 'Give your freestyle a name.';
  if (clean.length > MAX_TITLE_LENGTH) return `Keep the name under ${MAX_TITLE_LENGTH} characters.`;
  if (!durationMs) return 'Pulse could not tell how long that recording is. Try another file.';
  if (durationMs < MIN_FREESTYLE_MS) return 'Freestyles need to be at least 5 seconds long.';
  if (durationMs > MAX_FREESTYLE_MS) return 'Freestyles can be up to 10 minutes long.';
  return null;
}

/** Puts a recording on the radio. The file goes up first, then the listing. */
export async function uploadFreestyle(input: {
  uri: string;
  title: string;
  durationMs: number | null;
  mimeType?: string | null;
}): Promise<Freestyle> {
  const problem = validateFreestyle(input.title, input.durationMs);
  if (problem) throw new Error(problem);

  const db = client();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in to put a freestyle on the radio.');

  const mimeType = input.mimeType && EXTENSIONS[input.mimeType] ? input.mimeType : 'audio/mp4';
  const path = `${auth.user.id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${EXTENSIONS[mimeType]}`;

  const body = await readBytes(input.uri);
  if (body.byteLength > 25 * 1024 * 1024) throw new Error('That recording is over 25 MB.');

  const upload = await db.storage.from(FREESTYLE_BUCKET).upload(path, body, {
    contentType: mimeType,
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);

  const { data, error } = await db
    .from('freestyles')
    .insert({
      user_id: auth.user.id,
      title: input.title.trim(),
      storage_path: path,
      duration_ms: Math.round(input.durationMs!),
    })
    .select('*')
    .single();
  if (error) {
    // Do not leave an orphaned file behind when the listing is refused.
    await db.storage.from(FREESTYLE_BUCKET).remove([path]).catch(() => {});
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function deleteFreestyle(freestyle: Pick<Freestyle, 'id' | 'storagePath'>) {
  const db = client();
  const { error } = await db.from('freestyles').delete().eq('id', freestyle.id);
  if (error) throw new Error(error.message);
  await db.storage.from(FREESTYLE_BUCKET).remove([freestyle.storagePath]).catch(() => {});
}

export async function reportFreestyle(freestyleId: string, reason?: string) {
  const db = client();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in to report a freestyle.');
  const { error } = await db.from('freestyle_reports').insert({
    freestyle_id: freestyleId,
    reporter_id: auth.user.id,
    reason: reason ?? null,
  });
  // Reporting twice is not an error worth showing anyone.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}
