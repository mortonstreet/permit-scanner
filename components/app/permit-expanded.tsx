"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlignLeft, ArrowRight, DollarSign, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, formatUsd } from "@/lib/utils";
import type { Permit } from "@/lib/types";
import { PermitTimeline } from "./permit-timeline";
import { LeadPanel } from "./lead-panel";

/**
 * The in-place expansion under a result row: identity block, description,
 * timeline, property/value stats, then the lead panel that turns the permit
 * into a contactable decision maker.
 */
export function PermitExpanded({ permit }: { permit: Permit }) {
  // The detail route re-runs this search if its cache has been cleared, so the
  // link has to carry the filters that produced the row.
  const searchParams = useSearchParams();
  const detailHref = `/detail/permit-profile/${permit.id}${searchParams.size ? `?${searchParams}` : ""}`;

  return (
    <div className="space-y-3 border-t border-border bg-background px-4 py-4">
      <div className="grid gap-3 md:grid-cols-2">
        <InfoCard>
          <Detail label="Full address" value={fullAddress(permit)} />
          <Detail label="Jurisdiction" value={permit.geo.jurisdiction} />
        </InfoCard>
        <InfoCard>
          <Detail label="Permit number" value={permit.permit_number} mono />
          <Detail label="Permit type" value={permit.permit_type} />
        </InfoCard>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-background-secondary p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlignLeft className="size-4 text-foreground-muted" aria-hidden />
            <span className="label-caps">Description</span>
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            {permit.description ?? <span className="text-foreground-muted">Not reported</span>}
          </p>
        </div>
        <PermitTimeline permit={permit} compact />
      </div>

      <div className="rounded-xl border border-border bg-background-secondary">
        <StatRow
          icon={<Home className="size-4" aria-hidden />}
          label="Property"
          stats={[
            ["Lot", permit.property.lot_size_sqft ? `${formatNumber(permit.property.lot_size_sqft)} sqft` : null],
            ["Building", permit.property.building_area_sqft ? `${formatNumber(permit.property.building_area_sqft)} sqft` : null],
            ["Stories", permit.property.stories != null ? String(permit.property.stories) : null],
            ["Units", permit.property.units != null ? String(permit.property.units) : null],
            ["Built", permit.property.year_built != null ? String(permit.property.year_built) : null],
            ["Market value", permit.property.market_value != null ? formatUsd(permit.property.market_value) : null],
          ]}
        />
        <div className="border-t border-border" />
        <StatRow
          icon={<DollarSign className="size-4" aria-hidden />}
          label="Values"
          stats={[
            ["Job value", permit.job_value != null ? formatUsd(permit.job_value) : null],
            ["Fees", permit.fees != null ? formatUsd(permit.fees) : null],
            ["Total cost", permit.total_cost != null ? formatUsd(permit.total_cost) : null],
          ]}
        />
      </div>

      <LeadPanel permit={permit} />

      <div>
        <Button asChild>
          <Link href={detailHref}>
            View full detail <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 rounded-xl border border-border bg-background-secondary p-4 sm:grid-cols-2">{children}</div>;
}

function Detail({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="label-caps mb-1.5">{label}</p>
      <p className={mono ? "font-mono text-sm text-foreground" : "text-sm text-foreground"}>
        {value ?? <span className="text-foreground-muted">—</span>}
      </p>
    </div>
  );
}

function StatRow({
  icon, label, stats,
}: { icon: React.ReactNode; label: string; stats: Array<[string, string | null]> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
      <span className="flex items-center gap-2 text-foreground-secondary">
        <span className="flex size-7 items-center justify-center rounded-md bg-background-subtle text-primary">{icon}</span>
        <span className="label-caps">{label}</span>
      </span>
      {stats.map(([name, value]) => (
        <span key={name} className="flex items-center gap-1.5 text-sm">
          <span className="text-foreground-secondary">{name}</span>
          <span className={value ? "font-medium text-foreground" : "text-foreground-muted"}>{value ?? "—"}</span>
        </span>
      ))}
    </div>
  );
}

export function fullAddress(permit: Permit): string {
  const { city, state, zipcode } = permit.geo;
  const line2 = [city, state].filter(Boolean).join(", ") + (zipcode ? ` ${zipcode}` : "");
  return [permit.address, line2].filter((s) => s && s.trim()).join(", ") || "—";
}
