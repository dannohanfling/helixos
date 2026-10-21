import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Partner Program's GHL webhooks (H-1361 PR B, contract H-1398) through /api/webhooks/ghl with the workspace's inbound
 * secret: an order makes the restaurant, its plan and dates, one Payment per amount, once per order id; the onboarding form
 * fills the answers, sets form complete and moves the stage, once per submission id; the sync log never keeps the owner.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-partner-ghl-"));
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
const { hashSecret } = await import("@/lib/crypto");
const { POST } = await import("@/app/api/webhooks/ghl/route");
const { listOf } = await import("@/lib/partner-ghl");

const SECRET = "ghl-inbound-test-secret-not-real";
const W = "ws1";
const post = (body: unknown, secret = SECRET) =>
  POST(new Request("http://localhost/api/webhooks/ghl", { method: "POST", headers: { "content-type": "application/json", "x-helix-secret": secret }, body: JSON.stringify(body) }));
const ORDER = {
  event: "gnc.order_paid",
  sent_at: "2026-11-04T18:22:05Z",
  contact_id: "ghl_contact_TEST1",
  order_id: "ghl_order_TEST1",
  transaction_id: "ch_TEST1",
  paid_at: "2026-11-04T18:21:58Z",
  plan: "monthly",
  plan_tag: "gnc-plan-monthly",
  amount_total: 600,
  amount_setup: 500,
  amount_recurring: 100,
  currency: "USD",
  tax: 0,
  processor_fee: null,
  business_name: "Example Taqueria",
  owner_first_name: "Alex",
  owner_last_name: "Sample",
  owner_email: "alex@example.com",
  owner_phone: "+12065550100",
  source_page: "checkout-monthly",
};
const FORM = {
  event: "gnc.onboarding_submitted",
  sent_at: "2026-11-04T19:05:11Z",
  contact_id: "ghl_contact_TEST1",
  submission_id: "ghl_sub_TEST1",
  business_name: "Example Taqueria",
  owner_name: "Alex Sample",
  owner_email: "alex@example.com",
  owner_phone: "+12065550100",
  address: "123 Example St, Kent, WA 98032",
  website: "https://example.com",
  facebook_url: "https://facebook.com/example",
  instagram_url: "https://instagram.com/example",
  google_business_url: "https://g.page/example",
  hours: "Mon-Thu 11-9; Fri-Sat 11-10; Sun closed",
  logo_url: "https://assets.example.com/logo.png",
  menu_url: "https://example.com/menu",
  photo_urls: "https://assets.example.com/1.jpg, https://assets.example.com/2.jpg",
  brand_colors: "#C0392B, #F4D03F",
  reward_visits: 10,
  reward_text: "Free appetizer",
  welcome_offer: "Free drink on your first visit with the pass",
  slow_nights: ["Mon", "Tue"],
  staff_language: "both",
  concierge_handoff_name: "Jordan",
  concierge_handoff_phone: "+12065550101",
  never_say: "Don't promise delivery; we don't deliver.",
  terms_accepted: true,
  terms_version: "draft-2026-10-20",
  extra: { seating: "40 covers" },
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: W, name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1" });
  await db.insert(schema.integrations).values({ id: "integ1", workspaceId: W, provider: "gohighlevel", enabled: true, inboundSecretHash: hashSecret(SECRET) });
});

describe("the Partner Program's GHL webhooks", () => {
  it("splits a checkbox group sent as one string, keeps a list", () => {
    expect(listOf("Mon, Tue")).toEqual(["Mon", "Tue"]);
    expect(listOf(["Mon", "Tue"])).toEqual(["Mon", "Tue"]);
    expect(listOf("")).toEqual([]);
  });

  it("refuses a wrong secret, and an order without its id", async () => {
    expect((await post(ORDER, "wrong")).status).toBe(401);
    const res = await post({ ...ORDER, order_id: "" });
    expect(res.status).toBe(400);
  });

  it("an order makes the restaurant at signed with its plan, dates and owner on the record, one Payment per amount, once", async () => {
    const res = await post(ORDER);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; restaurantId: string; note: string };
    expect(j.ok).toBe(true);
    const r = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, j.restaurantId) }))!;
    expect([r.business, r.stage, r.plan, r.signedAt, r.paidAt, r.source]).toEqual(["Example Taqueria", "signed", "monthly", "2026-11-04", "2026-11-04", "in the group"]);
    expect(r.ownerContact).toBe("Alex Sample, alex@example.com, +12065550100");
    expect(r.extra.ghl_contact_id).toBe("ghl_contact_TEST1");
    expect(r.extra.ghl_source_page).toBe("checkout-monthly");
    let pays = await db.query.partnerPayments.findMany({ where: eq(schema.partnerPayments.restaurantId, r.id) });
    expect(pays.map((p) => [p.plan, p.amount, p.status, p.month, p.processor]).sort()).toEqual([["monthly", 100, "paid", "2026-11", "Stripe via GHL"], ["setup fee", 500, "paid", "2026-11", "Stripe via GHL"]]);
    // The same order again: nothing doubles.
    const again = await post(ORDER);
    expect(((await again.json()) as { note: string }).note).toMatch(/already on file/);
    pays = await db.query.partnerPayments.findMany({ where: eq(schema.partnerPayments.restaurantId, r.id) });
    expect(pays).toHaveLength(2);
    expect(await db.query.partnerTouches.findMany({ where: eq(schema.partnerTouches.restaurantId, r.id) })).toHaveLength(1);
    // The sync log keeps the ids and the business, never the owner.
    const logs = await db.query.syncEvents.findMany({ where: eq(schema.syncEvents.workspaceId, W) });
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(JSON.stringify(l.payload)).not.toMatch(/alex@|Sample|5550100/);
  });

  it("a yearly order is the annual plan with no setup line", async () => {
    const res = await post({ ...ORDER, order_id: "ghl_order_TEST2", contact_id: "ghl_contact_TEST2", business_name: "Example Bistro", plan: "yearly", plan_tag: "gnc-plan-yearly", amount_total: 1000, amount_setup: 0, amount_recurring: 1000 });
    const j = (await res.json()) as { restaurantId: string };
    const r = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, j.restaurantId) }))!;
    expect(r.plan).toBe("annual");
    const pays = await db.query.partnerPayments.findMany({ where: eq(schema.partnerPayments.restaurantId, r.id) });
    expect(pays.map((p) => [p.plan, p.amount])).toEqual([["annual", 1000]]);
  });

  it("the onboarding form fills the answers by contact id, sets form complete, moves to onboarding, keeps the rest in extra, once per submission", async () => {
    const res = await post(FORM);
    expect(res.status).toBe(200);
    const r = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.business, "Example Taqueria") }))!;
    expect([r.stage, r.formCompleteAt, r.termsAcceptedAt, r.address, r.website, r.facebookPage, r.instagram, r.googleBusinessProfile, r.menuLink, r.brandColors]).toEqual(["onboarding", "2026-11-04", "2026-11-04", "123 Example St, Kent, WA 98032", "https://example.com", "https://facebook.com/example", "https://instagram.com/example", "https://g.page/example", "https://example.com/menu", "#C0392B, #F4D03F"]);
    expect(r.reward).toBe("Free appetizer after 10 visits");
    expect(r.welcomeReward).toBe("Free drink on your first visit with the pass");
    expect(r.restaurantContactForMessages).toBe("Jordan, +12065550101");
    expect(r.extra).toMatchObject({ ghl_last_submission_id: "ghl_sub_TEST1", logo_url: "https://assets.example.com/logo.png", photo_urls: "https://assets.example.com/1.jpg, https://assets.example.com/2.jpg", slow_nights: "Mon, Tue", staff_language: "both", never_say: "Don't promise delivery; we don't deliver.", terms_version: "draft-2026-10-20", seating: "40 covers" });
    // The owner's contact from the order stays as it was; a second send of the same submission changes nothing.
    expect(r.ownerContact).toBe("Alex Sample, alex@example.com, +12065550100");
    const touchesBefore = (await db.query.partnerTouches.findMany({ where: eq(schema.partnerTouches.restaurantId, r.id) })).length;
    const again = await post(FORM);
    expect(((await again.json()) as { note: string }).note).toMatch(/already on file/);
    expect((await db.query.partnerTouches.findMany({ where: eq(schema.partnerTouches.restaurantId, r.id) })).length).toBe(touchesBefore);
    // A form before any order makes the restaurant itself, at onboarding.
    const fresh = await post({ ...FORM, submission_id: "ghl_sub_TEST3", contact_id: "ghl_contact_TEST3", business_name: "Example Deli", terms_accepted: "true" });
    const jf = (await fresh.json()) as { restaurantId: string };
    const d = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, jf.restaurantId) }))!;
    expect([d.business, d.stage, d.ownerContact]).toEqual(["Example Deli", "onboarding", "Alex Sample, alex@example.com, +12065550100"]);
  });
});
