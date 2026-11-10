import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from '@/src/ui/text';
import { fonts, palette, radii, spacing } from '@/src/theme/tokens';

/**
 * A big artist poster, in the style of a street ad: the photo large on Pulse's
 * green, the name set huge in a tall condensed face, one short line written by
 * hand beside it, and a thin strip of facts along the bottom.
 */
export function ArtistPoster({
  name,
  imageUrl,
  scribble,
  strip,
  width,
  height,
  onPress,
}: {
  name: string;
  imageUrl: string | null;
  /** The one handwritten line, e.g. "#1 in Kenya right now". */
  scribble: string;
  /** Facts along the bottom, e.g. "Pop · 4 songs in the chart". */
  strip: string;
  width: number;
  height: number;
  onPress: () => void;
}) {
  // Long names step down so they still sit on two lines at most.
  const size = name.length > 14 ? width * 0.15 : name.length > 9 ? width * 0.19 : width * 0.24;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${scribble}`}
      onPress={onPress}
      style={({ pressed }) => [styles.frame, { width, height }, pressed && { opacity: 0.9 }]}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          contentFit="cover"
          style={[styles.photo, { height: height * 0.62 }]}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {/* The photo melts into the green, so the name sits on colour, not on a face. */}
      <LinearGradient
        colors={[palette.green, 'rgba(62,122,0,0.85)', 'rgba(62,122,0,0)']}
        locations={[0, 0.38, 0.62]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.top}>
        <Txt style={styles.kicker}>PULSE</Txt>
        <Txt
          numberOfLines={2}
          adjustsFontSizeToFit
          style={[styles.name, { fontSize: size, lineHeight: size * 1.02 }]}
        >
          {name.toUpperCase()}.
        </Txt>
        <Txt numberOfLines={2} style={styles.scribble}>
          {scribble}
        </Txt>
      </View>

      <View style={styles.strip}>
        <Txt numberOfLines={1} style={styles.stripText}>
          {strip.toUpperCase()}
        </Txt>
        <Txt style={styles.stripText}>PULSE</Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.sm, overflow: 'hidden', backgroundColor: palette.green },
  photo: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  top: { padding: spacing.lg, gap: spacing.xs },
  kicker: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,0.8)' },
  name: { fontFamily: fonts.poster, color: '#FFFFFF', letterSpacing: -0.5 },
  scribble: {
    fontFamily: fonts.marker,
    fontSize: 15,
    lineHeight: 19,
    color: palette.limeBright,
    transform: [{ rotate: '-3deg' }],
    alignSelf: 'flex-end',
    textAlign: 'right',
    maxWidth: '75%',
  },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: '#0A0B0A',
  },
  stripText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2, color: '#FFFFFF', flexShrink: 1 },
});
