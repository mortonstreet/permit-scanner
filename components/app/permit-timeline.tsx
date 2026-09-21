import { CalendarDays } from "lucide-react";
import { cn, formatDateShort } from "@/lib/utils";
import { daysSincePosted, type Permit } from "@/lib/types";

/**
 * FILED -> ISSUED -> FINALIZED progress rail.
 *
 * A filled dot means the milestone happened; a hollow dot means it has not. The
 * pill over the first open gap shows how long the permit has been sitting there,
 * which is the number a contractor chasing the job actually cares about.
 */

interface Stage {
  key: "filed" | "issued" | "finalized";
  label: string;
  date: string | null;
}

export function PermitTimeline({ permit, compact = false }: { permit: Permit; compact?: boolean }) {
  const stages: Stage[] = [
    { key: "filed", label: "FILED", date: permit.file_date },
    { key: "issued", label: "ISSUED", date: permit.issue_date },
    { key: "finalized", label: "FINALIZED", date: permit.final_date },
  ];
  // The compact card in the results list stops at ISSUED.
  const visible = compact ? stages.slice(0, 2) : stages;

  const firstOpen = visible.findIndex((s) => !s.date);
  const ongoingDays = daysSincePosted(permit);

  return (
    <div className="rounded-xl border border-border bg-background-secondary p-4">
      <div className="mb-4 flex items-center gap-2">
        <CalendarDays className="size-4 text-foreground-muted" aria-hidden />
        <span className="label-caps">Permit timeline</span>
      </div>

      <div className="flex items-start justify-between gap-2">
        {visible.map((stage, i) => {
          const done = Boolean(stage.date);
          const isGapStart = i === firstOpen - 1 || (firstOpen === -1 && false);
          return (
            <div key={stage.key} className={cn("relative flex-1", i === visible.length - 1 && "flex-none")}>
              <p className={cn("mb-2 text-sm", done ? "text-foreground" : "text-foreground-muted")}>
                {done ? formatDateShort(stage.date) : "—"}
              </p>

              {isGapStart && ongoingDays != null && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-background-subtle px-2.5 py-1 text-[12px] font-medium text-foreground-secondary">
                  {ongoingDays} days ongoing
                </span>
              )}

              <div className="flex items-center">
                <span className={cn(
                  "size-2.5 shrink-0 rounded-full border-2",
                  done ? "border-primary bg-primary" : "border-border-hover bg-background-secondary",
                )} />
                {i < visible.length - 1 && (
                  <span className="mx-1 h-px flex-1 border-t-2 border-dashed border-border" />
                )}
              </div>

              <p className={cn(
                "mt-2 text-[11px] font-semibold tracking-wider",
                done ? "text-foreground-secondary" : "text-foreground-muted",
              )}>
                {stage.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
