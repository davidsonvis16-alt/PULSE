import { fileByteSource, fileSize, latin1, type ByteSource } from '@/src/ingestion/tags/bytes';
import { readId3v1, readId3v2, readMpegProperties } from '@/src/ingestion/tags/id3';
import { looksLikeMp4, readMp4 } from '@/src/ingestion/tags/mp4';
import { readFlac, readOgg, readWav } from '@/src/ingestion/tags/flac';
import type { AudioProperties, FileTags, RawTags } from '@/src/ingestion/tags/types';

export * from '@/src/ingestion/tags/types';
export { bufferByteSource, fileByteSource, type ByteSource } from '@/src/ingestion/tags/bytes';

/**
 * Reads whatever an audio file is willing to tell us about itself.
 *
 * Format is decided by the bytes, not the extension, because plenty of files on
 * a phone are named wrongly. Nothing here writes to the file — Pulse only ever
 * reads the user's music.
 */

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

const EMPTY: FileTags = { container: null, mimeType: null };

export async function readFileTags(uri: string, knownSize?: number): Promise<FileTags> {
  const size = knownSize ?? (await fileSize(uri));
  if (size <= 0) return EMPTY;
  return readTags(fileByteSource(uri, size));
}

export async function readTags(source: ByteSource): Promise<FileTags> {
  if (source.size <= 0) return EMPTY;

  let header: Uint8Array;
  try {
    header = await source.read(0, 16);
  } catch {
    return EMPTY;
  }

  const container = detectContainer(header);
  if (!container) return EMPTY;

  try {
    switch (container) {
      case 'mp3': {
        const id3 = await readId3v2(source);
        const tags: RawTags = id3?.tags ?? {};
        // ID3v1 only fills what v2 left blank; it is the cruder of the two.
        const v1 = await readId3v1(source);
        if (v1) {
          for (const [key, value] of Object.entries(v1)) {
            if (value !== undefined && (tags as Record<string, unknown>)[key] === undefined) {
              (tags as Record<string, unknown>)[key] = value;
            }
          }
        }
        const properties = await readMpegProperties(source, id3?.audioOffset ?? 0);
        return { ...tags, ...properties, container, mimeType: MIME_TYPES.mp3 };
      }
      case 'mp4':
        return merge(await readMp4(source), container);
      case 'flac':
        return merge(await readFlac(source), container);
      case 'ogg':
        return merge(await readOgg(source), container);
      case 'wav':
        return merge(await readWav(source), container);
      default:
        return EMPTY;
    }
  } catch {
    // A file we cannot parse is not an error: it becomes a track that needs
    // identification, which is exactly what that state is for.
    return { container, mimeType: MIME_TYPES[container] ?? null };
  }
}

function merge(
  result: { tags: RawTags; properties: AudioProperties } | null,
  container: string,
): FileTags {
  return {
    ...(result?.tags ?? {}),
    ...(result?.properties ?? {}),
    container,
    mimeType: MIME_TYPES[container] ?? null,
  };
}

function detectContainer(header: Uint8Array): string | null {
  if (header.length < 12) return null;
  const magic = latin1(header.subarray(0, 4));

  if (magic.startsWith('ID3')) return 'mp3';
  if (magic === 'fLaC') return 'flac';
  if (magic === 'OggS') return 'ogg';
  if (magic === 'RIFF') return 'wav';
  if (looksLikeMp4(header)) return 'mp4';
  // A bare MPEG frame sync: an MP3 with no tag at all.
  if (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** Fills in a bitrate when the format did not state one outright. */
export function estimateBitrate(size: number, durationMs: number | undefined): number | undefined {
  if (!durationMs || durationMs < 1000 || size <= 0) return undefined;
  return Math.round((size * 8) / (durationMs / 1000));
}
