"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copy-to-clipboard button.
 *
 * Falls back to a hidden textarea + execCommand because the async clipboard
 * API is unavailable on insecure origins, which includes plain-HTTP localhost
 * setups and some embedded browsers.
 */
export function CopyButton({
  value, label = "Copy", className,
}: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
    } catch {
      // A failed copy should not throw into the render tree; the icon simply
      // does not change, which is honest feedback that nothing was copied.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
        copied
          ? "text-success"
          : "text-foreground-muted hover:bg-background-muted hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
