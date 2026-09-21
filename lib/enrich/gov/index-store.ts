import "server-only";

/**
 * Lazily-built, process-wide index cache for the public government extracts.
 *
 * These files are tens of megabytes and refresh once a day, so we fetch and
 * index them once per process and reuse that for the lifetime of the instance.
 * Pinned to globalThis because Next gives each route its own module registry.
 *
 * A build is shared, not repeated: concurrent callers await the same promise,
 * otherwise the first ten requests after a cold start each pull 15MB.
 */

interface Entry<T> {
  promise: Promise<T>;
  builtAt: number;
}

const g = globalThis as typeof globalThis & { __govIndexes?: Map<string, Entry<unknown>> };
const store: Map<string, Entry<unknown>> = (g.__govIndexes ??= new Map());

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export async function getIndex<T>(
  key: string,
  build: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const existing = store.get(key) as Entry<T> | undefined;
  if (existing && Date.now() - existing.builtAt < ttlMs) return existing.promise;

  const entry: Entry<T> = { promise: build(), builtAt: Date.now() };
  store.set(key, entry);

  try {
    return await entry.promise;
  } catch (err) {
    // A failed build must not be cached, or the instance is poisoned until TTL.
    store.delete(key);
    throw err;
  }
}

export function indexStatus(): Array<{ key: string; ageMinutes: number }> {
  return [...store.entries()].map(([key, e]) => ({
    key,
    ageMinutes: Math.round((Date.now() - e.builtAt) / 60_000),
  }));
}

/** Fetch a large text file with a generous timeout and a clear failure. */
export async function fetchText(url: string, opts: { label: string; timeoutMs?: number }): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "permit-stack/0.1 (+https://permit-stack.com)" },
    });
    if (!res.ok) throw new Error(`${opts.label}: HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${opts.label}: timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
