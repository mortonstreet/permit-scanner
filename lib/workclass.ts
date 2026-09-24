import type { Permit } from "./types";

/**
 * Horizontal versus vertical work.
 *
 * This is the distinction the whole product now turns on, and it comes from
 * how the contract is actually let:
 *
 *   HORIZONTAL (land development, subdivision, mass grading, streets, storm,
 *   wet utilities). The developer contracts DIRECTLY with the sitework
 *   contractor. There is no general contractor in that contract. A developer
 *   contact is the buying party, and reaching them early is worth money.
 *
 *   VERTICAL (commercial ground-up buildings). The GC solicits subcontractor
 *   pricing BEFORE the owner has selected the GC, so at the moment a permit
 *   names a developer the people who can actually buy sitework are the three
 *   to six GCs assembling bids. Worse, standard subcontract language bars a
 *   sub from approaching the owner, and GCs drop subs who do. Selling a
 *   developer contact here hands the buyer a number they must not call.
 *
 * So horizontal work is the segment where an early developer contact is a
 * lead. Vertical work is where it is a liability.
 */

export type WorkClass = "horizontal" | "vertical" | "unknown";

const HORIZONTAL = [
  /\b(subdivision|subdiv|plat(ting)?|land develop\w*|site develop\w*|site plan|masterplan|master plan)\b/i,
  /\b(mass grad\w*|rough grad\w*|land disturb\w*|earthwork|excavat\w*|clearing and grubbing)\b/i,
  /\b(storm ?water|storm ?drain|sanitary sewer|force main|lift station|water main|wet utilit\w*)\b/i,
  /\b(street|roadway|paving|curb and gutter|sidewalk|right[- ]of[- ]way|\brow\b)\b/i,
  /\b(infrastructure|horizontal|offsite improvement|onsite improvement|dry utilit\w*)\b/i,
  /\b(erosion control|npdes|environmental resource|dredge|fill permit)\b/i,
];

const VERTICAL = [
  /\b(new building|new construction|building permit|shell|core and shell|tenant improvement)\b/i,
  /\b(addition|alteration|remodel|renovation|interior)\b/i,
  /\b(single family|sfr|townhome|duplex|apartment building|dwelling)\b/i,
  /\b(roof\w*|window|door|hvac|mechanical|electrical|plumbing fixture)\b/i,
];

/** Tags that only ever describe horizontal scope. */
const HORIZONTAL_TAGS = new Set(["excavation", "sitework", "grading", "utilities", "paving"]);
/** Tags that describe work on a structure. */
const VERTICAL_TAGS = new Set(["roofing", "window_door", "remodel", "electrical", "plumbing", "mechanical", "solar", "pool"]);

export interface WorkClassResult {
  workClass: WorkClass;
  /** 0-1. Low confidence means the evidence was thin, not that it is vertical. */
  confidence: number;
  /** What drove the call, shown so the classification is never opaque. */
  basis: string;
}

/**
 * Classify a permit.
 *
 * Structural evidence outranks text: an acreage or lot count means land
 * development regardless of how the description is worded, while a building
 * area means a structure.
 */
export function classifyWork(permit: Permit): WorkClassResult {
  const text = [permit.description, permit.permit_type, permit.permit_number]
    .filter(Boolean).join(" ");

  // An entitlement-stage filing with acreage is land development by definition.
  if (permit.stage === "entitlement") {
    const acres = readAcreage(permit);
    if (acres != null && acres >= 1) {
      return { workClass: "horizontal", confidence: 0.9, basis: `Entitlement filing over ${acres} acres` };
    }
  }

  const horizontalTag = permit.tags.find((t) => HORIZONTAL_TAGS.has(t));
  const verticalTag = permit.tags.find((t) => VERTICAL_TAGS.has(t));

  const horizontalHit = HORIZONTAL.some((re) => re.test(text));
  const verticalHit = VERTICAL.some((re) => re.test(text));

  // A building area with no sitework signal is a structure.
  if (permit.property.building_area_sqft && !horizontalHit && !horizontalTag) {
    return { workClass: "vertical", confidence: 0.75, basis: "Reports a building area and no sitework scope" };
  }

  if (horizontalHit && !verticalHit) {
    return { workClass: "horizontal", confidence: 0.85, basis: "Scope describes land development or sitework" };
  }
  if (horizontalTag && !verticalTag) {
    return { workClass: "horizontal", confidence: 0.7, basis: `Tagged ${horizontalTag}` };
  }
  if (verticalHit && !horizontalHit) {
    return { workClass: "vertical", confidence: 0.75, basis: "Scope describes work on a structure" };
  }
  if (horizontalHit && verticalHit) {
    // A ground-up building with a sitework component: the sitework is almost
    // always let by the GC, so treat it as vertical for buying purposes.
    return { workClass: "vertical", confidence: 0.55, basis: "Building scope with sitework attached; the GC lets that package" };
  }

  return { workClass: "unknown", confidence: 0.2, basis: "Not enough scope detail to classify" };
}

/** Acreage lives in different places depending on the feed. */
function readAcreage(permit: Permit): number | null {
  const raw = permit.source_fields["Acreage"] ?? permit.source_fields["acreage"]
    ?? permit.source_fields["ACRES"] ?? permit.source_fields["acres"];
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

export { readAcreage };

/**
 * Is this a lead where the developer can actually award the work?
 *
 * Horizontal scope, developer-let. This is the filter that separates a lead
 * from a contact the buyer is contractually discouraged from calling.
 */
export function isDeveloperLet(permit: Permit): boolean {
  return classifyWork(permit).workClass === "horizontal";
}
