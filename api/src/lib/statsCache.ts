/**
 * TTL cache for aggregation/statistics endpoints.
 *
 * Single-process in-memory map: the API runs one replica and the dataset is
 * small, so a cache server would be infrastructure without a payoff. Writes
 * invalidate by key prefix; the TTL is the backstop for out-of-band changes
 * (a pod restart reloads the whole dataset from datagen output anyway).
 */

const DEFAULT_TTL_SECONDS = 60;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const entries = new Map<string, Entry>();
/** In-flight computations, so concurrent misses compute once. */
const inflight = new Map<string, Promise<unknown>>();

export interface CacheResult<T> {
  value: T;
  hit: boolean;
}

/**
 * Serve `key` from cache, or compute and store it. Concurrent callers for the
 * same key share one computation.
 */
export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<CacheResult<T>> {
  const now = Date.now();
  const entry = entries.get(key);
  if (entry && entry.expiresAt > now) {
    return { value: entry.value as T, hit: true };
  }

  const existing = inflight.get(key);
  if (existing) {
    return { value: (await existing) as T, hit: true };
  }

  const promise = compute();
  inflight.set(key, promise);
  try {
    const value = await promise;
    entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return { value, hit: false };
  } finally {
    inflight.delete(key);
  }
}

/** Drop every entry whose key starts with one of `prefixes`. */
export function invalidate(...prefixes: string[]): number {
  let dropped = 0;
  for (const key of entries.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) {
      entries.delete(key);
      dropped++;
    }
  }
  return dropped;
}

/** Test seam: wipe all state between cases. */
export function resetCache(): void {
  entries.clear();
  inflight.clear();
}

export const TTL = {
  stats: 60,
  /** Fatigue feeds assignment decisions, so it stales faster. */
  fatigue: 30,
} as const;
