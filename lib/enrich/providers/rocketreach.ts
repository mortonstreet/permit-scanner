import type {
  CompanyProvider, ContactProvider, EmailStatus, ProviderContext, ResolvedCompany, ResolvedContact,
} from "../types";
import { TARGET_TITLES, titleRank } from "../types";

/**
 * RocketReach (Universal Credits endpoints).
 *
 * Docs: https://docs.rocketreach.co  ·  Auth: `Api-Key: <key>`
 *
 * Last in the waterfall on purpose: independent audits put its hit rate around
 * 30% and its per-credit cost is the highest here, so it should only ever see
 * what the cheaper providers missed. What it uniquely offers is phone grading
 * and a `direct dial` type, which ContactOut does not expose at all.
 *
 * Cost control comes from two features:
 *  - `teaser` on search results is FREE and says whether contact data exists.
 *  - `reveal_*` flags on lookup mean an unset field is neither returned nor billed.
 */

const BASE_URL = "https://api.rocketreach.co/api/v2";

/** Lookups are async: anything other than "complete" needs polling. */
const TERMINAL_STATUSES = new Set(["complete", "failed"]);
const POLL_INTERVAL_MS = 3_500;
const POLL_TIMEOUT_MS = 45_000;

interface RrEmail {
  email: string;
  smtp_valid?: "valid" | "invalid" | "accept-all" | "unknown";
  type?: "personal" | "professional" | "disposable" | "role-based";
  grade?: string;
}

interface RrPhone {
  number?: string;
  e164?: string;
  type?: "mobile" | "direct dial" | "other";
  grade?: string;
  recommended?: boolean;
}

interface RrPerson {
  id?: number;
  status?: string;
  name?: string;
  linkedin_url?: string;
  location?: string;
  city?: string;
  region?: string;
  current_title?: string;
  current_employer?: string;
  current_employer_domain?: string;
  recommended_professional_email?: string;
  recommended_personal_email?: string;
  current_work_email?: string;
  current_personal_email?: string;
  emails?: RrEmail[];
  phones?: RrPhone[];
  teaser?: {
    emails?: string[];
    personal_emails?: string[];
    professional_emails?: string[];
    phones?: Array<{ number?: string; is_premium?: boolean }>;
    is_premium_phone_available?: boolean;
  };
}

interface RrCompany {
  id?: number;
  name?: string;
  domain?: string;
  linkedin_url?: string;
  num_employees?: number;
  industry?: string;
  naics_codes?: string[];
  sic_codes?: string[];
  address?: { city?: string; region?: string; country?: string };
}

function apiKey(): string | undefined {
  return process.env.ROCKETREACH_API_KEY;
}

async function rrFetch<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("ROCKETREACH_API_KEY is not set");

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Api-Key": key,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      throw new Error(`RocketReach rate limited${retry ? `, retry after ${retry}s` : ""}`);
    }
    // 402 and 403 are different exhaustion conditions and read differently.
    if (res.status === 402) throw new Error("RocketReach email-verification credits are exhausted");
    if (res.status === 403) throw new Error("RocketReach lookup credits are exhausted");
    throw new Error(`RocketReach HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

function gradeToStatus(email: RrEmail | undefined): EmailStatus {
  if (!email) return "unverified";
  if (email.smtp_valid === "invalid" || email.grade === "F") return "invalid";
  if (email.grade === "A" || email.smtp_valid === "valid") return "verified";
  if (email.grade === "A-") return "verified";
  if (email.smtp_valid === "accept-all" || email.grade === "B") return "probable";
  return "unverified";
}

function mapPerson(p: RrPerson): ResolvedContact {
  const professional = p.emails?.find((e) => e.type === "professional");
  const personal = p.emails?.find((e) => e.type === "personal");
  // Prefer a graded direct dial or mobile over a switchboard number.
  const phone = p.phones?.find((x) => x.recommended)
    ?? p.phones?.find((x) => x.type === "direct dial" || x.type === "mobile")
    ?? p.phones?.[0];
  const mobile = p.phones?.find((x) => x.type === "mobile");

  const [first, ...rest] = (p.name ?? "").split(" ");

  return {
    full_name: p.name ?? "Unknown",
    first_name: first || null,
    last_name: rest.length ? rest.join(" ") : null,
    title: p.current_title ?? null,
    seniority: null,
    company_name: p.current_employer ?? null,
    linkedin_url: p.linkedin_url ?? null,
    work_email: p.recommended_professional_email ?? p.current_work_email ?? professional?.email ?? null,
    personal_email: p.recommended_personal_email ?? p.current_personal_email ?? personal?.email ?? null,
    email_status: gradeToStatus(professional ?? personal),
    phone: phone?.e164 ?? phone?.number ?? null,
    mobile_phone: mobile?.e164 ?? mobile?.number ?? null,
    location: p.location ?? ([p.city, p.region].filter(Boolean).join(", ") || null),
    provider: "rocketreach",
  };
}

export const rocketReachCompany: CompanyProvider = {
  name: "rocketreach",

  available() {
    return Boolean(apiKey());
  },

  async resolveCompany(firmName, hints, ctx: ProviderContext) {
    const res = await rrFetch<{ companies?: RrCompany[] }>("/universal/company/search", {
      method: "POST",
      signal: ctx.signal,
      body: JSON.stringify({
        page_size: 5,
        query: { name: [firmName], ...(hints.state ? { state: [hints.state] } : {}) },
      }),
    });

    const best = res.companies?.[0];
    if (!best) return { company: null, credits: 2, note: `RocketReach found no company matching "${firmName}".` };

    return {
      company: {
        name: best.name ?? firmName,
        domain: best.domain ?? null,
        linkedin_url: best.linkedin_url ?? null,
        location: [best.address?.city, best.address?.region].filter(Boolean).join(", ") || null,
        employee_count: best.num_employees ?? null,
        industry: best.industry ?? null,
        provider: "rocketreach",
        match_confidence: best.name?.toLowerCase() === firmName.toLowerCase() ? 0.9 : 0.6,
      },
      credits: 2, // 2 credits per company-search page.
    };
  },
};

export const rocketReachContact: ContactProvider = {
  name: "rocketreach",

  available() {
    return Boolean(apiKey());
  },

  async findDecisionMaker(company: ResolvedCompany, ctx: ProviderContext) {
    // Search first: it costs one credit per page and the teaser is free.
    const search = await rrFetch<{ profiles?: RrPerson[] }>("/universal/person/search", {
      method: "POST",
      signal: ctx.signal,
      body: JSON.stringify({
        page_size: 25,
        order_by: "relevance",
        query: {
          ...(company.domain ? { company_domain: [company.domain] } : { company_name: [company.name] }),
          current_title: TARGET_TITLES.slice(0, 12),
          contact_method: ["work email OR personal email"],
        },
      }),
    });

    const profiles = search.profiles ?? [];
    if (profiles.length === 0) {
      return { contact: null, credits: 1, note: `RocketReach found nobody at ${company.name}.` };
    }

    // The teaser tells us who has contact data before we pay to reveal anyone.
    const ranked = profiles
      .map((p) => ({
        person: p,
        rank: titleRank(p.current_title),
        hasContact:
          (p.teaser?.emails?.length ?? 0) > 0 ||
          (p.teaser?.professional_emails?.length ?? 0) > 0 ||
          (p.teaser?.personal_emails?.length ?? 0) > 0 ||
          (p.teaser?.phones?.length ?? 0) > 0,
      }))
      .sort((a, b) => Number(b.hasContact) - Number(a.hasContact) || a.rank - b.rank);

    const target = ranked.find((r) => r.hasContact && r.rank < Infinity) ?? ranked[0];
    if (!target?.person.id) {
      return { contact: null, credits: 1, note: `RocketReach has no revealable contact at ${company.name}.` };
    }

    // Reveal only the professional email and phone; personal email costs more.
    const lookupParams = new URLSearchParams({
      id: String(target.person.id),
      reveal_professional_email: "true",
      reveal_phone: "true",
      return_cached_emails: "false",
    });

    let person = await rrFetch<RrPerson>(`/universal/person/lookup?${lookupParams}`, {
      method: "GET", signal: ctx.signal,
    });

    // Lookups resolve asynchronously; poll until terminal or we run out of patience.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (person.status && !TERMINAL_STATUSES.has(person.status) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS, ctx.signal);
      const poll = await rrFetch<RrPerson[] | { profiles?: RrPerson[] }>(
        `/universal/person/check_status?ids=${target.person.id}`,
        { method: "GET", signal: ctx.signal },
      );
      const next = Array.isArray(poll) ? poll[0] : poll.profiles?.[0];
      if (!next) break;
      person = next;
    }

    if (person.status && !TERMINAL_STATUSES.has(person.status)) {
      return { contact: null, credits: 1, note: "RocketReach lookup did not finish in time; try again shortly." };
    }

    const contact = mapPerson({ ...target.person, ...person });
    // 1 search page + 2 for a professional email + 6 for a phone, on hits only.
    const credits = 1 + (contact.work_email ? 2 : 0) + (contact.phone ? 6 : 0);
    return { contact, credits };
  },
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
  });
}
