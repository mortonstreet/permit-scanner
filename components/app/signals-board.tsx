"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { US_STATES, stateName } from "@/lib/reference-data";
import { cn } from "@/lib/utils";
import type { Signal } from "@/lib/signal";
import { SignalCard } from "./signal-card";

/**
 * The call list.
 *
 * This is the answer to "who do I call today". It deliberately shows far fewer
 * rows than the permit search: everything here is work a site-work GC can bid,
 * with a named party to reach, ranked by how much the timing still favours them.
 */

interface SignalPayload {
  data: Signal[];
  meta: {
    window_days: number;
    funnel: { permits_scanned: number; gc_actionable: number; above_min_score: number };
    sources: string[];
    warnings: string[];
    returned: number;
  };
}

const WINDOWS = [
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
];

const STAGES = [
  // "Early" is the default a GC should live in: the measured window ahead of
  // permit issuance is months, where after it is days.
  { value: "early", label: "Early stage only" },
  { value: "entitlement", label: "Entitlement only" },
  { value: "pre_issuance", label: "Not yet issued" },
  { value: "all", label: "Any stage" },
];

/** States with live coverage today. Kept short so the demo never hits a dead one. */
const LIVE_STATES = ["FL", "TX", "CA", "IL", "OH", "LA"];

export function SignalsBoard() {
  const router = useRouter();
  const params = useSearchParams();

  const state = params.get("geo_state") ?? "FL";
  const windowDays = params.get("window") ?? "7";
  const stage = params.get("stage") ?? "all";
  const minScore = params.get("min_score") ?? "40";

  const [payload, setPayload] = useState<SignalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({
      geo_state: state, window: windowDays, stage, min_score: minScore, limit: "60",
    });
    return p.toString();
  }, [state, windowDays, stage, minScore]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/v1/signals?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        return body as SignalPayload;
      })
      .then(setPayload)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load signals");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [query]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.push(`/?${next.toString()}`, { scroll: false });
  }

  const signals = payload?.data ?? [];
  const hot = signals.filter((s) => s.band === "hot").length;
  // The permit-search link should land on the same scope the board is showing.
  const searchQuery = new URLSearchParams({
    geo_state: state, geo_state_label: stateName(state) ?? state,
    permit_from: isoDaysAgo(Number(windowDays)), permit_to: isoToday(),
  }).toString();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-7">
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Today&apos;s call list
            </h1>
            <p className="mt-1 text-sm text-foreground-secondary">
              Site-work jobs filed in {stateName(state) ?? state} that name someone you can reach,
              ranked by how much the timing still favours you.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/search?${searchQuery}`}>
              <Search className="size-4" /> Full permit search
            </Link>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Picker value={state} onChange={(v) => update("geo_state", v)} width="w-44"
            options={US_STATES.filter((s) => LIVE_STATES.includes(s.code))
              .map((s) => ({ value: s.code, label: s.name }))} />
          <Picker value={windowDays} onChange={(v) => update("window", v)} width="w-40" options={WINDOWS} />
          <Picker value={stage} onChange={(v) => update("stage", v)} width="w-44" options={STAGES} />
          <Picker value={minScore} onChange={(v) => update("min_score", v)} width="w-40"
            options={[
              { value: "0", label: "Any score" },
              { value: "40", label: "Score 40+" },
              { value: "60", label: "Score 60+" },
              { value: "70", label: "Hot only" },
            ]} />
        </div>
      </header>

      {payload && !loading && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-background-panel px-4 py-3 text-[13px]">
          <Stat label="On the list" value={signals.length} strong />
          <Stat label="Hot" value={hot} />
          <Stat label="Permits scanned" value={payload.meta.funnel.permits_scanned} />
          <Stat label="Feeds" value={payload.meta.sources.length} />
          <span className="text-foreground-muted">
            {payload.meta.funnel.permits_scanned.toLocaleString()} permits →{" "}
            {payload.meta.funnel.gc_actionable.toLocaleString()} you can bid and reach
          </span>
        </div>
      )}

      {loading && (
        <ul className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </ul>
      )}

      {error && (
        <div className="rounded-xl border border-error/30 bg-error-light px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-error-text">
            <TriangleAlert className="size-4" /> Could not load signals
          </p>
          <p className="mt-1 text-[13px] text-error-text/90">{error}</p>
        </div>
      )}

      {!loading && !error && signals.length === 0 && (
        <div className="rounded-xl border border-border bg-background-secondary px-6 py-16 text-center">
          <p className="font-display text-base font-semibold text-foreground">Nothing worth a call yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-foreground-secondary">
            No site-work permit in this window both names a reachable party and clears the score floor.
            Widen the window or drop the minimum score.
          </p>
        </div>
      )}

      {!loading && signals.length > 0 && (
        <ul className="space-y-3">
          {signals.map((s) => <SignalCard key={s.permit_id} signal={s} query={searchQuery} />)}
        </ul>
      )}

      {payload && payload.meta.sources.length > 0 && !loading && (
        <p className="mt-5 text-[12px] leading-relaxed text-foreground-muted">
          Live feeds: {payload.meta.sources.join(" · ")}
        </p>
      )}
    </main>
  );
}

function Picker({
  value, onChange, options, width,
}: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; width: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn(width, "h-9")}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn("tabular-nums", strong ? "text-lg font-bold text-primary" : "font-semibold text-foreground")}>
        {value.toLocaleString()}
      </span>
      <span className="text-foreground-secondary">{label}</span>
    </span>
  );
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
