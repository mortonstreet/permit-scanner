"use client";

import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import type { CoverageWarning } from "@/lib/coverage";

/**
 * The amber banner warning that the current filters lean on fields this area
 * reports inconsistently - the difference between "no permits match" and "this
 * county just doesn't fill in job value".
 */
export function CoverageBanner({
  warnings, scopeLabel, extraNotes,
}: { warnings: CoverageWarning[]; scopeLabel: string; extraNotes: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (warnings.length === 0 && extraNotes.length === 0)) return null;

  return (
    <div className="mx-5 mt-4 rounded-xl border border-warning-border bg-warning-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          {warnings.length > 0 && (
            <>
              <p className="text-sm font-semibold text-foreground">
                Limited coverage for your filters in {scopeLabel}
              </p>
              <ul className="mt-1.5 space-y-1">
                {warnings.map((w) => (
                  <li key={w.field} className="text-[13px] text-foreground-secondary">
                    <span className="font-medium text-foreground">{w.label}</span> — {w.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {extraNotes.length > 0 && (
            <ul className={warnings.length > 0 ? "mt-2 space-y-1" : "space-y-1"}>
              {extraNotes.map((note) => (
                <li key={note} className="text-[13px] text-foreground-secondary">{note}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss coverage warning"
          className="rounded-md p-1 text-foreground-muted transition-colors hover:bg-background-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
