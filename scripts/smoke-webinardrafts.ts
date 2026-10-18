/**
 * Claude's webinar drafts (H-181, plan H-684, PR 1). Through the connector: a read-only connection sees the read tools only;
 * webinar_create starts a webinar; webinar_draft_step refuses a field the step doesn't take, takes out a figure the member
 * didn't give, refuses a proof or story that needs permission first, and never changes the webinar; another workspace's
 * connection finds nothing. In the wizard, at 1440 and at 390: Claude's draft beside what's there, Approve writes it, Undo puts
 * it back, Edit opens the form filled and its save settles the draft, Discard drops it and Undo brings it back, and History
 * says "by Claude (connector)".
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
  const O = { workspaceId: ws, userId: maya.id };

  const CALLBACK = "http://localhost:4091/cb";
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
    const client = await registerClient("Smoke webinar drafts", [CALLBACK]);
    const v = (await viewerFor(userId, workspaceId))!;
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: scopes as never });
    const token = ((await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string }).access_token;
    const app = await db.query.connectedApps.findFirst({ where: and(eq(schema.connectedApps.userId, userId), eq(schema.connectedApps.clientId, client.id)) });
    if (app) apps.push(app.id);
    return token;
  };

  // Fixtures: an offer, a proof with its permission tick, one approved without it, and a story bank item held for a check.
  const offerId = newId();
  const proofOk = newId();
  const proofNoTick = newId();
  const storyHeld = newId();
  await db.insert(schema.offers).values({ id: offerId, workspaceId: ws, userId: maya.id, name: "Drafts walk offer", price: 997 });
  await db.insert(schema.proofs).values([
    { id: proofOk, workspaceId: ws, userId: maya.id, name: "Drafts walk: Kara's win", who: "Kara Young", status: "approved", permissionAt: new Date().toISOString() },
    { id: proofNoTick, workspaceId: ws, userId: maya.id, name: "Drafts walk: no tick", who: "Sam Lee", status: "approved", permissionAt: null },
  ]);
  await db.insert(schema.storyItems).values({ id: storyHeld, workspaceId: ws, userId: maya.id, key: `walk-${storyHeld}`, title: "Drafts walk held story", type: "story", what: "A held story", status: "check", digest: "walk" });
  let webinarId = "";
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    // ── 1. The connector. ──
    const readOnly = await connect(maya.id, ws, ["webinars"]);
    const writer = await connect(maya.id, ws, ["webinars", "webinars:write"]);
    const other = await connect(jordan.id, jordanM.workspaceId, ["webinars", "webinars:write"]);
    const listed = async (t: string) => ((await rpc(t, "tools/list")).result?.tools ?? []).map((x) => x.name).filter((n) => /webinar|story_bank/.test(n)).sort();
    must(JSON.stringify(await listed(readOnly)) === JSON.stringify(["story_bank_list", "webinar_read", "webinars_list"]), `a read-only connection lists the three read tools: ${await listed(readOnly)}`);
    must((await listed(writer)).length === 5, "a connection with Webinars: draft lists all five");

    let r = await call(writer, "webinar_create", { title: "Drafts walk webinar", offer_id: offerId });
    webinarId = String(r.data?.id ?? "");
    must(!r.isError && webinarId, `webinar_create starts one: ${r.text}`);
    let w = (await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!;
    must(w.status === "draft" && w.offerId === offerId && w.userId === maya.id && !w.promise, "a draft with its title and offer, nothing else set");

    r = await call(writer, "webinar_draft_step", { id: webinarId, step: "foundation", fields: { promise: "x", scheduledAt: "2026-11-01", status: "ready" } });
    must(/Nothing was saved/.test(r.text) && /scheduledAt/.test(r.text) && /status/.test(r.text), `a field the step doesn't take is refused by name: ${r.text}`);
    must(!(await db.query.webinarDrafts.findFirst({ where: eq(schema.webinarDrafts.webinarId, webinarId) })), "and nothing is saved");

    r = await call(writer, "webinar_draft_step", { id: webinarId, step: "foundation", source_words: "I want 3 booked calls from every webinar.", fields: { promise: "Leave with a plan to fill your calendar. Our clients add 40 leads a week.", audience: "Coaches with a full offer and an empty calendar", outcomes: ["Know your leak", "Book 3 calls", "Earn six figures this year"], originStory: { wall: "The week nobody showed up." } } });
    must(!r.isError && r.data?.saved === true, `the foundation draft is saved: ${r.text}`);
    const fields = r.data?.fields as Record<string, unknown>;
    must(fields.promise === "Leave with a plan to fill your calendar." && JSON.stringify(fields.outcomes) === JSON.stringify(["Know your leak", "Book 3 calls"]), `the invented 40 and the six figures came out, the member's 3 stayed: ${JSON.stringify(fields)}`);
    w = (await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!;
    must(!w.promise && !w.audience && w.outcomes.length === 0, "the webinar itself is unchanged");

    r = await call(writer, "webinar_draft_step", { id: webinarId, step: "beliefs", fields: { vehicle: { from: "Webinars are dead", to: "A small live room still sells", proofId: proofOk }, internal: { from: "I'm not a presenter", proofId: proofNoTick }, external: { to: "The calendar is mine to fill", storyId: storyHeld } } });
    must(!r.isError && r.data?.saved === true && /Needs permission first/.test(r.text), `beliefs are saved, and the flagged items are named as needing permission first: ${r.text}`);
    const bf = r.data?.fields as Record<string, Record<string, string>>;
    must(bf.vehicle?.proofId === proofOk && !bf.internal?.proofId && !bf.external?.storyId && bf.external?.to, `only the usable proof stays cited: ${JSON.stringify(bf)}`);

    r = await call(writer, "webinar_draft_step", { id: webinarId, step: "offer", fields: { ctaType: "Apply" } });
    must(!r.isError && r.data?.saved === true, `the offer draft is saved: ${r.text}`);

    r = await call(writer, "webinar_read", { id: webinarId });
    must(!r.isError && (r.data?.draftsWaiting as unknown[]).length === 3 && r.data?.readiness, `webinar_read shows three drafts waiting and the readiness checks: ${r.text}`);
    r = await call(readOnly, "webinar_draft_step", { id: webinarId, step: "offer", fields: { ctaType: "Apply" } });
    must(r.isError, "a read-only connection can't draft");
    r = await call(other, "webinar_read", { id: webinarId });
    must(r.text === "No webinar with that id in your HelixOS.", `another workspace's connection finds nothing: ${r.text}`);
    r = await call(other, "webinar_draft_step", { id: webinarId, step: "offer", fields: { ctaType: "Apply" } });
    must(r.text === "No webinar with that id in your HelixOS.", "and can't draft into it");
    r = await call(writer, "story_bank_list");
    must(!r.isError && ((r.data?.storyBank ?? []) as { id: string; usable: boolean }[]).some((s) => s.id === storyHeld && !s.usable), "story_bank_list shows the held story as not usable");
    console.log("✓ the connector: read-only lists reads only; create; unlisted fields refused; invented figures and income claims out; flagged proof and stories refused; the webinar unchanged; another workspace finds nothing");

    // ── 2. The wizard at 1440: Approve, then Undo. ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    await login(page);
    await open(page, `${base}/webinars/${webinarId}?step=foundation`, "claude-draft-foundation");
    must((await page.locator('[data-testid="draft-value-promise"]').innerText()).includes("Leave with a plan"), "the foundation draft shows beside what's there");
    must(await page.locator('[data-testid="draft-notes"]').isVisible(), "what was taken out is listed");
    await submit(page, '[data-testid="draft-approve"]');
    w = (await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!;
    must(w.promise === "Leave with a plan to fill your calendar." && w.outcomes.length === 2 && w.originStory.wall && w.status === "building", `Approve writes the draft in: ${w.promise}`);
    must(await page.locator('[data-testid="draft-note"]').isVisible(), "and says so");
    await page.locator('[data-testid="webinar-history"] summary').click();
    must((await page.locator('[data-testid="history-row"][data-connector="1"]').count()) >= 4, "History says by Claude (connector) on each connector write");
    must((await page.locator('[data-testid="webinar-history"]').innerText()).includes("by Claude (connector)"), "in those words");
    await submit(page, '[data-testid="history-row"][data-action="approved"] [data-testid="history-undo"]');
    w = (await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!;
    must(!w.promise && w.outcomes.length === 0 && !w.originStory.wall, "Undo puts back what Approve replaced");
    console.log("✓ 1440: the foundation draft beside the webinar, Approve writes it, History by Claude (connector), Undo puts it back");

    // ── 3. The wizard at 390: Edit the beliefs draft, Discard and bring back the offer draft. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `${base}/webinars/${webinarId}?step=beliefs`, "claude-draft-beliefs");
    must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the panel fits a phone, no sideways scroll");
    await page.locator('[data-testid="draft-edit"]').click();
    await page.locator('[data-testid="draft-editing"]').waitFor({ timeout: 20000 });
    must((await page.locator('textarea[name="vehicle_to"]').inputValue()) === "A small live room still sells", "Edit opens the form filled with the draft");
    await page.locator('textarea[name="vehicle_to"]').fill("A small live room still sells, when it is honest");
    await submit(page, 'form:has(input[name="fromDraft"]) button[type="submit"]');
    const vb = (await db.query.webinarBeliefs.findFirst({ where: and(eq(schema.webinarBeliefs.webinarId, webinarId), eq(schema.webinarBeliefs.type, "vehicle")) }))!;
    must(vb.toBelief === "A small live room still sells, when it is honest" && vb.proofId === proofOk, `the edited draft is saved by the step's own save: ${vb.toBelief}`);
    const bd = (await db.query.webinarDrafts.findFirst({ where: and(eq(schema.webinarDrafts.webinarId, webinarId), eq(schema.webinarDrafts.step, "beliefs")) }))!;
    must(bd.status === "edited", "and the draft is settled as edited");

    await open(page, `${base}/webinars/${webinarId}?step=offer`, "claude-draft-offer");
    await submit(page, '[data-testid="draft-discard"]');
    const od = (await db.query.webinarDrafts.findFirst({ where: and(eq(schema.webinarDrafts.webinarId, webinarId), eq(schema.webinarDrafts.step, "offer")) }))!;
    w = (await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!;
    must(od.status === "discarded" && w.ctaType === "Book a call", "Discard drops the draft and leaves the webinar");
    must(!(await page.locator('[data-testid="claude-draft-offer"]').count()), "and the panel goes");
    await page.locator('[data-testid="webinar-history"] summary').click();
    await submit(page, '[data-testid="history-row"][data-action="discarded"] [data-testid="history-undo"]');
    await page.locator('[data-testid="claude-draft-offer"]').waitFor({ timeout: 20000 });
    console.log("✓ 390: the panel fits; Edit fills the form and its save settles the draft; Discard drops it; Undo brings it back");
    await ctx.close();
  } finally {
    await browser.close();
    if (webinarId) await db.delete(schema.webinars).where(eq(schema.webinars.id, webinarId));
    await db.delete(schema.proofs).where(inArray(schema.proofs.id, [proofOk, proofNoTick]));
    await db.delete(schema.storyItems).where(eq(schema.storyItems.id, storyHeld));
    await db.delete(schema.offers).where(eq(schema.offers.id, offerId));
    if (apps.length) await db.delete(schema.connectedApps).where(inArray(schema.connectedApps.id, apps));
    void O;
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
