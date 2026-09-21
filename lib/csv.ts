import type { Permit } from "./types";
import { daysSincePosted } from "./types";

/**
 * CSV export.
 *
 * Column order follows how a contractor actually reads a lead: where the job is,
 * who is behind it, what it is worth, and how stale the signal already is.
 */

const COLUMNS: Array<[header: string, get: (p: Permit) => string | number | null]> = [
  ["Permit Number", (p) => p.permit_number],
  ["Status", (p) => p.status],
  ["Address", (p) => p.address],
  ["City", (p) => p.geo.city],
  ["County", (p) => p.geo.county],
  ["State", (p) => p.geo.state],
  ["Zip", (p) => p.geo.zipcode],
  ["Jurisdiction", (p) => p.geo.jurisdiction],
  ["Permit Type", (p) => p.permit_type],
  ["Tags", (p) => p.tags.join("; ")],
  ["Description", (p) => p.description],
  ["Firm", (p) => p.owner?.company ?? p.contractor?.company ?? null],
  ["Contractor", (p) => p.contractor?.company ?? p.contractor?.name ?? null],
  ["Contractor License", (p) => p.contractor?.license ?? null],
  ["Contractor Phone", (p) => p.contractor?.phone ?? null],
  ["Owner", (p) => p.owner?.company ?? p.owner?.name ?? null],
  ["Job Value", (p) => p.job_value],
  ["Fees", (p) => p.fees],
  ["Property Type", (p) => p.property.property_type],
  ["Units", (p) => p.property.units],
  ["Year Built", (p) => p.property.year_built],
  ["Filed", (p) => p.file_date],
  ["Issued", (p) => p.issue_date],
  ["Finalized", (p) => p.final_date],
  ["Days Since Posted", (p) => daysSincePosted(p)],
  ["Latitude", (p) => p.latitude],
  ["Longitude", (p) => p.longitude],
  ["Source", (p) => p.source_id],
];

/** RFC-4180 escaping: quote when the value contains a comma, quote or newline. */
function escapeCell(value: string | number | null): string {
  if (value == null) return "";
  const s = String(value);
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(permits: Permit[]): string {
  const header = COLUMNS.map(([name]) => escapeCell(name)).join(",");
  const rows = permits.map((p) => COLUMNS.map(([, get]) => escapeCell(get(p))).join(","));
  return [header, ...rows].join("\r\n");
}

/** Trigger a browser download without a round trip to the server. */
export function downloadCsv(csv: string, filename: string): void {
  // The BOM keeps Excel from mangling UTF-8 addresses.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
