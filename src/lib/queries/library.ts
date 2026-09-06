import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LibraryAsset } from "@/db/schema";

export async function assetsFor(workspaceId: string, userId: string, type?: LibraryAsset["type"]): Promise<LibraryAsset[]> {
  const scope = or(isNull(schema.libraryAssets.workspaceId), eq(schema.libraryAssets.workspaceId, workspaceId), eq(schema.libraryAssets.userId, userId));
  return db.query.libraryAssets.findMany({
    where: type ? and(scope, eq(schema.libraryAssets.type, type)) : scope,
    orderBy: [asc(schema.libraryAssets.type), asc(schema.libraryAssets.isExample), asc(schema.libraryAssets.name)],
  });
}
