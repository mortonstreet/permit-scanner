"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import { CopyButton } from "./copy-button";

/**
 * The raw record exactly as the jurisdiction published it.
 *
 * Kept verbatim on purpose: when our normalization gets something wrong, this
 * is where a user checks. URLs are rendered as real links with a copy button,
 * because several feeds put an Accela deep link here and it is the fastest
 * route to the authoritative record.
 */

const URL_PATTERN = /^https?:\/\//i;

function isUrl(value: unknown): value is string {
  return typeof value === "string" && URL_PATTERN.test(value.trim());
}

/** Turn SCREAMING_SNAKE and snake_case column names into something readable. */
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toUpperCase();
}

export function SourceFields({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return null;

  // Links last: they are the widest values and would otherwise break the grid.
  const scalars = entries.filter(([, v]) => !isUrl(v));
  const links = entries.filter(([, v]) => isUrl(v));

  return (
    <details className="group rounded-xl border border-border bg-background-secondary">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 text-sm text-foreground-secondary transition-colors hover:text-foreground">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        View all source fields
        <span className="text-foreground-muted">({entries.length})</span>
      </summary>

      <div className="space-y-4 border-t border-border px-4 py-3.5">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {scalars.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[11px] font-semibold tracking-wide text-foreground-muted">
                {humanizeKey(key)}
              </dt>
              <dd className="break-words font-mono text-[13px] text-foreground">{String(value)}</dd>
            </div>
          ))}
        </dl>

        {links.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            {links.map(([key, value]) => {
              const href = String(value).trim();
              return (
                <div key={key} className="min-w-0">
                  <dt className="mb-1 text-[11px] font-semibold tracking-wide text-foreground-muted">
                    {humanizeKey(key)}
                  </dt>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] text-primary transition-colors hover:border-border-hover hover:bg-background-hover"
                    >
                      <span className="truncate">{href}</span>
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    </a>
                    <CopyButton value={href} label={`Copy ${humanizeKey(key)}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}
