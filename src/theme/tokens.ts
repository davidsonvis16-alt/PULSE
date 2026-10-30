/**
 * Pulse design tokens.
 *
 * The mark's own colours: its lime plate, the ink of the P and the white it
 * sits on. Light is the default. In the dark the lime would glow like neon, so
 * dark mode takes a deeper, calmer green. Surfaces stay neutral so artwork
 * carries every other colour in the app.
 */

export const palette = {
  /** Canvas — the mark's ink, darkened to let artwork glow. */
  black: '#0B0C0B',
  ink: '#111211',
  surface: '#181A18',
  surfaceRaised: '#1E201E',
  surfaceHigh: '#252825',
  hairline: '#323632',
  hairlineSoft: '#262926',

  /** The lime of the Pulse plate: the accent on white. */
  lime: '#C9F62B',
  limeBright: '#D8FF52',
  limeDim: '#9CC61F',

  /** The accent in the dark, where full lime glares. */
  green: '#25D366',
  greenBright: '#3EE07B',
  greenDim: '#1DA851',

  /** The cream of the flag on the mark. */
  cream: '#F6F1DF',

  /** Labels on artwork ("New single", "Made for you"): warm, earthy, not a UI default. */
  terracotta: '#C2603D',

  white: '#FFFFFF',
  text: '#F4F5F3',
  textSecondary: '#B7BAB6',
  textMuted: '#959994',
  /** Still readable: 4.6:1 on the canvas, so small print never disappears. */
  textFaint: '#7B7F7A',

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

  /** Fills: buttons, switches, progress, the active tab. */
  accent: palette.green,
  accentBright: palette.greenBright,
  accentDim: palette.greenDim,
  accentGlow: 'rgba(37, 211, 102, 0.14)',
  /** The accent as text or an icon on the background — readable in both schemes. */
  accentInk: palette.green,
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

  skeleton: '#1A1C1A',
  skeletonHighlight: '#242724',
  scrim: 'rgba(11, 12, 11, 0.72)',
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
  background: palette.white,
  backgroundElevated: '#FAFAF8',
  card: '#F3F4F0',
  cardRaised: '#ECEDE8',
  cardHigh: '#E3E5DF',
  border: '#D3D6CF',
  borderSoft: '#E2E4DE',

  accent: palette.lime,
  accentBright: palette.limeBright,
  accentDim: palette.limeDim,
  accentGlow: 'rgba(201, 246, 43, 0.22)',
  accentInk: '#3E7A00',
  onAccent: '#0A0B0A',

  text: '#0C0D0C',
  textSecondary: '#4E524D',
  textMuted: '#696E68',
  textFaint: '#8A8F88',

  danger: '#C62F2F',
  warning: '#9A6A00',
  success: '#3F7D1F',
  info: '#1C6FB8',

  skeleton: '#ECEDE9',
  skeletonHighlight: '#F5F6F2',
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
 * One plain typeface, Inter, for everything: headings are set a little bolder
 * and larger rather than in a second display face, so screens read light and
 * clean. Native platforms pick a weight by family name rather than by
 * fontWeight, so each style names the exact cut it uses.
 */
export const fonts = {
  display: 'Inter_700Bold',
  heading: 'Inter_600SemiBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  /** Thick marker handwriting, for the opening screen only. */
  marker: 'PermanentMarker_400Regular',
} as const;

export const typography = {
  hero: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, fontWeight: '700' as const, letterSpacing: -0.8 },
  display: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  title1: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, fontWeight: '700' as const, letterSpacing: -0.3 },
  title2: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 24, fontWeight: '600' as const, letterSpacing: -0.2 },
  title3: { fontFamily: fonts.heading, fontSize: 16, lineHeight: 21, fontWeight: '600' as const, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, fontWeight: '500' as const },
  callout: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, fontWeight: '500' as const },
  caption: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, fontWeight: '400' as const },
  micro: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.6 },
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
  /** A plain soft shadow: accent-coloured glows read as neon. */
  accent: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;
