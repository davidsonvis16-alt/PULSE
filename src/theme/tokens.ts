/**
 * Pulse design tokens.
 *
 * Every colour here is taken from the Pulse mark: its lime plate, the ink of
 * the P, the cream of the flag, the grey of the wordmark and the white it sits
 * on. Surfaces are neutral so artwork carries all the other colour in the app.
 */

export const palette = {
  /** Canvas — the mark's ink, darkened to let artwork glow. */
  black: '#070708',
  ink: '#0C0C0D',
  surface: '#141416',
  surfaceRaised: '#1A1A1C',
  surfaceHigh: '#212124',
  hairline: '#2A2A2D',
  hairlineSoft: '#1E1E21',

  /** The lime of the Pulse plate. Primary actions and active state only. */
  lime: '#C9F62B',
  limeBright: '#D8FF52',
  limeDim: '#9CC61F',
  limeGlow: 'rgba(201, 246, 43, 0.16)',

  /** The cream of the flag on the mark. */
  cream: '#F6F1DF',

  white: '#FFFFFF',
  text: '#F4F4F3',
  /** The grey of the Pulse wordmark. */
  textSecondary: '#B0B3B0',
  textMuted: '#76797A',
  textFaint: '#4C4F50',

  danger: '#FF6B6B',
  warning: '#FFC24B',
  success: '#8FE04A',
  info: '#63B3ED',

  /** Mood accents — used only as gradient washes behind mood artwork. */
  moodCalm: '#5B7CFA',
  moodChill: '#31C4A8',
  moodEnergetic: '#FF5C8A',
  moodRock: '#F2803C',
} as const;

/** The mark's own colours, for the logo and the launch screen. */
export const brand = {
  plate: palette.lime,
  ink: '#0A0B0A',
  flag: palette.cream,
  wordmark: palette.textSecondary,
  launchBackground: palette.white,
} as const;

export const darkColors = {
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
  /** Text/icon colour to use *on top of* the accent — the mark's ink. */
  onAccent: '#0A0B0A',

  text: palette.text,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,
  textFaint: palette.textFaint,

  danger: palette.danger,
  warning: palette.warning,
  success: palette.success,
  info: palette.info,

  skeleton: '#1A1A1C',
  skeletonHighlight: '#242427',
  scrim: 'rgba(7, 7, 8, 0.72)',
} as const;

/** Widened so both schemes satisfy the same shape. */
export type ThemeColors = { [K in keyof typeof darkColors]: string };

/**
 * Light.
 *
 * The mark sits on white, so light mode is the mark's own background. The one
 * colour that cannot carry over is the lime: at full brightness it is
 * unreadable on white, so text and icons use a deepened lime of the same hue
 * and anything filled with it carries white rather than ink. The plate on the
 * logo itself never changes — see `brand`.
 */
export const lightColors: ThemeColors = {
  background: palette.white,
  backgroundElevated: '#FAFAF8',
  card: '#F3F4F1',
  cardRaised: '#EDEEEA',
  cardHigh: '#E4E6E1',
  border: '#D9DBD5',
  borderSoft: '#E7E9E3',

  accent: '#5F8B0C',
  accentBright: '#74A511',
  accentDim: '#89A85A',
  accentGlow: 'rgba(95, 139, 12, 0.12)',
  onAccent: palette.white,

  text: '#101210',
  textSecondary: '#4E524D',
  textMuted: '#72776F',
  textFaint: '#9BA097',

  danger: '#C62F2F',
  warning: '#9A6A00',
  success: '#3F7D1F',
  info: '#1C6FB8',

  skeleton: '#E9EAE6',
  skeletonHighlight: '#F3F4F0',
  scrim: 'rgba(16, 18, 16, 0.55)',
};

/**
 * The dark set, kept as a plain export for the handful of places that run
 * outside React and cannot read the theme — module constants and the
 * pre-mount launch screen. Everything rendered uses `useTheme()`.
 */
export const colors = darkColors;

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
