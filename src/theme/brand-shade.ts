/**
 * Colour for the big header blocks on album and artist pages.
 *
 * Every page gets its own shade, but the shades all belong to Pulse: each one
 * is a blend of the cover's own colour and the nearest of the logo's paints,
 * then set dark enough to carry white writing. When the cover's colour is not
 * known (native apps cannot read pixels), the title picks a paint pair instead,
 * so the same album always gets the same shade.
 */

/** The paints of the logo: lime, royal blue, sky blue, deep green, ink. */
export const PAINTS = ['#B5E61D', '#2342D6', '#1FB3E8', '#3E7A00', '#0A0B0A'] as const;

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function mix(a: RGB, b: RGB, amount: number): RGB {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

/** Perceived brightness, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hue({ r, g, b }: RGB): number | null {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 24) return null; // grey: no hue to speak of
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  return ((h * 60) + 360) % 360;
}

/** The paint closest in hue to a colour; ink for greys. */
function nearestPaint(colour: RGB): RGB {
  const h = hue(colour);
  if (h === null) return hexToRgb(PAINTS[4]);
  const candidates = PAINTS.slice(0, 4).map((p) => {
    const ph = hue(hexToRgb(p)) ?? 0;
    const d = Math.min(Math.abs(ph - h), 360 - Math.abs(ph - h));
    return { p, d };
  });
  return hexToRgb(candidates.sort((a, b) => a.d - b.d)[0].p);
}

/** Set a colour's brightness to roughly the given level, keeping its hue. */
export function toBrightness(colour: RGB, target: number): RGB {
  const l = luminance(colour);
  if (l < 0.01) return mix(colour, { r: 255, g: 255, b: 255 }, target);
  if (l > target) return mix(colour, { r: 0, g: 0, b: 0 }, 1 - target / l);
  return mix(colour, { r: 255, g: 255, b: 255 }, (target - l) / (1 - l) * 0.6);
}

/**
 * The header shade for a cover whose main colour is known: the cover's colour
 * pulled towards the nearest logo paint, dark enough for white text.
 */
export function brandShadeFor(artColour: RGB): { top: string; deep: string } {
  const paint = nearestPaint(artColour);
  const blended = mix(artColour, paint, 0.45);
  const top = toBrightness(blended, 0.34);
  const deep = toBrightness(blended, 0.16);
  return { top: rgbToHex(top), deep: rgbToHex(deep) };
}

/** A fixed shade for a name, when the cover's colour cannot be read. */
export function brandShadeByName(name: string): { top: string; deep: string } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = hexToRgb(PAINTS[h % 4]);
  const b = hexToRgb(PAINTS[(h >> 3) % 4]);
  const blended = mix(a, b, 0.35 + ((h >> 6) % 30) / 100);
  return { top: rgbToHex(toBrightness(blended, 0.34)), deep: rgbToHex(toBrightness(blended, 0.16)) };
}
