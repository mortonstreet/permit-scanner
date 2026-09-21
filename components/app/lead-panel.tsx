"use client";

import { useState } from "react";
import { Building2, Contact, Loader2, Lock, Mail, Phone, TriangleAlert, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Permit } from "@/lib/types";
import type { EnrichmentResult } from "@/lib/enrich/types";
import { competingContractor, resolveTarget } from "@/lib/lead";

/**
 * Turns a permit into a contactable lead.
 *
 * The firm is whatever the permit named (owner first, contractor second). The
 * decision maker behind that firm is resolved on demand through the enrichment
 * waterfall, because every lookup costs a credit - we never enrich speculatively.
 */
export function LeadPanel({ permit }: { permit: Permit }) {
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The party we sell: the developer who controls the job, not whoever is
  // already building it.
  const target = resolveTarget(permit);
  const competitor = competingContractor(permit);
  const firm = target?.name ?? null;

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Post the whole permit: the client already has it, and it removes any
        // dependence on a server-side cache surviving between requests.
        body: JSON.stringify({ permit_id: permit.id, permit }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Enrichment failed (${res.status})`);
      setResult(body as EnrichmentResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background-secondary p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-background-subtle text-primary">
            <UserRound className="size-4" aria-hidden />
          </span>
          <span className="label-caps">Lead on this job</span>
        </div>
        {!result && (
          <Button size="sm" onClick={reveal} disabled={loading || !firm}>
            {loading ? <><Loader2 className="size-4 animate-spin" /> Resolving…</> : <><Lock className="size-3.5" /> Reveal decision maker</>}
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label-caps mb-1.5">
            {target?.role === "gc" ? "Contractor (job already placed)" : "Developer"}
          </p>
          {firm ? (
            <>
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Building2 className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
                {firm}
              </p>
              <p className="mt-1 text-[13px] text-foreground-secondary">{target?.reason}</p>
            </>
          ) : (
            <p className="text-sm text-foreground-muted">
              This jurisdiction did not name a party on the permit.
            </p>
          )}

          {competitor ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning-border bg-warning-light px-2.5 py-1.5 text-[13px] text-warning-text">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span><strong>{competitor}</strong> is already the contractor of record. This job is placed.</span>
            </p>
          ) : firm ? (
            <p className="mt-2 rounded-lg border border-success/25 bg-success-light px-2.5 py-1.5 text-[13px] text-success-text">
              No contractor of record yet - the trade package is still open.
            </p>
          ) : null}
        </div>

        <div>
          <p className="label-caps mb-1.5">Decision maker</p>
          {!result && !error && (
            <p className="text-sm text-foreground-muted">
              {firm ? "Hidden until revealed." : "Needs a named firm to resolve."}
            </p>
          )}
          {error && (
            <p className="flex items-start gap-1.5 text-sm text-error-text">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          {result && <ContactCard result={result} />}
        </div>
      </div>

      {result?.contact && (
        <p className="mt-3 border-t border-border pt-3 text-[12px] text-foreground-muted">
          Resolved via {result.provider_chain.join(" → ")} · confidence {Math.round(result.confidence * 100)}%
        </p>
      )}
    </div>
  );
}

function ContactCard({ result }: { result: EnrichmentResult }) {
  const c = result.contact;
  if (!c) {
    return (
      <p className="text-sm text-foreground-secondary">
        No decision maker found for this firm.{" "}
        {result.notes.length > 0 && <span className="text-foreground-muted">{result.notes[0]}</span>}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-foreground">{c.full_name}</p>
      {c.title && <p className="text-[13px] text-foreground-secondary">{c.title}</p>}
      <div className="flex flex-col gap-1 pt-1">
        {c.work_email && <ContactLine icon={<Mail className="size-3.5" />} href={`mailto:${c.work_email}`} text={c.work_email} verified={c.email_status === "verified"} />}
        {c.personal_email && c.personal_email !== c.work_email && (
          <ContactLine icon={<Mail className="size-3.5" />} href={`mailto:${c.personal_email}`} text={c.personal_email} />
        )}
        {c.phone && <ContactLine icon={<Phone className="size-3.5" />} href={`tel:${c.phone}`} text={c.phone} />}
        {c.linkedin_url && <ContactLine icon={<Contact className="size-3.5" />} href={c.linkedin_url} text="LinkedIn profile" external />}
      </div>
    </div>
  );
}

function ContactLine({
  icon, href, text, verified = false, external = false,
}: { icon: React.ReactNode; href: string; text: string; verified?: boolean; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="group flex items-center gap-1.5 text-[13px] text-foreground-secondary hover:text-primary"
    >
      <span className="shrink-0 text-foreground-muted group-hover:text-primary">{icon}</span>
      <span className="truncate underline-offset-2 group-hover:underline">{text}</span>
      {verified && (
        <span className={cn("shrink-0 rounded-full border border-success/30 bg-success-light px-1.5 py-px text-[10px] font-semibold text-success-text")}>
          verified
        </span>
      )}
    </a>
  );
}
