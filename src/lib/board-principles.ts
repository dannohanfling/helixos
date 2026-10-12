/**
 * My Board: Danno's principles (rev 664 §8), the coach workspace's own, seeded from the source pack the first time
 * they're read. Apart from src/lib/board.ts so Coach → Danno loads only this.
 */
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { principlesFromPack } from "@/lib/engine/board";

/** The coach workspace's principles, in order; seeded from the pack the first time they're read. */
export async function principlesFor(workspaceId: string): Promise<schema.BoardPrinciple[]> {
  const rows = await db.query.boardPrinciples.findMany({ where: eq(schema.boardPrinciples.workspaceId, workspaceId), orderBy: [asc(schema.boardPrinciples.order), asc(schema.boardPrinciples.createdAt)] });
  if (rows.length) return rows;
  const seed = principlesFromPack();
  await db.insert(schema.boardPrinciples).values(seed.map((p, i) => ({ id: newId(), workspaceId, title: p.title, body: p.body, goodFor: p.goodFor, order: i })));
  return db.query.boardPrinciples.findMany({ where: eq(schema.boardPrinciples.workspaceId, workspaceId), orderBy: [asc(schema.boardPrinciples.order)] });
}
