import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { radii } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Album art.
 *
 * Requests the image at the size it will actually be drawn (providers serve
 * per-size URLs), caches to disk, and fades in so shelves do not flash. When a
 * source genuinely has no artwork we show a neutral music mark rather than a
 * fabricated cover.
 */
export function Artwork({
  uri,
  size,
  radius = radii.md,
  style,
  rounded,
  dim,
}: {
  uri: string | null | undefined;
  size: number;
  radius?: number;
  style?: ViewStyle;
  /** Circular, for artist portraits. */
  rounded?: boolean;
  dim?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const borderRadius = rounded ? size / 2 : radius;
  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius },
        style,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          contentFit="cover"
          transition={220}
          cachePolicy="disk"
          recyclingKey={uri}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback, { borderRadius }]}>
          <Ionicons
            name={rounded ? 'person' : 'musical-notes'}
            // Android refuses a zero font size outright, so never ask for one.
            size={Math.max(8, size * 0.32)}
            color={colors.textFaint}
          />
        </View>
      )}
      {dim && <View style={[StyleSheet.absoluteFill, styles.dim, { borderRadius }]} />}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    frame: {
      backgroundColor: colors.cardRaised,
      overflow: 'hidden',
    },
    fallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardHigh,
    },
    dim: { backgroundColor: 'rgba(0,0,0,0.35)' },
  });
