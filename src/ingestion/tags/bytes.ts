import * as FileSystem from 'expo-file-system/legacy';
import { isWebFile, readWebFileSlice, webFileSize } from '@/src/ingestion/web-store';

/**
 * Byte-level helpers for reading audio tags.
 *
 * Pulse reads tags itself rather than shipping a native tag library, so all of
 * this works in Expo Go and on both platforms. Files are read in slices — a few
 * hundred kilobytes of header, never the whole song — because a library scan
 * touches hundreds of files and pulling each one into memory would not finish.
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Decodes base64 without relying on atob, which is not everywhere. */
export function base64ToBytes(input: string): Uint8Array {
  let clean = input;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  if (padding) clean = clean.slice(0, -padding);

  const length = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(length);

  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i += 1) {
    const value = BASE64_LOOKUP[clean.charCodeAt(i)];
    if (value === 255) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex] = (buffer >> bits) & 0xff;
      outIndex += 1;
    }
  }

  return outIndex === out.length ? out : out.subarray(0, outIndex);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64_ALPHABET[c & 63];
  }
  return out;
}

/**
 * The only thing the tag readers know about storage.
 *
 * Keeping the readers behind this means they are pure byte logic: the app hands
 * them a file, and the test suite hands them a buffer.
 */
export interface ByteSource {
  readonly size: number;
  read(position: number, length: number): Promise<Uint8Array>;
}

/** Reads `length` bytes starting at `position`. Returns fewer at end of file. */
export async function readSlice(
  uri: string,
  position: number,
  length: number,
): Promise<Uint8Array> {
  if (isWebFile(uri)) return readWebFileSlice(uri, position, length);
  const encoded = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64',
    position,
    length,
  });
  return base64ToBytes(encoded);
}

export async function fileSize(uri: string): Promise<number> {
  if (isWebFile(uri)) return webFileSize(uri);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return 0;
  return 'size' in info && typeof info.size === 'number' ? info.size : 0;
}

export function fileByteSource(uri: string, size: number): ByteSource {
  return {
    size,
    read: (position, length) => readSlice(uri, position, Math.max(0, Math.min(length, size - position))),
  };
}

/** An in-memory source, used by the tag tests. */
export function bufferByteSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (position, length) =>
      bytes.subarray(position, Math.min(bytes.length, position + length)),
  };
}

/** Cursor over a byte buffer, with just the reads the tag formats need. */
export class ByteReader {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  has(count: number): boolean {
    return this.remaining >= count;
  }

  skip(count: number): void {
    this.offset += count;
  }

  u8(): number {
    return this.bytes[this.offset++] ?? 0;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u24(): number {
    return (this.u8() << 16) | (this.u8() << 8) | this.u8();
  }

  u32(): number {
    // Multiplication rather than a shift: a shift would go negative at 2^31.
    return this.u8() * 0x1000000 + this.u16() * 0x100 + this.u8();
  }

  u32le(): number {
    const a = this.u8();
    const b = this.u8();
    const c = this.u8();
    const d = this.u8();
    return a + b * 0x100 + c * 0x10000 + d * 0x1000000;
  }

  /** ID3 "syncsafe" integer: 7 bits per byte, top bit always clear. */
  syncSafe32(): number {
    return ((this.u8() & 0x7f) << 21) | ((this.u8() & 0x7f) << 14) | ((this.u8() & 0x7f) << 7) | (this.u8() & 0x7f);
  }

  ascii(length: number): string {
    let out = '';
    for (let i = 0; i < length; i += 1) out += String.fromCharCode(this.u8());
    return out;
  }

  slice(length: number): Uint8Array {
    const end = Math.min(this.bytes.length, this.offset + length);
    const out = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return out;
  }
}

export function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

export function utf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
      i += 1;
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (byte < 0xf0) {
      out += String.fromCharCode(
        ((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      // Outside the basic plane: emit a surrogate pair.
      const code =
        ((byte & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      const adjusted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
      i += 4;
    }
  }
  return out;
}

export function utf16(bytes: Uint8Array, bigEndianDefault = false): string {
  let start = 0;
  let bigEndian = bigEndianDefault;
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      bigEndian = false;
      start = 2;
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      bigEndian = true;
      start = 2;
    }
  }
  let out = '';
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const code = bigEndian ? (bytes[i] << 8) | bytes[i + 1] : (bytes[i + 1] << 8) | bytes[i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/** Trims trailing NULs and whitespace that tag writers leave behind. */
export function cleanText(value: string): string {
  return value.replace(/\0+$/g, '').replace(/\s+/g, ' ').trim();
}

export function indexOfBytes(haystack: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
