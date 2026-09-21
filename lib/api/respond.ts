import { NextResponse } from "next/server";

/**
 * One response shape for the whole public API.
 *
 * Errors always carry a stable machine-readable `code` alongside the human
 * message, so a consumer can branch on the code without string-matching prose.
 */

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "upstream_failed"
  | "not_configured"
  | "rate_limited";

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  upstream_failed: 502,
  not_configured: 503,
  rate_limited: 429,
};

export interface ApiMeta {
  /** Server time the response was produced, for client-side freshness display. */
  generated_at: string;
  api_version: "v1";
  [key: string]: unknown;
}

export function ok<T>(data: T, meta: Partial<ApiMeta> = {}, init: ResponseInit = {}) {
  return NextResponse.json(
    { data, meta: { generated_at: new Date().toISOString(), api_version: "v1", ...meta } },
    init,
  );
}

export function fail(code: ApiErrorCode, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status: STATUS[code] },
  );
}

/**
 * API-key auth.
 *
 * Enforced only when PERMIT_API_KEYS is set, so local development and the
 * first-party UI keep working without a key while production can lock down by
 * setting the variable. Keys are comma-separated.
 */
export function authorize(request: Request): { ok: true; key: string | null } | { ok: false; response: Response } {
  const configured = (process.env.PERMIT_API_KEYS ?? "")
    .split(",").map((k) => k.trim()).filter(Boolean);

  if (configured.length === 0) return { ok: true, key: null };

  const header = request.headers.get("x-api-key")
    ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? null;

  if (!header || !configured.includes(header)) {
    return { ok: false, response: fail("unauthorized", "Provide a valid X-API-Key header.") };
  }
  return { ok: true, key: header };
}

/** Same-origin requests from our own UI never need a key. */
export function isFirstParty(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
