import type {
  CompanyProvider, ContactProvider, EnrichmentResult, ProviderContext,
  ResolvedCompany, ResolvedContact,
} from "./types";
import { isAcceptable, scoreConfidence } from "./types";
import { displayFirmName, firmKey, looksLikeIndividual } from "./firm";

/**
 * The enrichment waterfall.
 *
 * Providers are tried in cost order and we stop at the first acceptable answer,
 * so a firm that resolves on the cheap provider never costs us the expensive
 * one. Every call is metered against a per-permit credit budget, because the
 * failure mode that actually hurts is burning credits on firms that were never
 * going to resolve.
 */

export interface WaterfallDeps {
  companyProviders: CompanyProvider[];
  contactProviders: ContactProvider[];
  /** Cache read; returns null on a miss or an expired entry. */
  readCache?: (key: string) => Promise<EnrichmentResult | null>;
  writeCache?: (key: string, result: EnrichmentResult) => Promise<void>;
  /** Per-call audit hook, for cost attribution. */
  audit?: (entry: {
    firmKey: string; permitId: string; provider: string; operation: string;
    credits: number; success: boolean; detail?: string;
  }) => Promise<void>;
}

export interface WaterfallInput {
  permitId: string;
  firmName: string | null;
  city?: string | null;
  state?: string | null;
  /** Hard ceiling on credits for this one permit. */
  creditBudget?: number;
  /**
   * A contact the permit itself already names. This is free and first-party -
   * it came from the applicant - so when it is reachable we return it without
   * calling a provider at all.
   */
  seedContact?: ResolvedContact | null;
  signal?: AbortSignal;
}

export async function runWaterfall(input: WaterfallInput, deps: WaterfallDeps): Promise<EnrichmentResult> {
  const { permitId, firmName, city = null, state = null, creditBudget = 4, seedContact = null, signal } = input;
  const notes: string[] = [];

  if (!firmName || !firmName.trim()) {
    return empty(permitId, null, ["This permit does not name a firm, so there is nobody to resolve."]);
  }

  const display = displayFirmName(firmName);
  const key = firmKey(firmName);

  // A cached firm is free; check before spending anything.
  if (deps.readCache) {
    const cached = await deps.readCache(key);
    if (cached) return { ...cached, permit_id: permitId, cached: true };
  }

  // Step 0: the permit itself. Jurisdictions often publish the applicant's own
  // phone or email, which is both free and the highest-precision data we will
  // ever have on this job. Never pay a provider when this is already reachable.
  if (seedContact && isAcceptable(seedContact)) {
    const result: EnrichmentResult = {
      permit_id: permitId,
      firm_name: display,
      company: null,
      contact: seedContact,
      provider_chain: ["permit-record"],
      confidence: scoreConfidence(null, seedContact),
      credits_spent: 0,
      notes: ["Contact came from the permit record itself, at no credit cost."],
      cached: false,
      resolved_at: new Date().toISOString(),
    };
    await deps.writeCache?.(key, result);
    return result;
  }

  // Individual applicants have no company record to resolve against. Say so
  // rather than burning a credit on a search that structurally cannot match.
  if (looksLikeIndividual(display)) {
    notes.push(`"${display}" looks like an individual applicant rather than a company.`);
  }

  const ctx: ProviderContext = { signal, creditBudget };
  const providerChain: string[] = [];
  let creditsSpent = 0;

  /* ------------------------------------------------ step 1: the company */
  let company: ResolvedCompany | null = null;

  for (const provider of deps.companyProviders) {
    if (!provider.available()) continue;
    if (creditsSpent >= creditBudget) { notes.push("Credit budget reached before the company resolved."); break; }

    try {
      const out = await provider.resolveCompany(display, { city, state }, ctx);
      creditsSpent += out.credits;
      providerChain.push(provider.name);
      await deps.audit?.({
        firmKey: key, permitId, provider: provider.name, operation: "company",
        credits: out.credits, success: Boolean(out.company), detail: out.note,
      });
      if (out.note) notes.push(out.note);
      if (out.company) { company = out.company; break; }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      notes.push(`${provider.name} company lookup failed: ${detail}`);
      await deps.audit?.({
        firmKey: key, permitId, provider: provider.name, operation: "company",
        credits: 0, success: false, detail,
      });
    }
  }

  if (!company) {
    // Fall through with a name-only stub so contact providers can still try.
    company = {
      name: display, domain: null, linkedin_url: null, location: [city, state].filter(Boolean).join(", ") || null,
      employee_count: null, industry: null, provider: "permit-record", match_confidence: 0.35,
    };
    notes.push("No company record matched; searching on the permit name alone.");
  }

  /* -------------------------------------------- step 2: decision maker */
  let contact: ResolvedContact | null = null;

  for (const provider of deps.contactProviders) {
    if (!provider.available()) continue;
    if (creditsSpent >= creditBudget) { notes.push("Credit budget reached before a contact resolved."); break; }

    try {
      const out = await provider.findDecisionMaker(company, ctx);
      creditsSpent += out.credits;
      providerChain.push(provider.name);
      await deps.audit?.({
        firmKey: key, permitId, provider: provider.name, operation: "contact",
        credits: out.credits, success: Boolean(out.contact), detail: out.note,
      });
      if (out.note) notes.push(out.note);

      // Keep the best candidate seen, but stop early on a good one.
      if (out.contact && (!contact || scoreConfidence(company, out.contact) > scoreConfidence(company, contact))) {
        contact = out.contact;
      }
      if (isAcceptable(contact)) break;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      notes.push(`${provider.name} contact lookup failed: ${detail}`);
      await deps.audit?.({
        firmKey: key, permitId, provider: provider.name, operation: "contact",
        credits: 0, success: false, detail,
      });
    }
  }

  if (!contact && providerChain.length === 0) {
    notes.push("No enrichment provider is configured. Add a provider API key to resolve contacts.");
  }

  const result: EnrichmentResult = {
    permit_id: permitId,
    firm_name: display,
    company: company.provider === "permit-record" ? null : company,
    contact,
    provider_chain: [...new Set(providerChain)],
    confidence: scoreConfidence(company, contact),
    credits_spent: creditsSpent,
    notes,
    cached: false,
    resolved_at: new Date().toISOString(),
  };

  // Cache misses too: a firm that resolved to nothing should not be retried
  // on every page view. The cache TTL handles eventual re-checking.
  await deps.writeCache?.(key, result);
  return result;
}

function empty(permitId: string, firmName: string | null, notes: string[]): EnrichmentResult {
  return {
    permit_id: permitId, firm_name: firmName, company: null, contact: null,
    provider_chain: [], confidence: 0, credits_spent: 0, notes,
    cached: false, resolved_at: new Date().toISOString(),
  };
}
