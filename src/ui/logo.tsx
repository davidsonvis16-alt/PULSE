import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Txt } from '@/src/ui/text';
import { colors, radii } from '@/src/theme/tokens';

/**
 * The Pulse mark: a lime rounded square carrying the P, optionally followed by
 * the wordmark. This is Pulse's identity — the proportions, the colour and the
 * letterform stay exactly as they are wherever the logo appears.
 */
export function PulseLogo({
  size = 32,
  showWordmark = false,
  tagline,
  style,
}: {
  size?: number;
  showWordmark?: boolean;
  tagline?: boolean;
  style?: ViewStyle;
}) {
  const wordSize = size * 0.86;
  return (
    <View style={[styles.row, style]}>
      <View
        style={[
          styles.mark,
          { width: size, height: size, borderRadius: size * 0.3 },
        ]}
      >
        <Txt
          style={{
            fontSize: size * 0.62,
            lineHeight: size * 0.78,
            fontWeight: '800',
            color: colors.onAccent,
            letterSpacing: -size * 0.03,
          }}
        >
          P
        </Txt>
      </View>
      {showWordmark && (
        <View style={styles.words}>
          <Txt
            style={{
              fontSize: wordSize,
              lineHeight: wordSize * 1.15,
              fontWeight: '800',
              letterSpacing: -wordSize * 0.035,
              color: colors.text,
            }}
          >
            Pulse
          </Txt>
          {tagline && (
            <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
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
  mark: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { justifyContent: 'center' },
});

export const PULSE_LOGO_RADIUS = radii.md;
