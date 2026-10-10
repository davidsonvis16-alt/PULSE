import { ticketmasterProvider } from '@/src/providers/events/adapters/ticketmaster';
import type { EventProvider } from '@/src/providers/events/types';

export * from '@/src/providers/events/types';

const registry = new Map<string, EventProvider>([[ticketmasterProvider.id, ticketmasterProvider]]);
let activeId = ticketmasterProvider.id;

export function registerEventProvider(provider: EventProvider) {
  registry.set(provider.id, provider);
}

export function setActiveEventProvider(id: string) {
  if (!registry.has(id)) throw new Error(`Unknown event provider: ${id}`);
  activeId = id;
}

export function eventProvider(): EventProvider {
  const provider = registry.get(activeId);
  if (!provider) throw new Error('No event provider registered');
  return provider;
}

export function eventProviderFor(id: string | null | undefined): EventProvider {
  return (id && registry.get(id)) || eventProvider();
}
