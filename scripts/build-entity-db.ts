import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { officerRank, officerTitle, parseSunbizRecord, readableName } from "../lib/enrich/gov/sunbiz-layout";

/**
 * Build the Florida entity-resolution database.
 *
 * Turns the SunBiz bulk files into one SQLite file the app can query:
 *
 *   entities   12.8M FL corporations and LLCs, with a normalized name index
 *   officers   registered agents and up to six officers per entity
 *   emails     10.7M document-number -> email pairs
 *
 * SQLite because the email index alone would be well over a gigabyte in
 * memory, and because name lookup wants a real index rather than a scan.
 *
 *   pnpm entity:build
 *   pnpm entity:build --emails-only
 */

const DATA_DIR = process.env.SUNBIZ_DATA_DIR ?? path.join(homedir(), ".permit-stack-data");
const OUT = process.env.ENTITY_DB_PATH ?? path.join(DATA_DIR, "fl-entities.sqlite");

/** Same normalization the runtime lookup uses; they must not drift. */
export function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[.,'"()&]/g, " ").replace(/\s+/g, " ").trim();
}

function looseName(name: string): string {
  return normalizeName(name)
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|LLLP|PA|PLLC|PLC|PC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createSchema(db: DatabaseSync) {
  db.exec(`
    pragma journal_mode = off;
    pragma synchronous = off;
    pragma temp_store = memory;

    create table if not exists entities (
      doc_number   text primary key,
      name         text not null,
      name_norm    text not null,
      name_loose   text not null,
      status       text,
      filing_type  text,
      city         text,
      state        text,
      zip          text,
      mail_city    text,
      mail_state   text,
      file_date    text,
      agent_name   text,
      agent_type   text,
      agent_city   text
    );

    create table if not exists officers (
      doc_number text not null,
      seq        integer not null,
      title      text,
      type       text,
      name_raw   text not null,
      name_read  text,
      city       text,
      state      text,
      rank       integer not null default 7
    );

    create table if not exists emails (
      doc_number text primary key,
      email      text not null
    );
  `);
}

function createIndexes(db: DatabaseSync) {
  console.log("  building indexes (this is the slow part)...");
  db.exec(`
    create index if not exists entities_name_norm  on entities (name_norm);
    create index if not exists entities_name_loose on entities (name_loose);
    create index if not exists officers_doc        on officers (doc_number);
  `);
}

/** Stream a single member out of a zip with the system unzip, avoiding a 18GB temp file. */
function unzipStream(zipPath: string, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
    let count = 0;
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => { onLine(line); count += 1; });
    rl.on("close", () => resolve(count));
    child.on("error", reject);
    child.stderr.on("data", (d) => {
      const msg = String(d);
      if (msg.trim() && !msg.includes("warning")) process.stderr.write(msg);
    });
  });
}

async function loadEmails(db: DatabaseSync, zipPath: string): Promise<number> {
  console.log(`\nemails: ${path.basename(zipPath)} (${(statSync(zipPath).size / 1e6).toFixed(0)} MB)`);
  const insert = db.prepare("insert or replace into emails (doc_number, email) values (?, ?)");
  let n = 0;
  db.exec("begin");
  const seen = await unzipStream(zipPath, (line) => {
    // "docnumber,email" with a BOM on the first line.
    const clean = n === 0 ? line.replace(/^﻿/, "") : line;
    const comma = clean.indexOf(",");
    if (comma <= 0) return;
    const doc = clean.slice(0, comma).trim();
    const email = clean.slice(comma + 1).trim().toLowerCase();
    if (!doc || !email.includes("@")) return;
    insert.run(doc, email);
    n += 1;
    if (n % 1_000_000 === 0) {
      db.exec("commit"); db.exec("begin");
      console.log(`    ${(n / 1e6).toFixed(0)}M`);
    }
  });
  db.exec("commit");
  console.log(`  ${n.toLocaleString()} emails from ${seen.toLocaleString()} lines`);
  return n;
}

async function loadEntities(db: DatabaseSync, zipPath: string): Promise<number> {
  console.log(`\nentities: ${path.basename(zipPath)} (${(statSync(zipPath).size / 1e9).toFixed(2)} GB)`);
  const insEntity = db.prepare(`insert or replace into entities
    (doc_number,name,name_norm,name_loose,status,filing_type,city,state,zip,mail_city,mail_state,file_date,agent_name,agent_type,agent_city)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insOfficer = db.prepare(`insert into officers
    (doc_number,seq,title,type,name_raw,name_read,city,state,rank) values (?,?,?,?,?,?,?,?,?)`);

  let n = 0, officerRows = 0;
  db.exec("begin");
  await unzipStream(zipPath, (line) => {
    const rec = parseSunbizRecord(line);
    if (!rec) return;

    insEntity.run(
      rec.docNumber, rec.name, normalizeName(rec.name), looseName(rec.name),
      rec.status, rec.filingType, rec.city, rec.state, rec.zip,
      rec.mailCity, rec.mailState, rec.fileDate,
      rec.registeredAgentName, rec.registeredAgentType, rec.registeredAgentCity,
    );

    rec.officers.forEach((o, i) => {
      insOfficer.run(
        rec.docNumber, i, officerTitle(o.title), o.type, o.name,
        readableName(o.name, o.type !== "C"), o.city, o.state, officerRank(o.title),
      );
      officerRows += 1;
    });

    n += 1;
    if (n % 500_000 === 0) {
      db.exec("commit"); db.exec("begin");
      console.log(`    ${(n / 1e6).toFixed(1)}M entities, ${(officerRows / 1e6).toFixed(1)}M officers`);
    }
  });
  db.exec("commit");
  console.log(`  ${n.toLocaleString()} entities, ${officerRows.toLocaleString()} officer rows`);
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const emailsOnly = args.includes("--emails-only");
  const entitiesOnly = args.includes("--entities-only");

  mkdirSync(path.dirname(OUT), { recursive: true });
  console.log(`Building ${OUT}`);

  const db = new DatabaseSync(OUT);
  createSchema(db);

  if (!entitiesOnly) {
    const emailZip = [...Array(8).keys()]
      .map((i) => path.join(DATA_DIR, `email_2026_q${(i % 4) + 1}.zip`))
      .find((p) => existsSync(p))
      ?? path.join(DATA_DIR, "email_2026_q2.zip");
    if (existsSync(emailZip)) await loadEmails(db, emailZip);
    else console.log(`  skipped emails: ${emailZip} not found`);
  }

  if (!emailsOnly) {
    const corZip = path.join(DATA_DIR, "cordata.zip");
    if (existsSync(corZip)) await loadEntities(db, corZip);
    else console.log(`  skipped entities: ${corZip} not found (run scripts/sunbiz-fetch.py cor)`);
  }

  createIndexes(db);

  const counts = {
    entities: (db.prepare("select count(*) c from entities").get() as { c: number }).c,
    officers: (db.prepare("select count(*) c from officers").get() as { c: number }).c,
    emails: (db.prepare("select count(*) c from emails").get() as { c: number }).c,
  };
  db.close();

  console.log(`\nDone. ${(statSync(OUT).size / 1e9).toFixed(2)} GB`);
  console.log(`  entities ${counts.entities.toLocaleString()}`);
  console.log(`  officers ${counts.officers.toLocaleString()}`);
  console.log(`  emails   ${counts.emails.toLocaleString()}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
