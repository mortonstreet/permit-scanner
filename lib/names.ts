/**
 * Person and firm name normalization.
 *
 * Permit feeds publish names in whatever shape their back office stores them:
 * separate first/last columns, "LAST FIRST" with no comma, "LAST, FIRST M",
 * ALL CAPS, or a company name sitting in a surname field. A lead list is
 * unusable if the name reads "De Jesus" or "Peterson Eric", so this module
 * turns all of those into something a salesperson can say out loud.
 */

/** Suffixes and particles that must not be treated as a surname or capitalized. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "md", "phd", "esq", "pe", "ra"]);
const PARTICLES = new Set(["de", "del", "della", "der", "van", "von", "la", "le", "da", "di", "du", "st", "mc", "mac", "bin", "al"]);

/** Tokens that mean the string is an organization, not a person. */
const ORG_MARKERS = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|lllp|pa|pllc|plc|pc|trust|estate|holdings?|group|enterprises?|partners(hip)?|associates|properties|property|homes?|builders?|construction|contracting|development|developers?|realty|investments?|capital|ventures?|management|services?|solutions?|systems?|industries|supply|county|city|town|village|authority|district|board|department|commission|agency|university|college|school|church|hospital|association|foundation|bank|\bhoa\b)\b/i;

export function isOrganization(name: string): boolean {
  return ORG_MARKERS.test(name);
}

function capitalizeToken(token: string, index: number): string {
  const bare = token.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!bare) return token;
  if (SUFFIXES.has(bare)) return bare.length <= 3 ? bare.toUpperCase() : cap(token);
  // Particles keep the case the source used. US filings write "De Jesus";
  // lowercasing a shouted "DE JESUS" would be our invention, not the record's.
  if (PARTICLES.has(bare) && index > 0 && token === token.toLowerCase()) return bare;
  // O'Brien, McDonald, Smith-Jones.
  if (/^(mc|mac)/i.test(bare) && bare.length > 3) {
    const prefix = /^mac/i.test(bare) ? 3 : 2;
    return cap(token.slice(0, prefix)) + cap(token.slice(prefix));
  }
  if (token.includes("'")) return token.split("'").map(cap).join("'");
  if (token.includes("-")) return token.split("-").map(cap).join("-");
  return cap(token);
}

function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Build a person's display name from whatever the source gave us.
 *
 * Handles the three common shapes:
 *   separate columns          -> ("Katrina", "De Jesus")  => "Katrina De Jesus"
 *   "LAST, FIRST M"           -> "PETERSON, ERIC J"       => "Eric J Peterson"
 *   "LAST FIRST" (no comma)   -> "PETERSON ERIC"          => "Eric Peterson"
 */
export function normalizePersonName(
  input: { first?: string | null; last?: string | null; full?: string | null },
): string | null {
  const first = clean(input.first);
  const last = clean(input.last);

  // Separate columns is the unambiguous case.
  if (first && last) return titleizePerson(`${first} ${last}`);
  // A company name parked in a name column: leave it alone, just de-shout it.
  if (first && !last) return isOrganization(first) ? titleizeOrg(first) : titleizePerson(first);
  if (last && !first) return isOrganization(last) ? titleizeOrg(last) : titleizePerson(last);

  const full = clean(input.full);
  if (!full) return null;
  if (isOrganization(full)) return titleizeOrg(full);

  // "LAST, FIRST MIDDLE"
  if (full.includes(",")) {
    const [surname, rest] = full.split(",", 2).map((s) => s.trim());
    if (surname && rest) return titleizePerson(`${rest} ${surname}`);
  }

  return titleizePerson(reorderIfLastFirst(full));
}

/**
 * Detect the "LAST FIRST" shape that Accela-style systems emit and flip it.
 *
 * Only applied to a bare two-token name with no comma. A given name in the
 * second slot is the signal; without one we leave the order alone, because
 * guessing wrong is worse than leaving it as filed.
 */
function reorderIfLastFirst(full: string): string {
  const tokens = full.split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return full;

  const [a, b] = tokens.map((t) => t.replace(/[^A-Za-z-]/g, "").toLowerCase());
  if (!a || !b) return full;
  // A trailing particle means the surname is already last ("Maria De").
  if (PARTICLES.has(b) || SUFFIXES.has(b)) return full;

  const firstIsGiven = COMMON_GIVEN_NAMES.has(a);
  const secondIsGiven = COMMON_GIVEN_NAMES.has(b);

  // "Peterson Eric" -> only the second token is a given name, so flip.
  if (secondIsGiven && !firstIsGiven) return `${tokens[1]} ${tokens[0]}`;
  return full;
}

export function titleizePerson(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").split(" ").map(capitalizeToken).join(" ");
}

/** True initialisms, which stay uppercase: LLC, PLLC, PA, PC... */
const UPPER_SUFFIXES = new Set(["llc", "lllp", "llp", "lp", "pllc", "plc", "pa", "pc", "hoa", "usa", "dba"]);
/** Abbreviated words, which are title-cased: Inc, Corp, Ltd, Co. */
const WORD_SUFFIXES = new Set(["inc", "corp", "ltd", "co", "incorporated", "corporation", "company", "limited"]);

/**
 * Is this token an initialism the source shouted, like DRB or PGR?
 *
 * All-caps, short, and vowel-free is a reliable tell. Applied only when the
 * source token was already uppercase, so "Homes" is never mangled.
 */
function isInitialism(token: string): boolean {
  const bare = token.replace(/[^A-Za-z]/g, "");
  if (bare.length < 2 || bare.length > 4) return false;
  if (bare !== bare.toUpperCase()) return false;
  return !/[AEIOU]/.test(bare);
}

/** Company names: title-case, but preserve initialisms and legal suffixes. */
export function titleizeOrg(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  return s.split(" ").map((w, i) => {
    const bare = w.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (UPPER_SUFFIXES.has(bare)) return bare.toUpperCase();
    if (WORD_SUFFIXES.has(bare)) return cap(bare);
    if (isInitialism(w)) return w.toUpperCase();
    if (i > 0 && (bare === "and" || bare === "of" || bare === "the")) return bare;
    return capitalizeToken(w, 1);
  }).join(" ");
}

function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, " ");
  if (!s || s.toUpperCase() === "NULL" || s.toUpperCase() === "NA" || s === "-") return null;
  return s;
}

/**
 * The 300 most common US given names, used only to decide whether a bare
 * two-token name is in "LAST FIRST" order. A false negative just leaves the
 * name as filed, which is the safe failure.
 */
const COMMON_GIVEN_NAMES = new Set<string>(`
james robert john michael david william richard joseph thomas christopher charles daniel matthew anthony mark donald
steven paul andrew joshua kenneth kevin brian george timothy ronald jason edward jeffrey ryan jacob gary nicholas eric
jonathan stephen larry justin scott brandon benjamin samuel gregory frank alexander raymond patrick jack dennis jerry
tyler aaron jose adam nathan henry zachary douglas peter kyle noah ethan jeremy walter christian keith roger terry
austin sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel joe logan alan juan albert
willie elijah wayne randy vincent mason roy ralph bobby russell bradley philip eugene ricardo carlos luis miguel angel
manuel rafael pedro fernando hector alberto javier ruben marco oscar sergio andres diego martin
mary patricia jennifer linda elizabeth barbara susan jessica sarah karen nancy lisa margaret betty sandra ashley dorothy
kimberly emily donna michelle carol amanda melissa deborah stephanie rebecca laura sharon cynthia kathleen amy angela
shirley anna brenda pamela nicole ruth katherine samantha christine emma catherine debra virginia rachel carolyn janet
maria heather diane julie joyce victoria kelly christina joan evelyn lauren judith olivia frances martha cheryl megan
andrea hannah jacqueline ann jean alice kathryn gloria teresa doris sara janice julia marie madison grace judy theresa
beverly denise marilyn amber danielle rose brittany diana abigail natalie jane lori alexis tiffany kayla katrina
carmen rosa ana sofia isabella valentina gabriela lucia elena patricia
`.trim().split(/\s+/));
