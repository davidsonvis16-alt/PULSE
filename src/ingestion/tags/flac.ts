import {
  ByteReader,
  base64ToBytes,
  bytesToBase64,
  cleanText,
  indexOfBytes,
  latin1,
  utf8,
  type ByteSource,
} from '@/src/ingestion/tags/bytes';
import { normaliseGenre, type AudioProperties, type RawTags } from '@/src/ingestion/tags/types';

/**
 * FLAC, Ogg Vorbis and WAV.
 *
 * FLAC and Ogg both carry Vorbis comments, so the comment parser is shared.
 * WAV has no standard artwork, but its RIFF INFO chunk still gives a title and
 * artist, which is enough for identification to take over.
 */

const MAX_BLOCK_BYTES = 12 * 1024 * 1024;

const VORBIS_FIELDS: Record<string, keyof RawTags | 'trackText' | 'discText'> = {
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ALBUMARTIST: 'albumArtist',
  GENRE: 'genre',
  DATE: 'year',
  YEAR: 'year',
  TRACKNUMBER: 'trackText',
  DISCNUMBER: 'discText',
};

export interface ContainerResult {
  tags: RawTags;
  properties: AudioProperties;
}

/* -------------------------------------------------------------------- FLAC */

export async function readFlac(source: ByteSource): Promise<ContainerResult | null> {
  const head = await source.read(0, 4);
  if (latin1(head) !== 'fLaC') return null;

  const tags: RawTags = {};
  const properties: AudioProperties = {};

  let offset = 4;
  for (let guard = 0; guard < 64; guard += 1) {
    const header = await source.read(offset, 4);
    if (header.length < 4) break;
    const isLast = (header[0] & 0x80) !== 0;
    const blockType = header[0] & 0x7f;
    const blockSize = (header[1] << 16) | (header[2] << 8) | header[3];
    if (blockSize <= 0 || blockSize > MAX_BLOCK_BYTES) break;

    if (blockType === 0) {
      readStreamInfo(await source.read(offset + 4, blockSize), properties);
    } else if (blockType === 4) {
      readVorbisComments(await source.read(offset + 4, blockSize), tags, 0);
    } else if (blockType === 6 && !tags.picture) {
      readFlacPicture(await source.read(offset + 4, blockSize), tags);
    }

    offset += 4 + blockSize;
    if (isLast) break;
  }

  tags.genre = normaliseGenre(tags.genre);
  return { tags, properties };
}

function readStreamInfo(bytes: Uint8Array, properties: AudioProperties) {
  if (bytes.length < 18) return;
  // Sample rate is 20 bits starting at byte 10, then 3 bits of channel count
  // minus one, then 5 bits of bit depth, then 36 bits of total samples.
  const sampleRate = (bytes[10] << 12) | (bytes[11] << 4) | (bytes[12] >> 4);
  const channels = ((bytes[12] >> 1) & 0x07) + 1;
  const totalSamples =
    ((bytes[13] & 0x0f) * 2 ** 32) +
    bytes[14] * 2 ** 24 +
    bytes[15] * 2 ** 16 +
    bytes[16] * 2 ** 8 +
    bytes[17];

  if (sampleRate > 0) {
    properties.sampleRate = sampleRate;
    properties.channels = channels;
    if (totalSamples > 0) properties.durationMs = Math.round((totalSamples / sampleRate) * 1000);
  }
}

function readFlacPicture(bytes: Uint8Array, tags: RawTags) {
  const reader = new ByteReader(bytes);
  reader.u32(); // picture type
  const mimeLength = reader.u32();
  const mimeType = reader.ascii(mimeLength) || 'image/jpeg';
  const descriptionLength = reader.u32();
  reader.skip(descriptionLength);
  reader.skip(16); // width, height, depth, colour count
  const dataLength = reader.u32();
  if (dataLength <= 0 || dataLength > reader.remaining) return;
  const data = reader.slice(dataLength);
  tags.picture = { base64: bytesToBase64(data), mimeType, byteLength: data.length };
}

/* ------------------------------------------------------------ Vorbis / Ogg */

function readVorbisComments(bytes: Uint8Array, tags: RawTags, startOffset: number) {
  const reader = new ByteReader(bytes);
  reader.offset = startOffset;
  if (!reader.has(4)) return;

  const vendorLength = reader.u32le();
  reader.skip(vendorLength);
  if (!reader.has(4)) return;

  const count = reader.u32le();
  for (let i = 0; i < count && reader.has(4); i += 1) {
    const length = reader.u32le();
    if (length <= 0 || length > reader.remaining) break;
    const entry = utf8(reader.slice(length));
    const split = entry.indexOf('=');
    if (split === -1) continue;

    const key = entry.slice(0, split).toUpperCase();
    const value = cleanText(entry.slice(split + 1));
    if (!value) continue;

    if (key === 'METADATA_BLOCK_PICTURE' && !tags.picture) {
      try {
        readFlacPicture(base64ToBytes(entry.slice(split + 1)), tags);
      } catch {
        /* a malformed picture block is not worth failing the whole file for */
      }
      continue;
    }

    const field = VORBIS_FIELDS[key];
    if (!field) continue;
    if (field === 'trackText') tags.trackNumber = Number(value.split('/')[0]) || undefined;
    else if (field === 'discText') tags.discNumber = Number(value.split('/')[0]) || undefined;
    else if (field === 'year') tags.year = value.slice(0, 4);
    else (tags as Record<string, unknown>)[field] = value;
  }
}

export async function readOgg(source: ByteSource): Promise<ContainerResult | null> {
  const head = await source.read(0, 4);
  if (latin1(head) !== 'OggS') return null;

  // The comment header sits in the first few pages; reading 256KB covers it
  // for every real-world file without loading the stream.
  const window = await source.read(0, 256 * 1024);
  const tags: RawTags = {};
  const properties: AudioProperties = {};

  const identification = indexOfBytes(window, [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
  if (identification !== -1 && identification + 16 < window.length) {
    const reader = new ByteReader(window);
    reader.offset = identification + 7;
    reader.u32le(); // vorbis version
    const channels = reader.u8();
    const sampleRate = reader.u32le();
    if (sampleRate > 0) {
      properties.sampleRate = sampleRate;
      properties.channels = channels;
    }
  }

  const comment = indexOfBytes(window, [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
  if (comment !== -1) readVorbisComments(window, tags, comment + 7);

  // Opus uses the same page structure with a different marker.
  const opus = indexOfBytes(window, [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]);
  if (opus !== -1 && !tags.title) readVorbisComments(window, tags, opus + 8);

  tags.genre = normaliseGenre(tags.genre);
  return { tags, properties };
}

/* --------------------------------------------------------------------- WAV */

const RIFF_FIELDS: Record<string, keyof RawTags> = {
  INAM: 'title',
  IART: 'artist',
  IPRD: 'album',
  IGNR: 'genre',
  ICRD: 'year',
};

export async function readWav(source: ByteSource): Promise<ContainerResult | null> {
  const size = source.size;
  const head = await source.read(0, 12);
  if (latin1(head.subarray(0, 4)) !== 'RIFF' || latin1(head.subarray(8, 12)) !== 'WAVE') {
    return null;
  }

  const window = await source.read(12, Math.min(size - 12, 128 * 1024));
  const reader = new ByteReader(window);
  const tags: RawTags = {};
  const properties: AudioProperties = {};

  while (reader.has(8)) {
    const chunkId = reader.ascii(4);
    const chunkSize = reader.u32le();
    if (chunkSize < 0 || chunkSize > reader.remaining) break;

    if (chunkId === 'fmt ') {
      const chunk = new ByteReader(reader.slice(chunkSize));
      chunk.u16(); // format tag
      properties.channels = chunk.u8() | (chunk.u8() << 8);
      properties.sampleRate = chunk.u32le();
      const byteRate = chunk.u32le();
      if (byteRate > 0) {
        properties.bitrate = byteRate * 8;
        properties.durationMs = Math.round(((size - 44) / byteRate) * 1000);
      }
    } else if (chunkId === 'LIST') {
      const chunk = new ByteReader(reader.slice(chunkSize));
      if (chunk.ascii(4) === 'INFO') {
        while (chunk.has(8)) {
          const infoId = chunk.ascii(4);
          const infoSize = chunk.u32le();
          if (infoSize <= 0 || infoSize > chunk.remaining) break;
          const value = cleanText(latin1(chunk.slice(infoSize)));
          const field = RIFF_FIELDS[infoId];
          if (field && value) (tags as Record<string, unknown>)[field] = value;
          if (infoSize % 2 === 1) chunk.skip(1); // chunks are word-aligned
        }
      }
    } else {
      reader.skip(chunkSize);
    }

    if (chunkSize % 2 === 1) reader.skip(1);
  }

  tags.genre = normaliseGenre(tags.genre);
  return { tags, properties };
}
