import { describe, expect, it } from "vitest";
import { isOrganization, normalizePersonName, titleizeOrg, titleizePerson } from "@/lib/names";

describe("normalizePersonName", () => {
  it("joins separate first and last columns (Manatee's shape)", () => {
    expect(normalizePersonName({ first: "Katrina", last: "De Jesus" })).toBe("Katrina De Jesus");
    expect(normalizePersonName({ first: "KATRINA", last: "DE JESUS" })).toBe("Katrina De Jesus");
  });

  it("keeps a lowercase particle the filer wrote lowercase", () => {
    expect(normalizePersonName({ full: "ludwig van beethoven" })).toBe("Ludwig van Beethoven");
  });

  it("flips LAST FIRST into reading order", () => {
    expect(normalizePersonName({ full: "Peterson Eric" })).toBe("Eric Peterson");
    expect(normalizePersonName({ full: "SMITH JAMES" })).toBe("James Smith");
  });

  it("leaves FIRST LAST alone", () => {
    expect(normalizePersonName({ full: "Eric Peterson" })).toBe("Eric Peterson");
    expect(normalizePersonName({ full: "Dave Schmitz" })).toBe("Dave Schmitz");
  });

  it("handles LAST, FIRST MIDDLE", () => {
    expect(normalizePersonName({ full: "PETERSON, ERIC J" })).toBe("Eric J Peterson");
  });

  it("does not flip when neither token is a known given name", () => {
    // Guessing wrong is worse than leaving it as filed.
    expect(normalizePersonName({ full: "Rozanski Blackburn" })).toBe("Rozanski Blackburn");
  });

  it("recognises companies parked in a name column and leaves them intact", () => {
    expect(normalizePersonName({ last: "TALBOT CUSTOM HOMES LLC" })).toBe("Talbot Custom Homes LLC");
    expect(normalizePersonName({ full: "DRB GROUP FLORIDA LLC" })).toBe("DRB Group Florida LLC");
  });

  it("returns null for empty and placeholder values", () => {
    expect(normalizePersonName({ full: null })).toBeNull();
    expect(normalizePersonName({ first: "NA", last: "NULL" })).toBeNull();
    expect(normalizePersonName({ full: "  " })).toBeNull();
  });
});

describe("titleizePerson", () => {
  it("keeps Mc/Mac and apostrophes readable", () => {
    expect(titleizePerson("MCDONALD")).toBe("McDonald");
    expect(titleizePerson("O'BRIEN")).toBe("O'Brien");
    expect(titleizePerson("SMITH-JONES")).toBe("Smith-Jones");
  });

  it("keeps generational suffixes uppercase", () => {
    expect(titleizePerson("JOHN SMITH JR")).toBe("John Smith JR");
    expect(titleizePerson("ROBERT LEE III")).toBe("Robert Lee III");
  });
});

describe("titleizeOrg", () => {
  it("keeps shouted initialisms uppercase instead of title-casing them", () => {
    expect(titleizeOrg("DRB GROUP FLORIDA LLC")).toBe("DRB Group Florida LLC");
    expect(titleizeOrg("PGR MECHANICAL CONTRACTORS INC")).toBe("PGR Mechanical Contractors Inc");
  });

  it("de-shouts but keeps legal suffixes uppercase", () => {
    expect(titleizeOrg("BOYLAND PROPERTIES MILLENIA PALMS DRIVE LLC")).toBe("Boyland Properties Millenia Palms Drive LLC");
    expect(titleizeOrg("PGR MECHANICAL CONTRACTORS INC")).toBe("PGR Mechanical Contractors Inc");
  });
});

describe("isOrganization", () => {
  it("separates entities from people", () => {
    expect(isOrganization("Talbot Custom Homes LLC")).toBe(true);
    expect(isOrganization("Miami-Dade County")).toBe(true);
    expect(isOrganization("Edge Creek Holdings")).toBe(true);
    expect(isOrganization("Katrina De Jesus")).toBe(false);
    expect(isOrganization("Eric Peterson")).toBe(false);
  });
});
