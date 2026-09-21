"use client";

import { Download, X } from "lucide-react";
import type { SearchFilters } from "@/lib/filters";
import { activeFilterChips } from "@/lib/filters";

/** The chip row above the results, with per-chip clear and a CSV export. */
export function ActiveFilters({
  filters, onClear, onClearAll, onDownload, downloadDisabled,
}: {
  filters: SearchFilters;
  onClear: (key: string) => void;
  onClearAll: () => void;
  onDownload: () => void;
  downloadDisabled: boolean;
}) {
  const chips = activeFilterChips(filters);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-foreground-secondary">Active filters</span>
        {chips.length === 0 && <span className="text-sm text-foreground-muted">None</span>}
        {chips.map((chip) => (
          <span
            key={String(chip.key)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background-secondary py-1 pl-3 pr-2 text-[13px] text-foreground"
          >
            {chip.label}
            <button
              type="button"
              onClick={() => onClear(String(chip.key))}
              aria-label={`Remove filter ${chip.label}`}
              className="rounded-full p-0.5 text-foreground-muted transition-colors hover:bg-background-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {chips.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="ml-1 text-[13px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onDownload}
        disabled={downloadDisabled}
        className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3.5 py-2 text-sm text-foreground-secondary transition-colors hover:border-border-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="size-4" aria-hidden />
        Download CSV
      </button>
    </div>
  );
}
