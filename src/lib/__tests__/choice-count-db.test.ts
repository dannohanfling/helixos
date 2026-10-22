import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The menu's "Switch HelixOS" count (Speed 2) is read in one wait, so it must always equal the length of the full list the
 * chooser shows: own memberships, team seats, and none of the removed, owner-removed or workspace-less ones.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-choices-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});

const { db, schema } = await import("@/db");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { choiceCount, choicesFor } = await import("@/lib/team");

const user = (id: string) => ({ id, email: `${id}@example.com`, name: `Person ${id}`, passwordHash: "x" });
const member = (id: string, workspaceId: string, userId: string, role: "coach" | "client", removedAt: string | null = null) => ({ id, workspaceId, userId, role, removedAt });
const seat = (id: string, workspaceId: string, ownerMembershipId: string, ownerUserId: string, teamUserId: string, removedAt: string | null = null) => ({ id, workspaceId, ownerMembershipId, userId: ownerUserId, teamUserId, addedBy: ownerUserId, removedAt });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values([
    { id: "w1", name: "One", slug: "one", clientInviteCode: "C1", coachInviteCode: "K1" },
    { id: "w2", name: "Two", slug: "two", clientInviteCode: "C2", coachInviteCode: "K2" },
    { id: "w3", name: "Three", slug: "three", clientInviteCode: "C3", coachInviteCode: "K3" },
  ]);
  await db.insert(schema.users).values(["solo", "multi", "helper", "owner1", "owner2", "gone"].map(user));
  await db.insert(schema.memberships).values([
    member("m-solo", "w1", "solo", "client"),
    member("m-multi1", "w1", "multi", "coach"),
    member("m-multi2", "w2", "multi", "client"),
    member("m-multi3", "w3", "multi", "client", "2026-10-01T00:00:00Z"),
    member("m-owner1", "w1", "owner1", "client"),
    member("m-owner2", "w2", "owner2", "client", "2026-10-02T00:00:00Z"),
    member("m-helper", "w1", "helper", "client"),
  ]);
  await db.insert(schema.teamMembers).values([
    seat("t1", "w1", "m-owner1", "owner1", "helper"),
    // The owner left: the seat no longer counts.
    seat("t2", "w2", "m-owner2", "owner2", "helper"),
    // The seat itself was removed.
    seat("t3", "w1", "m-owner1", "owner1", "multi", "2026-10-03T00:00:00Z"),
  ]);
});

describe("choiceCount", () => {
  it("equals the chooser's list for every kind of person", async () => {
    for (const id of ["solo", "multi", "helper", "owner1", "owner2", "gone"]) {
      expect(await choiceCount(id), id).toBe((await choicesFor(id)).length);
    }
  });

  it("counts own memberships and live team seats, and nothing removed", async () => {
    expect(await choiceCount("solo")).toBe(1);
    expect(await choiceCount("multi")).toBe(2);
    expect(await choiceCount("helper")).toBe(2);
    expect(await choiceCount("owner2")).toBe(0);
    expect(await choiceCount("gone")).toBe(0);
  });
});
