"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { BRAND, BRAND_TITLE } from "@/lib/brand";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Call list" },
  { href: "/search", label: "Permit search" },
];

/** Global header: wordmark, primary nav, account. */
export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-5">
      <div className="flex items-center gap-7">
        <Link href="/" className="flex items-center gap-2" aria-label={`${BRAND_TITLE} home`}>
          <span className="flex size-7 items-center justify-center rounded-md bg-primary">
            <ShovelMark />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-primary">
            {BRAND.word}<span className="text-accent">{BRAND.accent}</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-background-selected font-semibold text-primary"
                    : "text-foreground-secondary hover:bg-background-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground-secondary transition-colors hover:bg-background-muted hover:text-foreground"
      >
        <Settings className="size-4" aria-hidden />
        Account
      </button>
    </header>
  );
}

function ShovelMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
      <path d="M8 1.5v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-accent" />
      <path d="M5.5 8.5h5l-.7 4a1.8 1.8 0 0 1-1.8 1.5h-.0a1.8 1.8 0 0 1-1.8-1.5l-.7-4Z"
        fill="currentColor" className="text-white" />
      <path d="M6.4 1.5h3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-accent" />
    </svg>
  );
}
