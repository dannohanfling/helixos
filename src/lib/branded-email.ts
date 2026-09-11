/**
 * Turns an email's copy into the two parts the adapter sends: the branded HTML (template, logo served from the app's own
 * domain, one button carrying the link) and the plain text with the URL on its own line. The raw URL never appears in the HTML.
 */
import { renderEmailHtml, renderEmailText, escapeHtml } from "@/lib/engine/email-template";
import type { EmailCopy } from "@/lib/engine/reminder-copy";

/** The footer sentence's two times, read back from the copy's own footer so the HTML and the text can never disagree. */
function hourLabelsOf(footer: string): { morning: string; evening: string } | undefined {
  const m = footer.match(/^Reminders come at (\S+) and (\S+)\./);
  return m ? { morning: m[1], evening: m[2] } : undefined;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function brandedEmail(copy: EmailCopy, opts: { base?: string; settingsLink?: boolean } = {}): { subject: string; text: string; html: string } {
  const base = opts.base ?? appUrl();
  const actionUrl = `${base}${copy.path}`;
  const settingsUrl = `${base}/settings`;
  const slots = { preheader: copy.preheader, greeting: copy.greeting, stateLine: copy.stateLine, asks: copy.asks, buttonLabel: copy.buttonLabel, pointsLine: copy.pointsLine, actionUrl, settingsUrl, logoUrl: `${base}/email/logo-120.png` };
  // The template's footer is the reminders line with its Settings link; an email that is not a reminder carries its own words, without the link.
  const footerHtml = opts.settingsLink === false ? escapeHtml(copy.footerText) : undefined;
  return { subject: copy.subject, text: renderEmailText({ ...slots, footerText: copy.footerText }), html: renderEmailHtml({ ...slots, footerHtml, hourLabels: hourLabelsOf(copy.footerText) }) };
}
