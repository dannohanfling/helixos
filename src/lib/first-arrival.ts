/**
 * The first arrival's read (H-472): due once per person, ever, on their first open of HelixOS; a team member on their first
 * open of the owner's. It plays instead of the daily welcome and stamps the day as welcome-shown, so the daily welcome starts
 * the next day. A replay asked from Settings (Today with ?arrival=replay) stamps nothing. Never while a coach is switched into a
 * client, never on /coach pages.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { arrivalCard, arrivalDue, type ArrivalCard } from "@/lib/engine/first-arrival";
import { oohAccessFor } from "@/lib/office-hours-access";

/** `replay`: "Play my welcome again" from Settings (Today with ?arrival=replay): plays for anyone, stamps nothing, marks nothing. */
export async function firstArrivalFor(v: Viewer, path: string, opts: { replay?: boolean } = {}): Promise<ArrivalCard | null> {
  if (v.switchedInto) return null;
  const replay = Boolean(opts.replay);
  // The two faces are a client's and a team member's: a coach never gets it on their own, and can replay the client's from Settings.
  if (v.role === "coach" && !replay) return null;
  let seenAt: string | null = v.membership.firstArrivalSeenAt;
  if (v.team) {
    const row = await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, v.team.teamMemberId), columns: { firstArrivalSeenAt: true } });
    // No row (removed mid-request) reads as seen; a row's own null is "not yet".
    seenAt = row ? row.firstArrivalSeenAt : "unknown";
  }
  const due = !replay && arrivalDue({ seenAt, switchedInto: false, path });
  if (!due && !replay) return null;
  if (!replay && !v.team && (v.membership.welcomeShownOn ?? "") < v.today) {
    // The daily welcome starts the next day: today is marked shown before the layout reads it.
    await db.update(schema.memberships).set({ welcomeShownOn: v.today }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id)));
    v.membership.welcomeShownOn = v.today;
  }
  const first = v.actor.name.split(" ")[0] ?? "";
  if (v.team) return arrivalCard({ kind: "team", first, owner: v.user.name.split(" ")[0], oohOn: (await oohAccessFor(v)).open, replay });
  return arrivalCard({ kind: "client", first, replay });
}
