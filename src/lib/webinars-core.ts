/**
 * Webinars, the one copy of how one starts: the row, its section checklist from the templates, and its three beliefs. The
 * page's "New webinar" and the Board's set-up (a draft from a decision) both call it.
 */
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { SECTION_TEMPLATES } from "@/lib/engine/webinar";

export type NewWebinar = { title: string; category?: string | null; promise?: string | null; offerId?: string | null; scheduledAt?: string | null; notes?: string | null };

/** A new webinar for the member, as a draft. Returns its id. */
export async function createWebinar(m: { workspaceId: string; userId: string }, w: NewWebinar): Promise<string> {
  const id = newId();
  await db.insert(schema.webinars).values({ id, workspaceId: m.workspaceId, userId: m.userId, title: w.title.trim() || "Untitled webinar", category: w.category || "Live", promise: w.promise || null, offerId: w.offerId ?? null, scheduledAt: w.scheduledAt ?? null, notes: w.notes ?? null });
  await db.insert(schema.webinarSections).values(
    SECTION_TEMPLATES.map((t) => ({ id: newId(), webinarId: id, sectionKey: t.key, act: t.act, order: t.order, name: t.name, durationMin: t.durationMin, status: "todo" as const })),
  );
  await db.insert(schema.webinarBeliefs).values((["vehicle", "internal", "external"] as const).map((type) => ({ id: newId(), webinarId: id, type })));
  return id;
}
