/**
 * The Office Hours request's save, shared (Voice pack 2, rev 642): the page's form and the HelixOS connector's
 * office_hours_submit call this same function, so a request asked by voice goes through the same two gates (tried it yourself,
 * the promise to attend), the same next four Fridays and the same categories as one sent on the page.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { oohEditable, readOohRequest, type OohInput } from "@/lib/engine/office-hours";

export type OohMember = { workspaceId: string; userId: string; today: string; categories: string[] };
export type OohRaw = Parameters<typeof readOohRequest>[0];
export type OohSaved = { ok: true; id: string; value: OohInput; edited: boolean } | { ok: false; goBack: string } | { ok: false; error: string; field?: string };

/** New, or an edit of the member's own request up to and including its Friday (marked edited). Nothing is saved on a refusal. */
export async function saveOohRequest(m: OohMember, raw: OohRaw, requestId?: string | null): Promise<OohSaved> {
  const read = readOohRequest(raw, m.today, m.categories);
  if ("goBack" in read) return { ok: false, goBack: read.goBack };
  if ("error" in read) return { ok: false, error: read.error, field: read.field };
  const { value } = read;
  const fields = { friday: value.friday, description: value.description, triedSelf: value.triedSelf, tools: value.tools || null, goal: value.goal, category: value.category };
  if (requestId) {
    const mine = and(eq(schema.officeHoursRequests.id, requestId), eq(schema.officeHoursRequests.userId, m.userId), eq(schema.officeHoursRequests.workspaceId, m.workspaceId));
    const existing = await db.query.officeHoursRequests.findFirst({ where: mine });
    if (!existing || !oohEditable(m.today, existing.friday)) return { ok: false, error: "That request can't be changed after its Friday.", field: "edit" };
    await db.update(schema.officeHoursRequests).set({ ...fields, updatedAt: nowIso(), editedAt: nowIso() }).where(mine);
    return { ok: true, id: existing.id, value, edited: true };
  }
  const id = newId();
  await db.insert(schema.officeHoursRequests).values({ id, workspaceId: m.workspaceId, userId: m.userId, ...fields });
  return { ok: true, id, value, edited: false };
}
