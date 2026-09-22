import "server-only";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Florida entity resolution against the SunBiz registry.
 *
 * Answers the question the whole product depends on: given a company name on
 * a permit, who actually runs it and how do we reach them?
 *
 * Backed by the SQLite database that scripts/build-entity-db.ts produces:
 *   12.8M entities, their registered agents and officers, and 10.7M emails
 *   keyed by document number.
 *
 * SQLite rather than an in-memory index because the email table alone would
 * be well over a gigabyte resident, and name lookup wants a real B-tree.
 */

const DB_PATH = process.env.ENTITY_DB_PATH
  ?? path.join(process.env.SUNBIZ_DATA_DIR ?? path.join(homedir(), ".permit-stack-data"), "fl-entities.sqlite");

let db: DatabaseSync | null | undefined;

function getDb(): DatabaseSync | null {
  if (db !== undefined) return db;
  if (!existsSync(DB_PATH)) { db = null; return null; }
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    return db;
  } catch {
    db = null;
    return null;
  }
}

export function entityDbAvailable(): boolean {
  return getDb() !== null;
}

export interface SunbizOfficerRow {
  title: string;
  type: string;
  name: string;
  city: string | null;
  state: string | null;
  rank: number;
}

export interface SunbizEntity {
  docNumber: string;
  name: string;
  status: string | null;
  filingType: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  fileDate: string | null;
  registeredAgent: { name: string; type: string | null; city: string | null } | null;
  officers: SunbizOfficerRow[];
  email: string | null;
}

export type MatchMethod = "exact" | "loose" | "none";

export interface EntityMatch {
  entity: SunbizEntity | null;
  method: MatchMethod;
  /** 0-1. Exact-name matches on an active entity score highest. */
  confidence: number;
  /** Other entities that matched equally well; >0 means the name is ambiguous. */
  alternates: number;
  note?: string;
}

function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[.,'"()&]/g, " ").replace(/\s+/g, " ").trim();
}

function looseName(name: string): string {
  return normalizeName(name)
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|LLLP|PA|PLLC|PLC|PC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface EntityRow {
  doc_number: string; name: string; status: string | null; filing_type: string | null;
  city: string | null; state: string | null; zip: string | null; file_date: string | null;
  agent_name: string | null; agent_type: string | null; agent_city: string | null;
}

function hydrate(conn: DatabaseSync, row: EntityRow): SunbizEntity {
  const officers = conn
    .prepare("select title, type, name_read, name_raw, city, state, rank from officers where doc_number = ? order by rank, seq")
    .all(row.doc_number) as Array<Record<string, unknown>>;

  const email = conn
    .prepare("select email from emails where doc_number = ?")
    .get(row.doc_number) as { email?: string } | undefined;

  return {
    docNumber: row.doc_number,
    name: row.name,
    status: row.status,
    filingType: row.filing_type,
    city: row.city,
    state: row.state,
    zip: row.zip,
    fileDate: row.file_date,
    registeredAgent: row.agent_name
      ? { name: row.agent_name, type: row.agent_type, city: row.agent_city }
      : null,
    officers: officers.map((o) => ({
      title: String(o.title ?? "Officer"),
      type: String(o.type ?? ""),
      name: String(o.name_read ?? o.name_raw ?? ""),
      city: (o.city as string) ?? null,
      state: (o.state as string) ?? null,
      rank: Number(o.rank ?? 7),
    })),
    email: email?.email ?? null,
  };
}

/**
 * Resolve a company name to a Florida entity.
 *
 * Exact normalized match first. The suffix-insensitive fallback is scored much
 * lower on purpose: it was measured to over-match across entity types,
 * collapsing "A TO Z POOLS LLC" onto "A TO Z POOLS, INC." - different
 * companies. It is a hint, never an assertion.
 */
export function resolveEntity(companyName: string, hints: { city?: string | null } = {}): EntityMatch {
  const conn = getDb();
  if (!conn) return { entity: null, method: "none", confidence: 0, alternates: 0, note: "Entity database not built." };

  const norm = normalizeName(companyName);
  if (norm.length < 4) return { entity: null, method: "none", confidence: 0, alternates: 0 };

  const exact = conn
    .prepare("select * from entities where name_norm = ? order by (status = 'A') desc, file_date desc limit 6")
    .all(norm) as unknown as EntityRow[];

  if (exact.length > 0) {
    const picked = pickByCity(exact, hints.city);
    const active = picked.status === "A";
    return {
      entity: hydrate(conn, picked),
      method: "exact",
      // An inactive entity is still the right company, just dormant.
      confidence: active ? 0.94 : 0.8,
      alternates: exact.length - 1,
    };
  }

  const loose = looseName(companyName);
  if (loose.length >= 6) {
    const rows = conn
      .prepare("select * from entities where name_loose = ? order by (status = 'A') desc, file_date desc limit 6")
      .all(loose) as unknown as EntityRow[];
    if (rows.length > 0) {
      const picked = pickByCity(rows, hints.city);
      return {
        entity: hydrate(conn, picked),
        method: "loose",
        // Deliberately low: the entity suffix differs, so this may be a
        // different legal entity with a similar name.
        confidence: rows.length === 1 ? 0.6 : 0.45,
        alternates: rows.length - 1,
        note: rows.length > 1 ? `${rows.length} entities share this name without its suffix.` : undefined,
      };
    }
  }

  return { entity: null, method: "none", confidence: 0, alternates: 0 };
}

/** When several entities share a name, prefer the one in the permit's city. */
function pickByCity(rows: EntityRow[], city: string | null | undefined): EntityRow {
  if (!city) return rows[0];
  const want = city.toUpperCase().trim();
  return rows.find((r) => (r.city ?? "").toUpperCase().trim() === want) ?? rows[0];
}

/** Look up an email by document number alone, for a known entity. */
export function emailForDoc(docNumber: string): string | null {
  const conn = getDb();
  if (!conn) return null;
  const row = conn.prepare("select email from emails where doc_number = ?").get(docNumber) as { email?: string } | undefined;
  return row?.email ?? null;
}

export interface EntityDbStats {
  available: boolean;
  path: string;
  entities: number;
  officers: number;
  emails: number;
}

export function entityDbStats(): EntityDbStats {
  const conn = getDb();
  if (!conn) return { available: false, path: DB_PATH, entities: 0, officers: 0, emails: 0 };
  const one = (sql: string) => (conn.prepare(sql).get() as { c: number }).c;
  return {
    available: true,
    path: DB_PATH,
    entities: one("select count(*) c from entities"),
    officers: one("select count(*) c from officers"),
    emails: one("select count(*) c from emails"),
  };
}
