import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FRAMEWORKS_MD, FRAMEWORKS_MD_V2 } from "../../../scripts/fixtures/frameworks";

/** Frameworks on the server (H-1262, plan H-1270), against a real database with every migration applied. */
const dir = mkdtempSync(path.join(tmpdir(), "hx-frameworks-"));
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
const { dryRunFrameworks, frameworkBySlug, frameworkMaterial, frameworksFor, importFrameworks, setFrameworkStatus } = await import("@/lib/frameworks");

const W = "ws1";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: W, name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("frameworks on the server", () => {
  it("a dry run names each framework and saves nothing", async () => {
    const dry = await dryRunFrameworks(W, FRAMEWORKS_MD);
    expect(dry).toEqual({ added: ["Belief Before the Call", "The Opener", "The Price Ladder"], changed: [], unchanged: [], flagged: ["The Price Ladder"], unreadable: ["A heading with nothing under it"] });
    expect(await frameworksFor(W, true)).toEqual([]);
  });
  it("an import makes drafts; a re-import updates in place and keeps the status", async () => {
    expect(await importFrameworks(W, FRAMEWORKS_MD)).toMatchObject({ added: 3, changed: 0, unchanged: 0, flagged: 1 });
    expect(await setFrameworkStatus(W, (await frameworkBySlug(W, "belief-before-the-call", true))!.id, "published")).toEqual({ ok: true });
    expect(await dryRunFrameworks(W, FRAMEWORKS_MD_V2)).toMatchObject({ added: [], changed: ["Belief Before the Call"], unchanged: ["The Opener", "The Price Ladder"] });
    expect(await importFrameworks(W, FRAMEWORKS_MD_V2)).toMatchObject({ added: 0, changed: 1, unchanged: 2 });
    const b = (await frameworkBySlug(W, "belief-before-the-call", false))!;
    expect(b.status).toBe("published");
    expect(b.steps[2]).toContain("an hour before");
    expect((await frameworksFor(W, true)).length).toBe(3);
  });
  it("a price can't be published, and a published one that gains a price goes back to draft", async () => {
    const priced = (await frameworkBySlug(W, "the-price-ladder", true))!;
    const r = await setFrameworkStatus(W, priced.id, "published");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/names a price/);
    expect(await frameworkBySlug(W, "the-price-ladder", false)).toBeNull();
    await importFrameworks(W, FRAMEWORKS_MD_V2.replace("The idea: People do not show up sold.", "The idea: Charge $997 up front. People do not show up sold."));
    expect((await frameworkBySlug(W, "belief-before-the-call", true))!.status).toBe("draft");
    await importFrameworks(W, FRAMEWORKS_MD_V2);
    await setFrameworkStatus(W, (await frameworkBySlug(W, "belief-before-the-call", true))!.id, "published");
  });
  it("members see published only; the writer gets published, price-free, by the brief's words", async () => {
    expect((await frameworksFor(W, false)).map((f) => f.slug)).toEqual(["belief-before-the-call"]);
    const picks = await frameworkMaterial(W, ["call", "warmed", "price"], new Set());
    expect(picks.map((f) => f.slug)).toEqual(["belief-before-the-call"]);
    expect(await frameworkMaterial(W, ["nothing", "matches"], new Set())).toEqual([]);
    // Another workspace sees none of it.
    expect(await frameworksFor("ws2", true)).toEqual([]);
    expect(await db.query.frameworks.findMany({ where: eq(schema.frameworks.workspaceId, W) })).toHaveLength(3);
  });
});
