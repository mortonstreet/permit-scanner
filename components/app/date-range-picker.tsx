"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, formatDate, isoDaysAgo, todayIso } from "@/lib/utils";

/**
 * Two-month range calendar matching the reference app: click a start date, then
 * an end date, then Apply. Escape/Cancel discards the in-progress selection.
 */

interface DateRangePickerProps {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
];

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<string | null>(from);
  const [draftTo, setDraftTo] = useState<string | null>(to);
  const [cursor, setCursor] = useState(() => startOfMonth(from ?? todayIso()));

  // Re-seed the draft whenever the popover opens so a cancelled edit is discarded.
  useEffect(() => {
    if (open) {
      setDraftFrom(from);
      setDraftTo(to);
      setCursor(startOfMonth(from ?? todayIso()));
    }
  }, [open, from, to]);

  const label = from && to ? `${formatDate(from)} – ${formatDate(to)}`
    : from ? `After ${formatDate(from)}`
    : to ? `Before ${formatDate(to)}`
    : "Any dates";

  function pick(iso: string) {
    // First click, or restarting after a complete range, sets the start.
    if (!draftFrom || (draftFrom && draftTo)) { setDraftFrom(iso); setDraftTo(null); return; }
    if (iso < draftFrom) { setDraftFrom(iso); return; }
    setDraftTo(iso);
  }

  function apply() {
    onChange(draftFrom, draftTo ?? draftFrom);
    setOpen(false);
  }

  function applyPreset(days: number) {
    const f = isoDaysAgo(days);
    const t = todayIso();
    setDraftFrom(f); setDraftTo(t);
    onChange(f, t);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Issued date range: ${label}`}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 text-sm",
            "transition-colors hover:border-border-hover outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-primary/20",
          )}
        >
          <Calendar className="size-4 shrink-0 text-foreground-muted" aria-hidden />
          <span className={cn("truncate", from || to ? "text-foreground" : "text-foreground-muted")}>{label}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0">
        <div className="flex">
          <div className="w-40 shrink-0 border-r border-border p-2">
            <p className="label-caps px-2 py-1.5">Presets</p>
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => applyPreset(p.days)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] text-foreground-secondary hover:bg-background-hover hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <button
                type="button" aria-label="Previous month"
                onClick={() => setCursor(addMonths(cursor, -1))}
                className="rounded-md p-1 text-foreground-secondary hover:bg-background-hover"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div className="flex gap-12 text-sm font-semibold">
                <span>{monthLabel(cursor)}</span>
                <span>{monthLabel(addMonths(cursor, 1))}</span>
              </div>
              <button
                type="button" aria-label="Next month"
                onClick={() => setCursor(addMonths(cursor, 1))}
                className="rounded-md p-1 text-foreground-secondary hover:bg-background-hover"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="flex gap-4">
              <MonthGrid month={cursor} from={draftFrom} to={draftTo} onPick={pick} />
              <MonthGrid month={addMonths(cursor, 1)} from={draftFrom} to={draftTo} onPick={pick} />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-xs text-foreground-muted">
                {draftFrom ? formatDate(draftFrom) : "Start"} – {draftTo ? formatDate(draftTo) : "End"}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={apply} disabled={!draftFrom}>Apply</Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthGrid({
  month, from, to, onPick,
}: { month: string; from: string | null; to: string | null; onPick: (iso: string) => void }) {
  const days = useMemo(() => monthDays(month), [month]);
  const today = todayIso();
  const leading = new Date(`${month}T00:00:00Z`).getUTCDay();

  return (
    <div className="w-[196px]">
      <div className="mb-1 grid grid-cols-7 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="text-[11px] font-semibold text-foreground-muted">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: leading }, (_, i) => <span key={`pad-${i}`} />)}
        {days.map((iso) => {
          const inRange = Boolean(from && to && iso > from && iso < to);
          const isStart = iso === from;
          const isEnd = iso === to;
          const isFuture = iso > today;
          return (
            <button
              key={iso}
              type="button"
              disabled={isFuture}
              onClick={() => onPick(iso)}
              aria-label={new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
                weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
              })}
              className={cn(
                "mx-auto flex size-7 items-center justify-center rounded-md text-[13px] transition-colors",
                isFuture && "cursor-not-allowed text-foreground-tertiary",
                !isFuture && !isStart && !isEnd && !inRange && "text-foreground-secondary hover:bg-background-hover",
                inRange && "bg-background-selected text-primary",
                (isStart || isEnd) && "bg-primary font-semibold text-foreground-inverted",
                iso === today && !isStart && !isEnd && "ring-1 ring-border-hover",
              )}
            >
              {Number(iso.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- date plumbing (UTC) */

function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function addMonths(iso: string, delta: number): string {
  const d = new Date(`${startOfMonth(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthDays(iso: string): string[] {
  const start = new Date(`${startOfMonth(iso)}T00:00:00Z`);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}
