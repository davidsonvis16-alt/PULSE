import { useMemo } from 'react';
import { brandShadeByName } from '@/src/theme/brand-shade';

/**
 * The header shade for a cover. Native apps cannot read a picture's pixels
 * without extra libraries, so the name picks a Pulse shade instead; the web
 * version (use-artwork-colour.web.ts) reads the real cover.
 */
export function useArtworkColour(_uri: string | null | undefined, name: string): { top: string; deep: string } {
  return useMemo(() => brandShadeByName(name), [name]);
}
