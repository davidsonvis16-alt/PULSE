import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii } from '@/src/theme/tokens';

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
            size={size * 0.32}
            color={colors.textFaint}
          />
        </View>
      )}
      {dim && <View style={[StyleSheet.absoluteFill, styles.dim, { borderRadius }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
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
