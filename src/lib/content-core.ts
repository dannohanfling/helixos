/**
 * The Content board's add, shared (Voice pack 2, rev 642): the board's Quick idea form and the connector's idea_add call this
 * one function. With no date it lands in Ideas; with one, scheduled. What the member writes is theirs, so the mark is coach.
 */
import { db, schema } from "@/db";
import { CONTENT_STATUSES } from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

export type NewContent = { title: string; status?: string | null; contentType?: string | null; platform?: string | null; hasCta?: boolean; hook?: string | null; body?: string | null; cta?: string | null; postDate?: string | null; postTime?: string | null; notes?: string | null };

export async function createContentItem(m: { workspaceId: string; userId: string }, c: NewContent): Promise<string> {
  const id = newId();
  const status: (typeof CONTENT_STATUSES)[number] = CONTENT_STATUSES.find((s) => s === c.status) ?? (c.postDate ? "scheduled" : "idea");
  await db.insert(schema.contentItems).values({
    id,
    workspaceId: m.workspaceId,
    userId: m.userId,
    title: c.title,
    status,
    contentType: c.contentType || "CTA Post",
    platform: c.platform || "FB Group",
    hasCta: c.hasCta ?? false,
    hook: c.hook ?? null,
    body: c.body ?? null,
    cta: c.cta ?? null,
    postAt: c.postDate ? `${c.postDate}T${c.postTime || "09:00"}:00` : null,
    notes: c.notes ?? null,
    postedAt: status === "posted" ? nowIso() : null,
    origin: "coach",
  });
  return id;
}
