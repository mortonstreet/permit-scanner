import "server-only";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { normalizePhone, parseCsv } from "./csv";
import { fetchText, getIndex } from "./index-store";

/**
 * Florida DBPR public licence extracts.
 *
 * Two free, unauthenticated CSVs, regenerated every morning:
 *
 *   constr_app.csv             104k construction licence applicants, 98% have
 *                              a phone number. This is where the phones are.
 *   CONSTRUCTIONLICENSE_1.csv  260k licence rows. For individual certifications
 *                              it names the qualifying human AND the firm they
 *                              qualify, which is the company -> person bridge.
 *
 * Chained, these turn a company name on a permit into a named human with a
 * phone, for nothing. Measured against the full DBPR corpus, about a third of
 * licensed Florida construction firms resolve all the way through.
 *
 * Neither file carries an email address.
 */

const APPLICANTS_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts/constr_app.csv";
const LICENCES_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts//CONSTRUCTIONLICENSE_1.csv";

export interface DbprPerson {
  firstName: string;
  lastName: string;
  phone: string | null;
  city: string | null;
  licenseType: string | null;
}

export interface DbprFirm {
  firmName: string;
  /** Qualifying individual, as DBPR stores it: "LAST, FIRST M". */
  qualifierRaw: string;
  qualifierFirst: string | null;
  qualifierLast: string | null;
  licenseNumber: string | null;
  status: string | null;
  city: string | null;
}

export interface DbprIndex {
  /** "LAST|FIRST" -> applicant record with a phone. */
  peopleByName: Map<string, DbprPerson>;
  /** normalized firm name -> the human who qualifies that licence. */
  firmsByName: Map<string, DbprFirm>;
  /** licence number -> firm, for the highest-precision join when a feed has one. */
  firmsByLicense: Map<string, DbprFirm>;
  counts: { applicants: number; withPhone: number; firms: number; licences: number };
}

/**
 * Normalize a firm name for matching.
 *
 * Deliberately conservative: punctuation and spacing only. Stripping entity
 * suffixes was measured to over-match, collapsing "A TO Z POOLS LLC" onto
 * "A TO Z POOLS, INC." - different legal entities. The suffix stays part of
 * the key.
 */
export function normalizeFirmKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'"()&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Looser key, used only as a scored fallback after the strict key misses. */
export function looseFirmKey(name: string): string {
  return normalizeFirmKey(name)
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|LLLP|PA|PLLC|PLC|PC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function personKey(last: string, first: string): string {
  return `${last.toUpperCase().trim()}|${first.toUpperCase().trim()}`;
}

/** "WALTERS, DENNIS D" -> { last: "WALTERS", first: "DENNIS" } */
function splitQualifier(raw: string): { first: string | null; last: string | null } {
  const [last, rest] = raw.split(",", 2).map((s) => s?.trim() ?? "");
  if (!last) return { first: null, last: null };
  if (!rest) return { first: null, last };
  const first = rest.split(/\s+/)[0] ?? null;
  return { first, last };
}

/** Shape written by scripts/build-gov-index.ts. Tuples, not objects, to keep it small. */
interface PrebuiltIndex {
  built_at: string;
  counts: { applicants: number; withPhone: number; firms: number };
  people: Record<string, [string, string, string | null, string | null, string | null]>;
  firms: Record<string, [string, string | null, string | null, string | null, string | null, string | null]>;
  byLicence: Record<string, string>;
}

/**
 * Load the pre-built artifact if it is present.
 *
 * DBPR blocks datacenter IPs, so the deployed app cannot fetch the CSVs at
 * runtime. `pnpm gov:build-index` produces this file from an allowed network
 * and it ships with the deployment.
 */
async function loadPrebuilt(): Promise<DbprIndex | null> {
  try {
    const file = path.join(process.cwd(), "data", "fl-dbpr-index.json.gz");
    const raw = await readFile(file);
    const parsed = JSON.parse(gunzipSync(raw).toString("utf8")) as PrebuiltIndex;

    const peopleByName = new Map<string, DbprPerson>();
    for (const [key, t] of Object.entries(parsed.people)) {
      peopleByName.set(key, { firstName: t[0], lastName: t[1], phone: t[2], city: t[3], licenseType: t[4] });
    }

    const firmsByName = new Map<string, DbprFirm>();
    for (const [key, t] of Object.entries(parsed.firms)) {
      firmsByName.set(key, {
        firmName: t[0], qualifierRaw: [t[2], t[1]].filter(Boolean).join(", "),
        qualifierFirst: t[1], qualifierLast: t[2],
        licenseNumber: t[3], status: t[4], city: t[5],
      });
    }

    const firmsByLicense = new Map<string, DbprFirm>();
    for (const [licence, firmKey] of Object.entries(parsed.byLicence)) {
      const firm = firmsByName.get(firmKey);
      if (firm) firmsByLicense.set(licence, firm);
    }

    return {
      peopleByName, firmsByName, firmsByLicense,
      counts: { ...parsed.counts, licences: firmsByLicense.size },
    };
  } catch {
    // No artifact, or it is unreadable: fall through to the live fetch.
    return null;
  }
}

async function buildIndex(): Promise<DbprIndex> {
  const prebuilt = await loadPrebuilt();
  if (prebuilt) return prebuilt;

  const [applicantsCsv, licencesCsv] = await Promise.all([
    fetchText(APPLICANTS_URL, { label: "DBPR applicants", timeoutMs: 120_000 }),
    fetchText(LICENCES_URL, { label: "DBPR licences", timeoutMs: 180_000 }),
  ]);

  const peopleByName = new Map<string, DbprPerson>();
  let applicants = 0;
  let withPhone = 0;

  // constr_app.csv has no header. Columns by position:
  // 0 board 1 licence type 2 first 3 middle 4 last 5 suffix 6 street
  // 7,8 addr2/3  9 city 10 state 11 zip 12 county 13 PHONE
  for (const row of parseCsv(applicantsCsv)) {
    if (row.length < 14) continue;
    const first = row[2]?.trim();
    const last = row[4]?.trim();
    if (!first || !last) continue;

    applicants += 1;
    const phone = normalizePhone(row[13]);
    if (phone) withPhone += 1;

    const key = personKey(last, first);
    const existing = peopleByName.get(key);
    // Keep the first record that actually has a phone; a later phoneless
    // duplicate must not overwrite a usable one.
    if (existing?.phone && !phone) continue;

    peopleByName.set(key, {
      firstName: first,
      lastName: last,
      phone,
      city: row[9]?.trim() || null,
      licenseType: row[1]?.trim() || null,
    });
  }

  const firmsByName = new Map<string, DbprFirm>();
  const firmsByLicense = new Map<string, DbprFirm>();
  let licences = 0;

  // CONSTRUCTIONLICENSE_1.csv, no header. Columns by position:
  // 1 prefix  2 person OR entity  3 business name  8 city  14 status  20 licence no
  for (const row of parseCsv(licencesCsv)) {
    if (row.length < 21) continue;
    licences += 1;

    const prefix = row[1]?.trim();
    const col2 = row[2]?.trim() ?? "";
    const businessName = row[3]?.trim() ?? "";

    // "QB" rows are qualifying-business registrations: the entity sits in col2
    // and there is no separate human. Only the individual certifications
    // (CGC, CBC, CAC...) carry the person -> firm relationship we want.
    if (prefix === "QB" || !businessName) continue;

    const { first, last } = splitQualifier(col2);
    if (!last) continue;

    const firm: DbprFirm = {
      firmName: businessName,
      qualifierRaw: col2,
      qualifierFirst: first,
      qualifierLast: last,
      licenseNumber: row[20]?.trim() || null,
      status: row[14]?.trim() || null,
      city: row[8]?.trim() || null,
    };

    const key = normalizeFirmKey(businessName);
    const existing = firmsByName.get(key);
    // Prefer an active licence over an inactive one for the same firm.
    if (!existing || (existing.status !== "A" && firm.status === "A")) {
      firmsByName.set(key, firm);
    }
    if (firm.licenseNumber) firmsByLicense.set(firm.licenseNumber.toUpperCase(), firm);
  }

  return {
    peopleByName,
    firmsByName,
    firmsByLicense,
    counts: { applicants, withPhone, firms: firmsByName.size, licences },
  };
}

export function getDbprIndex(): Promise<DbprIndex> {
  // DBPR regenerates these every morning, so a 12h TTL is generous.
  return getIndex("fl-dbpr", buildIndex);
}

export interface DbprMatch {
  firm: DbprFirm | null;
  person: DbprPerson | null;
  /** How the match was made, surfaced so a weak join is visible. */
  via: "license_number" | "firm_exact" | "firm_loose" | "person_name" | null;
  confidence: number;
}

/** Resolve a firm name (and optionally a licence number) to a named human. */
export async function lookupFirm(
  firmName: string,
  licenseNumber?: string | null,
): Promise<DbprMatch> {
  const index = await getDbprIndex();

  // A licence number off the permit is the highest-precision key available.
  if (licenseNumber) {
    const byLicence = index.firmsByLicense.get(licenseNumber.toUpperCase().trim());
    if (byLicence) return withPerson(index, byLicence, "license_number", 0.97);
  }

  const exact = index.firmsByName.get(normalizeFirmKey(firmName));
  if (exact) return withPerson(index, exact, "firm_exact", 0.9);

  // Suffix-insensitive fallback. Scored lower on purpose: it is the strategy
  // that was measured to produce false positives across entity types.
  const loose = looseFirmKey(firmName);
  if (loose.length >= 6) {
    for (const [key, firm] of index.firmsByName) {
      if (looseFirmKey(key) === loose) return withPerson(index, firm, "firm_loose", 0.62);
    }
  }

  return { firm: null, person: null, via: null, confidence: 0 };
}

function withPerson(index: DbprIndex, firm: DbprFirm, via: DbprMatch["via"], confidence: number): DbprMatch {
  if (!firm.qualifierLast || !firm.qualifierFirst) return { firm, person: null, via, confidence };
  const person = index.peopleByName.get(personKey(firm.qualifierLast, firm.qualifierFirst)) ?? null;
  return { firm, person, via, confidence: person?.phone ? confidence : confidence * 0.8 };
}

/** Resolve an individual applicant straight to a phone number. */
export async function lookupPerson(first: string, last: string): Promise<DbprPerson | null> {
  const index = await getDbprIndex();
  return index.peopleByName.get(personKey(last, first)) ?? null;
}
