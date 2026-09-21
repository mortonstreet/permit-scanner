"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SearchResponse } from "./types";

/**
 * All filter state lives in the URL, so a search is shareable and the back
 * button works. Draft state is kept separately: the rail edits a draft and only
 * pressing Search commits it, which is how the reference app behaves.
 */

export type Draft = Record<string, string>;

export function useSearchState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const committed = useMemo(() => {
    const out: Draft = {};
    for (const [k, v] of searchParams.entries()) if (v !== "") out[k] = v;
    return out;
  }, [searchParams]);

  const [draft, setDraft] = useState<Draft>(committed);
  // Re-sync the draft when the URL changes from outside the rail (chips, back button).
  const lastCommitted = useRef(searchParams.toString());
  useEffect(() => {
    const current = searchParams.toString();
    if (current !== lastCommitted.current) {
      lastCommitted.current = current;
      setDraft(committed);
    }
  }, [searchParams, committed]);

  const setField = useCallback((key: string, value: string | null) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (value == null || value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  const commit = useCallback(
    (overrides: Draft = {}) => {
      const merged = { ...draft, ...overrides };
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(merged)) if (v !== "" && v != null) params.set(k, v);
      // Any filter change invalidates the current page offset.
      params.delete("page");
      params.sort();
      lastCommitted.current = params.toString();
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [draft, pathname, router],
  );

  /** Commit a change immediately, bypassing the draft (chips, tabs, paging). */
  const commitNow = useCallback(
    (changes: Draft, opts: { keepPage?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === "" || v == null) params.delete(k);
        else params.set(k, v);
      }
      if (!opts.keepPage) params.delete("page");
      params.sort();
      lastCommitted.current = params.toString();
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const reset = useCallback(() => {
    setDraft({});
    lastCommitted.current = "";
    router.push(pathname, { scroll: false });
  }, [pathname, router]);

  return { draft, committed, setField, commit, commitNow, reset, queryString: searchParams.toString() };
}

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Fetch permit results for the committed query, cancelling superseded requests. */
export function usePermitSearch(queryString: string): FetchState<SearchResponse> {
  const [state, setState] = useState<FetchState<SearchResponse>>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ data: prev.data, loading: true, error: null }));

    fetch(`/api/permits/search?${queryString}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Search failed (${res.status})`);
        return body as SearchResponse;
      })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Search failed" });
      });

    return () => controller.abort();
  }, [queryString]);

  return state;
}
