import { enumeratingScanner } from '@/src/ingestion/scanner';
import { ingestEngine } from '@/src/ingestion/ingest';
import { getLocalCounts } from '@/src/db/repos/local';
import { pushNotification } from '@/src/db/repos/notifications';
import { getNotificationPrefs } from '@/src/db/repos/settings';

/**
 * Watches the device for music added after the first import.
 *
 * The media store fires on any change, including ones that have nothing to do
 * with audio, so the callback is debounced and the scan itself only touches
 * files Pulse has not seen. The user does nothing: new songs turn up in their
 * library with artwork already attached.
 */

const DEBOUNCE_MS = 4000;

let stop: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function startLibraryWatch(): Promise<void> {
  if (stop) return;

  const scanner = await enumeratingScanner();
  if (!scanner) return;

  const permission = await scanner.getPermission();
  if (permission.state !== 'granted' && permission.state !== 'limited') return;

  // Nothing imported yet means the user has not opted in; do not scan uninvited.
  const counts = await getLocalCounts();
  if (counts.tracks === 0) return;

  stop = scanner.observeLibraryChanges(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runIncremental();
    }, DEBOUNCE_MS);
  });
}

export function stopLibraryWatch() {
  if (timer) clearTimeout(timer);
  timer = null;
  stop?.();
  stop = null;
}

async function runIncremental() {
  if (ingestEngine.isRunning) return;

  const before = await getLocalCounts();
  const result = await ingestEngine.run({ mode: 'device' });
  if (result.phase !== 'done') return;

  const after = await getLocalCounts();
  const added = after.tracks - before.tracks;
  if (added <= 0) return;

  const prefs = await getNotificationPrefs();
  if (!prefs.playlists) return;

  await pushNotification({
    type: 'playlist',
    title: `${added} new song${added === 1 ? '' : 's'} added`,
    body: 'Pulse found new music on your device, identified it and updated your Grooves.',
    entityType: 'library',
    entityId: `import-${Date.now()}`,
  });
}
