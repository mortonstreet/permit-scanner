"use client";

import { useMemo } from "react";
import { Building2, MapPinned } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/utils";
import type { Permit } from "@/lib/types";
import { TagList } from "./status-badge";

/**
 * The Contractors and Properties tabs.
 *
 * These are rollups of the permits already fetched, not separate queries. That
 * keeps a tab switch instant and free, at the cost of only reflecting the
 * current result window - which the footer states plainly.
 */

interface FirmRow {
  name: string;
  permits: number;
  totalValue: number;
  valuedPermits: number;
  jurisdictions: Set<string>;
  tags: Set<string>;
  latest: string | null;
}

export function ContractorsView({ permits, loading }: { permits: Permit[]; loading: boolean }) {
  const rows = useMemo(() => {
    const byFirm = new Map<string, FirmRow>();
    for (const p of permits) {
      const name = p.contractor?.company ?? p.contractor?.name ?? p.owner?.company ?? null;
      if (!name) continue;
      const key = name.toUpperCase();
      const row = byFirm.get(key) ?? {
        name, permits: 0, totalValue: 0, valuedPermits: 0,
        jurisdictions: new Set<string>(), tags: new Set<string>(), latest: null,
      };
      row.permits += 1;
      if (p.job_value != null) { row.totalValue += p.job_value; row.valuedPermits += 1; }
      if (p.geo.jurisdiction) row.jurisdictions.add(p.geo.jurisdiction);
      for (const t of p.tags) row.tags.add(t);
      const date = p.file_date ?? p.issue_date;
      if (date && (!row.latest || date > row.latest)) row.latest = date;
      byFirm.set(key, row);
    }
    return [...byFirm.values()].sort((a, b) => b.permits - a.permits || b.totalValue - a.totalValue);
  }, [permits]);

  if (loading && permits.length === 0) return <RollupSkeleton />;
  if (rows.length === 0) {
    return <EmptyRollup
      icon={<Building2 className="size-5" />}
      title="No firms named"
      body="None of the permits in this result set name a contractor or owner. Try a jurisdiction that reports those fields."
    />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background-secondary">
      <div className="grid grid-cols-[minmax(180px,2fr)_90px_130px_minmax(140px,1fr)_110px] items-center gap-3 border-b border-border px-4 py-3">
        <Header>Firm</Header><Header className="text-right">Permits</Header>
        <Header className="text-right">Total value</Header><Header>Work types</Header>
        <Header className="text-right">Latest</Header>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.name} className="grid grid-cols-[minmax(180px,2fr)_90px_130px_minmax(140px,1fr)_110px] items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0 hover:bg-background-hover">
            <span className="min-w-0">
              <span className="block truncate font-semibold text-foreground">{row.name}</span>
              <span className="block truncate text-[13px] text-foreground-secondary">
                {[...row.jurisdictions].slice(0, 2).join(", ") || "—"}
              </span>
            </span>
            <span className="text-right text-sm text-foreground">{row.permits}</span>
            <span className="text-right text-sm font-medium text-foreground">
              {row.valuedPermits > 0 ? formatUsd(row.totalValue) : <span className="text-foreground-muted">—</span>}
            </span>
            <span><TagList tags={[...row.tags]} max={2} /></span>
            <span className="text-right text-[13px] text-foreground-secondary">{row.latest ?? "—"}</span>
          </li>
        ))}
      </ul>
      <Footnote count={rows.length} noun="firms" />
    </div>
  );
}

export function PropertiesView({ permits, loading }: { permits: Permit[]; loading: boolean }) {
  const rows = useMemo(() => {
    const byAddress = new Map<string, { permit: Permit; count: number; totalValue: number }>();
    for (const p of permits) {
      if (!p.address) continue;
      const key = `${p.address.toUpperCase()}|${p.geo.city ?? ""}`;
      const row = byAddress.get(key) ?? { permit: p, count: 0, totalValue: 0 };
      row.count += 1;
      if (p.job_value != null) row.totalValue += p.job_value;
      byAddress.set(key, row);
    }
    return [...byAddress.values()].sort((a, b) => b.count - a.count || b.totalValue - a.totalValue);
  }, [permits]);

  if (loading && permits.length === 0) return <RollupSkeleton />;
  if (rows.length === 0) {
    return <EmptyRollup
      icon={<MapPinned className="size-5" />}
      title="No addressed permits"
      body="These permits did not come with a street address, so they cannot be grouped by property."
    />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background-secondary">
      <div className="grid grid-cols-[minmax(200px,2fr)_130px_90px_130px] items-center gap-3 border-b border-border px-4 py-3">
        <Header>Address</Header><Header>Property type</Header>
        <Header className="text-right">Permits</Header><Header className="text-right">Total value</Header>
      </div>
      <ul>
        {rows.map(({ permit, count, totalValue }) => (
          <li key={permit.id} className="grid grid-cols-[minmax(200px,2fr)_130px_90px_130px] items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0 hover:bg-background-hover">
            <span className="min-w-0">
              <span className="block truncate font-semibold text-foreground">{permit.address}</span>
              <span className="block truncate text-[13px] text-foreground-secondary">
                {[permit.geo.city, permit.geo.state].filter(Boolean).join(", ")}
              </span>
            </span>
            <span className="truncate text-sm capitalize text-foreground-secondary">
              {permit.property.property_type ?? <span className="text-foreground-muted">—</span>}
            </span>
            <span className="text-right text-sm text-foreground">{count}</span>
            <span className="text-right text-sm font-medium text-foreground">
              {totalValue > 0 ? formatUsd(totalValue) : <span className="text-foreground-muted">—</span>}
            </span>
          </li>
        ))}
      </ul>
      <Footnote count={rows.length} noun="properties" />
    </div>
  );
}

function Header({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`label-caps ${className ?? ""}`}>{children}</span>;
}

function Footnote({ count, noun }: { count: number; noun: string }) {
  return (
    <p className="border-t border-border bg-background-panel px-4 py-2.5 text-[12px] text-foreground-muted">
      {count.toLocaleString()} {noun} rolled up from the permits on this page.
    </p>
  );
}

function EmptyRollup({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-background-secondary px-6 py-16 text-center">
      <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-background-subtle text-foreground-muted">
        {icon}
      </span>
      <p className="font-display text-base font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-foreground-secondary">{body}</p>
    </div>
  );
}

function RollupSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background-secondary p-4">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}
