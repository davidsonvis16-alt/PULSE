/**
 * The station's clock.
 *
 * Kept apart from the network code so it can be tested on its own.
 */

/**
 * Where the station is at `nowMs`: which freestyle in the rotation, and how
 * far into it. The rotation loops end to end forever from the Unix epoch, so
 * the answer is the same on every phone. Pure, so it can be tested.
 */
export function livePosition(
  rotation: { durationMs: number }[],
  nowMs: number,
): { index: number; offsetMs: number } | null {
  const total = rotation.reduce((sum, item) => sum + Math.max(0, item.durationMs), 0);
  if (rotation.length === 0 || total <= 0) return null;
  let into = ((nowMs % total) + total) % total;
  for (let index = 0; index < rotation.length; index += 1) {
    const length = Math.max(0, rotation[index].durationMs);
    if (into < length) return { index, offsetMs: into };
    into -= length;
  }
  return { index: 0, offsetMs: 0 };
}
