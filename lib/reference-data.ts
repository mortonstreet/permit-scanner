/** US states, for the STATE select in the filter rail. */
export const US_STATES: Array<{ code: string; name: string }> = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],
  ["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],
  ["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],
  ["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],
  ["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],
  ["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],
  ["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],
  ["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],
  ["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
].map(([code, name]) => ({ code, name }));

export function stateName(code: string | undefined): string | undefined {
  return US_STATES.find((s) => s.code === code?.toUpperCase())?.name;
}

/** Work-type categories offered in the PERMITS include/exclude pickers. */
export const PERMIT_CATEGORIES: Array<{ value: string; label: string; group: string }> = [
  { value: "excavation", label: "Excavation", group: "Sitework" },
  { value: "sitework", label: "Site Work", group: "Sitework" },
  { value: "grading", label: "Grading", group: "Sitework" },
  { value: "demolition", label: "Demolition", group: "Sitework" },
  { value: "foundation", label: "Foundation", group: "Sitework" },
  { value: "utilities", label: "Utilities", group: "Sitework" },
  { value: "paving", label: "Paving", group: "Sitework" },
  { value: "new_construction", label: "New Construction", group: "Structure" },
  { value: "adu", label: "ADU", group: "Structure" },
  { value: "remodel", label: "Remodel", group: "Structure" },
  { value: "roofing", label: "Roofing", group: "Envelope" },
  { value: "window_door", label: "Window Door", group: "Envelope" },
  { value: "electrical", label: "Electrical", group: "Trade" },
  { value: "plumbing", label: "Plumbing", group: "Trade" },
  { value: "mechanical", label: "Mechanical", group: "Trade" },
  { value: "solar", label: "Solar", group: "Energy" },
  { value: "pool", label: "Pool", group: "Other" },
];

/** Which chip palette a tag uses, mirroring the reference app's tag colors. */
export function tagPalette(tag: string): "energy" | "power" | "trade" | "envelope" | "stone" {
  switch (tag) {
    case "solar": return "energy";
    case "electrical": case "mechanical": return "power";
    case "excavation": case "sitework": case "grading": case "new_construction": case "foundation": return "trade";
    case "roofing": case "window_door": return "envelope";
    default: return "stone";
  }
}

export const PROPERTY_TYPES = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "industrial", label: "Industrial" },
  { value: "mixed", label: "Mixed Use" },
  { value: "other", label: "Other" },
];

export const PERMIT_STATUSES = [
  { value: "final", label: "Final" },
  { value: "active", label: "Active" },
  { value: "in_review", label: "In Review" },
  { value: "inactive", label: "Inactive" },
];

/** Contractor license classifications used by the CONTRACTORS filter section. */
export const CONTRACTOR_CLASSIFICATIONS = [
  { value: "general", label: "General Contractor" },
  { value: "excavation", label: "Excavation / Site Work" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "mechanical", label: "Mechanical / HVAC" },
  { value: "roofing", label: "Roofing" },
  { value: "solar", label: "Solar" },
  { value: "pool", label: "Pool" },
];
