import { useEffect, useMemo, useState } from 'react';
import { brandShadeByName, brandShadeFor, type RGB } from '@/src/theme/brand-shade';

const cache = new Map<string, RGB | null>();

/**
 * The cover's main colour, read from a tiny copy of the picture: the most
 * saturated colours count the most, so a dark photo with a red jacket gives
 * red, not grey. Covers that refuse cross-origin reads give null.
 */
function readColour(uri: string): Promise<RGB | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          // Saturation plus a little for everything, so a plain cover still counts.
          const w = (max - min) / 255 + 0.08;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          weight += w;
        }
        resolve(weight ? { r: r / weight, g: g / weight, b: b / weight } : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = uri;
  });
}

export function useArtworkColour(uri: string | null | undefined, name: string): { top: string; deep: string } {
  const [colour, setColour] = useState<RGB | null>(() => (uri ? (cache.get(uri) ?? null) : null));

  useEffect(() => {
    if (!uri) return;
    if (cache.has(uri)) {
      setColour(cache.get(uri) ?? null);
      return;
    }
    let cancelled = false;
    void readColour(uri).then((found) => {
      cache.set(uri, found);
      if (!cancelled) setColour(found);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return useMemo(() => (colour ? brandShadeFor(colour) : brandShadeByName(name)), [colour, name]);
}
