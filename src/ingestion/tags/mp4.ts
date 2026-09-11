import {
  ByteReader,
  bytesToBase64,
  cleanText,
  latin1,
  utf8,
  type ByteSource,
} from '@/src/ingestion/tags/bytes';
import { normaliseGenre, type AudioProperties, type RawTags } from '@/src/ingestion/tags/types';

/**
 * MP4 container tags: .m4a, .mp4, .aac — everything iTunes and most phone
 * recorders write.
 *
 * Metadata lives in moov ▸ udta ▸ meta ▸ ilst, and the moov box can sit either
 * before or after the audio data, so the top-level boxes are walked rather than
 * assumed. Only the boxes we need are pulled into memory.
 */

const MAX_MOOV_BYTES = 12 * 1024 * 1024;

const FIELDS: Record<string, keyof RawTags | 'trackPair' | 'discPair' | 'genreIndex' | 'cover'> = {
  '©nam': 'title',
  '©ART': 'artist',
  '©alb': 'album',
  aART: 'albumArtist',
  '©gen': 'genre',
  gnre: 'genreIndex',
  '©day': 'year',
  trkn: 'trackPair',
  disk: 'discPair',
  covr: 'cover',
};

export interface Mp4Result {
  tags: RawTags;
  properties: AudioProperties;
}

export async function readMp4(source: ByteSource): Promise<Mp4Result | null> {
  const moov = await findTopLevelBox(source, 'moov');
  if (!moov) return null;

  const bytes = await source.read(moov.offset, Math.min(moov.size, MAX_MOOV_BYTES));
  const reader = new ByteReader(bytes);
  reader.skip(8); // the moov header itself

  const tags: RawTags = {};
  const properties: AudioProperties = {};

  walk(reader, bytes.length - 8, (type, payload) => {
    if (type === 'mvhd') readMovieHeader(payload, properties);
    if (type === 'udta' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
      // Containers: descend.
      walk(new ByteReader(payload), payload.length, (innerType, innerPayload) => {
        handleBox(innerType, innerPayload, tags, properties);
      });
      return;
    }
    handleBox(type, payload, tags, properties);
  });

  tags.genre = normaliseGenre(tags.genre);
  return { tags, properties };
}

function handleBox(
  type: string,
  payload: Uint8Array,
  tags: RawTags,
  properties: AudioProperties,
) {
  if (type === 'meta') {
    // `meta` carries a four-byte version/flags block before its children.
    const inner = new ByteReader(payload);
    inner.skip(4);
    walk(inner, payload.length - 4, (childType, childPayload) => {
      if (childType === 'ilst') readItemList(childPayload, tags);
    });
    return;
  }
  if (type === 'ilst') {
    readItemList(payload, tags);
    return;
  }
  if (type === 'mvhd') {
    readMovieHeader(payload, properties);
    return;
  }
  if (type === 'stsd') {
    readSampleDescription(payload, properties);
    return;
  }
  if (
    type === 'udta' ||
    type === 'trak' ||
    type === 'mdia' ||
    type === 'minf' ||
    type === 'stbl'
  ) {
    walk(new ByteReader(payload), payload.length, (childType, childPayload) =>
      handleBox(childType, childPayload, tags, properties),
    );
  }
}

/** Iterates the boxes in a buffer, handing each type and payload to `visit`. */
function walk(
  reader: ByteReader,
  limit: number,
  visit: (type: string, payload: Uint8Array) => void,
) {
  const end = reader.offset + limit;
  while (reader.offset + 8 <= Math.min(end, reader.bytes.length)) {
    const start = reader.offset;
    let boxSize = reader.u32();
    const type = reader.ascii(4);
    if (boxSize === 1) {
      // 64-bit size: the high word is always zero for files we can hold anyway.
      reader.skip(4);
      boxSize = reader.u32();
      reader.offset = start + 16;
      const payload = reader.bytes.subarray(start + 16, start + Math.max(16, boxSize));
      visit(type, payload);
      reader.offset = start + Math.max(16, boxSize);
      continue;
    }
    if (boxSize < 8 || start + boxSize > reader.bytes.length) break;
    visit(type, reader.bytes.subarray(start + 8, start + boxSize));
    reader.offset = start + boxSize;
  }
}

function readItemList(payload: Uint8Array, tags: RawTags) {
  const reader = new ByteReader(payload);
  walk(reader, payload.length, (name, itemPayload) => {
    const field = FIELDS[name];
    if (!field) return;

    const data = findDataBox(itemPayload);
    if (!data) return;

    switch (field) {
      case 'cover': {
        if (tags.picture) return;
        const mimeType = data.type === 14 ? 'image/png' : 'image/jpeg';
        tags.picture = {
          base64: bytesToBase64(data.value),
          mimeType,
          byteLength: data.value.length,
        };
        return;
      }
      case 'trackPair':
        tags.trackNumber = readNumberPair(data.value);
        return;
      case 'discPair':
        tags.discNumber = readNumberPair(data.value);
        return;
      case 'genreIndex': {
        const index = data.value.length >= 2 ? (data.value[0] << 8) | data.value[1] : 0;
        // `gnre` is the ID3 table, one-based.
        if (index > 0) tags.genre = normaliseGenre(String(index - 1));
        return;
      }
      case 'year': {
        const text = cleanText(utf8(data.value));
        if (text) tags.year = text.slice(0, 4);
        return;
      }
      default: {
        const text = cleanText(data.type === 1 ? utf8(data.value) : latin1(data.value));
        if (text) (tags as Record<string, unknown>)[field] = text;
      }
    }
  });
}

function findDataBox(payload: Uint8Array): { type: number; value: Uint8Array } | null {
  let result: { type: number; value: Uint8Array } | null = null;
  walk(new ByteReader(payload), payload.length, (type, boxPayload) => {
    if (type !== 'data' || result || boxPayload.length < 8) return;
    // version(1) + flags(3) where the low byte of flags is the value type,
    // then four reserved bytes.
    const dataType = boxPayload[3];
    result = { type: dataType, value: boxPayload.subarray(8) };
  });
  return result;
}

function readNumberPair(value: Uint8Array): number | undefined {
  if (value.length < 4) return undefined;
  const number = (value[2] << 8) | value[3];
  return number > 0 ? number : undefined;
}

function readMovieHeader(payload: Uint8Array, properties: AudioProperties) {
  if (payload.length < 20) return;
  const reader = new ByteReader(payload);
  const version = reader.u8();
  reader.skip(3);
  if (version === 1) {
    reader.skip(16); // 64-bit creation and modification times
    const timescale = reader.u32();
    reader.skip(4);
    const duration = reader.u32();
    if (timescale > 0) properties.durationMs = Math.round((duration / timescale) * 1000);
    return;
  }
  reader.skip(8);
  const timescale = reader.u32();
  const duration = reader.u32();
  if (timescale > 0) properties.durationMs = Math.round((duration / timescale) * 1000);
}

/** The audio sample entry carries channel count and sample rate. */
function readSampleDescription(payload: Uint8Array, properties: AudioProperties) {
  if (payload.length < 36) return;
  const reader = new ByteReader(payload);
  reader.skip(8); // version/flags + entry count
  reader.skip(8); // entry size + format
  reader.skip(8); // reserved + data reference index
  reader.skip(8); // version, revision, vendor
  const channels = reader.u16();
  reader.skip(6); // sample size, compression id, packet size
  const sampleRate = reader.u16(); // 16.16 fixed point; the integer half is enough
  if (channels > 0 && channels <= 8) properties.channels = channels;
  if (sampleRate > 0) properties.sampleRate = sampleRate;
}

/**
 * Walks only the top-level boxes to locate one by name, reading eight bytes at
 * a time. This is what lets us find a trailing `moov` without loading the audio.
 */
async function findTopLevelBox(
  source: ByteSource,
  wanted: string,
): Promise<{ offset: number; size: number } | null> {
  let offset = 0;
  // A malformed file must not spin here.
  for (let guard = 0; guard < 64 && offset + 8 <= source.size; guard += 1) {
    const header = await source.read(offset, 16);
    if (header.length < 8) return null;
    const reader = new ByteReader(header);
    let boxSize = reader.u32();
    const type = reader.ascii(4);
    let headerSize = 8;
    if (boxSize === 1) {
      reader.skip(4);
      boxSize = reader.u32();
      headerSize = 16;
    }
    if (type === wanted) return { offset, size: boxSize };
    if (boxSize < headerSize) return null;
    offset += boxSize;
  }
  return null;
}

export function looksLikeMp4(header: Uint8Array): boolean {
  if (header.length < 12) return false;
  return latin1(header.subarray(4, 8)) === 'ftyp';
}
