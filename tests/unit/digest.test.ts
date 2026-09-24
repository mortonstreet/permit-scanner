import { describe, expect, it } from "vitest";
import { buildDigest, type SenderIdentity } from "@/lib/notify/digest";
import type { Signal } from "@/lib/signal";

const sender: SenderIdentity = {
  company: "Permit Stack",
  postalAddress: "123 Main St, Miami FL 33101",
  unsubscribeUrl: "https://permit-stack.test/api/v1/unsubscribe",
};

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    permit_id: "abc123", score: 91, band: "hot", reasons: ["Filed in the last 24h"],
    stage: "pre_issuance", days_old: 1, posted: "1d ago",
    target: { name: "Katrina De Jesus", role: "owner_builder", why: "", is_company: false },
    competing_contractor: null, open: true, warnings: [],
    contact_on_permit: { phone: null, email: null },
    job: { description: "Build New SFR", permit_type: null, tags: ["new_construction"], value: 473_040 },
    where: {
      address: "Lake Jessie", city: "Parrish", county: null, state: "FL",
      jurisdiction: "Manatee County", latitude: null, longitude: null,
    },
    permit_number: "BLD2609-2170", source: "fl-manatee",
    work_class: "horizontal", work_class_basis: "test", acreage: 2.5,
    ...overrides,
  };
}

const opts = { appUrl: "https://permit-stack.test", windowDays: 7, sender };

describe("buildDigest", () => {
  it("summarizes the count in the subject", () => {
    expect(buildDigest([signal()], { email: "gc@acme.com", state: "FL" }, opts).subject)
      .toBe("1 open job in FL - Permit Stack");
    expect(buildDigest([signal(), signal()], { email: "gc@acme.com", state: "FL" }, opts).subject)
      .toBe("2 open jobs in FL - Permit Stack");
  });

  it("names the county when the territory is narrower than a state", () => {
    const c = buildDigest([signal()], { email: "gc@acme.com", state: "FL", county: "Orange" }, opts);
    expect(c.subject).toContain("Orange County");
  });

  it("emits RFC 8058 one-click unsubscribe headers", () => {
    // Gmail and Yahoo require these of bulk senders; without them the digest
    // is treated as a worse-behaved sender regardless of content.
    const c = buildDigest([signal()], { email: "gc@acme.com", state: "FL" }, opts);
    expect(c.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(c.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/permit-stack\.test\/api\/v1\/unsubscribe\?e=/);
    expect(c.headers["List-Unsubscribe"]).toContain(encodeURIComponent("gc@acme.com"));
  });

  it("carries the company, postal address and unsubscribe link in both parts", () => {
    const c = buildDigest([signal()], { email: "gc@acme.com", state: "FL" }, opts);
    for (const body of [c.html, c.text]) {
      expect(body).toContain("Permit Stack");
      expect(body).toContain("123 Main St, Miami FL 33101");
      expect(body.toLowerCase()).toContain("unsubscribe");
    }
  });

  it("always ships a plain-text alternative", () => {
    const c = buildDigest([signal()], { email: "gc@acme.com", state: "FL" }, opts);
    expect(c.text).toContain("Katrina De Jesus");
    expect(c.text).toContain("$473,040");
    expect(c.text).not.toContain("<td");
  });

  it("escapes HTML in firm names rather than injecting it", () => {
    const evil = signal({
      target: { name: '<script>alert(1)</script> LLC', role: "owner_builder", why: "", is_company: true },
    });
    const c = buildDigest([evil], { email: "gc@acme.com", state: "FL" }, opts);
    expect(c.html).not.toContain("<script>");
    expect(c.html).toContain("&lt;script&gt;");
  });

  it("says so plainly when there is nothing to report", () => {
    const c = buildDigest([], { email: "gc@acme.com", state: "FL" }, opts);
    expect(c.subject).toBe("Permit Stack: no new open jobs in FL");
    expect(c.html).toContain("Nothing new cleared the bar");
  });

  it("caps the list so one busy day does not produce an unreadable email", () => {
    const many = Array.from({ length: 40 }, (_, i) => signal({ permit_id: `p${i}` }));
    const c = buildDigest(many, { email: "gc@acme.com", state: "FL" }, opts);
    expect(c.subject).toContain("15 open jobs");
  });

  it("flags a firm with several filings as one call, not several", () => {
    const clustered = signal({
      also_filed: [
        { permit_id: "x", address: "1 A St", value: 100_000, posted: "2d ago" },
        { permit_id: "y", address: "2 B St", value: 200_000, posted: "3d ago" },
      ],
    });
    const c = buildDigest([clustered], { email: "gc@acme.com", state: "FL" }, opts);
    expect(c.html).toContain("+2 more permits");
    // 473,040 on the lead permit plus 100,000 and 200,000 on the others.
    expect(c.html).toContain("$773,040 combined");
  });
});
