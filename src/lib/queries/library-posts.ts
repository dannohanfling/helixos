import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LibraryPost } from "@/db/schema";

/** Everything a member can see: master entries, entries the coach shared in this workspace, and their own. */
export async function visibleLibrary(workspaceId: string, userId: string): Promise<LibraryPost[]> {
  return db.query.libraryPosts.findMany({
    where: or(eq(schema.libraryPosts.userId, userId), and(eq(schema.libraryPosts.shared, true), or(isNull(schema.libraryPosts.workspaceId), eq(schema.libraryPosts.workspaceId, workspaceId)))),
    orderBy: [desc(schema.libraryPosts.usedCount), desc(schema.libraryPosts.engagements), desc(schema.libraryPosts.createdAt)],
  });
}

export async function libraryPostFor(id: string, workspaceId: string, userId: string): Promise<LibraryPost | null> {
  const row = await db.query.libraryPosts.findFirst({ where: eq(schema.libraryPosts.id, id) });
  if (!row) return null;
  const visible = row.userId === userId || (row.shared && (row.workspaceId === null || row.workspaceId === workspaceId));
  return visible ? row : null;
}

export function matches(p: LibraryPost, q: string): boolean {
  if (!q) return true;
  const hay = [p.title, p.hook, p.body, p.cta, p.pillar, p.angle, p.contentType, p.useWhen, ...p.tags].filter(Boolean).join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
