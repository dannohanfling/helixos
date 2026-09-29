import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { canEmailMember } from "@/lib/engine/email-gate";
import { nowIso } from "@/lib/dates";

/** May HelixOS email this member automatically? The one check every automated sender makes (src/lib/engine/email-gate.ts). */
export async function canEmail(membershipId: string): Promise<boolean> {
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipId) });
  if (!m) return false;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!u) return false;
  return canEmailMember({ emailsEnabled: m.emailsEnabled, removedAt: m.removedAt, firstSignedInAt: u.firstSignedInAt });
}

/** The first sign-in, recorded once: called next to every writeSession, all of which are the person signing in as themselves. */
export async function markSignedIn(userId: string): Promise<void> {
  await db.update(schema.users).set({ firstSignedInAt: nowIso() }).where(and(eq(schema.users.id, userId), isNull(schema.users.firstSignedInAt)));
}
