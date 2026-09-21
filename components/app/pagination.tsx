"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({
  page, size, total, isEstimate, onPage,
}: { page: number; size: number; total: number; isEstimate: boolean; onPage: (page: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(total / size));
  const first = (page - 1) * size + 1;
  const last = Math.min(page * size, total);

  return (
    <nav className="mt-4 flex items-center justify-between gap-4" aria-label="Results pages">
      <p className="text-[13px] text-foreground-secondary">
        {first.toLocaleString()}–{last.toLocaleString()} of {isEstimate && "at least "}
        {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1">
        <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Previous page">
          <ChevronLeft className="size-4" />
        </PageButton>
        <span className="px-3 text-[13px] text-foreground-secondary">
          Page {page} of {lastPage.toLocaleString()}
        </span>
        <PageButton disabled={page >= lastPage} onClick={() => onPage(page + 1)} label="Next page">
          <ChevronRight className="size-4" />
        </PageButton>
      </div>
    </nav>
  );
}

function PageButton({
  disabled, onClick, label, children,
}: { disabled: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg border border-border bg-background-secondary transition-colors",
        disabled ? "cursor-not-allowed text-foreground-tertiary" : "text-foreground-secondary hover:border-border-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
