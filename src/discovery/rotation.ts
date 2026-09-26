import { getJsonSetting, setJsonSetting } from '@/src/db/repos/settings';

/**
 * Keeping suggestions from going stale.
 *
 * A taste profile barely moves from one hour to the next, so a recommender
 * built only on taste shows the same songs every time the app is opened — and
 * a shelf you have already read is no longer a suggestion. Rotation is the fix:
 * the same profile, sliced from a different angle each time, so there is always
 * something on the page that was not there before.
 *
 * It is a number, not randomness. The same rotation always produces the same
 * shelves, which means a suggestion can be explained, a screen can be reloaded
 * without everything jumping around, and a song that was on screen a moment ago
 * is still there when the list comes back.
 *
 * It advances on its own every few hours, and once more each time the listener
 * deliberately asks for something new by pulling to refresh.
 */

/** How long a set of suggestions stands before the next slice comes round. */
const ROTATION_MS = 3 * 60 * 60 * 1000;

let manualSteps = 0;

/** The current slice. Changes with the clock and with pull-to-refresh. */
export function currentRotation(): number {
  return Math.floor(Date.now() / ROTATION_MS) + manualSteps;
}

/** Asked for something new: move on rather than reloading the same shelves. */
export function advanceRotation(): number {
  manualSteps += 1;
  return currentRotation();
}

/**
 * Picks `count` items starting at the rotation's offset, wrapping round.
 *
 * Used for seeds — artists, genres — so that over a day every part of a
 * listener's taste gets its turn at the top of the page rather than the same
 * three artists holding it forever.
 */
export function rotate<T>(items: T[], rotation: number, count: number): T[] {
  if (items.length === 0 || count <= 0) return [];
  if (items.length <= count) return [...items];
  const start = ((rotation % items.length) + items.length) % items.length;
  const picked: T[] = [];
  for (let i = 0; i < count; i += 1) picked.push(items[(start + i) % items.length]);
  return picked;
}

// ---------------------------------------------------------------------------
// What has already been suggested
// ---------------------------------------------------------------------------

/**
 * A short memory of songs already put in front of this listener.
 *
 * Rotation changes the angle; this stops the same songs coming back round it.
 * A suggestion that was on the page yesterday is not wrong, it is just no
 * longer a suggestion — so the engine pushes these down a shelf rather than
 * dropping them, and a listener with a narrow library still gets a full page.
 *
 * It is deliberately short and small: a few hundred ids for a few days. This
 * is not a listening history, it never leaves the device, and it is keyed on
 * catalogue ids rather than on anything about the person.
 */
const SUGGESTED_KEY = 'discovery.recentlySuggested';
/** How long a song stays "already seen". */
const SUGGESTED_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Ceiling, so this cannot grow without limit. */
const SUGGESTED_MAX = 400;

type SuggestedLedger = Record<string, number>;

let ledger: SuggestedLedger | null = null;

async function loadLedger(): Promise<SuggestedLedger> {
  if (ledger) return ledger;
  ledger = await getJsonSetting<SuggestedLedger>(SUGGESTED_KEY, {}).catch(() => ({}));
  return ledger;
}

/** Ids shown recently enough to still count as seen. */
export async function recentlySuggested(): Promise<Set<string>> {
  const cutoff = Date.now() - SUGGESTED_TTL_MS;
  const entries = await loadLedger().catch(() => ({}) as SuggestedLedger);
  return new Set(Object.keys(entries).filter((id) => entries[id] >= cutoff));
}

/** Records a page of suggestions, oldest entries falling off the end. */
export async function rememberSuggested(trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return;
  const now = Date.now();
  const cutoff = now - SUGGESTED_TTL_MS;
  const current = await loadLedger().catch(() => ({}) as SuggestedLedger);

  const merged: SuggestedLedger = {};
  for (const [id, at] of Object.entries(current)) if (at >= cutoff) merged[id] = at;
  for (const id of trackIds) merged[id] = now;

  const kept = Object.entries(merged)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SUGGESTED_MAX);

  ledger = Object.fromEntries(kept);
  await setJsonSetting<SuggestedLedger>(SUGGESTED_KEY, ledger).catch(() => {});
}

/** Forgets everything, so the next page starts from scratch. */
export async function forgetSuggested(): Promise<void> {
  ledger = {};
  await setJsonSetting<SuggestedLedger>(SUGGESTED_KEY, {}).catch(() => {});
}
