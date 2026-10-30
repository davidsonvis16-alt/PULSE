import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Txt } from '@/src/ui/text';
import { brand, radii } from '@/src/theme/tokens';

// `icon.png` stays at full resolution for app-store/native icon generation,
// which reads it at build time rather than loading it into the JS bundle.
// Nothing on screen ever renders the mark above ~70px, so what actually ships
// in the bundle is the much lighter `splash-icon.png` copy — nothing here is
// paying app-store icon weight just to draw a small logo.
const MARK = require('@/assets/images/splash-icon.png');
const MARK_WHITE = require('@/assets/images/splash-icon-white.png');

/**
 * The Pulse mark: the lime plate carrying the P and its flag, optionally
 * followed by the wordmark. It renders the same image file the app icon and the
 * launch screen use, so the identity is one artwork rather than three
 * approximations of it.
 *
 * Two treatments, and only two. `plate` is the full-colour mark, used anywhere
 * it sits on the app's own surfaces. `white` is the same mark drawn as a single
 * white silhouette with no plate behind it — the treatment a brand uses on its
 * launch screen, where the logo should belong to the background rather than sit
 * on a tile of its own. It is the same artwork either way: the white version is
 * cut from the same file, so the two can never drift apart.
 */
export function PulseLogo({
  size = 32,
  showWordmark = false,
  tagline,
  variant = 'plate',
  onLight = false,
  style,
}: {
  size?: number;
  showWordmark?: boolean;
  tagline?: boolean;
  /** 'white' is the single-colour silhouette used on the launch screen. */
  variant?: 'plate' | 'white';
  /** On a light ground the wordmark keeps its grey rather than going white. */
  onLight?: boolean;
  style?: ViewStyle;
}) {
  const white = variant === 'white';
  // The mark is a burst with the letter small inside it, so the two variants
  // do not carry the same visual weight at the same pixel size. The plate sits
  // beside a wordmark of roughly its own height; the burst has to be drawn much
  // larger to read at all, and a wordmark scaled with it would dwarf it.
  const wordSize = size * (white ? 0.3 : 0.86);
  const wordColour = white ? brand.launchInk : brand.wordmark;

  return (
    <View style={[styles.row, style]}>
      <Image
        source={white ? MARK_WHITE : MARK}
        // The white mark is a silhouette with nothing behind it, so it must not
        // be given the plate's corner radius.
        style={{ width: size, height: size, borderRadius: white ? 0 : size * 0.28 }}
        contentFit="contain"
        accessibilityLabel="Pulse"
      />
      {showWordmark && (
        <View style={styles.words}>
          <Txt
            style={{
              fontSize: wordSize,
              lineHeight: wordSize * 1.15,
              fontWeight: '800',
              letterSpacing: -wordSize * 0.035,
              color: wordColour,
            }}
          >
            Pulse
          </Txt>
          {tagline && (
            <Txt
              variant="caption"
              style={{
                marginTop: 2,
                color: white ? brand.launchInkSoft : onLight ? brand.wordmark : undefined,
              }}
              tone={white || onLight ? undefined : 'muted'}
            >
              Own your music
            </Txt>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  words: { justifyContent: 'center' },
});

export const PULSE_LOGO_RADIUS = radii.md;
