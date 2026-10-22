import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The deploy's library sync (H-1664), against a real database: one read, a write only for a new or changed task, and the key
 * is never rewritten, so a member's progress rows stay attached and SQLite never scans them.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-libsync-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});

const { db, schema } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { syncLibraryTasks } = await import("@/db/library-sync");

const task = (key: string, name: string, order = 1) => ({ key, stageKey: "s1", order, name, teaching: null, howTo: null, submissionType: "written" as const, points: 10, effort: "medium" as const, priority: "should" as const, unlocks: null, trainingUrl: null });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: "ws1", name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1" });
  await db.insert(schema.users).values({ id: "u1", email: "u1@example.com", name: "Member", passwordHash: "x" });
  await db.insert(schema.pathwayStages).values({ key: "s1", order: 1, name: "Stage one", track: "core" });
});

describe("syncLibraryTasks (H-1664)", () => {
  it("inserts new tasks, leaves unchanged ones alone and updates only what changed", async () => {
    expect(await syncLibraryTasks([task("t1", "One"), task("t2", "Two")])).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
    await db.insert(schema.pathwayProgress).values({ id: "p1", workspaceId: "ws1", userId: "u1", libraryTaskKey: "t1", status: "submitted" });
    expect(await syncLibraryTasks([task("t1", "One"), task("t2", "Two")])).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect(await syncLibraryTasks([task("t1", "One, reworded"), task("t2", "Two", 2), task("t3", "Three")])).toEqual({ inserted: 1, updated: 2, unchanged: 0 });
    const t1 = await db.query.libraryTasks.findFirst({ where: eq(schema.libraryTasks.key, "t1") });
    expect(t1?.name).toBe("One, reworded");
    expect((await db.query.libraryTasks.findFirst({ where: eq(schema.libraryTasks.key, "t2") }))?.order).toBe(2);
    const progress = await db.query.pathwayProgress.findFirst({ where: eq(schema.pathwayProgress.id, "p1") });
    expect(progress).toMatchObject({ libraryTaskKey: "t1", status: "submitted" });
  });
});
