import {
  ByteReader,
  bytesToBase64,
  cleanText,
  latin1,
  utf16,
  utf8,
  type ByteSource,
} from '@/src/ingestion/tags/bytes';
import { normaliseGenre, type AudioProperties, type RawTags } from '@/src/ingestion/tags/types';

/**
 * ID3 tags, as found on MP3 files.
 *
 * Handles ID3v2.2, 2.3 and 2.4 (including unsynchronisation and the extended
 * header), falls back to the 128-byte ID3v1 block at the end of the file, and
 * reads embedded cover art out of APIC/PIC frames.
 */

const MAX_TAG_BYTES = 8 * 1024 * 1024;

/** Frame names differ between 2.2 (three letters) and 2.3/2.4 (four). */
const FRAME_ALIASES: Record<string, keyof RawTags | 'trackText' | 'discText'> = {
  TIT2: 'title',
  TT2: 'title',
  TPE1: 'artist',
  TP1: 'artist',
  TALB: 'album',
  TAL: 'album',
  TPE2: 'albumArtist',
  TP2: 'albumArtist',
  TCON: 'genre',
  TCO: 'genre',
  TYER: 'year',
  TYE: 'year',
  TDRC: 'year',
  TDRL: 'year',
  TRCK: 'trackText',
  TRK: 'trackText',
  TPOS: 'discText',
  TPA: 'discText',
};

export interface Id3Result {
  tags: RawTags;
  /** Where the audio actually starts, so the frame scan can skip the tag. */
  audioOffset: number;
}

export async function readId3v2(source: ByteSource): Promise<Id3Result | null> {
  const header = await source.read(0, 10);
  if (header.length < 10) return null;
  if (!(header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33)) return null; // "ID3"

  const majorVersion = header[3];
  const flags = header[5];
  const size =
    ((header[6] & 0x7f) << 21) | ((header[7] & 0x7f) << 14) | ((header[8] & 0x7f) << 7) | (header[9] & 0x7f);
  if (size <= 0 || size > MAX_TAG_BYTES) return { tags: {}, audioOffset: 10 + Math.max(0, size) };

  let body = await source.read(10, size);
  if (flags & 0x80) body = deUnsynchronise(body);

  const reader = new ByteReader(body);

  // Extended header, if present, is length-prefixed and skippable.
  if (flags & 0x40) {
    const extendedSize = majorVersion >= 4 ? reader.syncSafe32() : reader.u32();
    reader.skip(Math.max(0, extendedSize - (majorVersion >= 4 ? 4 : 0)));
  }

  const tags: RawTags = {};
  const idLength = majorVersion === 2 ? 3 : 4;

  while (reader.has(idLength + (majorVersion === 2 ? 3 : 6))) {
    const id = reader.ascii(idLength);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // padding reached

    let frameSize: number;
    if (majorVersion === 2) {
      frameSize = reader.u24();
    } else if (majorVersion >= 4) {
      frameSize = reader.syncSafe32();
      reader.skip(2);
    } else {
      frameSize = reader.u32();
      reader.skip(2);
    }

    if (frameSize <= 0 || frameSize > reader.remaining) break;
    const payload = reader.slice(frameSize);

    const target = FRAME_ALIASES[id];
    if (target) {
      const text = decodeTextFrame(payload);
      if (text) applyTextFrame(tags, target, text);
      continue;
    }

    if (id === 'APIC' || id === 'PIC') {
      const picture = decodePictureFrame(payload, id === 'PIC');
      // Front cover wins; anything else is only used if nothing better turns up.
      if (picture && (!tags.picture || picture.preferred)) {
        tags.picture = {
          base64: bytesToBase64(picture.data),
          mimeType: picture.mimeType,
          byteLength: picture.data.length,
        };
      }
    }
  }

  tags.genre = normaliseGenre(tags.genre);
  return { tags, audioOffset: 10 + size };
}

function applyTextFrame(tags: RawTags, target: string, text: string) {
  switch (target) {
    case 'trackText':
      tags.trackNumber = parseNumberPair(text);
      break;
    case 'discText':
      tags.discNumber = parseNumberPair(text);
      break;
    case 'year':
      // TDRC can be a full date; the year is what we want.
      tags.year = text.slice(0, 4);
      break;
    default:
      (tags as Record<string, unknown>)[target] = text;
  }
}

function parseNumberPair(text: string): number | undefined {
  const value = Number(text.split('/')[0]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function decodeTextFrame(payload: Uint8Array): string | undefined {
  if (payload.length < 2) return undefined;
  const encoding = payload[0];
  const body = payload.subarray(1);
  const text =
    encoding === 1
      ? utf16(body)
      : encoding === 2
        ? utf16(body, true)
        : encoding === 3
          ? utf8(body)
          : latin1(body);
  const clean = cleanText(text);
  return clean.length > 0 ? clean : undefined;
}

interface PictureFrame {
  data: Uint8Array;
  mimeType: string;
  preferred: boolean;
}

function decodePictureFrame(payload: Uint8Array, isV22: boolean): PictureFrame | null {
  if (payload.length < 6) return null;
  const encoding = payload[0];
  let offset = 1;

  let mimeType: string;
  if (isV22) {
    // v2.2 stores a three-character format code rather than a MIME type.
    const format = latin1(payload.subarray(1, 4)).toLowerCase();
    mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    offset = 4;
  } else {
    const end = payload.indexOf(0, offset);
    if (end === -1) return null;
    mimeType = latin1(payload.subarray(offset, end)).toLowerCase() || 'image/jpeg';
    if (!mimeType.includes('/')) mimeType = `image/${mimeType}`;
    offset = end + 1;
  }

  const pictureType = payload[offset];
  offset += 1;

  // Description, terminated by one NUL or two for the UTF-16 encodings.
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < payload.length && !(payload[offset] === 0 && payload[offset + 1] === 0)) {
      offset += 2;
    }
    offset += 2;
  } else {
    while (offset < payload.length && payload[offset] !== 0) offset += 1;
    offset += 1;
  }

  if (offset >= payload.length) return null;
  return {
    data: payload.subarray(offset),
    mimeType,
    // 3 is "cover (front)" in the ID3 picture-type table.
    preferred: pictureType === 3,
  };
}

/** Undoes the FF 00 padding ID3 inserts so tag bytes never look like a frame sync. */
function deUnsynchronise(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    out[length] = bytes[i];
    length += 1;
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i += 1;
  }
  return out.subarray(0, length);
}

/** The 128-byte block at the end of older MP3s. Used only to fill gaps. */
export async function readId3v1(source: ByteSource): Promise<RawTags | null> {
  const size = source.size;
  if (size < 128) return null;
  const bytes = await source.read(size - 128, 128);
  if (bytes.length < 128) return null;
  if (!(bytes[0] === 0x54 && bytes[1] === 0x41 && bytes[2] === 0x47)) return null; // "TAG"

  const text = (from: number, length: number) => cleanText(latin1(bytes.subarray(from, from + length)));
  const genreIndex = bytes[127];
  const trackByte = bytes[125] === 0 ? bytes[126] : 0;

  return {
    title: text(3, 30) || undefined,
    artist: text(33, 30) || undefined,
    album: text(63, 30) || undefined,
    year: text(93, 4) || undefined,
    trackNumber: trackByte > 0 ? trackByte : undefined,
    genre: normaliseGenre(String(genreIndex)),
  };
}

/* ------------------------------------------------------- audio properties */

const MPEG_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

/**
 * Reads the first MPEG frame header for bitrate, sample rate and channels, and
 * uses a Xing/Info header when present so variable-bitrate files report a real
 * duration instead of a guess.
 */
export async function readMpegProperties(
  source: ByteSource,
  audioOffset: number,
): Promise<AudioProperties> {
  const size = source.size;
  const window = await source.read(audioOffset, 4096);
  const syncIndex = findFrameSync(window);
  if (syncIndex === -1) return {};

  const b1 = window[syncIndex + 1];
  const b2 = window[syncIndex + 2];
  const b3 = window[syncIndex + 3];

  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits === 0) return {};

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (sampleRateIndex === 3) return {};

  const isVersion1 = versionBits === 3;
  const bitrate = (isVersion1 ? MPEG_BITRATES_V1_L3 : MPEG_BITRATES_V2_L3)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[versionBits]?.[sampleRateIndex];
  const channels = ((b3 >> 6) & 0x03) === 3 ? 1 : 2;
  if (!bitrate || !sampleRate) return {};

  const samplesPerFrame = isVersion1 ? 1152 : 576;
  const vbr = readXingFrameCount(window, syncIndex, isVersion1, channels);

  const durationMs = vbr
    ? Math.round((vbr * samplesPerFrame * 1000) / sampleRate)
    : Math.round(((size - audioOffset) * 8) / bitrate);

  return { bitrate: bitrate * 1000, sampleRate, channels, durationMs };
}

function findFrameSync(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) return i;
  }
  return -1;
}

/** Xing/Info sits inside the first frame and carries the real frame count. */
function readXingFrameCount(
  bytes: Uint8Array,
  syncIndex: number,
  isVersion1: boolean,
  channels: number,
): number | null {
  const sideInfo = isVersion1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;
  const start = syncIndex + 4 + sideInfo;
  if (start + 12 > bytes.length) return null;
  const marker = latin1(bytes.subarray(start, start + 4));
  if (marker !== 'Xing' && marker !== 'Info') return null;
  const flags = bytes[start + 7];
  if (!(flags & 0x01)) return null;
  const reader = new ByteReader(bytes.subarray(start + 8, start + 12));
  const frames = reader.u32();
  return frames > 0 ? frames : null;
}
