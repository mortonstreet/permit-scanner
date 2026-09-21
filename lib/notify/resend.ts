import "server-only";
import { Resend } from "resend";
import type { DigestContent, DigestRecipient } from "./digest";

/**
 * Email delivery via Resend.
 *
 * Optional, like every other integration here: with no key configured the app
 * simply reports that sending is unavailable rather than failing a request.
 */

export interface SendResult {
  sent: boolean;
  id?: string;
  error?: string;
  to: string;
}

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
      error: "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_ADDRESS.",
    };
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: recipient.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(process.env.RESEND_REPLY_TO_EMAIL ? { replyTo: process.env.RESEND_REPLY_TO_EMAIL } : {}),
      // Lets us correlate a send with the territory it covered.
      tags: [
        { name: "type", value: "daily_digest" },
        { name: "state", value: recipient.state },
      ],
    });

    if (error) return { sent: false, to: recipient.email, error: error.message };
    return { sent: true, to: recipient.email, id: data?.id };
  } catch (err) {
    return { sent: false, to: recipient.email, error: err instanceof Error ? err.message : "send failed" };
  }
}
