import type {
  CompanyProvider, ContactProvider, ProviderContext, ResolvedCompany, ResolvedContact,
} from "../types";
import { titleRank } from "../types";

/**
 * ContactOut.
 *
 * Docs: https://api.contactout.com  (single Slate page; no OpenAPI spec)
 * Auth: `token: <key>` header.
 *
 * The reason this provider sits early in the waterfall is
 * `/v1/people/decision-makers`, which returns `contact_availability` flags
 * WITHOUT charging email/phone credits. We use that to pick exactly one person
 * worth revealing instead of paying to reveal a shortlist.
 *
 * Billing notes that shape the code below:
 *  - decision-makers charges 1 SEARCH credit per profile returned, always.
 *  - email/phone credits are only charged on `reveal_info=true`, and only on a hit.
 *  - Response casing differs per endpoint (snake_case here, camelCase on enrich).
 *  - Error codes are swapped vs convention: 400 = bad credentials, 401 = bad input.
 */

const BASE_URL = "https://api.contactout.com";

interface CoProfile {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  headline?: string;
  seniority?: string;
  job_function?: string;
  li_vanity?: string;
  location?: string;
  country?: string;
  company?: { name?: string; domain?: string; email_domain?: string; url?: string };
  work_email?: string[];
  personal_email?: string[];
  email?: string[];
  phone?: string[];
  work_email_status?: Record<string, string>;
  contact_availability?: { personal_email?: boolean; work_email?: boolean; phone?: boolean };
}

interface CoSearchResponse {
  status_code?: number;
  metadata?: { page?: number; page_size?: number; total_results?: number };
  /** Keyed by LinkedIn URL - ContactOut has no per-request metadata field. */
  profiles?: Record<string, CoProfile>;
}

interface CoCompany {
  name?: string;
  domain?: string;
  website?: string;
  linkedin_url?: string;
  url?: string;
  size?: string | number;
  industry?: string;
  location?: string;
  headquarter?: string;
}

function apiKey(): string | undefined {
  return process.env.CONTACTOUT_API_KEY;
}

async function coFetch<T>(path: string, init: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("CONTACTOUT_API_KEY is not set");

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      token: key,
      // The docs show a bare `authorization: basic` with no credentials on some
      // endpoints and omit it on others; sending it is harmless and matches them.
      authorization: "basic",
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // ContactOut inverts the usual meanings of 400 and 401.
    if (res.status === 400) throw new Error("ContactOut rejected the credentials or headers");
    if (res.status === 401) throw new Error(`ContactOut rejected the request: ${body.slice(0, 160)}`);
    if (res.status === 403) throw new Error("ContactOut: out of credits, or this endpoint is not enabled on the key");
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      throw new Error(`ContactOut rate limited${retry ? `, retry after ${retry}s` : ""}`);
    }
    throw new Error(`ContactOut HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

function firstOrNull(list: string[] | undefined): string | null {
  return list && list.length > 0 ? list[0] : null;
}

function mapProfile(linkedinUrl: string, p: CoProfile, companyName: string | null): ResolvedContact {
  const workEmail = firstOrNull(p.work_email) ?? firstOrNull(p.email);
  const status = workEmail ? p.work_email_status?.[workEmail] : undefined;

  return {
    full_name: p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ") ?? "Unknown",
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    title: p.title ?? p.headline ?? null,
    seniority: p.seniority ?? null,
    company_name: p.company?.name ?? companyName,
    linkedin_url: linkedinUrl.startsWith("http") ? linkedinUrl : (p.li_vanity ? `https://www.linkedin.com/in/${p.li_vanity}` : null),
    work_email: workEmail,
    personal_email: firstOrNull(p.personal_email),
    // ContactOut's verifier enum; "Verified" appears on the camelCase endpoints.
    email_status: status
      ? (/^(verified|valid)$/i.test(status) ? "verified" : /accept_all|catch/i.test(status) ? "probable" : /invalid/i.test(status) ? "invalid" : "unverified")
      : workEmail ? "unverified" : "unverified",
    phone: firstOrNull(p.phone),
    mobile_phone: null, // ContactOut returns one undifferentiated phone array.
    location: p.location ?? p.country ?? null,
    provider: "contactout",
  };
}

/** Company resolution via `POST /v1/domain/enrich` (1 search credit per company found). */
export const contactOutCompany: CompanyProvider = {
  name: "contactout",

  available() {
    return Boolean(apiKey());
  },

  async resolveCompany(firmName, hints, ctx: ProviderContext) {
    const res = await coFetch<{ companies?: Record<string, CoCompany>; company?: CoCompany }>(
      "/v1/company/search",
      {
        method: "POST",
        signal: ctx.signal,
        body: JSON.stringify({
          name: [firmName],
          ...(hints.state ? { location: [hints.state] } : {}),
          page_size: 5,
        }),
      },
    );

    const list = res.companies ? Object.values(res.companies) : res.company ? [res.company] : [];
    if (list.length === 0) {
      return { company: null, credits: 0, note: `ContactOut found no company matching "${firmName}".` };
    }

    const best = list[0];
    const employees = typeof best.size === "number" ? best.size : Number.parseInt(String(best.size ?? ""), 10);

    return {
      company: {
        name: best.name ?? firmName,
        domain: best.domain ?? null,
        linkedin_url: best.linkedin_url ?? best.url ?? null,
        location: best.location ?? best.headquarter ?? null,
        employee_count: Number.isFinite(employees) ? employees : null,
        industry: best.industry ?? null,
        provider: "contactout",
        // Exact name match is a much stronger signal than a fuzzy one.
        match_confidence: best.name?.toLowerCase() === firmName.toLowerCase() ? 0.9 : 0.6,
      },
      credits: list.length, // 1 search credit per company returned.
    };
  },
};

/**
 * Decision-maker discovery, in two phases so we only pay to reveal one person:
 *   1. `reveal_info=false` - costs search credits, returns contact_availability
 *   2. re-call with `reveal_info=true` once we have picked the best title
 */
export const contactOutContact: ContactProvider = {
  name: "contactout",

  available() {
    return Boolean(apiKey());
  },

  async findDecisionMaker(company: ResolvedCompany, ctx: ProviderContext) {
    const params = new URLSearchParams();
    if (company.linkedin_url) params.set("linkedin_url", company.linkedin_url);
    else if (company.domain) params.set("domain", company.domain);
    else params.set("name", company.name);
    params.set("reveal_info", "false");
    params.set("page", "1");

    const scan = await coFetch<CoSearchResponse>(`/v1/people/decision-makers?${params}`, {
      method: "GET", signal: ctx.signal,
    });

    const entries = Object.entries(scan.profiles ?? {});
    if (entries.length === 0) {
      return { contact: null, credits: 0, note: `ContactOut found no decision makers for ${company.name}.` };
    }

    // 1 search credit per profile returned, whether or not we reveal any.
    const scanCredits = entries.length;

    // Rank by how well the title matches, then by whether contact data exists.
    const ranked = entries
      .map(([url, profile]) => ({
        url,
        profile,
        rank: titleRank(profile.title ?? profile.headline),
        reachable:
          Boolean(profile.contact_availability?.work_email) ||
          Boolean(profile.contact_availability?.personal_email) ||
          Boolean(profile.contact_availability?.phone),
      }))
      .sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.rank - b.rank);

    const best = ranked.find((r) => r.reachable && r.rank < Infinity) ?? ranked.find((r) => r.reachable);

    if (!best) {
      return {
        contact: null,
        credits: scanCredits,
        note: `ContactOut has no reachable contact for ${company.name} (${entries.length} profiles checked).`,
      };
    }

    // Phase 2: reveal just this one person.
    const revealParams = new URLSearchParams({
      profile: best.url,
      include_phone: "true",
      email_type: "both",
    });
    const revealed = await coFetch<{ profile?: CoProfile } & CoProfile>(
      `/v1/people/linkedin?${revealParams}`,
      { method: "GET", signal: ctx.signal },
    );
    const payload = revealed.profile ?? revealed;
    const contact = mapProfile(best.url, { ...best.profile, ...payload }, company.name);

    // Email + phone credits, charged only on a hit.
    const revealCredits = (contact.work_email || contact.personal_email ? 1 : 0) + (contact.phone ? 1 : 0);

    return { contact, credits: scanCredits + revealCredits };
  },
};
