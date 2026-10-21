import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * An agent in a client's HelixOS (H-1385), against a real database: the coach's grant per client and agent, the switched
 * viewer (work while the client lets their coach work, view otherwise, HumanOS off), Stop ending the switch and recording
 * itself, the client's record of the agent's writes, and a client found by first name.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-agent-clients-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});

const { db, schema } = await import("@/db");
const { and, eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { viewerFor } = await import("@/lib/auth");
const { agentSwitchesFor, clientByRef, grantsForClient, liveGrant, liveGrantsOf, recordAgentChange, setGrant, switchInto, switchOut, switchedViewerFor } = await import("@/lib/agent-clients");

const W = "ws1";
const O = { workspaceId: W, userId: "coach" };
const user = async (id: string, name: string, role: "coach" | "client", extra: Record<string, unknown> = {}) => {
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, name, passwordHash: "x" });
  await db.insert(schema.memberships).values({ id: `m-${id}`, workspaceId: W, userId: id, role, bodyEnabled: true, ...extra });
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: W, name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1" });
  await user("coach", "Danno Hanfling", "coach");
  await user("maya", "Maya Client", "client");
  await user("leo", "Leo Client", "client", { coachCanWork: false });
  await user("mia", "Maya Other", "client");
  await db.insert(schema.forumAgents).values({ id: "hospes", workspaceId: W, userId: "coach", name: "Hospes", nameKey: "hospes", createdBy: "member" });
  await db.insert(schema.forumAgents).values({ id: "builtin", workspaceId: W, userId: "coach", name: "Sentinel", nameKey: "sentinel", createdBy: "builtin", builtIn: "sentinel" });
  await db.insert(schema.connectedApps).values({ id: "app1", workspaceId: W, userId: "coach", membershipId: "m-coach", clientId: "agent-token", name: "Agent token: Hospes", scopes: ["forum", "inbox"], agentId: "hospes" });
  await db.insert(schema.agentTokens).values({ id: "tok1", workspaceId: W, userId: "coach", agentId: "hospes", appId: "app1", tokenHash: "h", last4: "abcd" });
});

describe("grants", () => {
  it("off by default; Allow makes a live grant once; Stop revokes it and records both for the client; a built-in agent gets none", async () => {
    expect(await liveGrant(O, "hospes", "m-maya")).toBeNull();
    expect(await setGrant(O, "hospes", "m-maya", true)).toBe(true);
    expect(await setGrant(O, "hospes", "m-maya", true)).toBe(true);
    expect((await grantsForClient(O, "m-maya")).filter((g) => !g.revokedAt)).toHaveLength(1);
    expect((await liveGrantsOf(O, "hospes")).map((g) => g.clientMembershipId)).toEqual(["m-maya"]);
    expect(await setGrant(O, "builtin", "m-maya", true)).toBe(false);
    expect(await setGrant(O, "hospes", "m-coach", true)).toBe(false);
    expect(await setGrant(O, "hospes", "m-maya", false)).toBe(true);
    expect(await liveGrant(O, "hospes", "m-maya")).toBeNull();
    const record = await db.query.coachChanges.findMany({ where: and(eq(schema.coachChanges.clientMembershipId, "m-maya"), eq(schema.coachChanges.kind, "change")) });
    expect(record.map((r) => r.action)).toEqual(["Allowed Hospes to work here", "Stopped Hospes working here"]);
    for (const r of record) expect([r.agentId, r.userId, r.coachUserId]).toEqual(["hospes", "maya", "coach"]);
  });
});

describe("the switched viewer", () => {
  it("is the client with the coach as the actor, work while the client lets their coach work, view otherwise, HumanOS off; none without a grant", async () => {
    const own = (await viewerFor("coach", W))!;
    expect(await switchedViewerFor(own, "hospes", "m-maya")).toBeNull();
    await setGrant(O, "hospes", "m-maya", true);
    await setGrant(O, "hospes", "m-leo", true);
    const maya = (await switchedViewerFor(own, "hospes", "m-maya"))!;
    expect([maya.user.id, maya.role, maya.actor.id, maya.switchedInto?.mode, maya.membership.bodyEnabled]).toEqual(["maya", "client", "coach", "work", false]);
    const leo = (await switchedViewerFor(own, "hospes", "m-leo"))!;
    expect(leo.switchedInto?.mode).toBe("view");
    // A client's own viewer never switches.
    const client = (await viewerFor("maya", W))!;
    expect(await switchedViewerFor(client, "hospes", "m-leo")).toBeNull();
  });

  it("client_switch records the switch and sets the connection; Stop clears the connection; the agent's writes land in the client's record", async () => {
    const own = (await viewerFor("coach", W))!;
    const sw = (await switchInto(own, "app1", "hospes", "m-maya"))!;
    expect((await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, "app1") }))!.switchedMembershipId).toBe("m-maya");
    await recordAgentChange(sw, "hospes", "tasks_add");
    await recordAgentChange(sw, "hospes", "some_new_tool");
    const changes = await db.query.coachChanges.findMany({ where: and(eq(schema.coachChanges.clientMembershipId, "m-maya"), eq(schema.coachChanges.kind, "change")) });
    expect(changes.map((c) => c.action)).toContain("Added a task");
    expect(changes.map((c) => c.action)).toContain("Made a change with some_new_tool");
    for (const c of changes.filter((c) => c.page === "Today")) expect([c.agentId, c.coachUserId, c.userId, c.mode]).toEqual(["hospes", "coach", "maya", "work"]);
    await switchOut(own, "app1", "hospes", sw);
    expect((await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, "app1") }))!.switchedMembershipId).toBeNull();
    const switches = await agentSwitchesFor(O, "m-maya");
    expect(switches.map((s) => s.kind)).toEqual(["switch_out", "switch_in"]);
    // Stop while switched in: the connection leaves the client at once.
    await switchInto(own, "app1", "hospes", "m-maya");
    await setGrant(O, "hospes", "m-maya", false);
    expect((await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, "app1") }))!.switchedMembershipId).toBeNull();
    expect(await switchedViewerFor(own, "hospes", "m-maya")).toBeNull();
  });

  it("a client by membership id, full name or a first name that matches one client only", async () => {
    expect((await clientByRef(O, "m-leo"))?.user.name).toBe("Leo Client");
    expect((await clientByRef(O, "Leo Client"))?.user.id).toBe("leo");
    expect((await clientByRef(O, "leo"))?.user.id).toBe("leo");
    expect(await clientByRef(O, "Maya")).toBeNull();
    expect((await clientByRef(O, "Maya Client"))?.user.id).toBe("maya");
    expect(await clientByRef(O, "Danno")).toBeNull();
  });
});
