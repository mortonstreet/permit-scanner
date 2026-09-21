/**
 * Product branding.
 *
 * Kept in one place so the name can change without touching components.
 * Override per environment with NEXT_PUBLIC_BRAND_NAME / _DOMAIN.
 *
 * Candidate domains on hand: permit-stack.com (product), physical-layer.com.
 */
export const BRAND = {
  /** Rendered as two-tone in the wordmark: `word` + `accent`. */
  word: process.env.NEXT_PUBLIC_BRAND_WORD ?? "permit",
  accent: process.env.NEXT_PUBLIC_BRAND_ACCENT ?? "stack",
  domain: process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? "permit-stack.com",
  tagline: "New construction permits the day they are filed, with the decision maker attached.",
} as const;

export const BRAND_NAME = `${BRAND.word}${BRAND.accent}`;
export const BRAND_TITLE = "Permit Stack";
