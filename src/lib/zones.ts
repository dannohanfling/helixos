/**
 * Time zones (H-457): the member's browser zone saved when they never had one, and the one-time line marked seen. The zone is
 * the member's own: never saved while a coach is switched in or for a team member, and never over a zone already chosen.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { canonicalZone } from "@/lib/engine/zones";

type Who = { switchedInto: unknown; team: unknown; membership: { id: string; timezone: string | null } };

/** The browser's zone, saved only when the member has none; true when it was saved. Logged as a cause, never a name. */
export async function saveBrowserZone(v: Who, zone: string): Promise<boolean> {
  if (v.switchedInto || v.team || v.membership.timezone) return false;
  const tz = canonicalZone(zone);
  if (!tz) return false;
  const done = await db
    .update(schema.memberships)
    .set({ timezone: tz })
    .where(and(eq(schema.memberships.id, v.membership.id), isNull(schema.memberships.timezone)))
    .returning({ id: schema.memberships.id });
  if (done.length) console.info("zone set from the browser");
  return done.length > 0;
}

/** Got it on the one-time line. */
export async function markZoneNoticeSeen(v: Omit<Who, "membership"> & { membership: { id: string } }): Promise<void> {
  if (v.switchedInto || v.team) return;
  await db.update(schema.memberships).set({ tzPromptSeenAt: nowIso() }).where(eq(schema.memberships.id, v.membership.id));
}
