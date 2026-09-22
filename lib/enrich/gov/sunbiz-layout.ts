/**
 * Florida SunBiz corporate data file layout.
 *
 * Fixed-width, 1,440 characters per record. Official definition:
 * https://dos.sunbiz.org/data-definitions/cor.html
 *
 * Offsets below are 0-based (the published spec is 1-based, so each is the
 * documented start minus one).
 */

export interface SunbizOfficer {
  title: string;
  /** P = person, C = company. */
  type: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface SunbizRecord {
  docNumber: string;
  name: string;
  /** A = active, I = inactive. */
  status: string;
  /** FLAL = FL LLC, FORL = foreign LLC, DOMP = domestic profit corp, ... */
  filingType: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  mailAddress1: string;
  mailCity: string;
  mailState: string;
  mailZip: string;
  fileDate: string;
  feiNumber: string;
  registeredAgentName: string;
  registeredAgentType: string;
  registeredAgentAddress: string;
  registeredAgentCity: string;
  registeredAgentState: string;
  officers: SunbizOfficer[];
}

export const RECORD_LENGTH = 1440;

function slice(line: string, start: number, len: number): string {
  return line.slice(start, start + len).trim();
}

/**
 * Person names are packed fixed-width inside the 42-char name field:
 * surname padded to 20 characters, then the given name, then a middle name.
 * Splitting on whitespace merges them, so slice by position instead.
 */
export function splitPackedName(raw: string): { last: string; first: string; middle: string } | null {
  if (raw.length < 20) {
    // Short fields are company names or malformed; the caller decides.
    return null;
  }
  const last = raw.slice(0, 20).trim();
  const rest = raw.slice(20).trim();
  if (!last) return null;
  const parts = rest.split(/\s+/).filter(Boolean);
  return { last, first: parts[0] ?? "", middle: parts.slice(1).join(" ") };
}

/** Render a packed name as "First Last", or the raw value for a company. */
export function readableName(raw: string, isPerson: boolean): string {
  if (!isPerson) return raw.trim();
  const parts = splitPackedName(raw);
  if (!parts || !parts.first) return raw.trim();
  return `${parts.first} ${parts.last}`;
}

export function parseSunbizRecord(line: string): SunbizRecord | null {
  if (line.length < 700) return null;

  const docNumber = slice(line, 0, 12);
  const name = slice(line, 12, 192);
  if (!docNumber || !name) return null;

  const officers: SunbizOfficer[] = [];
  // Six officer blocks of 128 bytes each, starting at offset 668.
  for (let i = 0; i < 6; i += 1) {
    const base = 668 + i * 128;
    if (base + 128 > line.length) break;
    const officerName = slice(line, base + 5, 42);
    if (!officerName) continue;
    officers.push({
      title: slice(line, base, 4),
      type: slice(line, base + 4, 1),
      name: officerName,
      address: slice(line, base + 47, 42),
      city: slice(line, base + 89, 28),
      state: slice(line, base + 117, 2),
      zip: slice(line, base + 119, 9),
    });
  }

  return {
    docNumber,
    name,
    status: slice(line, 204, 1),
    filingType: slice(line, 205, 15),
    address1: slice(line, 220, 42),
    city: slice(line, 304, 28),
    state: slice(line, 332, 2),
    zip: slice(line, 334, 10),
    mailAddress1: slice(line, 346, 42),
    mailCity: slice(line, 430, 28),
    mailState: slice(line, 458, 2),
    mailZip: slice(line, 460, 10),
    fileDate: slice(line, 472, 8),
    feiNumber: slice(line, 480, 14),
    registeredAgentName: slice(line, 544, 42),
    registeredAgentType: slice(line, 586, 1),
    registeredAgentAddress: slice(line, 587, 42),
    registeredAgentCity: slice(line, 629, 28),
    registeredAgentState: slice(line, 657, 2),
    officers,
  };
}

/** Officer title codes used by the corporate file. */
export const OFFICER_TITLES: Record<string, string> = {
  P: "President",
  V: "Vice President",
  T: "Treasurer",
  S: "Secretary",
  C: "Chairman",
  D: "Director",
  MGR: "Manager",
  MGRM: "Managing Member",
  AMBR: "Authorized Member",
  AP: "Authorized Person",
  CEO: "CEO",
  CFO: "CFO",
  PRES: "President",
  VP: "Vice President",
  TREA: "Treasurer",
  SECR: "Secretary",
};

export function officerTitle(code: string): string {
  const c = code.trim().toUpperCase();
  return OFFICER_TITLES[c] ?? (c || "Officer");
}

/**
 * How likely is this officer the person who actually decides?
 * Lower is better. Managing members and presidents run small FL entities.
 */
export function officerRank(code: string): number {
  const c = code.trim().toUpperCase();
  if (["MGRM", "AMBR", "MGR", "AP"].includes(c)) return 0;   // LLC control roles
  if (["P", "PRES", "CEO"].includes(c)) return 1;
  if (["C"].includes(c)) return 2;
  if (["V", "VP"].includes(c)) return 3;
  if (["T", "TREA", "CFO"].includes(c)) return 4;
  if (["S", "SECR"].includes(c)) return 5;
  if (["D"].includes(c)) return 6;
  return 7;
}
