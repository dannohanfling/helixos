/**
 * Claude's drafts everywhere, offers first (H-184, plan H-220 PR D2a). Through the connector: the three offer tools on the
 * Offers scope; offer_draft refuses a field an offer doesn't take, takes out an income claim and a figure the member didn't give,
 * never changes the offer, and makes no new offer until Approve; another workspace's connection finds nothing. In the app, at
 * 1440 and at 390: "Drafts waiting (N)" on Today, the amber dot on Offers, the /drafts list, the amber draft on the offer with
 * Approve and Undo, a red line keeping Approve off, Discard, and a new offer's draft opened with Edit and saved by the offer's
 * own form.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function login(page: Page) {
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
async function open(page: Page, url: string, testid: string) {
  for (let i = 0; i < 3; i++) {
    await page.goto(url);
    if (await page.locator(`[data-testid="${testid}"]`).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error(`${testid} never showed on ${url}`);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { viewerFor } = await import("@/lib/auth");
  const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
  const { createHash, randomBytes } = await import("node:crypto");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const jordanM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, jordan.id) }))!;
  const ws = mayaM.workspaceId;

  const CALLBACK = "http://localhost:4092/cb";
  let rpcId = 0;
  const rpc = async (token: string, method: string, params: unknown = {}) => {
    const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
    return (await res.json()) as { result?: { tools?: { name: string }[]; content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message: string } };
  };
  const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const j = await rpc(token, "tools/call", { name, arguments: args });
    const full = j.result?.content?.find((c) => c.type === "text")?.text ?? j.error?.message ?? "";
    const cut = full.indexOf("\n\n{");
    return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), isError: Boolean(j.result?.isError || j.error) };
  };
  const apps: string[] = [];
  const connect = async (userId: string, workspaceId: string, scopes: string[]) => {
    const client = await registerClient("Smoke offer drafts", [CALLBACK]);
    const v = (await viewerFor(userId, workspaceId))!;
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: scopes as never });
    const token = ((await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string }).access_token;
    const app = await db.query.connectedApps.findFirst({ where: and(eq(schema.connectedApps.userId, userId), eq(schema.connectedApps.clientId, client.id)) });
    if (app) apps.push(app.id);
    return token;
  };

  const offerId = newId();
  const madeOffers: string[] = [offerId];
  await db.insert(schema.offers).values({ id: offerId, workspaceId: ws, userId: maya.id, name: "Drafts walk offer", promise: "Calmer mornings in 30 days.", price: 997 });
  const offer = async () => (await db.query.offers.findFirst({ where: eq(schema.offers.id, offerId) }))!;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    // ── 1. The connector. ──
    const writer = await connect(maya.id, ws, ["offers"]);
    const other = await connect(jordan.id, jordanM.workspaceId, ["offers"]);
    const listed = ((await rpc(writer, "tools/list")).result?.tools ?? []).map((x) => x.name);
    must(["offers_list", "offer_read", "offer_draft"].every((n) => listed.includes(n)), `the Offers scope lists the three offer tools: ${listed.join(", ")}`);
    let r = await call(writer, "offers_list");
    must(!r.isError && (r.data?.offers as { id: string }[]).some((o) => o.id === offerId), `offers_list has the walk's offer: ${r.text}`);

    r = await call(writer, "offer_draft", { id: offerId, fields: { promise: "x", status: "live", paymentLink: "https://pay.example" } });
    must(/Nothing was saved/.test(r.text) && /status/.test(r.text) && /paymentLink/.test(r.text), `a field an offer doesn't take is refused by name: ${r.text}`);
    must(!(await db.query.drafts.findFirst({ where: eq(schema.drafts.targetId, offerId) })), "and nothing is saved");

    r = await call(writer, "offer_draft", { id: offerId, source_words: "Mornings feel calmer within 30 days, and nobody wants the 5 a.m. alarm.", fields: { promise: "Calmer mornings in 30 days, without the 5 a.m. alarm. Clients make $10,000 a month.", whyNow: "School starts soon. 87% of parents say mornings are their worst hour.", pathSteps: ["Notice the rush", "Move one thing to the night before", "Keep the calm"] } });
    must(!r.isError && r.data?.saved === true, `the draft is saved: ${r.text}`);
    const f = r.data?.fields as Record<string, unknown>;
    must(f.promise === "Calmer mornings in 30 days, without the 5 a.m. alarm." && f.whyNow === "School starts soon.", `the income claim and the invented 87% came out, the member's 30 days stayed: ${JSON.stringify(f)}`);
    must((await offer()).promise === "Calmer mornings in 30 days." && (await offer()).pathSteps.length === 0, "the offer itself is unchanged");
    r = await call(writer, "offer_read", { id: offerId });
    must(!r.isError && (r.data?.draft as { by: string } | null)?.by === "Claude (connector)", `offer_read shows the draft waiting, by Claude (connector): ${r.text}`);

    r = await call(writer, "offer_draft", { fields: { promise: "No name." } });
    must(/needs its name/.test(r.text), `a new offer needs its name: ${r.text}`);
    const before = (await db.query.offers.findMany({ where: eq(schema.offers.userId, maya.id) })).length;
    r = await call(writer, "offer_draft", { fields: { name: "Drafts walk new offer", promise: "A calm start, together." } });
    must(!r.isError && r.data?.saved === true, `a new offer's draft is saved: ${r.text}`);
    must((await db.query.offers.findMany({ where: eq(schema.offers.userId, maya.id) })).length === before, "and no offer is made until Approve");

    r = await call(other, "offer_read", { id: offerId });
    must(r.text === "No offer with that id in your HelixOS.", `another workspace's connection finds nothing: ${r.text}`);
    r = await call(other, "offer_draft", { id: offerId, fields: { promise: "Not theirs." } });
    must(r.text === "No offer with that id in your HelixOS.", "and can't draft into it");
    console.log("✓ the connector: three tools on Offers; unlisted fields refused; income claims and invented figures out; the offer unchanged; a new offer only on Approve; another workspace finds nothing");

    // ── 2. The app at 1440: Today's line, the dot, the list, Approve, Undo. ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    await login(page);
    await open(page, `${base}/today`, "today-drafts");
    must(/Drafts waiting \(\d+\)/.test(await page.locator('[data-testid="today-drafts"]').innerText()), "Today says Drafts waiting (N)");
    must((await page.locator('a[href="/offers"] [data-testid="draft-dot"]').count()) >= 1, "the amber dot sits on Offers in the menu");
    await page.locator('[data-testid="today-drafts"]').click();
    await page.locator('[data-testid="drafts-list"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="drafts-row"]').count()) >= 2, "the list has the two offer drafts");

    await open(page, `${base}/offers/${offerId}`, "claude-draft");
    must((await page.locator('[data-testid="claude-draft-label"]').innerText()).includes("not approved yet"), "the amber label says not approved yet");
    must((await page.locator('[data-testid="claude-draft-value-promise"]').innerText()).includes("without the 5 a.m. alarm"), "the draft shows beside what's there");
    await submit(page, '[data-testid="claude-draft-approve"]');
    let o = await offer();
    must(o.promise === "Calmer mornings in 30 days, without the 5 a.m. alarm." && o.pathSteps.length === 3 && o.status === "draft", `Approve writes the draft in and makes nothing live: ${o.promise}`);
    must(await page.locator('[data-testid="claude-draft-note"]').isVisible(), "and says so");
    must(!(await page.locator('[data-testid="claude-draft"]').count()), "the amber goes");
    await page.locator('[data-testid="claude-draft-history"] summary').click();
    must((await page.locator('[data-testid="claude-draft-history"]').innerText()).includes("by Claude (connector)"), "the history says by Claude (connector)");
    await submit(page, '[data-testid="claude-history-row"][data-action="approved"] [data-testid="claude-history-undo"]');
    o = await offer();
    must(o.promise === "Calmer mornings in 30 days." && o.pathSteps.length === 0, "Undo puts back what Approve replaced");
    console.log("✓ 1440: Drafts waiting on Today, the amber dot on Offers, the list, the amber draft on the offer, Approve writes it, Undo puts it back");

    // A red line: the offer changed after the draft was written, so Approve stays off until it's brought together with Edit.
    r = await call(writer, "offer_draft", { id: offerId, fields: { guarantee: "Do the work; if it doesn't help, I'll coach you until it does." } });
    await db.update(schema.offers).set({ guarantee: "Maya wrote her own." }).where(eq(schema.offers.id, offerId));
    await open(page, `${base}/offers/${offerId}`, "claude-draft");
    must(await page.locator('[data-testid="claude-draft-red"]').isVisible(), "the red line says why");
    must(await page.locator('[data-testid="claude-draft-approve"]').isDisabled(), "and Approve stays off");
    await submit(page, '[data-testid="claude-draft-discard"]');
    must((await offer()).guarantee === "Maya wrote her own." && !(await page.locator('[data-testid="claude-draft"]').count()), "Discard drops only the draft");
    console.log("✓ a red line keeps Approve off; Discard drops only the draft");

    // ── 3. At 390: a new offer's draft, opened with Edit and saved by the offer's own form. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `${base}/offers`, "claude-new-offers");
    must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the new offer's draft fits a phone, no sideways scroll");
    await submit(page, '[data-testid="claude-new-offers"] [data-testid="claude-draft-edit"]');
    await page.locator('[data-testid="claude-draft-editing"]').waitFor({ timeout: 20000 });
    const madeId = new URL(page.url()).pathname.split("/").pop()!;
    madeOffers.push(madeId);
    must((await page.locator('input[name="name"]').first().inputValue()) === "Drafts walk new offer", "Edit made the offer with its name and opened it");
    must((await page.locator('textarea[name="promise"]').inputValue()) === "A calm start, together.", "with the draft filled into the form");
    await page.locator('textarea[name="promise"]').fill("A calm start, together, every weekday.");
    await submit(page, 'form:has(input[name="draftId"]) button[type="submit"]');
    const made = (await db.query.offers.findFirst({ where: eq(schema.offers.id, madeId) }))!;
    must(made.promise === "A calm start, together, every weekday." && made.status === "draft", `the offer's own save writes it: ${made.promise}`);
    const settled = (await db.query.drafts.findFirst({ where: and(eq(schema.drafts.targetId, madeId), eq(schema.drafts.workspaceId, ws)) }))!;
    must(settled.status === "edited", "and the draft is settled as edited");
    console.log("✓ 390: the new offer's draft fits; Edit makes the offer and fills its form; its save settles the draft");
    await ctx.close();
  } finally {
    await browser.close();
    await db.delete(schema.drafts).where(and(eq(schema.drafts.workspaceId, ws), eq(schema.drafts.userId, maya.id), eq(schema.drafts.area, "offer")));
    await db.delete(schema.changeHistory).where(and(eq(schema.changeHistory.workspaceId, ws), eq(schema.changeHistory.userId, maya.id), eq(schema.changeHistory.area, "offer")));
    await db.delete(schema.offers).where(inArray(schema.offers.id, madeOffers));
    if (apps.length) await db.delete(schema.connectedApps).where(inArray(schema.connectedApps.id, apps));
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
