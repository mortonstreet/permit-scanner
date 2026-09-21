import type { Permit } from "./types";

/**
 * Process-local permit cache.
 *
 * Sources are queried live, so a permit the user just saw in a result list would
 * otherwise be unfetchable by id on the detail page. Search populates this cache
 * and the detail route reads it. It is a convenience layer, not the system of
 * record - Supabase holds that once configured (see lib/supabase/permits.ts).
 */

const MAX_ENTRIES = 5_000;
const TTL_MS = 30 * 60 * 1_000;

interface Entry {
  permit: Permit;
  expires: number;
}

/**
 * Pinned to globalThis because Next compiles each route into its own module
 * registry: a plain module-level Map would give the search route and the enrich
 * route two different caches. This still does not survive across serverless
 * instances, which is why callers can also post the permit body directly.
 */
const globalStore = globalThis as typeof globalThis & { __permitCache?: Map<string, Entry> };
const store: Map<string, Entry> = (globalStore.__permitCache ??= new Map<string, Entry>());

function evictExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
  }
}

export function cachePermits(permits: Permit[]): void {
  const now = Date.now();
  evictExpired(now);
  for (const permit of permits) {
    // Re-inserting moves the key to the end, giving us LRU-ish ordering.
    store.delete(permit.id);
    store.set(permit.id, { permit, expires: now + TTL_MS });
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

export function getCachedPermit(id: string): Permit | null {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expires <= Date.now()) { store.delete(id); return null; }
  return entry.permit;
}

export function cacheSize(): number {
  return store.size;
}
