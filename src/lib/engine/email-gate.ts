/**
 * Who HelixOS may email automatically (29 Sep: a client the coach hasn't introduced yet must hear nothing). One rule, read by
 * every automated sender through canEmail (src/lib/email-gate.ts): the coach's switch is on, they have signed in at least once,
 * and they haven't been removed. A send a person asks for or presses by hand (their own forgotten password, the coach's reset
 * link) doesn't go through it.
 */
export type EmailGateInput = { emailsEnabled: boolean; removedAt: string | null; firstSignedInAt: string | null };

export type EmailBlock = "switched_off" | "never_signed_in" | "removed";

/** Why HelixOS won't email this member automatically, or null when it may. */
export function emailBlock(m: EmailGateInput): EmailBlock | null {
  if (m.removedAt) return "removed";
  if (!m.emailsEnabled) return "switched_off";
  if (!m.firstSignedInAt) return "never_signed_in";
  return null;
}
export const canEmailMember = (m: EmailGateInput): boolean => emailBlock(m) === null;
