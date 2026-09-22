import "server-only";
import { Resend } from "resend";
import type { DigestContent, DigestRecipient } from "./digest";

/**
 * Email delivery via Resend.
 *
 * Resend requires a verified domain: the default resend.dev sender can only
 * reach the address that owns the account, so there is no domain-free path to
 * real recipients. With no key or no from-address configured this reports that
 * cleanly rather than failing a request.
 *
 * Every To/CC/BCC address bills as one email against the quota, and the free
 * tier's 100/day is a hard UTC-calendar-day stop.
 */

export interface SendResult {
  sent: boolean;
  id?: string;
  error?: string;
  to: string;
}

/** Resend caps a batch at 100 messages and rejects the whole batch if one is invalid. */
const MAX_BATCH = 100;

let client: Resend | null | undefined;

function getClient(): Resend | null {
  if (client !== undefined) return client;
  const key = process.env.RESEND_API_KEY;
  client = key ? new Resend(key) : null;
  return client;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && fromAddress());
}

export function fromAddress(): string | null {
  return process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM_EMAIL ?? null;
}

/** Resend tags accept only ASCII letters, digits, underscore and hyphen. */
function safeTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 256);
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPayload(recipient: DigestRecipient, content: DigestContent, from: string) {
  return {
    from,
    to: recipient.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    headers: content.headers,
    ...(process.env.RESEND_REPLY_TO_EMAIL ? { replyTo: process.env.RESEND_REPLY_TO_EMAIL } : {}),
    tags: [
      { name: "type", value: "daily_digest" },
      { name: "state", value: safeTag(recipient.state) },
    ],
  };
}

export async function sendDigest(
  recipient: DigestRecipient,
  content: DigestContent,
): Promise<SendResult> {
  const resend = getClient();
  const from = fromAddress();

  if (!resend || !from) {
    return {
      sent: false,
      to: recipient.email,
      error: "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_ADDRESS (a verified domain).",
    };
  }

  // The SDK returns { data, error } rather than throwing; try/catch here is
  // only for network-level failures.
  try {
    const { data, error } = await resend.emails.send(
      buildPayload(recipient, content, from),
      // Guards against a cron or platform retry double-sending the same digest.
      { idempotencyKey: `digest/${safeTag(recipient.email)}/${todayStamp()}` },
    );
    if (error) return { sent: false, to: recipient.email, error: error.message };
    return { sent: true, to: recipient.email, id: data?.id };
  } catch (err) {
    return { sent: false, to: recipient.email, error: err instanceof Error ? err.message : "send failed" };
  }
}

/**
 * Send many digests in batches.
 *
 * Batching matters at any real list size: the API allows 10 requests/second
 * per team, so 500 individual sends would trip the limit while five batches
 * will not. A batch is validated atomically, so one malformed address fails
 * the whole batch - hence the per-batch fallback to individual sends.
 */
export async function sendDigestBatch(
  items: Array<{ recipient: DigestRecipient; content: DigestContent }>,
): Promise<SendResult[]> {
  const resend = getClient();
  const from = fromAddress();

  if (!resend || !from) {
    return items.map(({ recipient }) => ({
      sent: false,
      to: recipient.email,
      error: "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_ADDRESS (a verified domain).",
    }));
  }

  const results: SendResult[] = [];

  for (let i = 0; i < items.length; i += MAX_BATCH) {
    const chunk = items.slice(i, i + MAX_BATCH);
    try {
      const { data, error } = await resend.batch.send(
        chunk.map(({ recipient, content }) => buildPayload(recipient, content, from)),
        { idempotencyKey: `digest-batch/${todayStamp()}/${i / MAX_BATCH}` },
      );

      if (error) {
        // One invalid address rejects the batch, so fall back to individual
        // sends and let the good ones through.
        for (const item of chunk) results.push(await sendDigest(item.recipient, item.content));
        continue;
      }

      const ids = data?.data ?? [];
      chunk.forEach((item, idx) => {
        results.push({ sent: true, to: item.recipient.email, id: ids[idx]?.id });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "batch send failed";
      for (const item of chunk) results.push({ sent: false, to: item.recipient.email, error: message });
    }
  }

  return results;
}
