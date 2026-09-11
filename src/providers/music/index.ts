import { itunesProvider, ITUNES_PROVIDER_ID } from '@/src/providers/music/adapters/itunes';
import type { MusicProvider } from '@/src/providers/music/types';

export * from '@/src/providers/music/types';
export { ITUNES_PROVIDER_ID };

/**
 * The provider registry.
 *
 * Pulse resolves a source by id, so a track saved from one catalogue keeps
 * working after another is added. Registering a new adapter is the only change
 * needed to point Pulse at a different music source.
 */
const registry = new Map<string, MusicProvider>([[itunesProvider.id, itunesProvider]]);

let activeProviderId = itunesProvider.id;

export function registerMusicProvider(provider: MusicProvider) {
  registry.set(provider.id, provider);
}

export function setActiveMusicProvider(id: string) {
  if (!registry.has(id)) throw new Error(`Unknown music provider: ${id}`);
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
