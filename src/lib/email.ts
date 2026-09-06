export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Minimal email adapter: Resend when a key is present, console otherwise. */
export async function sendEmail(to: string, subject: string, text: string): Promise<"sent" | "logged"> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "HelixOS <onboarding@resend.dev>";
  if (!key) {
    console.log(`[email:logged] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
    return "logged";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
  return "sent";
}
