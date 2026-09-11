/**
 * Email adapter: SendGrid when SENDGRID_API_KEY is set, console otherwise. One provider, one code path.
 * EMAIL_FROM is "Name <addr@domain>" or a bare address; the domain must be verified in SendGrid first.
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY);
}

/** Development and smoke tests point the adapter at scripts/mock-sendgrid.ts. Never honoured in production. */
function endpoint(): string {
  const override = process.env.NODE_ENV !== "production" ? process.env.EMAIL_API_URL : undefined;
  return `${(override ?? "https://api.sendgrid.com").replace(/\/$/, "")}/v3/mail/send`;
}

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** "HelixOS <helixos@evolveomega.com>" or "helixos@evolveomega.com". Anything else is a configuration error, never a guess. */
export function parseFrom(raw: string | undefined): { email: string; name?: string } {
  const value = (raw ?? "").trim();
  if (!value) throw new Error("EMAIL_FROM is not set. Set it to \"HelixOS <helixos@evolveomega.com>\" (a sender verified in SendGrid).");
  const m = value.match(/^(.*?)\s*<([^<>]+)>$/);
  const email = (m ? m[2] : value).trim();
  const name = m ? m[1].trim().replace(/^"|"$/g, "") : "";
  if (!ADDRESS.test(email)) throw new Error(`EMAIL_FROM is not a valid sender: ${JSON.stringify(value)}. Use "Name <address>" or a bare address.`);
  return name ? { email, name } : { email };
}

/** SendGrid answers errors with {"errors":[{"message","field","help"}]}; the message is the only way to diagnose an unverified sender or wrong domain. */
export function describeSendGridError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: { message?: string; field?: string | null; help?: string | null }[] };
    const errors = (parsed.errors ?? []).map((e) => [e.message, e.field ? `(field: ${e.field})` : "", e.help ? `help: ${e.help}` : ""].filter(Boolean).join(" ")).filter(Boolean);
    if (errors.length) return `SendGrid failed: ${status} ${errors.join("; ")}`;
  } catch {
    /* not JSON */
  }
  return `SendGrid failed: ${status} ${body.slice(0, 500)}`;
}

/**
 * Sends one email. With `html` the message is multipart, text first and HTML second, and the text part is never dropped: some
 * people read text, some clients strip HTML, and the text part is what a raw fallback looks like.
 */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<"sent" | "logged"> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    console.log(`[email:logged] to=${to} subject=${JSON.stringify(subject)}${html ? " (html part attached)" : ""}\n${text}`);
    return "logged";
  }
  const from = parseFrom(process.env.EMAIL_FROM);
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from,
      subject,
      content: [{ type: "text/plain", value: text }, ...(html ? [{ type: "text/html", value: html }] : [])],
    }),
  });
  // SendGrid returns 202 Accepted on success; res.ok covers the whole 2xx range.
  if (!res.ok) throw new Error(describeSendGridError(res.status, await res.text()));
  return "sent";
}
