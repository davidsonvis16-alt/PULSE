import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Txt } from '@/src/ui/text';
import { brand, radii } from '@/src/theme/tokens';

const MARK = require('@/assets/images/icon.png');

/**
 * The Pulse mark: the lime plate carrying the P and its flag, optionally
 * followed by the wordmark. It renders the same image file the app icon and the
 * launch screen use, so the identity is one artwork rather than three
 * approximations of it.
 */
export function PulseLogo({
  size = 32,
  showWordmark = false,
  tagline,
  onLight = false,
  style,
}: {
  size?: number;
  showWordmark?: boolean;
  tagline?: boolean;
  /** On the white launch screen the wordmark keeps its grey. */
  onLight?: boolean;
  style?: ViewStyle;
}) {
  const wordSize = size * 0.86;
  return (
    <View style={[styles.row, style]}>
      <Image
        source={MARK}
        style={{ width: size, height: size, borderRadius: size * 0.28 }}
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
              color: brand.wordmark,
            }}
          >
            Pulse
          </Txt>
          {tagline && (
            <Txt
              variant="caption"
              style={{ marginTop: 2, color: onLight ? brand.wordmark : undefined }}
              tone={onLight ? undefined : 'muted'}
            >
              Your music. Your way.
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
