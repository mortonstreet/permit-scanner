/**
 * Contact enrichment contract.
 *
 * A permit names a firm. Contractors want a human. The waterfall resolves
 * firm -> company record -> decision maker -> contact details, trying providers
 * in cost order and stopping at the first acceptable answer, because every
 * provider call costs a credit.
 */

export type EmailStatus = "verified" | "probable" | "unverified" | "invalid";

export interface ResolvedCompany {
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  location: string | null;
  employee_count: number | null;
  industry: string | null;
  /** Which provider produced this company record. */
  provider: string;
  /** 0..1 - how sure we are this is the firm named on the permit. */
  match_confidence: number;
}

export interface ResolvedContact {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  company_name: string | null;
  linkedin_url: string | null;
  work_email: string | null;
  personal_email: string | null;
  email_status: EmailStatus;
  phone: string | null;
  mobile_phone: string | null;
  location: string | null;
  provider: string;
}

export interface EnrichmentResult {
  permit_id: string;
  firm_name: string | null;
  company: ResolvedCompany | null;
  contact: ResolvedContact | null;
  /** Providers actually called, in order, e.g. ["contactout", "rocketreach"]. */
  provider_chain: string[];
  /** 0..1 overall confidence in the contact. */
  confidence: number;
  /** Credits consumed by this resolution, for cost accounting. */
  credits_spent: number;
  /** Human-readable explanations, e.g. "no LinkedIn presence for this firm". */
  notes: string[];
  /** Whether this came from cache rather than a fresh provider call. */
  cached: boolean;
  resolved_at: string;
}

/**
 * Decision-maker titles in priority order for construction firms.
 *
 * Small US construction companies are usually owner-operated, so the owner and
 * president outrank any functional title. Preconstruction and estimating come
 * next because they are the people who actually evaluate an incoming bid.
 */
export const TARGET_TITLES: string[] = [
  "Owner",
  "President",
  "Founder",
  "CEO",
  "Principal",
  "Partner",
  "General Manager",
  "Vice President of Construction",
  "VP Construction",
  "Director of Construction",
  "Director of Development",
  "Project Executive",
  "Preconstruction Manager",
  "Director of Preconstruction",
  "Chief Estimator",
  "Estimator",
  "Construction Manager",
  "Operations Manager",
  "Project Manager",
];

/** Rank a title against TARGET_TITLES; lower is better, Infinity means no match. */
export function titleRank(title: string | null | undefined): number {
  if (!title) return Infinity;
  const t = title.toLowerCase();
  for (let i = 0; i < TARGET_TITLES.length; i += 1) {
    if (t.includes(TARGET_TITLES[i].toLowerCase())) return i;
  }
  // Catch shapes the explicit list misses, e.g. "Co-Owner", "Managing Member".
  if (/\b(owner|principal|founder|managing member|proprietor)\b/.test(t)) return 0;
  if (/\b(president|chief executive)\b/.test(t)) return 1;
  return Infinity;
}

export interface ProviderContext {
  /** Abort in-flight provider calls when the request is cancelled. */
  signal?: AbortSignal;
  /** Stop calling providers once this many credits are spent on one permit. */
  creditBudget: number;
}

export interface CompanyProvider {
  name: string;
  /** Configured and ready to call? */
  available(): boolean;
  resolveCompany(firmName: string, hints: { city?: string | null; state?: string | null }, ctx: ProviderContext):
    Promise<{ company: ResolvedCompany | null; credits: number; note?: string }>;
}

export interface ContactProvider {
  name: string;
  available(): boolean;
  findDecisionMaker(company: ResolvedCompany, ctx: ProviderContext):
    Promise<{ contact: ResolvedContact | null; credits: number; note?: string }>;
}

/** An answer good enough to stop the waterfall and save the next provider's credit. */
export function isAcceptable(contact: ResolvedContact | null): boolean {
  if (!contact) return false;
  const reachable = Boolean(contact.work_email ?? contact.personal_email ?? contact.phone ?? contact.mobile_phone);
  return reachable && titleRank(contact.title) < Infinity;
}

/** Blend title fit, contact completeness and company match into one 0..1 score. */
export function scoreConfidence(company: ResolvedCompany | null, contact: ResolvedContact | null): number {
  if (!contact) return 0;
  let score = 0;
  const rank = titleRank(contact.title);
  if (rank <= 2) score += 0.4;
  else if (rank < Infinity) score += 0.25;
  else score += 0.05;

  if (contact.email_status === "verified") score += 0.3;
  else if (contact.work_email) score += 0.18;
  else if (contact.personal_email) score += 0.1;

  if (contact.phone ?? contact.mobile_phone) score += 0.15;
  if (contact.linkedin_url) score += 0.05;
  score += (company?.match_confidence ?? 0.5) * 0.1;

  return Math.min(Math.round(score * 100) / 100, 1);
}
