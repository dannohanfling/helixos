import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mergeGlossary, type GlossaryItem } from "@/lib/engine/glossary";

/** The workspace's glossary: the seed with the coach's changes on top (rev 768). */
export async function glossaryFor(workspaceId: string): Promise<GlossaryItem[]> {
  const rows = await db.query.glossaryEntries.findMany({ where: eq(schema.glossaryEntries.workspaceId, workspaceId) });
  return mergeGlossary(rows);
}
