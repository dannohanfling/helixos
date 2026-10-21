import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The PARTNER bot's lead webhook (H-1361 PR B): the key in the header, never the query string; a lead becomes a restaurant
 * with a bot touch and its answers kept; a second lead for the same business adds a touch and never moves it backwards.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-partner-lead-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});
vi.mock("@/lib/report-error", () => ({ reportError: () => undefined }));

const { db, schema } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { POST } = await import("@/app/api/webhooks/partner-lead/route");
const { leadDemoDate, leadSource, leadType } = await import("@/lib/partner-lead");

const KEY = "test-lead-key-not-a-real-one";
const post = (body: unknown, headers: Record<string, string> = { "x-helix-secret": KEY }) =>
  POST(new Request("http://localhost/api/webhooks/partner-lead", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: "ws1", name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1" });
  process.env.PARTNER_LEAD_KEY = KEY;
  delete process.env.PARTNER_LEAD_WORKSPACE;
});
afterAll(() => {
  delete process.env.PARTNER_LEAD_KEY;
});

describe("the lead webhook", () => {
  it("maps the bot's buttons to the program's lists", () => {
    expect(leadType("Cafe or bakery")).toBe("cafe");
    expect(leadType("Food truck")).toBe("food truck");
    expect(leadType("Bar")).toBe("bar");
    expect(leadType("Restaurant")).toBe("restaurant");
    expect(leadType("Other")).toBe("other");
    expect(leadType("")).toBe("restaurant");
    expect(leadSource("nominated by a taste bud")).toBe("nominated");
    expect(leadSource("")).toBe("in the group");
    expect(leadDemoDate("2026-10-27 10:30")).toBe("2026-10-27");
    expect(leadDemoDate("two times that work")).toBeNull();
  });

  it("refuses without the key, with a wrong key, or with the key in the query string", async () => {
    expect((await post({ business: "A" }, {})).status).toBe(401);
    expect((await post({ business: "A" }, { "x-helix-secret": "wrong" })).status).toBe(401);
    expect((await POST(new Request(`http://localhost/api/webhooks/partner-lead?secret=${KEY}`, { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ city: "Tucson" })).status).toBe(400);
  });

  it("a lead becomes a restaurant with a bot touch, its answers kept; a second lead adds a touch and never moves it back", async () => {
    const res = await post({ business: "Smoke Cantina", type: "Restaurant", city: "Tucson", google_reviews_bucket: "50 to 200", pain: "Slow nights", demo_time: "2026-10-27 10:30", source: "comment PARTNER" });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; restaurantId: string; created: boolean; stage: string };
    expect(j.created).toBe(true);
    expect(j.stage).toBe("demo booked");
    const r = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, j.restaurantId) }))!;
    expect([r.type, r.city, r.source, r.demoAt, r.nextStep, r.nextStepDate]).toEqual(["restaurant", "Tucson", "in the group", "2026-10-27", "Demo walkthrough", "2026-10-27"]);
    expect(r.extra).toEqual({ "reviews bucket": "50 to 200", "one thing to fix": "Slow nights", "demo time": "2026-10-27 10:30" });
    let touches = await db.query.partnerTouches.findMany({ where: eq(schema.partnerTouches.restaurantId, r.id) });
    expect(touches).toHaveLength(1);
    expect([touches[0].who, touches[0].channel, touches[0].firstConversation]).toEqual(["bot", "bot", true]);
    expect(touches[0].note).not.toMatch(/@|\d{3}-\d{4}/);
    // Signed in the meantime: a second lead for the same business neither renames, restages nor re-dates it.
    await db.update(schema.partnerRestaurants).set({ stage: "signed", demoAt: "2026-10-20" }).where(eq(schema.partnerRestaurants.id, r.id));
    const again = await post({ business: "smoke cantina", type: "Bar", demo_time: "2026-11-02", google_reviews_bucket: "Over 200" });
    expect(((await again.json()) as { created: boolean; stage: string }).created).toBe(false);
    const after = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, r.id) }))!;
    expect([after.business, after.stage, after.type, after.demoAt]).toEqual(["Smoke Cantina", "signed", "restaurant", "2026-10-20"]);
    expect(after.extra["reviews bucket"]).toBe("Over 200");
    touches = await db.query.partnerTouches.findMany({ where: eq(schema.partnerTouches.restaurantId, r.id) });
    expect(touches).toHaveLength(2);
    expect(touches.some((t) => !t.firstConversation)).toBe(true);
  });

  it("with two workspaces and no slug set there is nowhere to land; the slug picks one", async () => {
    await db.insert(schema.workspaces).values({ id: "ws2", name: "Other", slug: "other", clientInviteCode: "C2", coachInviteCode: "K2" });
    expect((await post({ business: "Nowhere Grill" })).status).toBe(503);
    process.env.PARTNER_LEAD_WORKSPACE = "other";
    const res = await post({ business: "Elsewhere Grill" });
    expect(res.status).toBe(200);
    const row = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.business, "Elsewhere Grill") }))!;
    expect(row.workspaceId).toBe("ws2");
    delete process.env.PARTNER_LEAD_WORKSPACE;
  });
});
