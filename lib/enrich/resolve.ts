import "server-only";
import { lookupFirm, type DbprMatch } from "./gov/fl-dbpr";
import { lookupOrlandoBtr } from "./gov/orlando-btr";
import { entityDbAvailable, resolveEntity } from "./gov/sunbiz";
import { isOrganization, titleizeOrg, titleizePerson } from "../names";

/**
 * Multi-source entity resolution.
 *
 * Every source is consulted, not just the first one that answers, because
 * they are complementary rather than redundant:
 *
 *   SunBiz      who legally owns and runs the entity, plus a filing email
 *   DBPR        the licence qualifier and a phone, for contractors
 *   Orlando BTR phone and email together, for one city
 *
 * Each field records where it came from and how confident we are, so a
 * salesperson can see that a phone is a licence-board record rather than a
 * guess, and so a wrong answer is traceable to its source.
 */

export type FieldSource = "sunbiz" | "fl-dbpr" | "orlando-btr" | "permit";

export interface SourcedValue<T> {
  value: T;
  source: FieldSource;
  /** 0-1 confidence in this specific field, not the record as a whole. */
  confidence: number;
}

export interface ResolvedPerson {
  name: SourcedValue<string>;
  title: SourcedValue<string> | null;
  phone: SourcedValue<string> | null;
  email: SourcedValue<string> | null;
  location: SourcedValue<string> | null;
  /** Sources that independently named this same person. */
  corroboratedBy: FieldSource[];
}

export interface EntityResolutionResult {
  query: string;
  /** The legal entity, when one was found. */
  entity: {
    name: string;
    docNumber: string | null;
    status: string | null;
    filingType: string | null;
    city: string | null;
    registeredAgent: string | null;
    /** The email the entity files with the state for official notices. */
    filingEmail: SourcedValue<string> | null;
    source: FieldSource;
    confidence: number;
    matchMethod: string;
    /** >0 means several entities share this name; treat with care. */
    ambiguousWith: number;
  } | null;
  /** Everyone we can name, best first. */
  people: ResolvedPerson[];
  /** The one to call. */
  primary: ResolvedPerson | null;
  /** Licence detail, when the firm is a licensed contractor. */
  license: { number: string | null; status: string | null; qualifier: string | null } | null;
  sourcesChecked: FieldSource[];
  sourcesHit: FieldSource[];
  notes: string[];
  /** 0-1 over the whole resolution: identity plus reachability. */
  confidence: number;
}

function sv<T>(value: T, source: FieldSource, confidence: number): SourcedValue<T> {
  return { value, source, confidence };
}

/** Two names refer to the same person if their surname and initial agree. */
function samePerson(a: string, b: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, "").split(/\s+/).filter(Boolean);
  const pa = norm(a), pb = norm(b);
  if (pa.length === 0 || pb.length === 0) return false;
  const lastA = pa[pa.length - 1], lastB = pb[pb.length - 1];
  if (lastA !== lastB) return false;
  return pa[0][0] === pb[0][0];
}

export interface ResolveOptions {
  city?: string | null;
  state?: string | null;
  /** Licence number from the permit, the highest-precision join available. */
  licenseNumber?: string | null;
  /**
   * Skip sources that need a network round trip. SunBiz and DBPR are local
   * (SQLite and an in-memory index), so a local-only resolve is sub-millisecond
   * and can run inline for every row of a result list. Orlando's tax receipts
   * are an HTTP call and are left for on-demand resolution.
   */
  localOnly?: boolean;
}

export async function resolveEntityFully(
  companyName: string,
  opts: ResolveOptions = {},
): Promise<EntityResolutionResult> {
  const notes: string[] = [];
  const sourcesChecked: FieldSource[] = [];
  const sourcesHit: FieldSource[] = [];
  const people: ResolvedPerson[] = [];

  const isFl = (opts.state ?? "FL").toUpperCase() === "FL";
  if (!isFl) {
    return empty(companyName, ["Entity resolution currently covers Florida only."]);
  }
  if (!isOrganization(companyName)) {
    notes.push(`"${companyName}" reads as an individual rather than a company.`);
  }

  // ── all three in parallel; they are independent ──────────────────────
  sourcesChecked.push("sunbiz", "fl-dbpr");
  if (!opts.localOnly) sourcesChecked.push("orlando-btr");

  const [sunbiz, dbpr, btr] = await Promise.all([
    Promise.resolve().then(() => (entityDbAvailable() ? resolveEntity(companyName, { city: opts.city }) : null)),
    lookupFirm(companyName, opts.licenseNumber).catch(() => null),
    opts.localOnly ? Promise.resolve(null) : lookupOrlandoBtr(companyName).catch(() => null),
  ]);

  if (!entityDbAvailable()) {
    notes.push("SunBiz entity database is not built; run `pnpm entity:build`.");
  }

  /* ── SunBiz: the legal entity, its officers, and the filing email ──── */
  let entity: EntityResolutionResult["entity"] = null;

  if (sunbiz?.entity) {
    sourcesHit.push("sunbiz");
    const e = sunbiz.entity;
    entity = {
      name: titleizeOrg(e.name),
      docNumber: e.docNumber,
      status: e.status === "A" ? "Active" : e.status === "I" ? "Inactive" : e.status,
      filingType: e.filingType,
      city: e.city,
      registeredAgent: e.registeredAgent ? titleizePerson(e.registeredAgent.name) : null,
      filingEmail: e.email ? sv(e.email, "sunbiz", 0.85 * sunbiz.confidence) : null,
      source: "sunbiz",
      confidence: sunbiz.confidence,
      matchMethod: sunbiz.method,
      ambiguousWith: sunbiz.alternates,
    };
    if (sunbiz.note) notes.push(sunbiz.note);

    // Officers are already ranked by control role: managing member, then
    // president, and so on down.
    for (const officer of e.officers.slice(0, 5)) {
      if (!officer.name || officer.type === "C") continue;
      people.push({
        name: sv(titleizePerson(officer.name), "sunbiz", sunbiz.confidence),
        title: sv(officer.title, "sunbiz", sunbiz.confidence),
        phone: null,
        // The filing email belongs to the entity, so attach it to the top
        // officer only rather than implying each person has that inbox.
        email: people.length === 0 && e.email ? sv(e.email, "sunbiz", 0.7 * sunbiz.confidence) : null,
        location: officer.city ? sv(`${officer.city}, ${officer.state ?? "FL"}`, "sunbiz", sunbiz.confidence) : null,
        corroboratedBy: ["sunbiz"],
      });
    }

    // The registered agent is often the same person, and often the owner.
    const agent = e.registeredAgent;
    if (agent && agent.type !== "C") {
      const agentName = titleizePerson(agent.name);
      const existing = people.find((p) => samePerson(p.name.value, agentName));
      if (existing) existing.corroboratedBy.push("sunbiz");
      else {
        people.push({
          name: sv(agentName, "sunbiz", sunbiz.confidence * 0.9),
          title: sv("Registered Agent", "sunbiz", sunbiz.confidence),
          phone: null, email: null,
          location: agent.city ? sv(`${agent.city}, FL`, "sunbiz", sunbiz.confidence) : null,
          corroboratedBy: ["sunbiz"],
        });
      }
    }
  }

  /* ── DBPR: licence qualifier and a phone ───────────────────────────── */
  let license: EntityResolutionResult["license"] = null;

  if (dbpr?.firm) {
    sourcesHit.push("fl-dbpr");
    license = {
      number: dbpr.firm.licenseNumber,
      status: dbpr.firm.status === "A" ? "Active" : dbpr.firm.status,
      qualifier: dbpr.firm.qualifierFirst && dbpr.firm.qualifierLast
        ? titleizePerson(`${dbpr.firm.qualifierFirst} ${dbpr.firm.qualifierLast}`)
        : null,
    };
    mergeDbprPerson(people, dbpr);
  }

  /* ── Orlando BTR: phone and email in one row ───────────────────────── */
  if (btr && (btr.phone || btr.email)) {
    sourcesHit.push("orlando-btr");
    const btrName = btr.ownerName ? titleizePerson(btr.ownerName) : null;
    const match = btrName ? people.find((p) => samePerson(p.name.value, btrName)) : people[0];

    if (match) {
      if (!match.phone && btr.phone) match.phone = sv(btr.phone, "orlando-btr", 0.85);
      if (!match.email && btr.email) match.email = sv(btr.email, "orlando-btr", 0.8);
      if (!match.corroboratedBy.includes("orlando-btr")) match.corroboratedBy.push("orlando-btr");
    } else if (btrName) {
      people.push({
        name: sv(btrName, "orlando-btr", 0.75),
        title: sv(btr.licenseType ?? "Owner", "orlando-btr", 0.6),
        phone: btr.phone ? sv(btr.phone, "orlando-btr", 0.85) : null,
        email: btr.email ? sv(btr.email, "orlando-btr", 0.8) : null,
        location: sv("Orlando, FL", "orlando-btr", 0.9),
        corroboratedBy: ["orlando-btr"],
      });
    }
  }

  /* ── pick who to call ──────────────────────────────────────────────── */
  const primary = pickPrimary(people);

  if (people.length === 0) {
    notes.push(sourcesHit.length === 0
      ? `No Florida public record matched "${companyName}".`
      : `Matched the entity but no individual is named on the filings.`);
  }

  return {
    query: companyName,
    entity,
    people,
    primary,
    license,
    sourcesChecked,
    sourcesHit: [...new Set(sourcesHit)],
    notes,
    confidence: overallConfidence(entity, primary, sourcesHit),
  };
}

function mergeDbprPerson(people: ResolvedPerson[], dbpr: DbprMatch): void {
  const first = dbpr.person?.firstName ?? dbpr.firm?.qualifierFirst;
  const last = dbpr.person?.lastName ?? dbpr.firm?.qualifierLast;
  if (!first || !last) return;

  const name = titleizePerson(`${first} ${last}`);
  const phone = dbpr.person?.phone ?? null;
  const existing = people.find((p) => samePerson(p.name.value, name));

  if (existing) {
    // Two independent registries naming the same human is the strongest
    // signal we can get without calling anyone.
    if (!existing.corroboratedBy.includes("fl-dbpr")) existing.corroboratedBy.push("fl-dbpr");
    if (!existing.phone && phone) existing.phone = sv(phone, "fl-dbpr", 0.9);
    if (!existing.title) existing.title = sv("Licence Qualifier", "fl-dbpr", 0.8);
    return;
  }

  people.push({
    name: sv(name, "fl-dbpr", dbpr.confidence),
    title: sv("Licence Qualifier", "fl-dbpr", 0.8),
    phone: phone ? sv(phone, "fl-dbpr", 0.9) : null,
    email: null,
    location: dbpr.person?.city ? sv(`${dbpr.person.city}, FL`, "fl-dbpr", 0.8) : null,
    corroboratedBy: ["fl-dbpr"],
  });
}

/**
 * Rank the people we found.
 *
 * Reachability first - a name with a phone beats a better title with nothing -
 * then corroboration across registries, then how senior the role is.
 */
function pickPrimary(people: ResolvedPerson[]): ResolvedPerson | null {
  if (people.length === 0) return null;
  const score = (p: ResolvedPerson) =>
    (p.phone ? 40 : 0) +
    (p.email ? 25 : 0) +
    p.corroboratedBy.length * 12 +
    (p.title?.value.match(/managing member|president|owner|ceo|authorized/i) ? 15 : 0) +
    (p.name.confidence * 10);
  return [...people].sort((a, b) => score(b) - score(a))[0];
}

function overallConfidence(
  entity: EntityResolutionResult["entity"],
  primary: ResolvedPerson | null,
  hits: FieldSource[],
): number {
  let score = 0;
  if (entity) score += entity.confidence * 0.45;
  if (primary) {
    score += primary.name.confidence * 0.2;
    if (primary.phone) score += 0.2;
    if (primary.email) score += 0.1;
    if (primary.corroboratedBy.length > 1) score += 0.05;
  }
  // Independent sources agreeing is worth more than any single source.
  if (new Set(hits).size >= 2) score = Math.min(1, score * 1.1);
  return Math.round(Math.min(score, 1) * 100) / 100;
}

function empty(query: string, notes: string[]): EntityResolutionResult {
  return {
    query, entity: null, people: [], primary: null, license: null,
    sourcesChecked: [], sourcesHit: [], notes, confidence: 0,
  };
}
