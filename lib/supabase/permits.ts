import "server-only";
import type { Permit } from "../types";
import type { SourceDescriptor } from "../sources/types";
import { getSupabase } from "./client";

/** Row shape matching the `permits` table; `firm_name` is generated in Postgres. */
function toRow(permit: Permit) {
  return {
    id: permit.id,
    source_id: permit.source_id,
    permit_number: permit.permit_number,
    status: permit.status,
    status_raw: permit.status_raw,
    description: permit.description,
    permit_type: permit.permit_type,
    tags: permit.tags,
    address: permit.address,
    state: permit.geo.state,
    county: permit.geo.county,
    city: permit.geo.city,
    zipcode: permit.geo.zipcode,
    jurisdiction: permit.geo.jurisdiction,
    latitude: permit.latitude,
    longitude: permit.longitude,
    job_value: permit.job_value,
    fees: permit.fees,
    total_cost: permit.total_cost,
    file_date: permit.file_date,
    issue_date: permit.issue_date,
    final_date: permit.final_date,
    contractor: permit.contractor,
    owner: permit.owner,
    contractor_unassigned: permit.contractor_unassigned,
    property: permit.property,
    source_fields: permit.source_fields,
  };
}

export async function registerSource(descriptor: SourceDescriptor, archival: boolean): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from("sources").upsert({
    id: descriptor.id,
    label: descriptor.label,
    platform: descriptor.platform,
    state: descriptor.state,
    county: descriptor.county ?? null,
    city: descriptor.city ?? null,
    jurisdiction: descriptor.jurisdiction,
    cadence: descriptor.cadence,
    archival,
    notes: descriptor.notes ?? null,
  }, { onConflict: "id" });
}

/**
 * Upsert a batch of permits. Chunked because Postgres statement size and the
 * PostgREST payload limit both bite well before a full ingestion run finishes.
 */
export async function upsertPermits(permits: Permit[], chunkSize = 500): Promise<number> {
  const db = getSupabase();
  if (!db || permits.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < permits.length; i += chunkSize) {
    const chunk = permits.slice(i, i + chunkSize).map(toRow);
    const { error, count } = await db
      .from("permits")
      .upsert(chunk, { onConflict: "id", count: "exact" });
    if (error) throw new Error(`permit upsert failed: ${error.message}`);
    written += count ?? chunk.length;
  }
  return written;
}

export async function startIngestRun(sourceId: string): Promise<number | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data, error } = await db
    .from("ingest_runs").insert({ source_id: sourceId }).select("id").single();
  if (error) return null;
  return data?.id ?? null;
}

export async function finishIngestRun(
  runId: number | null,
  result: { rowsSeen: number; rowsUpserted: number; ok: boolean; error?: string },
): Promise<void> {
  const db = getSupabase();
  if (!db || runId == null) return;
  await db.from("ingest_runs").update({
    finished_at: new Date().toISOString(),
    rows_seen: result.rowsSeen,
    rows_upserted: result.rowsUpserted,
    ok: result.ok,
    error: result.error ?? null,
  }).eq("id", runId);

  await db.from("sources").update({
    last_run_at: new Date().toISOString(),
    ...(result.ok ? { last_ok_at: new Date().toISOString(), last_error: null } : { last_error: result.error ?? "unknown" }),
  }).eq("id", (await db.from("ingest_runs").select("source_id").eq("id", runId).single()).data?.source_id ?? "");
}

export async function getPermitById(id: string): Promise<Permit | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data, error } = await db.from("permits").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return fromRow(data);
}

/** Inverse of toRow - rebuild the nested Permit shape the app works with. */
export function fromRow(row: Record<string, unknown>): Permit {
  return {
    id: String(row.id),
    source_id: String(row.source_id),
    permit_number: (row.permit_number as string) ?? null,
    status: (row.status as Permit["status"]) ?? "unknown",
    status_raw: (row.status_raw as string) ?? null,
    description: (row.description as string) ?? null,
    permit_type: (row.permit_type as string) ?? null,
    tags: (row.tags as Permit["tags"]) ?? [],
    address: (row.address as string) ?? null,
    geo: {
      state: (row.state as string) ?? null,
      county: (row.county as string) ?? null,
      city: (row.city as string) ?? null,
      zipcode: (row.zipcode as string) ?? null,
      jurisdiction: (row.jurisdiction as string) ?? null,
    },
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    job_value: (row.job_value as number) ?? null,
    fees: (row.fees as number) ?? null,
    total_cost: (row.total_cost as number) ?? null,
    file_date: (row.file_date as string) ?? null,
    issue_date: (row.issue_date as string) ?? null,
    final_date: (row.final_date as string) ?? null,
    contractor: (row.contractor as Permit["contractor"]) ?? null,
    owner: (row.owner as Permit["owner"]) ?? null,
    contractor_unassigned: Boolean(row.contractor_unassigned),
    property: (row.property as Permit["property"]) ?? {
      property_type: null, lot_size_sqft: null, building_area_sqft: null,
      stories: null, units: null, year_built: null, market_value: null,
    },
    source_fields: (row.source_fields as Record<string, unknown>) ?? {},
    ingested_at: String(row.ingested_at ?? new Date().toISOString()),
  };
}
