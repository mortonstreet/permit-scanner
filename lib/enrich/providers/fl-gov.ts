import type {
  CompanyProvider, ContactProvider, ProviderContext, ResolvedCompany, ResolvedContact,
} from "../types";
import { lookupFirm, lookupPerson } from "../gov/fl-dbpr";
import { lookupOrlandoBtr } from "../gov/orlando-btr";
import { isOrganization, titleizePerson } from "../../names";

/**
 * Florida public-records enrichment.
 *
 * First in the waterfall and free, because it is public record: DBPR licence
 * extracts give a firm's qualifying human and their phone, and Orlando's
 * business tax receipts give phone and email together.
 *
 * Unlike the commercial providers, this data carries no resale restriction -
 * it is a public record under Fla. Stat. Ch. 119 - which matters for a product
 * that sells leads onward.
 */

function isFlorida(hints: { state?: string | null }): boolean {
  return (hints.state ?? "").toUpperCase() === "FL";
}

export const floridaGovCompany: CompanyProvider = {
  name: "fl-public-records",

  // No key to configure; it is always available.
  available: () => true,

  async resolveCompany(firmName, hints, _ctx: ProviderContext) {
    if (!isFlorida(hints)) {
      return { company: null, credits: 0, note: "Florida public records only cover FL permits." };
    }
    if (!isOrganization(firmName)) {
      return { company: null, credits: 0, note: `"${firmName}" reads as an individual; skipping the company lookup.` };
    }

    const match = await lookupFirm(firmName);
    if (!match.firm) {
      return { company: null, credits: 0, note: `No Florida contractor licence found for "${firmName}".` };
    }

    return {
      company: {
        name: match.firm.firmName,
        domain: null,
        linkedin_url: null,
        location: match.firm.city ? `${match.firm.city}, FL` : null,
        employee_count: null,
        industry: "Construction",
        provider: "fl-dbpr",
        match_confidence: match.confidence,
      },
      credits: 0,
      note: `Matched DBPR licence ${match.firm.licenseNumber ?? "?"} via ${match.via}.`,
    };
  },
};

export const floridaGovContact: ContactProvider = {
  name: "fl-public-records",

  available: () => true,

  async findDecisionMaker(company: ResolvedCompany, _ctx: ProviderContext) {
    const notes: string[] = [];

    // 1. Orlando business tax receipts: the only free source with phone AND
    //    email in one row. Narrow, but the best answer when it hits.
    const btr = await lookupOrlandoBtr(company.name).catch(() => null);
    if (btr && (btr.phone || btr.email)) {
      return {
        contact: {
          full_name: btr.ownerName ? titleizePerson(btr.ownerName) : company.name,
          first_name: null,
          last_name: null,
          title: btr.licenseType ?? "Owner",
          seniority: "owner",
          company_name: btr.businessName,
          linkedin_url: null,
          work_email: btr.email,
          personal_email: null,
          // A business-tax filing is self-reported and current, but unverified.
          email_status: btr.email ? "probable" : "unverified",
          phone: btr.phone,
          mobile_phone: null,
          location: "Orlando, FL",
          provider: "orlando-btr",
        },
        credits: 0,
        note: "Matched an Orlando business tax receipt.",
      };
    }

    // 2. DBPR: firm -> qualifying individual -> phone.
    const match = await lookupFirm(company.name);
    if (match.person) {
      const full = titleizePerson(`${match.person.firstName} ${match.person.lastName}`);
      return {
        contact: {
          full_name: full,
          first_name: titleizePerson(match.person.firstName),
          last_name: titleizePerson(match.person.lastName),
          // The qualifier is legally responsible for the licence, which in a
          // small contractor is almost always the owner.
          title: "Licence Qualifier",
          seniority: "owner",
          company_name: match.firm?.firmName ?? company.name,
          linkedin_url: null,
          work_email: null,
          personal_email: null,
          email_status: "unverified",
          phone: match.person.phone,
          mobile_phone: null,
          location: match.person.city ? `${match.person.city}, FL` : null,
          provider: "fl-dbpr",
        },
        credits: 0,
        note: `DBPR licence qualifier for ${match.firm?.firmName ?? company.name}.`,
      };
    }

    // The licence names a qualifying human even when the applicant file has no
    // phone for them. A name is still progress: it is what the paid providers
    // need as input, and it is what a salesperson asks for on the phone.
    if (match.firm?.qualifierFirst && match.firm.qualifierLast) {
      return {
        contact: {
          full_name: titleizePerson(`${match.firm.qualifierFirst} ${match.firm.qualifierLast}`),
          first_name: titleizePerson(match.firm.qualifierFirst),
          last_name: titleizePerson(match.firm.qualifierLast),
          title: "Licence Qualifier",
          seniority: "owner",
          company_name: match.firm.firmName,
          linkedin_url: null,
          work_email: null,
          personal_email: null,
          email_status: "unverified",
          phone: null,
          mobile_phone: null,
          location: match.firm.city ? `${match.firm.city}, FL` : null,
          provider: "fl-dbpr",
        },
        credits: 0,
        note: `DBPR licence ${match.firm.licenseNumber ?? ""} names the qualifier, but no phone is on file.`,
      };
    }

    if (match.firm) notes.push("DBPR has the licence but no named qualifier.");
    else notes.push(`No Florida contractor licence matched "${company.name}".`);

    return { contact: null, credits: 0, note: notes.join(" ") };
  },
};

/**
 * Individual applicants never resolve through a company lookup, so they get
 * their own path: straight from the name on the permit to a DBPR phone.
 */
export async function lookupIndividual(fullName: string): Promise<ResolvedContact | null> {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const first = parts[0];
  const last = parts.slice(1).join(" ");
  const person = await lookupPerson(first, last).catch(() => null);
  if (!person?.phone) return null;

  return {
    full_name: titleizePerson(`${person.firstName} ${person.lastName}`),
    first_name: titleizePerson(person.firstName),
    last_name: titleizePerson(person.lastName),
    title: person.licenseType ?? "Applicant",
    seniority: "owner",
    company_name: null,
    linkedin_url: null,
    work_email: null,
    personal_email: null,
    email_status: "unverified",
    phone: person.phone,
    mobile_phone: null,
    location: person.city ? `${person.city}, FL` : null,
    provider: "fl-dbpr",
  };
}
