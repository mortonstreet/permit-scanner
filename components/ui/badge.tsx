import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-border bg-background-subtle text-foreground-secondary",
        final: "border-transparent bg-status-final text-foreground-inverted",
        active: "border-transparent bg-status-active-light text-status-active-text",
        in_review: "border-transparent bg-status-review-light text-status-review-text",
        inactive: "border-status-inactive-border bg-status-inactive-light text-status-inactive-text",
        unknown: "border-status-unknown-border bg-status-unknown-light text-status-unknown-text",
        count: "border-transparent bg-background-subtle text-foreground-secondary font-medium",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
