/**
 * Changing a login email (H-47), one place for the member's own Settings and the coach's client page: a confirmation link to
 * the NEW address (24 hours, single use, only its sha256 stored), a plain heads-up to the OLD address with no link that undoes
 * anything, the same words back whether or not the new address is free, and the change only when the link is clicked. Each
 * row is the log: who started it, when, the old and new addresses masked.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUrl, brandedEmail } from "@/lib/branded-email";
import { nowIso } from "@/lib/dates";
import { emailConfigured, sendEmail } from "@/lib/email";
import { EMAIL_CHANGE_SAID, EMAIL_CHANGE_STARTS_PER_HOUR, EMAIL_CHANGE_TTL_MS, emailChangeProblem, maskEmail } from "@/lib/engine/account";
import { newId } from "@/lib/ids";
import { allow } from "@/lib/rate-limit";
import { hashToken } from "@/lib/reset-link";

export type EmailChangeStart = { ok: true; said: string; devLink?: string } | { ok: false; text: string };

/** Starts a change for `userId` to `newEmail`; `by` is who asked (the user, or their coach) and `byName` the coach's name for the emails. */
export async function startEmailChange(o: { userId: string; newEmail: string; by: string; byName?: string }): Promise<EmailChangeStart> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, o.userId), columns: { id: true, email: true, name: true } });
  if (!user) return { ok: false, text: "That account isn't here." };
  const next = o.newEmail.trim().toLowerCase();
  const problem = emailChangeProblem(user.email, next);
  if (problem) return { ok: false, text: problem };
  if (!(await allow(`emailchange:${user.id}`, EMAIL_CHANGE_STARTS_PER_HOUR, 60 * 60 * 1000))) return { ok: false, text: "Several email changes were started in the last hour, so no new link was sent. Use the newest email you have, or wait an hour." };
  if (!emailConfigured() && process.env.NODE_ENV === "production") return { ok: false, text: "Email isn't set up yet, so a confirmation link can't be sent." };
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.emailChanges).values({ id: newId(), userId: user.id, newEmail: next, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS).toISOString(), startedBy: o.by, oldMasked: maskEmail(user.email), newMasked: maskEmail(next) });
  const first = user.name.split(" ")[0];
  const who = o.byName && o.by !== user.id ? `${o.byName} asked to change` : "You asked to change";
  // An address already in use gets no link: the same words come back either way, and the clash is caught at the click.
  const taken = await db.query.users.findFirst({ where: eq(schema.users.email, next), columns: { id: true } });
  let devLink: string | undefined;
  if (!taken) {
    const mail = brandedEmail(
      {
        subject: "Confirm your new HelixOS login email",
        preheader: "One click and this becomes the email you sign in with. Good for 24 hours.",
        greeting: `Hi ${first},`,
        stateLine: null,
        asks: [`${who} the email you sign in to HelixOS with to this address. If that's right, confirm it within 24 hours:`],
        buttonLabel: "Use this email to sign in",
        pointsLine: "Nothing changes until you confirm. Your CRM and chatbot keep the email they have.",
        path: `/email-change/${token}`,
        footerText: "If it wasn't you, ignore this and nothing changes.",
      },
      { settingsLink: false },
    );
    const delivery = await sendEmail(next, mail.subject, mail.text, mail.html).catch((e: unknown) => {
      console.error("[email] email change send failed", JSON.stringify({ message: e instanceof Error ? e.message : String(e) }));
      return "failed" as const;
    });
    if (delivery === "failed") return { ok: false, text: "The confirmation email couldn't be sent right now. Try again in a minute." };
    if (delivery === "logged" && process.env.NODE_ENV !== "production") devLink = `${appUrl()}/email-change/${token}`;
  }
  // The old address hears about it, with nothing to click.
  await sendEmail(user.email, "Your HelixOS login email is being changed", `Hi ${first},\n\n${who} the email you sign in to HelixOS with, from ${maskEmail(user.email)} to ${maskEmail(next)}. It takes effect only once the new address confirms it.\n\nIf this wasn't you, reply to this email and we'll stop it.\n\nHelixOS`).catch(() => undefined);
  return { ok: true, said: EMAIL_CHANGE_SAID, ...(devLink ? { devLink } : {}) };
}

/** The pending change a live token names, for the confirm page: the new address masked, or nothing. */
export async function pendingEmailChange(token: string): Promise<{ newMasked: string } | null> {
  const row = await db.query.emailChanges.findFirst({ where: and(eq(schema.emailChanges.tokenHash, hashToken(token)), isNull(schema.emailChanges.usedAt), gt(schema.emailChanges.expiresAt, nowIso())), columns: { newMasked: true } });
  return row ? { newMasked: row.newMasked } : null;
}

/** The click: single use, within 24 hours, the address still free; then the login email switches. */
export async function confirmEmailChange(token: string): Promise<{ ok: true; email: string } | { ok: false; text: string }> {
  const row = await db.query.emailChanges.findFirst({ where: and(eq(schema.emailChanges.tokenHash, hashToken(token)), isNull(schema.emailChanges.usedAt), gt(schema.emailChanges.expiresAt, nowIso())) });
  if (!row) return { ok: false, text: "This link has expired or was already used. Start the change again from Settings." };
  const taken = await db.query.users.findFirst({ where: eq(schema.users.email, row.newEmail), columns: { id: true } });
  if (taken && taken.id !== row.userId) return { ok: false, text: "This address can't be used for this account. Start the change again with another address." };
  const now = nowIso();
  const claimed = await db.update(schema.emailChanges).set({ usedAt: now }).where(and(eq(schema.emailChanges.id, row.id), isNull(schema.emailChanges.usedAt))).returning({ id: schema.emailChanges.id });
  if (!claimed[0]) return { ok: false, text: "This link was already used." };
  await db.update(schema.users).set({ email: row.newEmail }).where(eq(schema.users.id, row.userId));
  return { ok: true, email: row.newEmail };
}

/** The last change made on an account, for the coach's client page: when, by whom, masked old and new. */
export async function lastEmailChange(userId: string): Promise<{ at: string; oldMasked: string; newMasked: string; byUser: boolean } | null> {
  const rows = await db.query.emailChanges.findMany({ where: eq(schema.emailChanges.userId, userId) });
  const done = rows.filter((r) => r.usedAt).sort((a, b) => (b.usedAt ?? "").localeCompare(a.usedAt ?? ""))[0];
  return done ? { at: done.usedAt!, oldMasked: done.oldMasked, newMasked: done.newMasked, byUser: done.startedBy === userId } : null;
}
