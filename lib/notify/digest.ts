import type { Signal } from "../signal";

/**
 * The daily developer-signal digest.
 *
 * What a partner GC receives: the open jobs in their territory filed since the
 * last send, ranked. Deliberately plain HTML with inline styles - Gmail strips
 * <style> blocks and Outlook ignores most of CSS, so anything clever here
 * arrives broken.
 */

export interface DigestRecipient {
  email: string;
  /** Company name, used in the greeting. */
  company?: string | null;
  /** Two-letter state this GC works in. */
  state: string;
  /** Optional county filter, when the territory is narrower than a state. */
  county?: string | null;
}

export interface DigestContent {
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe. Required for bulk mail since Feb 2024. */
  headers: Record<string, string>;
}

/**
 * Sender identity shown in the footer.
 *
 * A physical postal address and a working unsubscribe are required - by
 * CAN-SPAM for commercial mail, and unconditionally by Resend's acceptable
 * use policy for any bulk send. Not worth litigating the transactional
 * exemption for two lines of HTML.
 */
export interface SenderIdentity {
  company: string;
  postalAddress: string;
  /** Base URL of the one-click unsubscribe endpoint. */
  unsubscribeUrl: string;
}

const BRAND = "Permit Stack";

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDigest(
  signals: Signal[],
  recipient: DigestRecipient,
  opts: { appUrl: string; windowDays: number; sender?: SenderIdentity },
): DigestContent {
  const sender: SenderIdentity = opts.sender ?? {
    company: process.env.DIGEST_COMPANY_NAME ?? "Permit Stack",
    postalAddress: process.env.DIGEST_POSTAL_ADDRESS ?? "",
    unsubscribeUrl: `${opts.appUrl}/api/v1/unsubscribe`,
  };
  const unsubLink = `${sender.unsubscribeUrl}?e=${encodeURIComponent(recipient.email)}`;
  const top = signals.slice(0, 15);
  const where = recipient.county ? `${recipient.county} County` : recipient.state;
  const subject = top.length === 0
    ? `${BRAND}: no new open jobs in ${where}`
    : `${top.length} open job${top.length === 1 ? "" : "s"} in ${where} - ${BRAND}`;

  const rows = top.map((s) => {
    const t = s.target;
    const addr = [s.where.address, s.where.city].filter(Boolean).join(", ") || s.where.jurisdiction || "";
    const link = `${opts.appUrl}/detail/permit-profile/${s.permit_id}?geo_state=${s.where.state ?? recipient.state}`;
    const extra = s.also_filed?.length ? ` <span style="color:#6b695c">(+${s.also_filed.length} more permits)</span>` : "";

    return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #e2dcc9;vertical-align:top">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="vertical-align:top;width:44px">
              <div style="width:36px;height:36px;border-radius:8px;background:${s.band === "hot" ? "#01654d" : "#f0ecdf"};color:${s.band === "hot" ? "#ffffff" : "#6b695c"};text-align:center;line-height:36px;font-weight:700;font-size:15px">${s.score}</div>
            </td>
            <td style="vertical-align:top;padding-left:10px">
              <div style="font-size:15px;font-weight:600;color:#101727">${esc(t?.name ?? "Unnamed")}${extra}</div>
              <div style="font-size:13px;color:#6b695c;margin-top:2px">${esc(addr)}</div>
              <div style="font-size:13px;color:#101727;margin-top:6px">${esc((s.job.description ?? s.job.permit_type ?? "").slice(0, 110))}</div>
              <div style="font-size:13px;color:#6b695c;margin-top:6px">
                <strong style="color:#01654d">${money(s.job.value)}</strong>
                &nbsp;·&nbsp; filed ${esc(s.posted)}
                ${s.contact_on_permit.phone ? `&nbsp;·&nbsp; <a href="tel:${esc(s.contact_on_permit.phone)}" style="color:#01654d">${esc(s.contact_on_permit.phone)}</a>` : ""}
              </div>
              <a href="${esc(link)}" style="display:inline-block;margin-top:9px;font-size:13px;color:#01654d;font-weight:600;text-decoration:none">Open the permit &rarr;</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fcfbf8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fcfbf8;padding:24px 12px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#ffffff;border:1px solid #e2dcc9;border-radius:14px;padding:26px">
        <tr><td>
          <div style="font-size:19px;font-weight:700;color:#01654d;letter-spacing:-0.3px">permit<span style="color:#e8bd51">stack</span></div>
          <h1 style="margin:16px 0 4px;font-size:21px;color:#101727;letter-spacing:-0.3px">
            ${top.length} open job${top.length === 1 ? "" : "s"} in ${esc(where)}
          </h1>
          <p style="margin:0 0 18px;font-size:14px;color:#6b695c;line-height:1.5">
            Permits filed in the last ${opts.windowDays} day${opts.windowDays === 1 ? "" : "s"} with
            <strong style="color:#101727">no contractor of record yet</strong>. The trade package on these is still open.
          </p>
          ${top.length === 0
            ? `<p style="font-size:14px;color:#6b695c">Nothing new cleared the bar today. You will get the next one as soon as something does.</p>`
            : `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>`}
          <p style="margin:22px 0 0;font-size:12px;color:#a29c88;line-height:1.6">
            Sourced from county and state permit records, normalized by ${esc(sender.company)}.
            <a href="${esc(opts.appUrl)}" style="color:#01654d">Open the full call list</a>
          </p>
          <p style="margin:14px 0 0;padding-top:14px;border-top:1px solid #e2dcc9;font-size:11px;color:#a29c88;line-height:1.7">
            You are receiving this because ${esc(sender.company)} sends you permit signals for your territory.<br>
            ${esc(sender.company)}${sender.postalAddress ? ` &middot; ${esc(sender.postalAddress)}` : ""}<br>
            <a href="${esc(unsubLink)}" style="color:#6b695c;text-decoration:underline">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `${top.length} open jobs in ${where}`,
    `Filed in the last ${opts.windowDays} days, no contractor of record yet.`,
    "",
    ...top.map((s) => {
      const addr = [s.where.address, s.where.city].filter(Boolean).join(", ");
      return `[${s.score}] ${s.target?.name ?? "Unnamed"} - ${money(s.job.value)}\n    ${addr}\n    ${(s.job.description ?? "").slice(0, 100)}\n    ${opts.appUrl}/detail/permit-profile/${s.permit_id}`;
    }),
    "",
    `Full call list: ${opts.appUrl}`,
    "",
    `${sender.company}${sender.postalAddress ? ` - ${sender.postalAddress}` : ""}`,
    `Unsubscribe: ${unsubLink}`,
  ].join("\n");

  return {
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
