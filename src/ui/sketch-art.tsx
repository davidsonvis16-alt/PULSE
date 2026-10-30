import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Blur, Canvas, ColorMatrix, Image as SkiaImage, useImage } from '@shopify/react-native-skia';
import { Artwork } from '@/src/ui/artwork';

/**
 * Artwork drawn as a pencil sketch, in the artist's own colours.
 *
 * The cover's colours are kept and softened, as if painted, and pencil lines
 * traced from the picture are laid over them: the classic "colour dodge"
 * sketch, where a picture blended with a blurred negative of itself leaves only
 * its edges. Nothing is recoloured — the blur and the lines are the whole
 * effect. The web version (sketch-art.web.tsx) does the same with the
 * browser's own image filters.
 *
 * It fills its parent, so the parent decides the size and the corner radius.
 */
export function SketchArt({ uri, style }: { uri: string | null | undefined; style?: ViewStyle }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const image = useImage(uri ?? undefined);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (!size || size.width !== width || size.height !== height) setSize({ width, height });
  };

  return (
    <View style={[StyleSheet.absoluteFill, style]} onLayout={onLayout}>
      {/* The plain cover shows until the sketch is ready, so nothing pops in empty. */}
      {!image && size && size.width > 0 && (
        <Artwork uri={uri} size={Math.max(size.width, size.height)} radius={0} />
      )}
      {image && size && (
        <Canvas style={StyleSheet.absoluteFill}>
          {/* 1. The picture in grey. */}
          <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit="cover">
            <ColorMatrix matrix={GREY} />
          </SkiaImage>
          {/* 2. Dodged by its own blurred negative: flat areas go white, edges stay as pencil lines. */}
          <SkiaImage
            image={image}
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fit="cover"
            blendMode="colorDodge"
          >
            <ColorMatrix matrix={GREY_NEGATIVE} />
            <Blur blur={7} mode="clamp" />
          </SkiaImage>
          {/* 3. The real colours, softened, multiplied over the lines. */}
          <SkiaImage
            image={image}
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fit="cover"
            blendMode="multiply"
          >
            <Blur blur={1.6} mode="clamp" />
          </SkiaImage>
        </Canvas>
      )}
    </View>
  );
}

const R = 0.299;
const G = 0.587;
const B = 0.114;

const GREY = [R, G, B, 0, 0, R, G, B, 0, 0, R, G, B, 0, 0, 0, 0, 0, 1, 0];
const GREY_NEGATIVE = [-R, -G, -B, 0, 1, -R, -G, -B, 0, 1, -R, -G, -B, 0, 1, 0, 0, 0, 1, 0];
