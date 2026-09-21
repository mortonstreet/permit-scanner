"use client";

import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { cn, formatUsd } from "@/lib/utils";
import type { Permit } from "@/lib/types";

/**
 * Lightweight pin map.
 *
 * Plots geocoded permits on an equirectangular projection of their own bounding
 * box. No tile provider and no token required, which keeps the app working out
 * of the box; swap in Mapbox GL here if basemap imagery becomes necessary.
 */
export function PermitMap({
  permits, onSelect, selectedId,
}: { permits: Permit[]; onSelect?: (permit: Permit) => void; selectedId?: string | null }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const located = useMemo(
    () => permits.filter((p) => p.latitude != null && p.longitude != null),
    [permits],
  );

  const bounds = useMemo(() => {
    if (located.length === 0) return null;
    const lats = located.map((p) => p.latitude as number);
    const lngs = located.map((p) => p.longitude as number);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    // Pad so pins never sit flush against the panel edge.
    const padLat = Math.max((maxLat - minLat) * 0.15, 0.02);
    const padLng = Math.max((maxLng - minLng) * 0.15, 0.02);
    return {
      minLat: minLat - padLat, maxLat: maxLat + padLat,
      minLng: minLng - padLng, maxLng: maxLng + padLng,
    };
  }, [located]);

  function project(permit: Permit): { left: string; top: string } {
    if (!bounds) return { left: "50%", top: "50%" };
    const x = ((permit.longitude as number) - bounds.minLng) / (bounds.maxLng - bounds.minLng);
    // Latitude increases northward but CSS top increases downward.
    const y = 1 - ((permit.latitude as number) - bounds.minLat) / (bounds.maxLat - bounds.minLat);
    return { left: `${x * 100}%`, top: `${y * 100}%` };
  }

  return (
    <section
      id="search-results-map"
      aria-label="Permit map"
      className="flex h-full w-full flex-col border-l border-border bg-background-panel"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Permit map</h3>
          <p className="text-[13px] text-foreground-secondary">Explore matching permits on the map.</p>
        </div>
        <span className="shrink-0 rounded-full bg-background-subtle px-2.5 py-1 text-[12px] font-medium text-foreground-secondary">
          {located.length} {located.length === 1 ? "pin" : "pins"}
        </span>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {/* Subtle grid so the plot reads as a map surface rather than empty space. */}
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-border-soft) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-soft) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />

        {located.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
            <p className="text-sm text-foreground-secondary">
              None of these permits include map coordinates.
            </p>
          </div>
        ) : (
          located.map((permit) => {
            const pos = project(permit);
            const isActive = selectedId === permit.id || hovered === permit.id;
            return (
              <button
                key={permit.id}
                type="button"
                onClick={() => onSelect?.(permit)}
                onMouseEnter={() => setHovered(permit.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ left: pos.left, top: pos.top }}
                aria-label={`${permit.address ?? "Permit"} ${permit.geo.city ?? ""}`}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-full transition-transform",
                  isActive ? "z-20 scale-110" : "z-10 hover:scale-110",
                )}
              >
                <MapPin
                  className={cn("size-6 drop-shadow-sm", isActive ? "text-primary-dark" : "text-primary")}
                  fill="currentColor"
                  strokeWidth={1}
                />
                {isActive && (
                  <span className="absolute left-1/2 top-full z-30 w-52 -translate-x-1/2 translate-y-1 rounded-lg border border-border bg-background-secondary p-2.5 text-left shadow-lg">
                    <span className="block truncate text-[13px] font-semibold text-foreground">
                      {permit.address ?? permit.geo.city ?? "Permit"}
                    </span>
                    <span className="block truncate text-[12px] text-foreground-secondary">
                      {[permit.geo.city, permit.geo.state].filter(Boolean).join(", ")}
                    </span>
                    {permit.job_value != null && (
                      <span className="mt-0.5 block text-[12px] font-medium text-primary">
                        {formatUsd(permit.job_value)}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
