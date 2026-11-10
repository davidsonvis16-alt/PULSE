import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Txt } from '@/src/ui/text';
import { PulseLogo } from '@/src/ui/logo';
import { fonts, radii, spacing } from '@/src/theme/tokens';

/** The paint colours of the Pulse logo: lime, royal blue, sky blue, ink. */
const PAINT = ['#B5E61D', '#2342D6', '#1FB3E8', '#0A0B0A', '#3E7A00'];

/** Height of the strip of facts along the bottom. */
const STRIP = 34;
/** Thickness of the triangle border. */
const BAND = 18;

/**
 * A band of triangles that fit into one another, point up then point down,
 * so together they make a straight-edged strip — a mosaic frame.
 */
function TriangleBand({
  length,
  vertical,
  offset,
}: {
  length: number;
  vertical?: boolean;
  /** Where in the paint colours this band starts, so every card differs. */
  offset: number;
}) {
  const count = Math.max(2, Math.round(length / BAND));
  const step = length / count;
  // Each triangle is placed exactly: they alternate point-in, point-out and
  // overlap by half, so together they fill the edge with no gaps.
  return (
    <View style={{ width: vertical ? BAND : length, height: vertical ? length : BAND, overflow: 'hidden' }}>
      {Array.from({ length: count * 2 + 1 }, (_, i) => {
        const colour = PAINT[(i + offset) % PAINT.length];
        const flip = i % 2 === 1;
        const at = i * (step / 2) - step / 2;
        return vertical ? (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: at,
              width: 0,
              height: 0,
              borderTopWidth: step / 2,
              borderBottomWidth: step / 2,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              ...(flip
                ? { borderRightWidth: BAND, borderRightColor: colour }
                : { borderLeftWidth: BAND, borderLeftColor: colour }),
            }}
          />
        ) : (
          <View
            key={i}
            style={{
              position: 'absolute',
              top: 0,
              left: at,
              width: 0,
              height: 0,
              borderLeftWidth: step / 2,
              borderRightWidth: step / 2,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              ...(flip
                ? { borderTopWidth: BAND, borderTopColor: colour }
                : { borderBottomWidth: BAND, borderBottomColor: colour }),
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * A big artist poster, bright like the Pulse logo: a white page framed by a
 * mosaic of triangles in the logo's paint colours, the photo set in, the name
 * running up the side in tall condensed capitals, one short line and a
 * thin strip of facts. Every card starts the colours somewhere else.
 */
export function ArtistPoster({
  name,
  imageUrl,
  scribble,
  strip,
  width,
  height,
  variant = 0,
  onPress,
}: {
  name: string;
  imageUrl: string | null;
  /** The one short line, e.g. "#1 in Kenya right now". */
  scribble: string;
  /** Facts along the bottom, e.g. "Pop · 4 songs in the chart". */
  strip: string;
  width: number;
  height: number;
  /** Which way round the colours go on this card. */
  variant?: number;
  onPress: () => void;
}) {
  const offset = ((variant * 2) % PAINT.length + PAINT.length) % PAINT.length;
  const accent = PAINT[(offset + 1) % PAINT.length] === '#0A0B0A' ? PAINT[1] : PAINT[(offset + 1) % PAINT.length];
  const body = height - STRIP;
  const inner = { left: BAND, top: BAND, right: BAND, bottom: STRIP + BAND };
  const innerHeight = body - BAND * 2;
  // The band the name runs up: wide for short names, narrower for long ones.
  const side = Math.min((width - BAND * 2) * 0.3, (innerHeight / Math.max(4, name.length + 1)) * 1.9);
  const photoTop = innerHeight * 0.32;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${scribble}`}
      onPress={onPress}
      style={({ pressed }) => [styles.frame, { width, height }, pressed && { opacity: 0.9 }]}
    >
      {/* The mosaic frame: four bands of triangles meeting at the corners. */}
      <View style={[styles.edge, { top: 0, left: 0 }]}>
        <TriangleBand length={width} offset={offset} />
      </View>
      <View style={[styles.edge, { top: body - BAND, left: 0 }]}>
        <TriangleBand length={width} offset={offset + 2} />
      </View>
      <View style={[styles.edge, { top: 0, left: 0 }]}>
        <TriangleBand length={body} vertical offset={offset + 1} />
      </View>
      <View style={[styles.edge, { top: 0, right: 0 }]}>
        <TriangleBand length={body} vertical offset={offset + 3} />
      </View>

      <View style={[styles.inner, inner]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            contentFit="cover"
            style={[styles.photo, { left: side, top: photoTop, right: 0, bottom: 0 }]}
            accessibilityIgnoresInvertColors
          />
        ) : null}

        <View style={[styles.top, { paddingLeft: side + spacing.xs, height: photoTop }]}>
          <Txt numberOfLines={2} style={[styles.scribble, { color: accent }]}>
            {scribble}
          </Txt>
        </View>

        {/* The name runs up the side, like a street ad. */}
        <View
          pointerEvents="none"
          style={[
            styles.side,
            {
              width: innerHeight,
              height: side,
              transform: [
                { translateX: -innerHeight / 2 + side / 2 },
                { translateY: innerHeight / 2 - side / 2 },
                { rotate: '-90deg' },
              ],
            },
          ]}
        >
          <Txt numberOfLines={1} adjustsFontSizeToFit style={[styles.name, { fontSize: side * 0.86, lineHeight: side }]}>
            {name.toUpperCase()}.
          </Txt>
        </View>
      </View>

      <View style={styles.strip}>
        <Txt numberOfLines={1} style={styles.stripText}>
          {strip.toUpperCase()}
        </Txt>
        <PulseLogo size={20} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.sm, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  edge: { position: 'absolute' },
  inner: { position: 'absolute', overflow: 'hidden' },
  photo: { position: 'absolute' },
  top: { justifyContent: 'center', alignItems: 'flex-end', gap: spacing.sm, paddingRight: spacing.sm },
  scribble: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 19,
    textAlign: 'right',
  },
  side: { position: 'absolute', left: 0, top: 0, justifyContent: 'center', paddingHorizontal: spacing.sm },
  name: { fontFamily: fonts.poster, color: '#0A0B0A', letterSpacing: -0.5 },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: STRIP,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: '#0A0B0A',
  },
  stripText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2, color: '#FFFFFF', flexShrink: 1 },
});
