import { Badge } from "@/components/ui/badge";
import { cn, humanizeTag } from "@/lib/utils";
import { tagPalette } from "@/lib/reference-data";
import type { PermitStatus } from "@/lib/types";

const STATUS_LABELS: Record<PermitStatus, string> = {
  final: "FINAL",
  active: "ACTIVE",
  in_review: "IN REVIEW",
  inactive: "INACTIVE",
  unknown: "—",
};

export function StatusBadge({ status }: { status: PermitStatus }) {
  if (status === "unknown") return <span className="text-foreground-muted">—</span>;
  return <Badge variant={status}>{STATUS_LABELS[status]}</Badge>;
}

const PALETTE_CLASSES = {
  energy: "bg-tag-energy-bg text-tag-energy-fg border-tag-energy-line",
  power: "bg-tag-power-bg text-tag-power-fg border-tag-power-line",
  trade: "bg-tag-trade-bg text-tag-trade-fg border-tag-trade-line",
  envelope: "bg-tag-envelope-bg text-tag-envelope-fg border-tag-envelope-line",
  stone: "bg-tag-stone-bg text-tag-stone-fg border-tag-stone-line",
} as const;

export function TagChip({ tag }: { tag: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap",
      PALETTE_CLASSES[tagPalette(tag)],
    )}>
      {humanizeTag(tag)}
    </span>
  );
}

/** Show the first tag plus a "+N" pill, as the reference table does. */
export function TagList({ tags, max = 1 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return <span className="text-foreground-muted">—</span>;
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  return (
    <div className="flex items-center gap-1.5">
      {shown.map((t) => <TagChip key={t} tag={t} />)}
      {extra > 0 && (
        <span className="inline-flex items-center rounded-full border border-border bg-background-subtle px-2 py-0.5 text-[12px] font-medium text-foreground-secondary">
          +{extra}
        </span>
      )}
    </div>
  );
}
