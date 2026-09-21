/**
 * Firm-name normalization.
 *
 * Permits name the same company a dozen ways: "ABC EXCAVATING LLC",
 * "Abc Excavating, L.L.C.", "ABC EXCAVATING INC.". Collapsing these to one key
 * is what makes the enrichment cache actually hit, which is the difference
 * between paying once per developer and once per permit.
 */

const SUFFIXES = [
  "llc", "l l c", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "lp", "llp", "lllp", "pa", "pllc", "plc", "pc",
  "trust", "rev trust", "revocable trust", "family trust", "holdings", "holding",
  "group", "enterprises", "enterprise", "partners", "partnership", "associates",
];

const NOISE = ["the", "and", "of"];

/** Does this look like a person rather than a company? */
export function looksLikeIndividual(name: string): boolean {
  const cleaned = name.trim();
  if (!cleaned) return false;
  // Any corporate suffix means it is an entity, however short the name.
  const lower = cleaned.toLowerCase().replace(/[.,]/g, "");
  if (SUFFIXES.some((s) => new RegExp(`\\b${s}\\b`).test(lower))) return false;
  // Trusts are entities even without a suffix keyword we matched above.
  if (/\btrust\b|\bestate\b/i.test(cleaned)) return false;

  // Public bodies and institutions are entities however plain the name reads.
  const publicBody = /\b(county|city of|town of|village of|authority|district|board|department|dept|commission|agency|municipal|state of|university|college|school|hospital|church|airport|port)\b/i;
  if (publicBody.test(cleaned)) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 4) return false;
  // Two or three capitalized words with no industry noun reads as a person.
  const industryNoun = /\b(excavat|construct|build|develop|contract|homes?|realty|properties|engineering|electric|plumb|roof|concrete|paving|landscap|marine|dock|services?|solutions?|systems?|industr|supply|management|capital|investment|partners|group|associates|ventures?)\w*/i;
  if (industryNoun.test(cleaned)) return false;
  return words.length >= 2 && words.length <= 3;
}

/** Stable cache key for a firm. */
export function firmKey(name: string): string {
  let s = name.toLowerCase();
  // Collapse dotted initialisms first: "l.l.c." and "l l c" both become "llc",
  // otherwise they split into single letters and never match the suffix list.
  s = s.replace(/\b(?:[a-z]\.){2,}/g, (m) => m.replace(/\./g, ""));
  s = s.replace(/[.,'"()]/g, " ");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9\s-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // "l l c" -> "llc" once punctuation is gone.
  s = s.replace(/\b([a-z])(?: ([a-z]))+\b/g, (m) => m.replace(/ /g, ""));

  const words = s.split(" ").filter((w) => w && !NOISE.includes(w));
  // Strip trailing legal suffixes, which vary between filings of the same firm.
  while (words.length > 1 && SUFFIXES.includes(words[words.length - 1])) words.pop();

  return words.join("-") || s.replace(/\s+/g, "-");
}

/** Human-facing cleanup: collapse whitespace, fix ALL CAPS, keep legal suffixes. */
export function displayFirmName(name: string): string {
  const s = name.trim().replace(/\s+/g, " ");
  if (s !== s.toUpperCase()) return s;
  return s
    .split(" ")
    .map((w) => {
      const bare = w.replace(/[^A-Za-z]/g, "").toLowerCase();
      if (["llc", "inc", "pa", "lp", "llp", "pc", "pllc"].includes(bare)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Guess the firm's web domain from its name. Cheap pre-step: a correct guess
 * lets a provider match on domain, which is far more reliable than name search.
 */
export function guessDomain(name: string): string | null {
  const key = firmKey(name).replace(/-/g, "");
  if (key.length < 4 || key.length > 30) return null;
  return `${key}.com`;
}
