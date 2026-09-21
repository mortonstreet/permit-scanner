import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname } from "node:path";
import { normalizePhone, parseCsv } from "../lib/enrich/gov/csv";

/**
 * Pre-build the Florida DBPR lookup index.
 *
 * DBPR blocks datacenter IPs, so the deployed app cannot fetch these CSVs
 * itself. This builds a compact artifact from a network DBPR allows (a laptop,
 * or the Railway worker if its egress is permitted) and writes it to
 * data/fl-dbpr-index.json.gz, which the app loads instead.
 *
 *   pnpm gov:build-index
 *
 * 61MB of CSV collapses to a few MB: we keep only the fields the lookup needs.
 */

const APPLICANTS_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts/constr_app.csv";
const LICENCES_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts//CONSTRUCTIONLICENSE_1.csv";
const OUT = "data/fl-dbpr-index.json.gz";

/** Arrays rather than objects: the key names would otherwise dominate the file. */
type PersonTuple = [first: string, last: string, phone: string | null, city: string | null, type: string | null];
type FirmTuple = [firm: string, qFirst: string | null, qLast: string | null, licence: string | null, status: string | null, city: string | null];

async function get(url: string, label: string): Promise<string> {
  process.stdout.write(`  fetching ${label}... `);
  const res = await fetch(url, { headers: { "user-agent": "permit-stack/0.1" } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}${res.status === 403 ? " (DBPR blocks this network)" : ""}`);
  const text = await res.text();
  console.log(`${(text.length / 1e6).toFixed(1)} MB`);
  return text;
}

function normalizeFirmKey(name: string): string {
  return name.toUpperCase().replace(/[.,'"()&]/g, " ").replace(/\s+/g, " ").trim();
}

function splitQualifier(raw: string): { first: string | null; last: string | null } {
  const [last, rest] = raw.split(",", 2).map((s) => s?.trim() ?? "");
  if (!last) return { first: null, last: null };
  if (!rest) return { first: null, last };
  return { first: rest.split(/\s+/)[0] ?? null, last };
}

async function main() {
  console.log("Building the Florida DBPR index\n");

  const [applicantsCsv, licencesCsv] = await Promise.all([
    get(APPLICANTS_URL, "constr_app.csv"),
    get(LICENCES_URL, "CONSTRUCTIONLICENSE_1.csv"),
  ]);

  const people: Record<string, PersonTuple> = {};
  let applicants = 0, withPhone = 0;

  for (const row of parseCsv(applicantsCsv)) {
    if (row.length < 14) continue;
    const first = row[2]?.trim(), last = row[4]?.trim();
    if (!first || !last) continue;
    applicants += 1;
    const phone = normalizePhone(row[13]);
    if (phone) withPhone += 1;
    const key = `${last.toUpperCase()}|${first.toUpperCase()}`;
    // Never let a phoneless duplicate overwrite a usable record.
    if (people[key]?.[2] && !phone) continue;
    people[key] = [first, last, phone, row[9]?.trim() || null, row[1]?.trim() || null];
  }

  const firms: Record<string, FirmTuple> = {};
  const byLicence: Record<string, string> = {};

  for (const row of parseCsv(licencesCsv)) {
    if (row.length < 21) continue;
    const prefix = row[1]?.trim();
    const col2 = row[2]?.trim() ?? "";
    const business = row[3]?.trim() ?? "";
    // QB rows are the entity registration itself and name no human.
    if (prefix === "QB" || !business) continue;

    const { first, last } = splitQualifier(col2);
    if (!last) continue;

    const licence = row[20]?.trim() || null;
    const status = row[14]?.trim() || null;
    const key = normalizeFirmKey(business);
    const existing = firms[key];
    if (!existing || (existing[4] !== "A" && status === "A")) {
      firms[key] = [business, first, last, licence, status, row[8]?.trim() || null];
    }
    if (licence) byLicence[licence.toUpperCase()] = key;
  }

  const payload = {
    built_at: new Date().toISOString(),
    source: "FL DBPR public licence extracts",
    counts: { applicants, withPhone, firms: Object.keys(firms).length },
    people,
    firms,
    byLicence,
  };

  const json = JSON.stringify(payload);
  const gz = gzipSync(json, { level: 9 });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gz);

  console.log(`\n  applicants ${applicants.toLocaleString()} (${((100 * withPhone) / applicants).toFixed(1)}% with phone)`);
  console.log(`  firms      ${Object.keys(firms).length.toLocaleString()} with a named qualifier`);
  console.log(`  ${OUT}: ${(json.length / 1e6).toFixed(1)} MB -> ${(gz.length / 1e6).toFixed(1)} MB gzipped`);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
