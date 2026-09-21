"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatUsd } from "@/lib/utils";
import type { Permit } from "@/lib/types";
import { freshnessLabel } from "@/lib/sources/aggregate";
import { StatusBadge, TagList } from "./status-badge";
import { PermitExpanded } from "./permit-expanded";

/**
 * The results list. Rows expand in place to a detail card (matching the
 * reference app) and link out to a full profile page.
 */

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  residential: "Residential", commercial: "Commercial",
  industrial: "Industrial", mixed: "Mixed Use", other: "Other",
};

interface ResultsTableProps {
  permits: Permit[];
  loading: boolean;
}

export function ResultsTable({ permits, loading }: ResultsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading && permits.length === 0) return <ResultsSkeleton />;

  if (permits.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background-secondary px-6 py-16 text-center">
        <p className="font-display text-base font-semibold text-foreground">No permits match these filters</p>
        <p className="mt-1.5 text-sm text-foreground-secondary">
          Try widening the date range, clearing keywords, or choosing a different area.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-background-secondary", loading && "opacity-60")}>
      {/* Column widths are shared with each row below via the same grid template. */}
      <div className="grid grid-cols-[32px_110px_minmax(180px,2fr)_120px_minmax(120px,1fr)_minmax(140px,1.2fr)_110px_90px] items-center gap-3 border-b border-border px-4 py-3">
        <span className="sr-only">Expand</span>
        <HeaderCell>Status</HeaderCell>
        <HeaderCell>Address</HeaderCell>
        <HeaderCell>Property type</HeaderCell>
        <HeaderCell>Tags</HeaderCell>
        <HeaderCell>Firm</HeaderCell>
        <HeaderCell className="text-right">Job value</HeaderCell>
        <HeaderCell className="text-right">Started</HeaderCell>
      </div>

      <ul>
        {permits.map((permit) => {
          const expanded = expandedId === permit.id;
          const firm = permit.owner?.company ?? permit.contractor?.company ?? null;
          return (
            <li key={permit.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`permit-result-expanded-${permit.id}`}
                onClick={() => setExpandedId(expanded ? null : permit.id)}
                className={cn(
                  "grid w-full grid-cols-[32px_110px_minmax(180px,2fr)_120px_minmax(120px,1fr)_minmax(140px,1.2fr)_110px_90px] items-center gap-3 px-4 py-3.5 text-left transition-colors",
                  expanded ? "bg-background-selected" : "hover:bg-background-hover",
                )}
              >
                <ChevronRight className={cn(
                  "size-4 text-foreground-muted transition-transform",
                  expanded && "rotate-90",
                )} aria-hidden />

                <span><StatusBadge status={permit.status} /></span>

                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">
                    {permit.address ?? locationOnly(permit)}
                  </span>
                  {permit.address && (
                    <span className="block truncate text-[13px] text-foreground-secondary">{locationOnly(permit)}</span>
                  )}
                </span>

                <span className="truncate text-sm text-foreground-secondary">
                  {permit.property.property_type ? PROPERTY_TYPE_LABELS[permit.property.property_type] : <Dash />}
                </span>

                <span><TagList tags={permit.tags} /></span>

                <span className="truncate text-sm text-foreground-secondary">
                  {firm ?? <Dash />}
                </span>

                <span className="text-right text-sm font-medium text-foreground">
                  {permit.job_value != null ? formatUsd(permit.job_value) : <Dash />}
                </span>

                <span className="text-right text-sm text-foreground-secondary">{freshnessLabel(permit)}</span>
              </button>

              <div
                id={`permit-result-expanded-${permit.id}`}
                aria-hidden={!expanded}
                inert={!expanded ? true : undefined}
                className={cn("overflow-hidden transition-all", expanded ? "block" : "hidden")}
              >
                <PermitExpanded permit={permit} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HeaderCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("label-caps", className)}>{children}</span>;
}

function Dash() {
  return <span className="text-foreground-muted">—</span>;
}

/** "San Antonio, TX 78216" from whatever geo parts the source gave us. */
export function locationOnly(permit: Permit): string {
  const { city, state, zipcode, county } = permit.geo;
  const place = city ?? (county ? `${county} County` : null);
  return [place, state].filter(Boolean).join(", ") + (zipcode ? ` ${zipcode}` : "") || "—";
}

function ResultsSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background-secondary">
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-3 w-40" />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0">
          <Skeleton className="h-5 w-20 rounded-md" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
