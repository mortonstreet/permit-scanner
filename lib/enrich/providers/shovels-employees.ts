import type {
  CompanyProvider, ContactProvider, ProviderContext, ResolvedCompany, ResolvedContact,
} from "../types";
import { titleRank } from "../types";

/**
 * Shovels contractors + employees.
 *
 * First paid step in the waterfall because it is construction-native and the
 * cheapest per contact (~$0.02/record at Basic tier, 1 credit = 1 record). An
 * employee record arrives complete: name, job title, seniority, business email,
 * personal email, phone and LinkedIn, with no name-matching guesswork when the
 * permit already carries a contractor_id.
 *
 * The open variable is coverage - Shovels publishes no figure for what share of
 * contractors have employee records. Benchmark it before relying on this tier.
 */

const BASE_URL = "https://api.shovels.ai/v2";

interface ShovelsContractor {
  id: string;
  name?: string | null;
  business_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  primary_phone?: string | null;
  primary_email?: string | null;
  employee_count?: string | null;
  primary_industry?: string | null;
  classification_derived?: string[] | null;
  address?: { city?: string | null; state?: string | null } | null;
}

interface ShovelsEmployee {
  id: string;
  contractor_id?: string;
  name?: string | null;
  job_title?: string | null;
  seniority_level?: string | null;
  department?: string | null;
  business_email?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
}

interface Paginated<T> {
  items: T[];
  next_cursor?: string | null;
}

function apiKey(): string | undefined {
  return process.env.SHOVELS_API_KEY;
}

async function shovelsFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("SHOVELS_API_KEY is not set");

  const res = await fetch(`${BASE_URL}${path}`, {
    signal,
    headers: { "X-API-Key": key, accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 402) throw new Error("Shovels monthly credit limit exceeded");
    if (res.status === 429) throw new Error("Shovels rate limited; back off and retry");
    throw new Error(`Shovels HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a firm name to a Shovels contractor.
 *
 * `/contractors/search` requires a geo_id and a date window, and contractor_name
 * must be at least 3 characters (it is trigram-indexed upstream).
 */
export const shovelsCompany: CompanyProvider = {
  name: "shovels",

  available() {
    return Boolean(apiKey());
  },

  async resolveCompany(firmName, hints, ctx: ProviderContext) {
    if (firmName.trim().length < 3) {
      return { company: null, credits: 0, note: "Firm name is too short for a Shovels contractor search." };
    }
    if (!hints.state) {
      return { company: null, credits: 0, note: "Shovels contractor search needs a state to scope the query." };
    }

    const params = new URLSearchParams({
      geo_id: hints.state.toUpperCase(),
      permit_from: isoMonthsAgo(24),
      permit_to: new Date().toISOString().slice(0, 10),
      contractor_name: firmName,
      size: "5",
      include_tallies: "false",
    });

    const page = await shovelsFetch<Paginated<ShovelsContractor>>(`/contractors/search?${params}`, ctx.signal);
    const best = page.items?.[0];
    if (!best) {
      return { company: null, credits: 0, note: `Shovels has no contractor matching "${firmName}" in ${hints.state}.` };
    }

    const name = best.business_name ?? best.name ?? firmName;
    const employees = Number.parseInt(String(best.employee_count ?? ""), 10);

    return {
      company: {
        name,
        domain: best.website ? best.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null,
        linkedin_url: best.linkedin_url ?? null,
        location: [best.address?.city, best.address?.state].filter(Boolean).join(", ") || null,
        employee_count: Number.isFinite(employees) ? employees : null,
        industry: best.primary_industry ?? best.classification_derived?.[0] ?? null,
        provider: "shovels",
        match_confidence: name.toLowerCase() === firmName.toLowerCase() ? 0.92 : 0.65,
      },
      // 1 credit per record returned.
      credits: page.items.length,
    };
  },
};

/** Cache the Shovels contractor id between the two steps of one resolution. */
const contractorIdByCompany = new WeakMap<ResolvedCompany, string>();

export function rememberContractorId(company: ResolvedCompany, id: string): void {
  contractorIdByCompany.set(company, id);
}

export const shovelsContact: ContactProvider = {
  name: "shovels",

  available() {
    return Boolean(apiKey());
  },

  async findDecisionMaker(company: ResolvedCompany, ctx: ProviderContext) {
    // Only usable when the company came from Shovels and carries its id.
    const contractorId = contractorIdByCompany.get(company);
    if (!contractorId) {
      return {
        contact: null, credits: 0,
        note: "Shovels employee lookup needs a Shovels contractor id; the company did not resolve there.",
      };
    }

    const page = await shovelsFetch<Paginated<ShovelsEmployee>>(
      `/contractors/${encodeURIComponent(contractorId)}/employees?size=50`,
      ctx.signal,
    );

    const employees = page.items ?? [];
    if (employees.length === 0) {
      return { contact: null, credits: 0, note: `Shovels has no employee records for ${company.name}.` };
    }

    const ranked = employees
      .map((e) => ({
        employee: e,
        rank: titleRank(e.job_title),
        reachable: Boolean(e.business_email ?? e.email ?? e.phone),
      }))
      .sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.rank - b.rank);

    const best = ranked.find((r) => r.reachable) ?? ranked[0];
    const e = best.employee;
    const [first, ...rest] = (e.name ?? "").split(" ");

    const contact: ResolvedContact = {
      full_name: e.name ?? "Unknown",
      first_name: first || null,
      last_name: rest.length ? rest.join(" ") : null,
      title: e.job_title ?? null,
      seniority: e.seniority_level ?? null,
      company_name: company.name,
      linkedin_url: e.linkedin_url ?? null,
      work_email: e.business_email ?? null,
      personal_email: e.email ?? null,
      // Shovels does not publish a per-address verification state.
      email_status: e.business_email || e.email ? "unverified" : "unverified",
      phone: e.phone ?? null,
      mobile_phone: null,
      location: [e.city, e.state].filter(Boolean).join(", ") || null,
      provider: "shovels",
    };

    return { contact, credits: employees.length };
  },
};

/** Pull the Shovels contractor id out of a permit's raw source fields, if present. */
export function contractorIdFromSourceFields(fields: Record<string, unknown>): string | null {
  const id = fields.contractor_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
