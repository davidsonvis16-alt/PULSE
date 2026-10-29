import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import {
  Blur,
  Canvas,
  ColorMatrix,
  Group,
  Image as SkiaImage,
  Paint,
  useImage,
} from '@shopify/react-native-skia';
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
      {!image && <Artwork uri={uri} size={Math.max(size?.width ?? 0, size?.height ?? 0)} radius={0} />}
      {image && size && (
        <Canvas style={StyleSheet.absoluteFill}>
          {/* The colours, softened. */}
          <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit="cover">
            <Blur blur={1.6} />
          </SkiaImage>
          {/* The pencil: grey, dodged by its own blurred negative, multiplied over the colour. */}
          <Group layer={<Paint blendMode="multiply" />}>
            <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit="cover">
              <ColorMatrix matrix={GREY} />
            </SkiaImage>
            <Group layer={<Paint blendMode="colorDodge" />}>
              <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit="cover">
                <ColorMatrix matrix={GREY_NEGATIVE} />
                <Blur blur={7} />
              </SkiaImage>
            </Group>
          </Group>
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
