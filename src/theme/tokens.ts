/**
 * Pulse design tokens.
 *
 * Pulse's identity: deep neutral black canvas, soft charcoal surfaces, a single
 * bright lime accent used sparingly for the things you can act on, and artwork
 * carrying the colour. Nothing else competes with the album art.
 */

export const palette = {
  /** Canvas — true near-black so artwork glows. */
  black: '#08090A',
  ink: '#0B0C0E',
  surface: '#121316',
  surfaceRaised: '#17181C',
  surfaceHigh: '#1D1F24',
  hairline: '#24262B',
  hairlineSoft: '#1B1D21',

  /** The Pulse lime. Reserved for primary actions and active state. */
  lime: '#CBF24C',
  limeBright: '#D7FF4F',
  limeDim: '#9DBE33',
  limeGlow: 'rgba(203, 242, 76, 0.16)',

  white: '#FFFFFF',
  text: '#F4F5F6',
  textSecondary: '#A2A7AF',
  textMuted: '#6B7078',
  textFaint: '#4A4E56',

  danger: '#FF6B6B',
  warning: '#FFC24B',
  success: '#5CD98A',
  info: '#63B3ED',

  /** Mood accents — used only as gradient washes behind mood artwork. */
  moodCalm: '#5B7CFA',
  moodChill: '#31C4A8',
  moodEnergetic: '#FF5C8A',
  moodRock: '#F2803C',
} as const;

export const colors = {
  background: palette.black,
  backgroundElevated: palette.ink,
  card: palette.surface,
  cardRaised: palette.surfaceRaised,
  cardHigh: palette.surfaceHigh,
  border: palette.hairline,
  borderSoft: palette.hairlineSoft,

  accent: palette.lime,
  accentBright: palette.limeBright,
  accentDim: palette.limeDim,
  accentGlow: palette.limeGlow,
  /** Text/icon colour to use *on top of* the lime accent. */
  onAccent: palette.black,

  text: palette.text,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,
  textFaint: palette.textFaint,

  danger: palette.danger,
  warning: palette.warning,
  success: palette.success,
  info: palette.info,

  skeleton: '#191B1F',
  skeletonHighlight: '#23262B',
  scrim: 'rgba(8, 9, 10, 0.72)',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.8 },
  title1: { fontSize: 27, lineHeight: 33, fontWeight: '800' as const, letterSpacing: -0.6 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  title3: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '500' as const, letterSpacing: -0.1 },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '700' as const, letterSpacing: -0.1 },
  callout: { fontSize: 14, lineHeight: 19, fontWeight: '600' as const },
  caption: { fontSize: 12.5, lineHeight: 17, fontWeight: '500' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.6 },
} as const;

/** Breakpoints: phone -> tablet -> laptop -> desktop. Layouts change, not stretch. */
export const breakpoints = {
  phone: 0,
  phoneLarge: 430,
  tablet: 700,
  laptop: 1024,
  desktop: 1400,
} as const;

export type Breakpoint = keyof typeof breakpoints;

export const layout = {
  /** Max readable content width on very wide screens. */
  maxContentWidth: 1240,
  miniPlayerHeight: 64,
  tabBarHeight: 62,
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  lift: {
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  accent: {
    shadowColor: palette.lime,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
} as const;
