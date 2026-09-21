/**
 * The logged side of "Continue anyway": one row per confirm, with who, when, which action, which record and the names of
 * the unreviewed drafts it carried. The deck route reads a confirm back by id before it serves a deck that carries drafts.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import type { ReviewSurface } from "@/db/schema";

export async function recordConfirm(who: { workspaceId: string; userId: string; userName: string }, surface: ReviewSurface, subjectId: string, items: string[]): Promise<string> {
  const id = newId();
  await db.insert(schema.reviewConfirms).values({ id, workspaceId: who.workspaceId, userId: who.userId, userName: who.userName, surface, subjectId, items });
  return id;
}

/** The confirm named, when it is this user's, for this action, on this record; otherwise null. */
export async function confirmFor(id: string | null | undefined, userId: string, surface: ReviewSurface, subjectId: string): Promise<schema.ReviewConfirm | null> {
  if (!id) return null;
  const row = await db.query.reviewConfirms.findFirst({ where: and(eq(schema.reviewConfirms.id, id), eq(schema.reviewConfirms.userId, userId), eq(schema.reviewConfirms.surface, surface), eq(schema.reviewConfirms.subjectId, subjectId)) });
  return row ?? null;
}
