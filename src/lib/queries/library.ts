import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LibraryAsset } from "@/db/schema";

/**
 * Everything this member may read: the shared bank (no workspace, no owner), their workspace's bank (the workspace's, no
 * owner), and their own entries in this workspace. Never another member's (rev 511, 5 Oct): every member's own entry carries
 * the workspace too, so "the workspace's" alone handed each member everyone else's stories and objections.
 */
export function scopeFor(workspaceId: string, userId: string) {
  const a = schema.libraryAssets;
  return or(and(isNull(a.workspaceId), isNull(a.userId)), and(eq(a.workspaceId, workspaceId), isNull(a.userId)), and(eq(a.workspaceId, workspaceId), eq(a.userId, userId)));
}

export async function assetsFor(workspaceId: string, userId: string, type?: LibraryAsset["type"]): Promise<LibraryAsset[]> {
  const scope = scopeFor(workspaceId, userId);
  return db.query.libraryAssets.findMany({
    where: type ? and(scope, eq(schema.libraryAssets.type, type)) : scope,
    orderBy: [asc(schema.libraryAssets.type), asc(schema.libraryAssets.isExample), asc(schema.libraryAssets.name)],
  });
}

/** One asset by id, only if it is in this member's scope. Ids come from forms, so never dereference one without this. */
export async function assetFor(workspaceId: string, userId: string, assetId: string | null | undefined): Promise<LibraryAsset | null> {
  if (!assetId) return null;
  const row = await db.query.libraryAssets.findFirst({ where: and(eq(schema.libraryAssets.id, assetId), scopeFor(workspaceId, userId)) });
  return row ?? null;
}
