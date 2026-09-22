import { NextResponse } from "next/server";

/**
 * One-click unsubscribe, GET and POST.
 *
 * RFC 8058 requires the List-Unsubscribe URL to accept a POST from the mail
 * client with no confirmation step, and Gmail and Yahoo enforce that for bulk
 * senders. The GET exists for people who click the footer link.
 *
 * Suppression is recorded in Supabase when configured; without it the request
 * is acknowledged and logged, so the endpoint never 500s at a mail provider.
 */

async function suppress(email: string): Promise<{ recorded: boolean; detail: string }> {
  const { getSupabase } = await import("@/lib/supabase/client");
  const db = getSupabase();
  if (!db) {
    console.warn(`[unsubscribe] no store configured; ${email} was not persisted`);
    return { recorded: false, detail: "acknowledged, but no suppression store is configured" };
  }
  const { error } = await db
    .from("email_suppressions")
    .upsert({ email: email.toLowerCase(), reason: "unsubscribe" }, { onConflict: "email" });
  if (error) {
    console.error(`[unsubscribe] failed to record ${email}: ${error.message}`);
    return { recorded: false, detail: error.message };
  }
  return { recorded: true, detail: "suppressed" };
}

function emailFrom(request: Request): string | null {
  const e = new URL(request.url).searchParams.get("e");
  return e && e.includes("@") ? e : null;
}

/** Mail clients POST here with no body and expect a 2xx. */
export async function POST(request: Request) {
  const email = emailFrom(request);
  if (!email) return NextResponse.json({ error: "Missing recipient" }, { status: 400 });
  const result = await suppress(email);
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const email = emailFrom(request);
  if (!email) {
    return new NextResponse("<p>This unsubscribe link is missing its recipient.</p>", {
      status: 400, headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  await suppress(email);
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>
     <div style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#101727">
       <h1 style="font-size:1.25rem">Unsubscribed</h1>
       <p style="color:#6b695c">${email} will not receive further permit digests.</p>
     </div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
