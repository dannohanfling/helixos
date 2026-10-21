import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Partner Program's data (H-1307, plan H-1361), against a real database: a restaurant by name or id, touches that
 * set the next step, payments that never land twice, and a month's statement built, rebuilt around Danno's approved lines,
 * and never reaching across workspaces.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-partner-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});

const { db, schema } = await import("@/db");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { addAdjustment, addPayment, addTouch, approvePayouts, buildPayouts, payoutLinesFor, restaurantById, restaurantByRef, restaurantsFor, touchesFor, upsertRestaurant } = await import("@/lib/partner");

const W = "ws1";
const TODAY = "2026-10-21";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: W, name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1" });
  await db.insert(schema.workspaces).values({ id: "ws2", name: "Other", slug: "other", clientInviteCode: "C2", coachInviteCode: "K2" });
});

describe("restaurants", () => {
  it("adds by business name, updates the same one by name or id, and keeps lists and checks in words", async () => {
    const a = await upsertRestaurant(W, { business: "Luigi's", type: "restaurant", city: "Tucson", stage: "talking", source: "nope", passHolders: "12" });
    expect(a.created).toBe(true);
    const again = await upsertRestaurant(W, { business: "luigi's", stage: "demo booked" });
    expect(again).toEqual({ id: a.id, created: false });
    const byId = await upsertRestaurant(W, { id: a.id, plan: "annual", foundingPartner: true, googleRatingAtStart: "4.6" });
    expect(byId.created).toBe(false);
    const r = (await restaurantById(W, a.id, TODAY))!;
    expect(r.stage).toBe("demo booked");
    expect(r.source).toBeNull();
    expect(r.passHolders).toBe(12);
    expect(r.plan).toBe("annual");
    expect(r.foundingPartner).toBe(true);
    expect(r.googleRatingAtStart).toBe(4.6);
    expect(r.derived.setupPromise).toBe("not handed");
    expect((await restaurantByRef(W, "Luigi's"))?.id).toBe(a.id);
    expect(await restaurantByRef("ws2", "Luigi's")).toBeNull();
    expect(await restaurantById("ws2", a.id, TODAY)).toBeNull();
  });

  it("refuses a new restaurant without a name and never reads another workspace's", async () => {
    await expect(upsertRestaurant(W, { city: "Nowhere" })).rejects.toThrow(/business name/);
    await upsertRestaurant("ws2", { business: "Elsewhere Diner" });
    expect((await restaurantsFor(W, TODAY)).map((r) => r.business)).toEqual(["Luigi's"]);
  });

  it("derives the setup promise and the check-in from the dates", async () => {
    const h = await upsertRestaurant(W, { business: "Handed Grill", handedToWalletpushAt: "2026-10-10", stage: "handed to WalletPush" });
    expect((await restaurantById(W, h.id, TODAY))!.derived.setupPromise).toBe("OVERDUE");
    const l = await upsertRestaurant(W, { business: "Live Taco", handedToWalletpushAt: "2026-09-01", liveAt: "2026-09-05", stage: "live" });
    const live = (await restaurantById(W, l.id, TODAY))!;
    expect(live.derived.setupPromise).toBe("kept");
    expect(live.derived.checkinDue).toBe("2026-10-05");
    expect(live.derived.checkinOverdue).toBe(true);
    expect((await restaurantsFor(W, TODAY, { stage: "live" })).map((r) => r.business)).toEqual(["Live Taco"]);
  });
});

describe("touches and payments", () => {
  it("a touch with a next step sets the restaurant's next step", async () => {
    const r = (await restaurantByRef(W, "Luigi's"))!;
    await addTouch(W, r.id, { who: "Mercator", channel: "call", note: "Owner keen", nextStep: "Send the demo link", nextStepDate: "2026-10-23" });
    await addTouch(W, r.id, { who: "nobody", channel: "carrier pigeon" });
    const touches = await touchesFor(W, r.id);
    expect(touches).toHaveLength(2);
    expect(touches.map((t) => [t.who, t.channel]).sort()).toEqual([["Danno", "DM"], ["Mercator", "call"]]);
    const now = (await restaurantById(W, r.id, TODAY))!;
    expect(now.nextStep).toBe("Send the demo link");
    expect(now.nextStepDate).toBe("2026-10-23");
  });

  it("a payment needs an amount, defaults its month to its date, and the same external id lands once", async () => {
    const r = (await restaurantByRef(W, "Live Taco"))!;
    await expect(addPayment(W, r.id, { date: "2026-10-03" })).rejects.toThrow(/amount/);
    const p = await addPayment(W, r.id, { date: "2026-10-03", amount: "99", externalId: "ch_1" });
    expect(p.created).toBe(true);
    const dup = await addPayment(W, r.id, { date: "2026-10-04", amount: 99, externalId: "ch_1" });
    expect(dup).toEqual({ id: p.id, created: false });
    const rows = await db.query.partnerPayments.findMany({ where: (t, { eq }) => eq(t.restaurantId, r.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0].month).toBe("2026-10");
    expect(rows[0].status).toBe("paid");
  });
});

describe("the monthly statement", () => {
  it("builds the month's lines, keeps Danno's approved ones on a rebuild, and leaves adjustments alone", async () => {
    const taco = (await restaurantByRef(W, "Live Taco"))!;
    const luigi = (await restaurantByRef(W, "Luigi's"))!;
    await addPayment(W, luigi.id, { date: "2026-10-12", amount: 1200, plan: "annual", feesDeducted: 36 });
    await addPayment(W, luigi.id, { date: "2026-10-12", amount: 50, plan: "monthly", promo: true });
    await addPayment(W, taco.id, { date: "2026-10-20", amount: 99, status: "refunded" });
    const first = await buildPayouts(W, "2026-10", { feesOffFirst: false });
    expect(first).toEqual({ built: 2, kept: 0, dropped: 0 });
    let lines = await payoutLinesFor(W, "2026-10");
    expect(lines.map((l) => [l.kind, l.amount]).sort()).toEqual([["monthly", 49.5], ["yearly_installment", 50]]);
    expect(await approvePayouts(W, "2026-10")).toBe(2);
    await addAdjustment(W, taco.id, "2026-10", -10, "Refund already sent");
    const second = await buildPayouts(W, "2026-10", { feesOffFirst: true });
    expect(second).toEqual({ built: 0, kept: 2, dropped: 0 });
    lines = await payoutLinesFor(W, "2026-10");
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.approvedByDannoAt)).toHaveLength(2);
    expect(lines.find((l) => l.kind === "adjustment")!.amount).toBe(-10);
    // November carries the second installment, unapproved, and nothing from the other workspace.
    expect(await buildPayouts(W, "2026-11", { feesOffFirst: false })).toEqual({ built: 1, kept: 0, dropped: 0 });
    expect((await payoutLinesFor(W, "2026-11"))[0].installment).toBe(2);
    expect(await payoutLinesFor("ws2")).toEqual([]);
  });
});
