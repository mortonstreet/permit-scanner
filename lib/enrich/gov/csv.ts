/**
 * Minimal RFC-4180 CSV reader.
 *
 * The government extracts we consume are quoted, comma-delimited, and contain
 * commas inside quoted fields ("WALTERS, DENNIS D"), so splitting on commas
 * corrupts roughly every other row. No dependency for ~40 lines.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field); field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/** Iterate CSV rows from raw text, skipping blanks. Handles CRLF and a BOM. */
export function* parseCsv(text: string): Generator<string[]> {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of clean.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    yield parseCsvLine(line);
  }
}

/** US phone digits -> (407) 555-1234, or null if it is not a real number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  // Area codes never start with 0 or 1; those rows are placeholder junk.
  if (ten[0] === "0" || ten[0] === "1") return null;
  if (/^(\d)\1{9}$/.test(ten)) return null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
