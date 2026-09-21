"use client";

import { Bot, CircleHelp, List, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Permits / Contractors / Properties switcher plus the view controls.
 * Counts show a dash until a search has returned, matching the reference app.
 */

export type ResultTab = "permits" | "contractors" | "properties";

interface ResultsTabsProps {
  tab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
  counts: Partial<Record<ResultTab, number | null>>;
  mapOpen: boolean;
  onToggleMap: () => void;
}

const TABS: Array<{ id: ResultTab; label: string }> = [
  { id: "permits", label: "Permits" },
  { id: "contractors", label: "Contractors" },
  { id: "properties", label: "Properties" },
];

export function ResultsTabs({ tab, onTabChange, counts, mapOpen, onToggleMap }: ResultsTabsProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-5">
      <div role="tablist" aria-label="Result type" className="flex items-center gap-1">
        {TABS.map(({ id, label }) => {
          const selected = tab === id;
          const count = counts[id];
          return (
            <button
              key={id}
              role="tab"
              aria-selected={selected}
              onClick={() => onTabChange(id)}
              className={cn(
                "relative flex items-center gap-2 px-3 py-3.5 text-[15px] transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-primary/20 rounded-t-md",
                selected ? "font-semibold text-primary" : "text-foreground-secondary hover:text-foreground",
              )}
            >
              {label}
              <span
                data-testid={`search-results-tab-${id}-count`}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[12px] font-medium",
                  selected ? "bg-background-selected text-primary" : "bg-background-subtle text-foreground-muted",
                )}
              >
                {count == null ? "—" : formatCount(count)}
              </span>
              {selected && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <ToolButton icon={<CircleHelp className="size-4" />} label="Help" />
        <ToolButton
          icon={mapOpen ? <List className="size-4" /> : <MapIcon className="size-4" />}
          label={mapOpen ? "Hide map" : "Show map"}
          onClick={onToggleMap}
        />
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-foreground-inverted transition-colors hover:bg-primary-hover"
        >
          <Bot className="size-4" aria-hidden />
          Agent
        </button>
      </div>
    </div>
  );
}

function ToolButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3.5 py-2 text-sm text-foreground-secondary transition-colors hover:border-border-hover hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  );
}

/** 10,000+ rather than an exact number once we hit the counting ceiling. */
function formatCount(n: number): string {
  if (n >= 10_000) return "10,000+";
  return n.toLocaleString("en-US");
}
