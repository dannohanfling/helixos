/**
 * The Pathway task library, kept in step with src/data/seed/task_library.json on every deploy (npm run db:migrate) and by the
 * seed (H-1664). One read for the whole library, then a write only for a task that is new or changed.
 *
 * Why it matters: an upsert that also sets `key` makes SQLite treat it as a change of the parent key, and it then checks
 * pathway_progress for rows still pointing at the old key. That column leads no index, so each of the 218 upserts read the
 * whole table (about 7.4K rows on live), roughly 1.6 million rows read per deploy for a library that usually hasn't changed.
 * Here the key is only ever the WHERE, never the SET.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type LibraryTaskRow = typeof schema.libraryTasks.$inferInsert;

const FIELDS = ["stageKey", "order", "name", "teaching", "howTo", "submissionType", "points", "effort", "priority", "unlocks", "trainingUrl"] as const;

export async function syncLibraryTasks(rows: readonly LibraryTaskRow[]): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const have = new Map((await db.select().from(schema.libraryTasks)).map((r) => [r.key, r]));
  const out = { inserted: 0, updated: 0, unchanged: 0 };
  for (const row of rows) {
    const cur = have.get(row.key);
    if (!cur) {
      await db.insert(schema.libraryTasks).values(row).onConflictDoNothing();
      out.inserted++;
      continue;
    }
    const { key, ...rest } = row;
    if (!FIELDS.some((f) => (cur[f] ?? null) !== (rest[f] ?? null))) {
      out.unchanged++;
      continue;
    }
    await db.update(schema.libraryTasks).set(rest).where(eq(schema.libraryTasks.key, key));
    out.updated++;
  }
  return out;
}
