/**
 * Pulse design tokens.
 *
 * The mark's own colours: its lime plate, the ink of the P and the white it
 * sits on. Light is the default: white, with deep green and a little black.
 * Dark is the mirror: calm matte black, with white and a little lime. Surfaces
 * stay neutral so artwork carries every other colour in the app.
 */

export const palette = {
  /** Canvas — the mark's ink, darkened to let artwork glow. */
  // Matte black: neutral, no blue or green in it, and only a few steps lighter
  // for the boxes on top, so dark mode is calm rather than shiny.
  black: '#0A0A0A',
  ink: '#0E0E0E',
  surface: '#141414',
  surfaceRaised: '#191919',
  surfaceHigh: '#202020',
  hairline: '#262626',
  hairlineSoft: '#1B1B1B',

  /** The lime of the Pulse plate: the accent on white. */
  lime: '#C9F62B',
  limeBright: '#D8FF52',
  limeDim: '#9CC61F',

  /** The accent, light and dark: the deep green of the navigation bar. */
  green: '#3E7A00',
  greenBright: '#4C9200',
  greenDim: '#2F5C00',

  /** The cream of the flag on the mark. */
  cream: '#F6F1DF',

  /** Labels on artwork ("New single", "Made for you"): warm, earthy, not a UI default. */
  terracotta: '#C2603D',

  white: '#FFFFFF',
  text: '#F2F2F2',
  textSecondary: '#B5B5B5',
  textMuted: '#8F8F8F',
  /** Still readable: 4.6:1 on the canvas, so small print never disappears. */
  textFaint: '#767676',

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
  /**
   * The launch screen.
   *
   * One solid brand ground with the mark on it in white, the way a logo is
   * presented rather than the way an app icon is. It is the app's own black, so
   * the splash hands over to the first screen without a flash of a different
   * colour in between — which is the whole reason these are tokens and not
   * three separate hex codes in three files.
   */
  launchBackground: palette.white,
  launchInk: '#0A0B0A',
  launchInkSoft: 'rgba(10,11,10,0.66)',
} as const;

export const darkColors = {
  background: palette.black,
  backgroundElevated: palette.ink,
  card: palette.surface,
  cardRaised: palette.surfaceRaised,
  cardHigh: palette.surfaceHigh,
  border: palette.hairline,
  borderSoft: palette.hairlineSoft,

  /**
   * In the dark the accent is the lime of the mark, used sparingly — a play
   * button, a switch, the active tab — the way black is only a detail in light
   * mode. No glow anywhere.
   */
  accent: '#B8E62E',
  accentBright: '#C9F62B',
  accentDim: '#8FB61F',
  accentGlow: 'rgba(184, 230, 46, 0.08)',
  /** The accent as text or an icon on the background. */
  accentInk: '#B8E62E',
  /** Text/icon colour to use *on top of* the accent. */
  onAccent: '#0A0A0A',

  text: palette.text,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,
  textFaint: palette.textFaint,

  danger: palette.danger,
  warning: palette.warning,
  success: palette.success,
  info: palette.info,

  skeleton: '#161616',
  skeletonHighlight: '#1E1E1E',
  scrim: 'rgba(10, 10, 10, 0.75)',
} as const;

/** Widened so both schemes satisfy the same shape. */
export type ThemeColors = { [K in keyof typeof darkColors]: string };

/**
 * Light — the default.
 *
 * The mark sits on white, so light mode is the mark's own background, with
 * the lime plate's colour on everything filled: buttons, switches, the active
 * tab, always carrying ink. Lime is too light to read as text on white, so
 * text and icons in the accent use a deep green of the same family instead.
 */
export const lightColors: ThemeColors = {
  // Cloud white: the page is pure white and the boxes on it barely lighter
  // than paper, with no grey or green in them, so the whole screen reads bright.
  background: palette.white,
  backgroundElevated: palette.white,
  card: '#F7F8F8',
  cardRaised: '#F0F2F2',
  cardHigh: '#E8EBEB',
  border: '#E1E5E5',
  borderSoft: '#EDF0F0',

  accent: palette.green,
  accentBright: palette.greenBright,
  accentDim: palette.greenDim,
  accentGlow: 'rgba(62, 122, 0, 0.12)',
  accentInk: palette.green,
  onAccent: '#FFFFFF',

  text: '#070807',
  textSecondary: '#2E312D',
  textMuted: '#4A4E49',
  textFaint: '#6B6F6A',

  danger: '#C62F2F',
  warning: '#9A6A00',
  success: '#3F7D1F',
  info: '#1C6FB8',

  skeleton: '#EEF1F1',
  skeletonHighlight: '#F8FAFA',
  scrim: 'rgba(12, 13, 12, 0.55)',
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

/** Square on purpose: cards, covers and buttons keep only a hint of a corner. */
export const radii = {
  xs: 1,
  sm: 2,
  md: 2,
  lg: 3,
  xl: 3,
  xxl: 4,
  pill: 999,
} as const;

/**
 * One typeface, Figtree — round and friendly, in the spirit of Spotify's — set
 * a step heavier than plain text usually is, so everything reads with a little
 * weight without shouting. Native platforms pick a weight by family name rather
 * than by fontWeight, so each style names the exact cut it uses.
 */
export const fonts = {
  display: 'Figtree_800ExtraBold',
  heading: 'Figtree_700Bold',
  regular: 'Figtree_500Medium',
  medium: 'Figtree_600SemiBold',
  semibold: 'Figtree_700Bold',
  bold: 'Figtree_800ExtraBold',
  /** Thick marker handwriting: the opening screen and one line on posters. */
  marker: 'PermanentMarker_400Regular',
  /** Tall condensed capitals for the big artist posters. */
  poster: 'Anton_400Regular',
} as const;

export const typography = {
  hero: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.8 },
  display: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  title1: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, fontWeight: '800' as const, letterSpacing: -0.4 },
  title2: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 24, fontWeight: '700' as const, letterSpacing: -0.2 },
  title3: { fontFamily: fonts.heading, fontSize: 16, lineHeight: 21, fontWeight: '700' as const, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, fontWeight: '500' as const },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  callout: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, fontWeight: '600' as const },
  caption: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, fontWeight: '500' as const },
  micro: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.6 },
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
  /** The queue panel on the right of a laptop window. */
  queuePanelWidth: 320,
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
  /** A plain soft shadow: accent-coloured glows read as neon. */
  accent: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;
