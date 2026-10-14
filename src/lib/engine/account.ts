/**
 * Account rules with no database (H-47): a login email shown masked in a log or a heads-up, and the words every email-change
 * start answers with, whether or not the address is free, so nothing says who has an account.
 */

/** d•••o@gmail.com: first and last letter of the name part, the domain whole; a one-letter name shows as that letter and dots. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = name.length <= 1 ? `${name}•••` : `${name[0]}•••${name[name.length - 1]}`;
  return `${shown}@${domain}`;
}

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_CHANGE_STARTS_PER_HOUR = 3;
export const EMAIL_CHANGE_SAID = "If that address can take it, a confirmation link is on its way. Check that inbox; the link works for 24 hours.";
export const EMAIL_CHANGE_CRM_NOTE = "Your email in your CRM and chatbot stays as it was; update it there if you want them to match.";

/** A plain check before anything is sent: one @, something either side, no spaces, not the same address. */
export function emailChangeProblem(current: string, next: string): string | null {
  const n = next.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n)) return "That doesn't look like an email address.";
  if (n === current.trim().toLowerCase()) return "That's already your login email.";
  return null;
}
