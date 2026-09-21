import { describe, expect, it, vi } from "vitest";
import { displayFirmName, firmKey, guessDomain, looksLikeIndividual } from "@/lib/enrich/firm";
import { isAcceptable, scoreConfidence, titleRank } from "@/lib/enrich/types";
import { runWaterfall } from "@/lib/enrich/waterfall";
import type { CompanyProvider, ContactProvider, ResolvedCompany, ResolvedContact } from "@/lib/enrich/types";

describe("firmKey", () => {
  it("collapses the ways one firm is spelled across permits", () => {
    const variants = ["ABC EXCAVATING LLC", "Abc Excavating, L.L.C.", "ABC Excavating Inc.", "abc excavating"];
    const keys = new Set(variants.map(firmKey));
    expect(keys.size).toBe(1);
  });

  it("keeps genuinely different firms apart", () => {
    expect(firmKey("ABC Excavating")).not.toBe(firmKey("ABD Excavating"));
  });
});

describe("looksLikeIndividual", () => {
  it("spots a person so we do not spend a credit on a company search", () => {
    expect(looksLikeIndividual("John Mastrangelo")).toBe(true);
    expect(looksLikeIndividual("Jose Valdes")).toBe(true);
  });

  it("treats anything with a legal suffix or industry noun as a company", () => {
    expect(looksLikeIndividual("Clymer Farner Barley, Inc.")).toBe(false);
    expect(looksLikeIndividual("MICHAEL A GARCEAU REV TRUST")).toBe(false);
    expect(looksLikeIndividual("Mills Short Construction")).toBe(false);
  });
});

describe("displayFirmName", () => {
  it("de-shouts a name while keeping legal suffixes uppercase", () => {
    expect(displayFirmName("ABC EXCAVATING LLC")).toBe("Abc Excavating LLC");
  });
});

describe("guessDomain", () => {
  it("guesses a plausible domain for a normal firm name", () => {
    expect(guessDomain("ABC Excavating LLC")).toBe("abcexcavating.com");
  });
  it("declines when the name is too short or too long to be a domain", () => {
    expect(guessDomain("AB")).toBeNull();
  });
});

describe("titleRank", () => {
  it("puts owners and presidents ahead of project managers", () => {
    expect(titleRank("Owner")).toBeLessThan(titleRank("Project Manager"));
    expect(titleRank("Co-Owner")).toBeLessThan(titleRank("Estimator"));
  });
  it("returns Infinity for an irrelevant title", () => {
    expect(titleRank("Receptionist")).toBe(Infinity);
    expect(titleRank(null)).toBe(Infinity);
  });
});

function contact(overrides: Partial<ResolvedContact> = {}): ResolvedContact {
  return {
    full_name: "Jane Doe", first_name: "Jane", last_name: "Doe",
    title: "Owner", seniority: null, company_name: "ABC Excavating",
    linkedin_url: null, work_email: "jane@abc.com", personal_email: null,
    email_status: "verified", phone: null, mobile_phone: null,
    location: null, provider: "test", ...overrides,
  };
}

describe("isAcceptable", () => {
  it("requires both a relevant title and a way to reach them", () => {
    expect(isAcceptable(contact())).toBe(true);
    expect(isAcceptable(contact({ work_email: null }))).toBe(false);
    expect(isAcceptable(contact({ title: "Receptionist" }))).toBe(false);
    expect(isAcceptable(null)).toBe(false);
  });
});

describe("scoreConfidence", () => {
  it("scores a verified owner email above an unverified junior one", () => {
    const strong = scoreConfidence(null, contact());
    const weak = scoreConfidence(null, contact({ title: "Project Manager", email_status: "unverified" }));
    expect(strong).toBeGreaterThan(weak);
  });
});

/* ------------------------------------------------------------- waterfall */

function companyProvider(name: string, company: ResolvedCompany | null, credits = 1): CompanyProvider {
  return { name, available: () => true, resolveCompany: vi.fn(async () => ({ company, credits })) };
}

function contactProvider(name: string, result: ResolvedContact | null, credits = 1): ContactProvider {
  return { name, available: () => true, findDecisionMaker: vi.fn(async () => ({ contact: result, credits })) };
}

const company: ResolvedCompany = {
  name: "ABC Excavating", domain: "abc.com", linkedin_url: null, location: "Cape Coral, FL",
  employee_count: 12, industry: "Construction", provider: "test", match_confidence: 0.9,
};

describe("runWaterfall", () => {
  it("returns the permit's own contact for free, without calling a provider", async () => {
    const cheap = contactProvider("cheap", contact());
    const result = await runWaterfall(
      {
        permitId: "p1", firmName: "ABC Excavating LLC", state: "FL",
        seedContact: contact({ provider: "permit-record", title: "Owner", phone: "+12395551234" }),
      },
      { companyProviders: [companyProvider("co", company)], contactProviders: [cheap] },
    );
    expect(result.credits_spent).toBe(0);
    expect(result.provider_chain).toEqual(["permit-record"]);
    expect(cheap.findDecisionMaker).not.toHaveBeenCalled();
  });

  it("stops at the first acceptable provider so the expensive one is never called", async () => {
    const cheap = contactProvider("cheap", contact(), 1);
    const pricey = contactProvider("pricey", contact(), 9);
    const result = await runWaterfall(
      { permitId: "p1", firmName: "ABC Excavating LLC", state: "FL" },
      { companyProviders: [companyProvider("co", company)], contactProviders: [cheap, pricey] },
    );
    expect(pricey.findDecisionMaker).not.toHaveBeenCalled();
    expect(result.contact?.full_name).toBe("Jane Doe");
  });

  it("falls through to the next provider when the first misses", async () => {
    const miss = contactProvider("miss", null, 0);
    const hit = contactProvider("hit", contact(), 2);
    const result = await runWaterfall(
      { permitId: "p1", firmName: "ABC Excavating LLC", state: "FL" },
      { companyProviders: [companyProvider("co", company)], contactProviders: [miss, hit] },
    );
    expect(hit.findDecisionMaker).toHaveBeenCalled();
    expect(result.provider_chain).toContain("hit");
  });

  it("stops spending once the credit budget is exhausted", async () => {
    const expensive = contactProvider("expensive", null, 10);
    const next = contactProvider("next", contact(), 1);
    const result = await runWaterfall(
      { permitId: "p1", firmName: "ABC Excavating LLC", state: "FL", creditBudget: 3 },
      { companyProviders: [companyProvider("co", company, 0)], contactProviders: [expensive, next] },
    );
    expect(next.findDecisionMaker).not.toHaveBeenCalled();
    expect(result.notes.join(" ")).toMatch(/budget/i);
  });

  it("serves a cached firm without calling any provider", async () => {
    const provider = contactProvider("provider", contact());
    const result = await runWaterfall(
      { permitId: "p2", firmName: "ABC Excavating LLC", state: "FL" },
      {
        companyProviders: [], contactProviders: [provider],
        readCache: async () => ({
          permit_id: "other", firm_name: "Abc Excavating LLC", company: null, contact: contact(),
          provider_chain: ["cached"], confidence: 0.8, credits_spent: 3, notes: [], cached: true,
          resolved_at: new Date().toISOString(),
        }),
      },
    );
    expect(result.cached).toBe(true);
    expect(result.permit_id).toBe("p2");
    expect(provider.findDecisionMaker).not.toHaveBeenCalled();
  });

  it("says plainly when the permit names nobody", async () => {
    const result = await runWaterfall(
      { permitId: "p3", firmName: null },
      { companyProviders: [], contactProviders: [] },
    );
    expect(result.contact).toBeNull();
    expect(result.notes[0]).toMatch(/does not name a firm/);
  });

  it("survives a provider that throws and records why", async () => {
    const broken: ContactProvider = {
      name: "broken", available: () => true,
      findDecisionMaker: async () => { throw new Error("429 rate limited"); },
    };
    const backup = contactProvider("backup", contact());
    const result = await runWaterfall(
      { permitId: "p4", firmName: "ABC Excavating LLC", state: "FL" },
      { companyProviders: [companyProvider("co", company)], contactProviders: [broken, backup] },
    );
    expect(result.contact).not.toBeNull();
    expect(result.notes.join(" ")).toMatch(/rate limited/);
  });
});

describe("looksLikeIndividual - public bodies", () => {
  it("treats counties, cities and authorities as entities, not people", () => {
    expect(looksLikeIndividual("Miami-dade County")).toBe(false);
    expect(looksLikeIndividual("City of Orlando")).toBe(false);
    expect(looksLikeIndividual("Tampa Port Authority")).toBe(false);
    expect(looksLikeIndividual("Orlando Health Inc")).toBe(false);
  });

  it("still recognises an actual person", () => {
    expect(looksLikeIndividual("Dave Schmitz")).toBe(true);
    expect(looksLikeIndividual("Hoang Nguyen")).toBe(true);
  });
});
