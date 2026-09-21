"use client";

import { useState } from "react";
import { Minus, Plus, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONTRACTOR_CLASSIFICATIONS, PERMIT_CATEGORIES, PERMIT_STATUSES,
  PROPERTY_TYPES, US_STATES, stateName,
} from "@/lib/reference-data";
import type { CoverageReport } from "@/lib/coverage";
import { cn } from "@/lib/utils";
import type { Draft } from "@/lib/use-search-state";
import { DateRangePicker } from "./date-range-picker";

/** Which geography input the LOCATION chip row is currently showing. */
type LocationMode = "city" | "zipcode" | "county" | "state" | "address";

const LOCATION_MODES: Array<{ mode: LocationMode; label: string }> = [
  { mode: "city", label: "City" },
  { mode: "zipcode", label: "Zip Code" },
  { mode: "county", label: "County" },
  { mode: "state", label: "State" },
  { mode: "address", label: "Address" },
];

interface FilterRailProps {
  draft: Draft;
  setField: (key: string, value: string | null) => void;
  onSearch: () => void;
  onReset: () => void;
  coverage: CoverageReport | null;
}

export function FilterRail({ draft, setField, onSearch, onReset, coverage }: FilterRailProps) {
  const initialMode: LocationMode =
    draft.geo_city ? "city" : draft.geo_zipcode ? "zipcode" : draft.geo_county ? "county" : "state";
  const [locationMode, setLocationMode] = useState<LocationMode>(initialMode);

  /** Switching geography scope clears the others so only one is ever active. */
  function selectLocationMode(mode: LocationMode) {
    setLocationMode(mode);
    for (const key of ["geo_city", "geo_zipcode", "geo_county", "geo_address"]) {
      if (key !== `geo_${mode}`) setField(key, null);
    }
    if (mode !== "state") setField("geo_state_label", null);
  }

  return (
    <aside className="flex h-full w-[302px] shrink-0 flex-col border-r border-border bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="label-caps text-[13px] tracking-wider">Filter by</h2>
        <SlidersHorizontal className="size-4 text-foreground-muted" aria-hidden />
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-5">
        <Accordion type="multiple" defaultValue={["search-in", "date-range"]}>
          {/* ---------------------------------------------------------- SEARCH IN */}
          <AccordionItem value="search-in">
            <AccordionTrigger>Search in</AccordionTrigger>
            <AccordionContent className="space-y-5">
              <Field label="Location">
                <div className="flex flex-wrap gap-2">
                  {LOCATION_MODES.map(({ mode, label }) => (
                    <Chip key={mode} selected={locationMode === mode} onClick={() => selectLocationMode(mode)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Authority">
                <div className="flex flex-wrap gap-2">
                  <Chip
                    selected={Boolean(draft.geo_jurisdiction)}
                    onClick={() => setField("geo_jurisdiction", draft.geo_jurisdiction ? null : "")}
                  >
                    Jurisdiction
                  </Chip>
                </div>
                {draft.geo_jurisdiction !== undefined && (
                  <Input
                    className="mt-2"
                    placeholder="Jurisdiction name"
                    value={draft.geo_jurisdiction ?? ""}
                    onChange={(e) => setField("geo_jurisdiction", e.target.value)}
                  />
                )}
              </Field>

              {locationMode === "state" && (
                <Field label="State">
                  <Select
                    value={draft.geo_state ?? ""}
                    onValueChange={(value) => {
                      setField("geo_state", value);
                      setField("geo_state_label", stateName(value) ?? value);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a state..." /></SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-[13px] leading-snug text-foreground-secondary">
                    Narrow to a county or city for more accurate field coverage.
                  </p>
                </Field>
              )}

              {locationMode === "county" && (
                <Field label="County">
                  <Input
                    placeholder="County name"
                    value={draft.geo_county ?? ""}
                    onChange={(e) => { setField("geo_county", e.target.value); setField("geo_county_label", e.target.value); }}
                  />
                </Field>
              )}

              {locationMode === "city" && (
                <Field label="City">
                  <Input
                    placeholder="City name"
                    value={draft.geo_city ?? ""}
                    onChange={(e) => { setField("geo_city", e.target.value); setField("geo_city_label", e.target.value); }}
                  />
                </Field>
              )}

              {locationMode === "zipcode" && (
                <Field label="Zip code">
                  <Input
                    placeholder="5-digit ZIP"
                    inputMode="numeric"
                    maxLength={5}
                    value={draft.geo_zipcode ?? ""}
                    onChange={(e) => setField("geo_zipcode", e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              )}

              {locationMode === "address" && (
                <Field label="Address">
                  <Input
                    placeholder="Street address"
                    value={draft.geo_address ?? ""}
                    onChange={(e) => setField("geo_address", e.target.value)}
                  />
                </Field>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* --------------------------------------------------------- DATE RANGE */}
          <AccordionItem value="date-range">
            <AccordionTrigger>Date range</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <Field label="Issued" coverage={coverage?.fields.issue_date}>
                <DateRangePicker
                  from={draft.permit_from ?? null}
                  to={draft.permit_to ?? null}
                  onChange={(from, to) => { setField("permit_from", from); setField("permit_to", to); }}
                />
              </Field>
              <p className="text-[13px] leading-snug text-foreground-secondary">
                Free searches are limited to the last 12 months.{" "}
                <a href="#upgrade" className="font-semibold text-primary underline-offset-2 hover:underline">Upgrade</a>{" "}
                for full history.
              </p>
            </AccordionContent>
          </AccordionItem>

          {/* ------------------------------------------------------------ PERMITS */}
          <AccordionItem value="permits">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                Permits
                {hasAny(draft, ["permit_q", "permit_tags", "permit_tags_exclude", "permit_status"]) && <Dot />}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5">
              <Field label="Description keywords" coverage={coverage?.fields.description}>
                <Input
                  placeholder="Description"
                  value={draft.permit_q ?? ""}
                  onChange={(e) => setField("permit_q", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
                />
              </Field>

              <Field label="Included categories" coverage={coverage?.fields.tags}>
                <CategoryPicker
                  icon="include"
                  placeholder="Include categories..."
                  value={csvToList(draft.permit_tags)}
                  onChange={(list) => setField("permit_tags", list.join(",") || null)}
                />
              </Field>

              <Field label="Excluded categories" coverage={coverage?.fields.tags}>
                <CategoryPicker
                  icon="exclude"
                  placeholder="Exclude categories..."
                  value={csvToList(draft.permit_tags_exclude)}
                  onChange={(list) => setField("permit_tags_exclude", list.join(",") || null)}
                />
              </Field>

              <Field label="Status">
                <div className="flex flex-wrap gap-2">
                  {PERMIT_STATUSES.map((s) => {
                    const selected = csvToList(draft.permit_status).includes(s.value);
                    return (
                      <Chip
                        key={s.value}
                        selected={selected}
                        onClick={() => setField("permit_status", toggleCsv(draft.permit_status, s.value))}
                      >
                        {s.label}
                      </Chip>
                    );
                  })}
                </div>
              </Field>
            </AccordionContent>
          </AccordionItem>

          {/* -------------------------------------------------------- CONTRACTORS */}
          <AccordionItem value="contractors">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                Contractors
                {hasAny(draft, ["contractor_name", "contractor_website", "contractor_class"]) && <Dot />}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5">
              <Field label="Classification">
                <Select value={draft.contractor_class ?? ""} onValueChange={(v) => setField("contractor_class", v)}>
                  <SelectTrigger><SelectValue placeholder="Select classification..." /></SelectTrigger>
                  <SelectContent>
                    {CONTRACTOR_CLASSIFICATIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Company name">
                <Input placeholder="Enter name" value={draft.contractor_name ?? ""} onChange={(e) => setField("contractor_name", e.target.value)} />
              </Field>
              <Field label="Company website">
                <Input placeholder="example.com" value={draft.contractor_website ?? ""} onChange={(e) => setField("contractor_website", e.target.value)} />
              </Field>
            </AccordionContent>
          </AccordionItem>

          {/* ----------------------------------------------------------- BUILDING */}
          <AccordionItem value="building">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                Building
                {hasAny(draft, ["property_type", "property_min_unit_count", "property_min_year_built", "property_min_building_area"]) && <Dot />}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5">
              <Field label="Property type" coverage={coverage?.fields.property_type}>
                <div className="flex flex-wrap gap-2">
                  {PROPERTY_TYPES.map((t) => (
                    <Chip
                      key={t.value}
                      selected={csvToList(draft.property_type).includes(t.value)}
                      onClick={() => setField("property_type", toggleCsv(draft.property_type, t.value))}
                    >
                      {t.label}
                    </Chip>
                  ))}
                </div>
              </Field>
              <RangeField
                label="Units" minKey="property_min_unit_count" maxKey="property_max_unit_count"
                draft={draft} setField={setField}
              />
              <RangeField
                label="Year built" minKey="property_min_year_built" maxKey="property_max_year_built"
                draft={draft} setField={setField} placeholderMin="1900" placeholderMax="2026"
              />
              <RangeField
                label="Building area (sq ft)" minKey="property_min_building_area" maxKey="property_max_building_area"
                draft={draft} setField={setField}
              />
            </AccordionContent>
          </AccordionItem>

          {/* ---------------------------------------------------------- FINANCIAL */}
          <AccordionItem value="financial">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                Financial
                {hasAny(draft, ["permit_min_job_value", "permit_max_job_value", "permit_min_fees", "property_min_market_value"]) && <Dot />}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5">
              <RangeField
                label="Job value ($)" minKey="permit_min_job_value" maxKey="permit_max_job_value"
                draft={draft} setField={setField} coverage={coverage?.fields.job_value}
                placeholderMin="0" placeholderMax="Any"
              />
              <Field label="Minimum fees ($)" coverage={coverage?.fields.fees}>
                <Input
                  inputMode="numeric" placeholder="0"
                  value={draft.permit_min_fees ?? ""}
                  onChange={(e) => setField("permit_min_fees", e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <RangeField
                label="Market value ($)" minKey="property_min_market_value" maxKey="property_max_market_value"
                draft={draft} setField={setField}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="py-4 text-right">
          <button type="button" className="text-[13px] text-foreground-muted hover:text-foreground-secondary">
            Show tutorial
          </button>
        </div>
      </div>

      <footer className="grid grid-cols-[1fr_1.6fr] gap-3 border-t border-border bg-background px-5 py-4">
        <Button variant="outline" onClick={onReset}>Reset</Button>
        <Button onClick={onSearch}>Search</Button>
      </footer>
    </aside>
  );
}

/* ------------------------------------------------------------------ helpers */

function Field({
  label, coverage, children,
}: { label: string; coverage?: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label-caps">{label}</span>
        {coverage !== undefined && <CoverageChip pct={coverage} />}
      </div>
      {children}
    </div>
  );
}

/**
 * The amber "⚠ 36%" pill. Jurisdictions report fields inconsistently, so we show
 * how many records in the current scope actually populate this field rather than
 * letting a filter silently hide most of the data.
 */
function CoverageChip({ pct }: { pct: number }) {
  const rounded = Math.round(pct * 100);
  const missing = 100 - rounded;
  const tone =
    rounded >= 90 ? "border-border bg-background-subtle text-foreground-secondary"
      : "border-warning-border bg-warning-light text-warning-text";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tone)}>
          {rounded < 90 && <TriangleAlert className="size-3" aria-hidden />}
          {rounded}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {rounded}% of permits in this area report this field. Filtering on it may hide up to ~{missing}% of results.
      </TooltipContent>
    </Tooltip>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/30",
        selected
          ? "border-primary bg-primary text-foreground-inverted"
          : "border-border bg-background-secondary text-foreground-secondary hover:border-border-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Dot() {
  return <span className="size-1.5 rounded-full bg-accent" aria-label="filter active" />;
}

function RangeField({
  label, minKey, maxKey, draft, setField, coverage, placeholderMin = "Min", placeholderMax = "Max",
}: {
  label: string; minKey: string; maxKey: string; draft: Draft;
  setField: (k: string, v: string | null) => void; coverage?: number;
  placeholderMin?: string; placeholderMax?: string;
}) {
  return (
    <Field label={label} coverage={coverage}>
      <div className="flex items-center gap-2">
        <Input
          inputMode="numeric" placeholder={placeholderMin}
          value={draft[minKey] ?? ""}
          onChange={(e) => setField(minKey, e.target.value.replace(/\D/g, ""))}
        />
        <span className="text-foreground-muted">–</span>
        <Input
          inputMode="numeric" placeholder={placeholderMax}
          value={draft[maxKey] ?? ""}
          onChange={(e) => setField(maxKey, e.target.value.replace(/\D/g, ""))}
        />
      </div>
    </Field>
  );
}

function CategoryPicker({
  icon, placeholder, value, onChange,
}: { icon: "include" | "exclude"; placeholder: string; value: string[]; onChange: (list: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const groups = [...new Set(PERMIT_CATEGORIES.map((c) => c.group))];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 text-sm",
            "transition-colors hover:border-border-hover outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-primary/20",
          )}
        >
          {icon === "include"
            ? <Plus className="size-4 shrink-0 text-primary" aria-hidden />
            : <Minus className="size-4 shrink-0 text-error" aria-hidden />}
          <span className={cn("truncate", value.length ? "text-foreground" : "text-foreground-muted")}>
            {value.length ? `${value.length} selected` : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-80 w-[262px] overflow-y-auto scrollbar-thin p-2">
        {groups.map((group) => (
          <div key={group} className="mb-2 last:mb-0">
            <p className="label-caps px-2 py-1">{group}</p>
            {PERMIT_CATEGORIES.filter((c) => c.group === group).map((cat) => (
              <label
                key={cat.value}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-background-hover"
              >
                <Checkbox
                  checked={value.includes(cat.value)}
                  onCheckedChange={(checked) =>
                    onChange(checked ? [...value, cat.value] : value.filter((v) => v !== cat.value))
                  }
                />
                {cat.label}
              </label>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function csvToList(raw: string | undefined): string[] {
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function toggleCsv(raw: string | undefined, value: string): string | null {
  const list = csvToList(raw);
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return next.length ? next.join(",") : null;
}

function hasAny(draft: Draft, keys: string[]): boolean {
  return keys.some((k) => draft[k] != null && draft[k] !== "");
}
