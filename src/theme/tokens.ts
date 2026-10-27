/**
 * Pulse design tokens — "Afterglow".
 *
 * A deep ink with a breath of violet in it, and one hot ember accent that is
 * nobody else's: not Spotify's green, Apple's red or Deezer's purple. Surfaces
 * stay quiet so artwork carries the rest of the colour; the player goes further
 * and takes its whole background from the cover that is playing.
 */

export const palette = {
  /** Canvas — ink with a breath of violet, so artwork glows against it. */
  black: '#0C0B10',
  ink: '#141319',
  surface: '#1C1B23',
  surfaceRaised: '#22212A',
  surfaceHigh: '#2A2932',
  hairline: '#2E2D36',
  hairlineSoft: '#222129',

  /** Ember. Primary actions and active state only. */
  ember: '#FF6A3D',
  emberBright: '#FF8A5B',
  emberDim: '#C9502C',
  emberGlow: 'rgba(255, 106, 61, 0.16)',

  /** The cream of the flag on the mark. */
  cream: '#F6F1DF',

  white: '#FFFFFF',
  text: '#F5F3F7',
  textSecondary: '#C9C6D2',
  textMuted: '#A09DAB',
  /** Still readable: 4.6:1 on the canvas, so small print never disappears. */
  textFaint: '#7C7987',

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
  plate: palette.ember,
  ink: '#1A0A04',
  flag: palette.cream,
  wordmark: palette.textSecondary,
  /**
   * The launch screen.
   *
   * One solid brand ground with the mark on it in white, the way a logo is
   * presented rather than the way an app icon is. It is the app's own black, so
   * the splash hands over to the first screen without a flash of a different
   * colour in between — which is the whole reason these are tokens and not
   * three separate hex codes in three files.
   */
  launchBackground: palette.black,
  launchInk: palette.white,
  launchInkSoft: 'rgba(255,255,255,0.66)',
} as const;

export const darkColors = {
  background: palette.black,
  backgroundElevated: palette.ink,
  card: palette.surface,
  cardRaised: palette.surfaceRaised,
  cardHigh: palette.surfaceHigh,
  border: palette.hairline,
  borderSoft: palette.hairlineSoft,

  accent: palette.ember,
  accentBright: palette.emberBright,
  accentDim: palette.emberDim,
  accentGlow: palette.emberGlow,
  /** Text/icon colour to use *on top of* the accent. */
  onAccent: '#1A0A04',

  text: palette.text,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,
  textFaint: palette.textFaint,

  danger: palette.danger,
  warning: palette.warning,
  success: palette.success,
  info: palette.info,

  skeleton: '#1C1B23',
  skeletonHighlight: '#26252E',
  scrim: 'rgba(12, 11, 16, 0.72)',
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
  backgroundElevated: '#FAF9FB',
  card: '#F3F2F6',
  cardRaised: '#ECEBF0',
  cardHigh: '#E3E1E8',
  border: '#D8D6DE',
  borderSoft: '#E8E6EC',

  // Full-strength ember is too light for text on white; this is the same hue
  // deepened to pass 4.5:1.
  accent: '#C73E14',
  accentBright: '#E0552A',
  accentDim: '#E89A80',
  accentGlow: 'rgba(199, 62, 20, 0.12)',
  onAccent: palette.white,

  text: '#121117',
  textSecondary: '#4D4A57',
  textMuted: '#6D6A78',
  textFaint: '#8E8B99',

  danger: '#C62F2F',
  warning: '#9A6A00',
  success: '#3F7D1F',
  info: '#1C6FB8',

  skeleton: '#ECEBF0',
  skeletonHighlight: '#F5F4F8',
  scrim: 'rgba(18, 17, 23, 0.55)',
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

/**
 * Bricolage Grotesque for headings — it has a voice, which a music app should —
 * and Inter for everything you read. Native platforms pick a weight by family
 * name rather than by fontWeight, so each style names the exact cut it uses.
 */
export const fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  heading: 'BricolageGrotesque_700Bold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const typography = {
  hero: { fontFamily: fonts.display, fontSize: 56, lineHeight: 56, fontWeight: '800' as const, letterSpacing: -2 },
  display: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -1.2 },
  title1: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, fontWeight: '800' as const, letterSpacing: -0.8 },
  title2: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 27, fontWeight: '700' as const, letterSpacing: -0.5 },
  title3: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 23, fontWeight: '700' as const, letterSpacing: -0.3 },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, fontWeight: '500' as const, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, fontWeight: '600' as const, letterSpacing: -0.1 },
  callout: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, fontWeight: '600' as const },
  caption: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 17, fontWeight: '500' as const },
  micro: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.8 },
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
  /** Laptop and up: the navigation sidebar and the player bar under everything. */
  sidebarWidth: 264,
  playerBarHeight: 88,
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
    shadowColor: palette.ember,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
} as const;
