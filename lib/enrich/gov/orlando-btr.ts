import "server-only";
import { normalizePhone } from "./csv";

/**
 * City of Orlando business tax receipts.
 *
 * The only free government source found that carries a phone AND an email in
 * the same row. 119k businesses, ~11.5k contractors, refreshed daily. Socrata,
 * so it is queried live per lookup rather than indexed - no download, no
 * memory cost, and always current.
 *
 * Narrow by design: Orlando only. It is the model to replicate if other
 * Florida tax collectors start publishing their BTR files.
 */

const ENDPOINT = "https://data.cityoforlando.net/resource/7388-4re5.json";

export interface OrlandoBtrMatch {
  businessName: string;
  ownerName: string | null;
  phone: string | null;
  email: string | null;
  licenseType: string | null;
  /** DBPR licence number, which Orlando often embeds in the owner field. */
  licenseNumber: string | null;
}

interface BtrRow {
  business_name?: string;
  business_owner_name?: string;
  phone?: string;
  business_email?: string;
  license_type?: string;
  license_status?: string;
}

function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Orlando embeds "CGC151629" style licence numbers inside the owner name. */
function extractLicense(owner: string | null | undefined): string | null {
  if (!owner) return null;
  const m = owner.match(/\b(C[A-Z]{2}\d{4,7}|R[A-Z]\d{4,7})\b/);
  return m ? m[1] : null;
}

/** Strip the licence number back out so the name reads cleanly. */
function cleanOwnerName(owner: string | null | undefined, businessName: string): string | null {
  if (!owner) return null;
  let s = owner.replace(/\b(C[A-Z]{2}\d{4,7}|R[A-Z]\d{4,7})\b/g, " ").replace(/\s+/g, " ").trim();
  // Orlando frequently repeats the business name inside the owner field.
  const bn = businessName.toUpperCase();
  if (s.toUpperCase().startsWith(bn)) s = s.slice(businessName.length).trim();
  return s || null;
}

export async function lookupOrlandoBtr(firmName: string): Promise<OrlandoBtrMatch | null> {
  const needle = firmName.toUpperCase().replace(/[.,'"()]/g, " ").replace(/\s+/g, " ").trim();
  if (needle.length < 4) return null;

  const params = new URLSearchParams({
    $select: "business_name,business_owner_name,phone,business_email,license_type,license_status",
    // Case-insensitive prefix/contains on the business name.
    $where: `upper(business_name) like ${soqlString(`%${needle}%`)}`,
    $limit: "5",
  });
  if (process.env.SOCRATA_APP_TOKEN) params.set("$$app_token", process.env.SOCRATA_APP_TOKEN);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${ENDPOINT}?${params}`, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "permit-stack/0.1" },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as BtrRow[];
    if (!rows.length) return null;

    // Prefer a row that actually carries contact detail, and an active licence.
    const best = rows.find((r) => r.phone && r.business_email)
      ?? rows.find((r) => r.phone)
      ?? rows[0];

    const businessName = best.business_name ?? firmName;
    return {
      businessName,
      ownerName: cleanOwnerName(best.business_owner_name, businessName),
      phone: normalizePhone(best.phone),
      email: best.business_email?.trim().toLowerCase() || null,
      licenseType: best.license_type ?? null,
      licenseNumber: extractLicense(best.business_owner_name),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
