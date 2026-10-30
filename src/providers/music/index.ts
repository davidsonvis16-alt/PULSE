import { itunesProvider, ITUNES_PROVIDER_ID } from '@/src/providers/music/adapters/itunes';
import { localProvider } from '@/src/providers/music/adapters/local';
import { deezerProvider } from '@/src/providers/music/adapters/deezer';
import { audiusProvider } from '@/src/providers/music/adapters/audius';
import type { MusicProvider } from '@/src/providers/music/types';
import { freestyleProvider } from '@/src/radio/freestyle-provider';

export * from '@/src/providers/music/types';
export { ITUNES_PROVIDER_ID };

/**
 * The provider registry.
 *
 * Pulse resolves a source by id, so a track saved from one catalogue keeps
 * working after another is added. Registering a new adapter is the only change
 * needed to point Pulse at a different music source.
 */
const registry = new Map<string, MusicProvider>([
  [itunesProvider.id, itunesProvider],
  // Always registered, never the active source: it only resolves music that is
  // already on the device.
  [localProvider.id, localProvider],
  // Resolves uploads heard on Pulse Radio.
  [freestyleProvider.id, freestyleProvider],
  // A second catalogue for discovery, so music one shop lacks is not missed.
  [deezerProvider.id, deezerProvider],
  // Independent music, streamed in full, on the Indie page.
  [audiusProvider.id, audiusProvider],
]);

let activeProviderId = itunesProvider.id;

export function registerMusicProvider(provider: MusicProvider) {
  registry.set(provider.id, provider);
}

export function setActiveMusicProvider(id: string) {
  if (!registry.has(id)) throw new Error(`Unknown music provider: ${id}`);
  if (!registry.get(id)!.capabilities.search) {
    throw new Error(`${id} cannot be the active provider: it does not support search`);
  }
  activeProviderId = id;
}

/** The source new searches and discovery run against. */
export function musicProvider(): MusicProvider {
  const provider = registry.get(activeProviderId);
  if (!provider) throw new Error(`Music provider ${activeProviderId} is not registered`);
  return provider;
}

/** The source a specific saved entity came from, falling back to the active one. */
export function providerFor(providerId: string | null | undefined): MusicProvider {
  if (providerId && registry.has(providerId)) return registry.get(providerId)!;
  return musicProvider();
}

export function listMusicProviders(): MusicProvider[] {
  return [...registry.values()];
}

/** The catalogue sources a user could search — excludes the on-device one. */
export function listSearchableProviders(): MusicProvider[] {
  return [...registry.values()].filter((provider) => provider.capabilities.search);
}
