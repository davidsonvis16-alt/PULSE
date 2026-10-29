import { useId } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

/**
 * Artwork drawn as a pencil sketch, in the artist's own colours — the web
 * version of sketch-art.tsx, built from the browser's SVG filters instead of
 * Skia, so the web app does not download a drawing engine for it.
 *
 * The same recipe: the colours softened, and pencil lines from a grey copy
 * colour-dodged by its blurred negative, multiplied over them.
 */
export function SketchArt({ uri, style }: { uri: string | null | undefined; style?: ViewStyle }) {
  const id = `sketch-${useId().replace(/:/g, '')}`;
  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id={id} colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="paint" />
          <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="grey" />
          <feComponentTransfer in="grey" result="negative">
            <feFuncR type="table" tableValues="1 0" />
            <feFuncG type="table" tableValues="1 0" />
            <feFuncB type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feGaussianBlur in="negative" stdDeviation="7" result="soft" />
          <feBlend in="grey" in2="soft" mode="color-dodge" result="lines" />
          <feComponentTransfer in="lines" result="pencil">
            <feFuncR type="gamma" exponent="2" />
            <feFuncG type="gamma" exponent="2" />
            <feFuncB type="gamma" exponent="2" />
          </feComponentTransfer>
          <feBlend in="paint" in2="pencil" mode="multiply" />
        </filter>
      </svg>
      {uri ? (
        <img
          src={uri}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: `url(#${id})`,
          }}
        />
      ) : null}
    </View>
  );
}
