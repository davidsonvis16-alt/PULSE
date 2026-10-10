/**
 * Text matching used to decide whether a candidate really is the user's song.
 *
 * The input is messy by nature — filenames written by download sites, tags
 * typed by hand, titles carrying "(Official Video)" — so cleaning happens
 * before any comparison, and comparison returns a score rather than a verdict.
 */

/** Noise that appears in filenames but never in a real title. */
const NOISE_PATTERNS: RegExp[] = [
  /\((official\s*)?(music\s*)?(video|audio|lyric[s]?|visualizer|version)\)/gi,
  /\[(official\s*)?(music\s*)?(video|audio|lyric[s]?|visualizer|version)\]/gi,
  /\b(official\s+(music\s+)?(video|audio))\b/gi,
  /\b(hq|hd|4k|cdq|full\s*album|free\s*download)\b/gi,
  /\b\d{2,3}\s*kbps\b/gi,
  /\b\d{3}k\b/gi,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}\b/gi,
  /\b[a-z0-9-]+\.(com|net|org|to|cc|me)\b/gi,
  /[\(\[][^)\]]*\b(mp3|download|audio)\b[^)\]]*[\)\]]/gi,
  /\s[-–—]\s*topic\b/gi,
  /\(\s*\d+\s*\)\s*$/,
];

export function stripExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]{2,5}$/i, '');
}

/** Turns a filename into something worth searching for. */
export function cleanFilename(filename: string): string {
  let value = stripExtension(filename);
  value = value.replace(/[_]+/g, ' ');
  // "Artist.Name.-.Title" comes out of some rippers; dots are the separator
  // there, but only when the name has no real spaces to begin with.
  if (!/\s/.test(value) && (value.match(/\./g) ?? []).length >= 2) {
    value = value.replace(/\./g, ' ');
  }
  // Leading track numbers: "01 - ", "07.", "3 "
  value = value.replace(/^\s*\d{1,3}\s*[-._)]\s*/, '');
  for (const pattern of NOISE_PATTERNS) value = value.replace(pattern, ' ');
  // Stripping noise leaves the brackets that held it, and often a dangling
  // separator where a suffix used to be.
  value = value.replace(/[\(\[\{]\s*[\)\]\}]/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  value = value.replace(/[\s\-–—_.,]+$/, '');
  return value.trim();
}

/**
 * Splits "Artist - Title" when a filename uses that shape.
 * Returns nulls rather than guessing when there is no clear separator.
 */
export function splitArtistTitle(value: string): { artist: string | null; title: string | null } {
  const cleaned = cleanFilename(value);
  const match = cleaned.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (!match) return { artist: null, title: cleaned || null };
  return { artist: match[1].trim(), title: match[2].trim() };
}

/**
 * Capitalises a name that was typed carelessly, without mangling one that was
 * not: "burna boy" and "BURNA BOY" both become "Burna Boy", while "DJ Khaled"
 * and "SZA" keep the capitals that belong to them.
 */
export function titleCase(value: string): string {
  const capitalise = (token: string) =>
    token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();

  const tokens = value.split(/(\s+)/);
  const words = tokens.filter((token) => token.trim());
  const letters = value.replace(/[^a-zA-Z]/g, '');

  // A whole name in capitals is shouting, not styling — unless it is a single
  // short word, which is how stage names like SZA and MGK are written.
  if (letters && letters === letters.toUpperCase()) {
    if (words.length === 1 && letters.length <= 4) return value;
    return tokens.map((token) => (token.trim() ? capitalise(token) : token)).join('');
  }

  return tokens
    .map((token) => {
      if (!token.trim()) return token;
      const tokenLetters = token.replace(/[^a-zA-Z]/g, '');
      // Only careless lower case is corrected; deliberate casing is left alone.
      if (!tokenLetters || tokenLetters !== tokenLetters.toLowerCase()) return token;
      return capitalise(token);
    })
    .join('');
}

/**
 * True when a filename says nothing a person would recognise: track numbers,
 * camera and messenger exports, "recording 4", a bare string of digits.
 *
 * These are the names worth replacing with whatever the catalogue calls the
 * song, because there is nothing of the user's intent in them to preserve.
 */
export function isLowInformationName(filename: string): boolean {
  const cleaned = cleanFilename(filename).trim();
  if (cleaned.length < 3) return true;

  const letters = cleaned.replace(/[^a-zA-Z]/g, '');
  const digits = cleaned.replace(/[^0-9]/g, '');
  // Mostly digits: "20240113 084512", "128 07 03".
  if (digits.length >= letters.length) return true;

  const words = cleaned.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const filler = new Set([
    'track',
    'audio',
    'song',
    'music',
    'recording',
    'record',
    'voice',
    'memo',
    'new',
    'untitled',
    'unknown',
    'file',
    'copy',
    'final',
    'aud',
    'wa',
    'mus',
    'download',
    'sound',
  ]);
  // Every word is filler or a number: "track 05", "new recording 3", "AUD 0002".
  return words.every((word) => filler.has(word) || /^\d+$/.test(word));
}

/**
 * The name to show for a file Pulse could not identify.
 *
 * The song is kept exactly as it is — this only decides what it is called. A
 * filename is usually "Artist - Title" wearing a download site's clothes, so
 * the noise comes off, the separator is read, and careless capitals are fixed.
 * When there is no separator the whole thing is the title, and the artist is
 * left unknown rather than invented.
 */
export function displayNameFromFilename(filename: string): {
  artist: string | null;
  title: string;
} {
  const { artist, title } = splitArtistTitle(filename);
  const cleanedTitle = (title ?? cleanFilename(filename)).trim();
  return {
    artist: artist ? titleCase(artist) : null,
    title: cleanedTitle ? titleCase(cleanedTitle) : stripExtension(filename),
  };
}

export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drops the parenthetical suffixes that make two titles look different. */
export function coreTitle(value: string): string {
  return normalise(
    value
      .replace(/\((feat|ft|with)[^)]*\)/gi, ' ')
      .replace(/\[(feat|ft|with)[^\]]*\]/gi, ' ')
      .replace(/\b(feat|ft)\.?\s+.+$/gi, ' '),
  );
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** 0 (nothing in common) to 1 (identical), on normalised text. */
export function similarity(a: string, b: string): number {
  const left = normalise(a);
  const right = normalise(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const distance = levenshtein(left, right);
  const editScore = 1 - distance / Math.max(left.length, right.length);

  // Token overlap catches reordering and extra words that edit distance punishes.
  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  const tokenScore = shared / Math.max(leftTokens.size, rightTokens.size);

  // One of the two being contained in the other is a strong signal on its own.
  const containment = left.includes(right) || right.includes(left) ? 0.9 : 0;

  return Math.max(containment, editScore * 0.55 + tokenScore * 0.45);
}
