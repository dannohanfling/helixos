/**
 * One place that issues a password-reset token: the client's own /forgot and the coach's "Send reset link" both go through
 * here, so a coach-issued link is exactly the client's own link (single use, 60 minutes, only its sha256 hash stored). The
 * raw token is returned to the caller to put in an email or hand to the coach to copy; it is never written anywhere but as a
 * hash, and never logged.
 */
import { createHash, randomBytes } from "node:crypto";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";

export const RESET_TTL_MS = 60 * 60 * 1000;
/** The cookie a coach's "Send reset link" leaves for their own next page load when there is no email to send: the link to copy, once. */
export const COACH_RESET_COOKIE = "helix_coach_reset";
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Issues a fresh single-use reset token for a user and returns the raw token; only its hash reaches the database. */
export async function issueResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.passwordResets).values({ id: newId(), userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString() });
  return token;
}
