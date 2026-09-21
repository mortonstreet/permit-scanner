"use client";

import Link from "next/link";
import { ArrowRight, Building2, Clock, MapPin, Phone, TriangleAlert, Zap } from "lucide-react";
import { cn, formatUsd, humanizeTag } from "@/lib/utils";
import { tagPalette } from "@/lib/reference-data";
import type { Signal } from "@/lib/signal";
import { CopyButton } from "./copy-button";

/**
 * One lead on the call list.
 *
 * The layout answers, in reading order: how urgent, who to call, what the job
 * is, and why it scored. A GC scanning this should be able to pick their next
 * call without opening anything.
 */

const BAND_STYLES = {
  hot: "border-primary/40 bg-background-selected",
  warm: "border-warning-border bg-warning-surface",
  cool: "border-border bg-background-secondary",
} as const;

const SCORE_STYLES = {
  hot: "bg-primary text-foreground-inverted",
  warm: "bg-warning-light text-warning-text border border-warning-border",
  cool: "bg-background-subtle text-foreground-secondary",
} as const;

const ROLE_LABELS: Record<string, string> = {
  owner_builder: "Developer",
  developer: "Developer",
  gc: "GC (job placed)",
};

const ROLE_STYLES: Record<string, string> = {
  // The developer on an unplaced job is the lead we actually sell.
  owner_builder: "bg-primary text-foreground-inverted",
  developer: "bg-primary-light text-primary",
  gc: "bg-background-subtle text-foreground-muted",
};

const STAGE_LABELS: Record<Signal["stage"], string> = {
  pre_permit: "Pre-permit",
  pre_issuance: "Not yet issued",
  issued: "Issued",
};

export function SignalCard({ signal, query }: { signal: Signal; query: string }) {
  const href = `/detail/permit-profile/${signal.permit_id}${query ? `?${query}` : ""}`;
  const place = [signal.where.city, signal.where.state].filter(Boolean).join(", ");

  return (
    <li className={cn("rounded-xl border p-4 transition-colors", BAND_STYLES[signal.band])}>
      <div className="flex items-start gap-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className={cn(
            "flex size-11 items-center justify-center rounded-lg text-lg font-bold tabular-nums",
            SCORE_STYLES[signal.band],
          )}>
            {signal.score}
          </span>
          <span className="label-caps text-[10px]">{signal.band}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
              <Building2 className="size-4 shrink-0 text-foreground-muted" aria-hidden />
              {signal.target?.name ?? "Unnamed firm"}
            </span>
            {signal.target && (
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                ROLE_STYLES[signal.target.role] ?? "bg-background-subtle text-foreground-secondary",
              )}>
                {ROLE_LABELS[signal.target.role] ?? signal.target.role}
              </span>
            )}
            {signal.open && (
              <span className="rounded-full bg-success-light px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success-text">
                Open
              </span>
            )}
            {signal.contact_on_permit.phone && (
              <a
                href={`tel:${signal.contact_on_permit.phone}`}
                className="flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
              >
                <Phone className="size-3.5" aria-hidden />
                {signal.contact_on_permit.phone}
              </a>
            )}
          </div>

          {signal.competing_contractor && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-warning-text">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {signal.competing_contractor} already has this job
            </p>
          )}

          <p className="mt-1.5 line-clamp-2 text-sm text-foreground">
            {signal.job.description ?? signal.job.permit_type ?? "No scope published"}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-foreground-secondary">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden /> {signal.posted}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="size-3.5" aria-hidden /> {STAGE_LABELS[signal.stage]}
            </span>
            {signal.where.address && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{signal.where.address}{place ? `, ${place}` : ""}</span>
              </span>
            )}
            {signal.job.value != null && (
              <span className="font-semibold text-foreground">{formatUsd(signal.job.value)}</span>
            )}
          </div>

          {signal.also_filed && signal.also_filed.length > 0 && (
            <p className="mt-1.5 text-[13px] text-primary">
              + {signal.also_filed.length} more permit{signal.also_filed.length > 1 ? "s" : ""} from this firm
              {signal.also_filed.some((f) => f.value != null) && (
                <span className="text-foreground-secondary">
                  {" "}({formatUsd(signal.also_filed.reduce((sum, f) => sum + (f.value ?? 0), 0))} combined)
                </span>
              )}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {signal.job.tags.slice(0, 3).map((t) => (
              <span key={t} className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                TAG_CLASSES[tagPalette(t)],
              )}>
                {humanizeTag(t)}
              </span>
            ))}
            {signal.reasons.slice(0, 2).map((r) => (
              <span key={r} className="rounded-full bg-background-muted px-2 py-0.5 text-[11px] text-foreground-secondary">
                {r}
              </span>
            ))}
            {signal.warnings?.slice(0, 1).map((w) => (
              <span key={w} className="rounded-full border border-warning-border bg-warning-light px-2 py-0.5 text-[11px] text-warning-text">
                {w}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1 self-center">
          <Link
            href={href}
            className="rounded-lg border border-border bg-background-secondary p-2 text-foreground-secondary transition-colors hover:border-border-hover hover:text-primary"
            aria-label={`Open permit ${signal.permit_number ?? signal.permit_id}`}
          >
            <ArrowRight className="size-4" />
          </Link>
          <CopyButton value={signal.permit_number ?? signal.permit_id} label="Copy permit number" />
        </div>
      </div>
    </li>
  );
}

const TAG_CLASSES = {
  energy: "bg-tag-energy-bg text-tag-energy-fg border-tag-energy-line",
  power: "bg-tag-power-bg text-tag-power-fg border-tag-power-line",
  trade: "bg-tag-trade-bg text-tag-trade-fg border-tag-trade-line",
  envelope: "bg-tag-envelope-bg text-tag-envelope-fg border-tag-envelope-line",
  stone: "bg-tag-stone-bg text-tag-stone-fg border-tag-stone-line",
} as const;
