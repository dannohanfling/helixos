import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Submissions to verify (H-1280, plan H-1296), against a real database: the count is handed-in Pathway tasks plus handed-in
 * certification deliverables for clients still in the workspace, and nothing else.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-submissions-"));
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
const { submissionsWaiting, submissionsWaitingCount } = await import("@/lib/queries/submissions");

const W = "ws1";
const user = async (id: string, name: string, role: "coach" | "client", removedAt: string | null = null) => {
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, name, passwordHash: "x" });
  await db.insert(schema.memberships).values({ id: `m-${id}`, workspaceId: W, userId: id, role, removedAt });
};
const pathway = async (id: string, userId: string, status: "todo" | "submitted" | "revision" | "verified") =>
  db.insert(schema.pathwayProgress).values({ id, workspaceId: W, userId, libraryTaskKey: `task-${id}`, status, submittedAt: "2026-10-20T10:00:00.000Z" });
const cert = async (id: string, userId: string, status: "submitted" | "passed" | "revise") =>
  db.insert(schema.certSubmissions).values({ id, workspaceId: W, userId, deliverableId: "d1", url: "https://example.com/x", status });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: W, name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1" });
  await db.insert(schema.workspaces).values({ id: "ws2", name: "Other", slug: "other", clientInviteCode: "C2", coachInviteCode: "K2" });
  // The hand-ins point at real Pathway tasks and a real deliverable: the foreign keys are on.
  await db.insert(schema.pathwayStages).values({ key: "s1", order: 1, name: "Stage one", track: "core" });
  for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) await db.insert(schema.libraryTasks).values({ key: `task-${id}`, stageKey: "s1", order: 1, name: `Task ${id}` });
  await db.insert(schema.certModules).values({ id: "mod1", name: "Module one", order: 1 });
  await db.insert(schema.certDeliverables).values({ id: "d1", moduleId: "mod1", name: "Deliverable one", order: 1 });
  await user("coach", "Danno Hanfling", "coach");
  await user("maya", "Maya Client", "client");
  await user("leo", "Leo Client", "client");
  await user("gone", "Gone Client", "client", "2026-10-01T00:00:00.000Z");
});

describe("submissionsWaiting", () => {
  it("is empty with nothing handed in", async () => {
    expect(await submissionsWaiting(W)).toEqual({ pathway: [], certs: [], total: 0 });
  });
  it("counts handed-in Pathway tasks and certification deliverables, and nothing verified, sent back, passed or marked revise", async () => {
    await pathway("p1", "maya", "submitted");
    await pathway("p2", "leo", "submitted");
    await pathway("p3", "leo", "verified");
    await pathway("p4", "maya", "revision");
    await pathway("p5", "maya", "todo");
    await cert("c1", "maya", "submitted");
    await cert("c2", "leo", "passed");
    await cert("c3", "leo", "revise");
    const w = await submissionsWaiting(W);
    expect(w.pathway.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
    expect(w.certs.map((r) => r.id)).toEqual(["c1"]);
    expect(w.total).toBe(3);
    expect(await submissionsWaitingCount(W)).toBe(3);
  });
  it("skips a removed client's hand-ins and another workspace's", async () => {
    await pathway("p6", "gone", "submitted");
    await cert("c4", "gone", "submitted");
    await db.insert(schema.pathwayProgress).values({ id: "p7", workspaceId: "ws2", userId: "maya", libraryTaskKey: "task-p7", status: "submitted" });
    expect(await submissionsWaitingCount(W)).toBe(3);
  });
  it("drops when one is verified or sent back", async () => {
    await db.update(schema.pathwayProgress).set({ status: "verified" }).where(eq(schema.pathwayProgress.id, "p1"));
    expect(await submissionsWaitingCount(W)).toBe(2);
    await db.update(schema.certSubmissions).set({ status: "revise" }).where(eq(schema.certSubmissions.id, "c1"));
    expect(await submissionsWaitingCount(W)).toBe(1);
  });
});
