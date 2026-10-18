/**
 * The Office Hours request's save, shared (Voice pack 2, rev 642): the page's form and the HelixOS connector's
 * office_hours_submit call this same function, so a request asked by voice goes through the same two gates (tried it yourself,
 * the promise to attend), the same next four Fridays and the same categories as one sent on the page.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { oohCanEdit, readAttendees, readOohRequest, readOthers, type OohInput } from "@/lib/engine/office-hours";

/**
 * Whose request it is and who is writing it (H-413): `userId` is always the owner's (the account the request belongs to);
 * `actorId` is the team member submitting for them, or null when the owner writes; `attendeesAllowed` is the owner's live team.
 */
/** `today` is the host's (the workspace's zone) and `sessionWeekday` the workspace's session day (H-457), so dates key on the host's session. */
export type OohMember = { workspaceId: string; userId: string; today: string; categories: string[]; actorId?: string | null; attendeesAllowed?: string[]; sessionWeekday?: number };
export type OohRaw = Parameters<typeof readOohRequest>[0] & { attendees?: string[]; attendeesOther?: string };
export type OohSaved = { ok: true; id: string; value: OohInput; edited: boolean } | { ok: false; goBack: string } | { ok: false; error: string; field?: string };

/** New, or an edit of the member's own request up to and including its Friday (marked edited). Nothing is saved on a refusal. */
export async function saveOohRequest(m: OohMember, raw: OohRaw, requestId?: string | null): Promise<OohSaved> {
  const read = readOohRequest(raw, m.today, m.categories, m.sessionWeekday ?? 5);
  if ("goBack" in read) return { ok: false, goBack: read.goBack };
  if ("error" in read) return { ok: false, error: read.error, field: read.field };
  const { value } = read;
  // Who's attending (H-413): the owner and their team only; the "Others" line is names, never an email or a phone number.
  const others = readOthers(raw.attendeesOther ?? "");
  if ("error" in others) return { ok: false, error: others.error, field: others.field };
  const attendeeUserIds = readAttendees(raw.attendees ?? [], m.attendeesAllowed ?? [], m.userId);
  const actorId = m.actorId ?? null;
  const who = { ownerId: m.userId, actorId: actorId ?? m.userId, team: Boolean(actorId) };
  const fields = { friday: value.friday, description: value.description, triedSelf: value.triedSelf, tools: value.tools || null, goal: value.goal, category: value.category, attendeeUserIds, attendeesOther: others.value };
  if (requestId) {
    const mine = and(eq(schema.officeHoursRequests.id, requestId), eq(schema.officeHoursRequests.userId, m.userId), eq(schema.officeHoursRequests.workspaceId, m.workspaceId));
    const existing = await db.query.officeHoursRequests.findFirst({ where: mine });
    // A team member changes only a request they submitted themselves; the owner any of theirs; nobody after the Friday.
    if (!existing || !oohCanEdit(existing, who, m.today, existing.friday)) return { ok: false, error: "That request can't be changed after its Friday.", field: "edit" };
    await db.update(schema.officeHoursRequests).set({ ...fields, updatedAt: nowIso(), editedAt: nowIso() }).where(mine);
    return { ok: true, id: existing.id, value, edited: true };
  }
  const id = newId();
  await db.insert(schema.officeHoursRequests).values({ id, workspaceId: m.workspaceId, userId: m.userId, submittedByUserId: actorId, ...fields });
  return { ok: true, id, value, edited: false };
}
