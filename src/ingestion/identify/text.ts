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
  /\b(hq|hd|4k|full\s*album|free\s*download)\b/gi,
  /\b\d{2,3}\s*kbps\b/gi,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}\b/gi,
  /\b[a-z0-9-]+\.(com|net|org|to|cc|me)\b/gi,
  /[\(\[][^)\]]*\b(mp3|download|audio)\b[^)\]]*[\)\]]/gi,
];

export function stripExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]{2,5}$/i, '');
}

/** Turns a filename into something worth searching for. */
export function cleanFilename(filename: string): string {
  let value = stripExtension(filename);
  value = value.replace(/[_]+/g, ' ');
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
