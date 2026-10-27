/**
 * Runs `work` over `items` with at most `limit` in flight, keeping the input
 * order in the result. Stops starting new work once `signal` aborts.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !signal.aborted) {
      const at = next;
      next += 1;
      results[at] = await work(items[at]);
    }
  });
  await Promise.all(lanes);
  return results.filter((result) => result !== undefined);
}
