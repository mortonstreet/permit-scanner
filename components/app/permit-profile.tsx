"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatUsd } from "@/lib/utils";
import type { Permit } from "@/lib/types";
import { toCsv, downloadCsv } from "@/lib/csv";
import { StatusBadge, TagChip } from "./status-badge";
import { PermitTimeline } from "./permit-timeline";
import { SourceFields } from "./source-fields";
import { CopyButton } from "./copy-button";
import { LeadPanel } from "./lead-panel";

/** Full-page permit record: the drill-down from "View full detail". */
export function PermitProfile({ permitId }: { permitId: string }) {
  const [permit, setPermit] = useState<Permit | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Forwarded so the API can re-run the originating search on a cache miss.
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/permits/${encodeURIComponent(permitId)}${query ? `?${query}` : ""}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Could not load permit (${res.status})`);
        return body as Permit;
      })
      .then(setPermit)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load permit");
      });
    return () => controller.abort();
  }, [permitId, query]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <BackLink query={query} />
        <div className="mt-6 rounded-xl border border-border bg-background-secondary px-6 py-12 text-center">
          <p className="font-display text-base font-semibold text-foreground">Permit unavailable</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-foreground-secondary">{error}</p>
        </div>
      </main>
    );
  }

  if (!permit) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-6 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  const notReported = unreportedFields(permit);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <BackLink query={query} />

      <div className="mb-5 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            {permit.permit_number ?? "Unnumbered permit"}
          </h1>
          <CopyButton value={permit.permit_number ?? permit.id} label="Copy permit number" className="size-8" />
          <button
            type="button"
            aria-label="Download this permit as CSV"
            onClick={() => downloadCsv(toCsv([permit]), `permit-${permit.permit_number ?? permit.id}.csv`)}
            className="rounded-md p-1.5 text-primary transition-colors hover:bg-background-muted"
          >
            <Download className="size-4" />
          </button>
        </div>
        <StatusBadge status={permit.status} />
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-background-secondary p-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <span className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-background-subtle text-primary">
                <Info className="size-4" aria-hidden />
              </span>
              <span className="label-caps">Overview</span>
            </span>
            <Inline label="Location" value={[permit.geo.county, permit.geo.state].filter(Boolean).join(", ")} />
            <Inline label="Authority" value={permit.geo.jurisdiction} />
            <Inline label="Type" value={permit.permit_type} />
          </div>
        </div>

        <PermitTimeline permit={permit} />

        <div className="rounded-xl border border-border bg-background-secondary p-4">
          <p className="label-caps mb-2">Description</p>
          <p className="text-sm leading-relaxed text-foreground">
            {permit.description ?? <span className="text-foreground-muted">Not reported</span>}
          </p>
          {permit.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {permit.tags.map((t) => <TagChip key={t} tag={t} />)}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Property">
            <Row label="Property type" value={permit.property.property_type} />
            <Row label="Lot size" value={permit.property.lot_size_sqft ? `${formatNumber(permit.property.lot_size_sqft)} sqft` : null} />
            <Row label="Building area" value={permit.property.building_area_sqft ? `${formatNumber(permit.property.building_area_sqft)} sqft` : null} />
            <Row label="Stories" value={permit.property.stories} />
            <Row label="Units" value={permit.property.units} />
            <Row label="Year built" value={permit.property.year_built} />
            <Row label="Market value" value={permit.property.market_value != null ? formatUsd(permit.property.market_value) : null} />
          </Panel>
          <Panel title="Values">
            <Row label="Job value" value={permit.job_value != null ? formatUsd(permit.job_value) : null} />
            <Row label="Fees" value={permit.fees != null ? formatUsd(permit.fees) : null} />
            <Row label="Total cost" value={permit.total_cost != null ? formatUsd(permit.total_cost) : null} />
            <Row label="Full address" value={permit.address} />
            <Row label="Coordinates" value={permit.latitude != null ? `${permit.latitude.toFixed(5)}, ${permit.longitude?.toFixed(5)}` : null} />
            <Row label="Source" value={permit.source_id} />
          </Panel>
        </div>

        <LeadPanel permit={permit} />

        <SourceFields fields={permit.source_fields} />

        {notReported.length > 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-3">
            <span className="text-[13px] text-foreground-muted">
              <span className="font-medium">Not reported</span>{" "}
              {notReported.join(" · ")}
            </span>
          </div>
        )}
      </div>
    </main>
  );
}

function BackLink({ query }: { query: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={query ? `/search?${query}` : "/"}><ChevronLeft className="size-4" /> Back to results</Link>
    </Button>
  );
}

function Inline({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[13px] text-foreground-secondary">{label}</span>
      <span className="text-sm font-medium text-foreground">
        {value || <span className="font-normal text-foreground-muted">—</span>}
      </span>
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background-secondary p-4">
      <p className="label-caps mb-3">{title}</p>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[13px] text-foreground-secondary">{label}</dt>
      <dd className="truncate text-right text-[13px] font-medium text-foreground">
        {value == null || value === "" ? <span className="font-normal text-foreground-muted">—</span> : String(value)}
      </dd>
    </div>
  );
}

/** Mirrors the reference app's dashed "Not reported" strip at the page foot. */
function unreportedFields(permit: Permit): string[] {
  const checks: Array<[string, boolean]> = [
    ["Property owner", !permit.owner?.company && !permit.owner?.name],
    ["Job value", permit.job_value == null],
    ["Fees", permit.fees == null],
    ["Total cost", permit.total_cost == null],
    ["Property type", permit.property.property_type == null],
    ["Lot", permit.property.lot_size_sqft == null],
    ["Building", permit.property.building_area_sqft == null],
    ["Stories", permit.property.stories == null],
    ["Units", permit.property.units == null],
    ["Built", permit.property.year_built == null],
    ["Market value", permit.property.market_value == null],
    ["Map location", permit.latitude == null],
    ["Contractors", !permit.contractor],
  ];
  return checks.filter(([, missing]) => missing).map(([label]) => label);
}
