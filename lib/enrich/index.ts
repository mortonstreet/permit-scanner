import "server-only";
import { getSupabase } from "../supabase/client";
import type { Permit } from "../types";
import { firmKey } from "./firm";
import { contactOutCompany, contactOutContact } from "./providers/contactout";
import { rocketReachCompany, rocketReachContact } from "./providers/rocketreach";
import { shovelsCompany, shovelsContact } from "./providers/shovels-employees";
import type { EnrichmentResult, ResolvedContact } from "./types";
import { runWaterfall, type WaterfallDeps } from "./waterfall";

/**
 * Assembles the enrichment waterfall.
 *
 * Provider order is cost order, cheapest first, which is also - for small US
 * construction firms - roughly hit-rate order. These firms are frequently
 * absent from LinkedIn entirely, so the LinkedIn-first providers are last
 * rather than first: they should only ever see what the construction-native
 * sources could not resolve.
 */

/** Lift whatever contact the jurisdiction already published off the permit. */
export function seedContactFromPermit(permit: Permit): ResolvedContact | null {
  const source = permit.owner?.email || permit.owner?.phone ? permit.owner
    : permit.contractor?.email || permit.contractor?.phone ? permit.contractor
    : null;
  if (!source) return null;

  const name = source.name ?? source.company;
  if (!name) return null;
  const [first, ...rest] = name.split(" ");

  return {
    full_name: name,
    first_name: first || null,
    last_name: rest.length ? rest.join(" ") : null,
    // The permit says who filed, not what their title is.
    title: source.name && source.company && source.name !== source.company ? "Applicant" : "Owner",
    seniority: null,
    company_name: source.company ?? null,
    linkedin_url: null,
    work_email: source.email ?? null,
    personal_email: null,
    email_status: "unverified",
    phone: source.phone ?? null,
    mobile_phone: null,
    location: null,
    provider: "permit-record",
  };
}

function buildDeps(): WaterfallDeps {
  const db = getSupabase();

  return {
    // Cheapest first. Shovels is construction-native and ~$0.02/record;
    // ContactOut next; RocketReach last on cost and measured hit rate.
    companyProviders: [shovelsCompany, contactOutCompany, rocketReachCompany],
    contactProviders: [shovelsContact, contactOutContact, rocketReachContact],

    async readCache(key) {
      if (!db) return null;
      const { data, error } = await db
        .from("enriched_firms")
        .select("*")
        .eq("firm_key", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (error || !data) return null;

      return {
        permit_id: "",
        firm_name: data.firm_name as string,
        company: data.company as EnrichmentResult["company"],
        contact: data.contact as EnrichmentResult["contact"],
        provider_chain: (data.provider_chain as string[]) ?? [],
        confidence: Number(data.confidence ?? 0),
        credits_spent: Number(data.credits_spent ?? 0),
        notes: (data.notes as string[]) ?? [],
        cached: true,
        resolved_at: String(data.resolved_at),
      };
    },

    async writeCache(key, result) {
      if (!db) return;
      // Cache misses too - a firm that resolved to nothing should not be
      // retried on every page view. A shorter TTL lets it be re-checked sooner.
      const ttlDays = result.contact ? 90 : 14;
      await db.from("enriched_firms").upsert({
        firm_key: key,
        firm_name: result.firm_name ?? key,
        company: result.company,
        contact: result.contact,
        provider_chain: result.provider_chain,
        confidence: result.confidence,
        credits_spent: result.credits_spent,
        notes: result.notes,
        resolved_at: result.resolved_at,
        expires_at: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
      }, { onConflict: "firm_key" });
    },

    async audit(entry) {
      if (!db) return;
      await db.from("enrichment_calls").insert({
        firm_key: entry.firmKey,
        permit_id: entry.permitId,
        provider: entry.provider,
        operation: entry.operation,
        credits: entry.credits,
        success: entry.success,
        detail: entry.detail ?? null,
      });
    },
  };
}

export interface EnrichPermitOptions {
  creditBudget?: number;
  signal?: AbortSignal;
}

export async function enrichPermit(permit: Permit, opts: EnrichPermitOptions = {}): Promise<EnrichmentResult> {
  const firmName = permit.owner?.company ?? permit.owner?.name
    ?? permit.contractor?.company ?? permit.contractor?.name ?? null;

  return runWaterfall(
    {
      permitId: permit.id,
      firmName,
      city: permit.geo.city,
      state: permit.geo.state,
      seedContact: seedContactFromPermit(permit),
      creditBudget: opts.creditBudget ?? 4,
      signal: opts.signal,
    },
    buildDeps(),
  );
}

/** Which enrichment providers currently have credentials configured. */
export function configuredProviders(): string[] {
  const deps = buildDeps();
  return [...new Set([
    ...deps.companyProviders.filter((p) => p.available()).map((p) => p.name),
    ...deps.contactProviders.filter((p) => p.available()).map((p) => p.name),
  ])];
}

export { firmKey };
