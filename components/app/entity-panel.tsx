"use client";

import { useState } from "react";
import {
  Building2, Contact, Landmark, Loader2, Mail, Phone, ShieldCheck, TriangleAlert, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Permit } from "@/lib/types";
import { CopyButton } from "./copy-button";

/**
 * Full entity resolution for the party on a permit.
 *
 * Shows where every field came from. A phone from a licence board and a phone
 * from a guess are not the same thing, and a salesperson about to dial should
 * be able to tell them apart at a glance.
 */

type FieldSource = "sunbiz" | "fl-dbpr" | "orlando-btr" | "permit";

interface Sourced<T> { value: T; source: FieldSource; confidence: number }

interface Person {
  name: Sourced<string>;
  title: Sourced<string> | null;
  phone: Sourced<string> | null;
  email: Sourced<string> | null;
  location: Sourced<string> | null;
  corroboratedBy: FieldSource[];
}

interface Resolution {
  query: string;
  entity: {
    name: string; docNumber: string | null; status: string | null; filingType: string | null;
    city: string | null; registeredAgent: string | null;
    filingEmail: Sourced<string> | null;
    confidence: number; matchMethod: string; ambiguousWith: number;
  } | null;
  people: Person[];
  primary: Person | null;
  license: { number: string | null; status: string | null; qualifier: string | null } | null;
  sourcesChecked: FieldSource[];
  sourcesHit: FieldSource[];
  notes: string[];
  confidence: number;
}

const SOURCE_LABELS: Record<FieldSource, string> = {
  sunbiz: "FL SunBiz",
  "fl-dbpr": "FL DBPR licence",
  "orlando-btr": "Orlando tax receipt",
  permit: "the permit",
};

function SourceTag({ source, confidence }: { source: FieldSource; confidence: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default rounded-full bg-background-muted px-1.5 py-px text-[10px] font-medium text-foreground-muted">
          {SOURCE_LABELS[source] ?? source}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        From {SOURCE_LABELS[source] ?? source} · {Math.round(confidence * 100)}% confidence
      </TooltipContent>
    </Tooltip>
  );
}

export function EntityPanel({ permit }: { permit: Permit }) {
  const [data, setData] = useState<Resolution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/v1/resolve?permit_id=${encodeURIComponent(permit.id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `Resolution failed (${res.status})`);
      setData(body.data as Resolution);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background-secondary p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-background-subtle text-primary">
            <Landmark className="size-4" aria-hidden />
          </span>
          <span className="label-caps">Entity resolution</span>
          {data && (
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              data.confidence >= 0.7 ? "bg-success-light text-success-text"
                : data.confidence >= 0.4 ? "bg-warning-light text-warning-text"
                : "bg-background-subtle text-foreground-muted",
            )}>
              {Math.round(data.confidence * 100)}% confident
            </span>
          )}
        </div>
        <Button size="sm" variant={data ? "outline" : "default"} onClick={resolve} disabled={loading}>
          {loading ? <><Loader2 className="size-4 animate-spin" /> Checking sources…</>
            : data ? "Re-check" : <><ShieldCheck className="size-3.5" /> Resolve entity</>}
        </Button>
      </div>

      {!data && !error && !loading && (
        <p className="text-sm text-foreground-secondary">
          Cross-check this firm against the Florida corporate registry, contractor licence
          board and municipal tax receipts. All public record, no credits.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-sm text-error-text">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {data && (
        <div className="space-y-3">
          {data.entity && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Building2 className="size-4 shrink-0 text-foreground-muted" aria-hidden />
                <span className="font-semibold text-foreground">{data.entity.name}</span>
                {data.entity.status && (
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    data.entity.status === "Active"
                      ? "bg-success-light text-success-text"
                      : "bg-background-subtle text-foreground-muted",
                  )}>
                    {data.entity.status}
                  </span>
                )}
                {data.entity.docNumber && (
                  <span className="flex items-center gap-1 font-mono text-[12px] text-foreground-secondary">
                    {data.entity.docNumber}
                    <CopyButton value={data.entity.docNumber} label="Copy document number" />
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-foreground-secondary">
                {data.entity.filingType && <span>{data.entity.filingType}</span>}
                {data.entity.city && <span>{data.entity.city}, FL</span>}
                {data.entity.registeredAgent && <span>Agent: {data.entity.registeredAgent}</span>}
              </div>
              {data.entity.filingEmail && (
                <p className="mt-2 flex items-center gap-1.5 text-[13px]">
                  <Mail className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
                  <a href={`mailto:${data.entity.filingEmail.value}`} className="text-primary hover:underline">
                    {data.entity.filingEmail.value}
                  </a>
                  <CopyButton value={data.entity.filingEmail.value} label="Copy email" />
                  <SourceTag {...data.entity.filingEmail} />
                  <span className="text-foreground-muted">state filing address</span>
                </p>
              )}
              {data.entity.ambiguousWith > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warning-text">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {data.entity.ambiguousWith} other {data.entity.ambiguousWith === 1 ? "entity shares" : "entities share"} this
                  name{data.entity.matchMethod === "loose" ? " once the suffix is ignored" : ""}.
                </p>
              )}
            </div>
          )}

          {data.license && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-background px-3 py-2 text-[13px]">
              <span className="label-caps">Licence</span>
              {data.license.number && (
                <span className="font-mono text-foreground">{data.license.number}</span>
              )}
              {data.license.status && (
                <span className={data.license.status === "Active" ? "text-success-text" : "text-foreground-muted"}>
                  {data.license.status}
                </span>
              )}
              {data.license.qualifier && (
                <span className="text-foreground-secondary">Qualifier: {data.license.qualifier}</span>
              )}
            </div>
          )}

          {data.people.length > 0 && (
            <ul className="space-y-2">
              {data.people.map((p, i) => (
                <li key={`${p.name.value}-${i}`} className={cn(
                  "rounded-lg border p-3",
                  p === data.primary ? "border-primary/40 bg-background-selected" : "border-border bg-background",
                )}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <UserRound className="size-4 shrink-0 text-foreground-muted" aria-hidden />
                    <span className="font-semibold text-foreground">{p.name.value}</span>
                    {p.title && <span className="text-[13px] text-foreground-secondary">{p.title.value}</span>}
                    {p === data.primary && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-inverted">
                        Call this one
                      </span>
                    )}
                    {p.corroboratedBy.length > 1 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex cursor-default items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-[10px] font-semibold text-success-text">
                            <ShieldCheck className="size-3" /> corroborated
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Named independently by {p.corroboratedBy.map((s) => SOURCE_LABELS[s]).join(" and ")}.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
                    {p.phone && (
                      <span className="flex items-center gap-1.5">
                        <Phone className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
                        <a href={`tel:${p.phone.value}`} className="font-medium text-primary hover:underline">{p.phone.value}</a>
                        <CopyButton value={p.phone.value} label="Copy phone" />
                        <SourceTag {...p.phone} />
                      </span>
                    )}
                    {p.email && (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Mail className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
                        <a href={`mailto:${p.email.value}`} className="truncate text-primary hover:underline">{p.email.value}</a>
                        <CopyButton value={p.email.value} label="Copy email" />
                        <SourceTag {...p.email} />
                      </span>
                    )}
                    {p.location && <span className="text-foreground-secondary">{p.location.value}</span>}
                    {!p.phone && !p.email && (
                      <span className="text-foreground-muted">No contact detail on file</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[12px] text-foreground-muted">
            <Contact className="size-3.5" aria-hidden />
            <span>
              Checked {data.sourcesChecked.length} public sources
              {data.sourcesHit.length > 0 && `, matched ${data.sourcesHit.map((s) => SOURCE_LABELS[s]).join(", ")}`}
            </span>
          </div>

          {data.notes.length > 0 && (
            <ul className="space-y-1">
              {data.notes.map((n) => (
                <li key={n} className="text-[12px] text-foreground-secondary">{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
