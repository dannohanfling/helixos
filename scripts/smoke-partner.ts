/**
 * The Partner Program (H-1307, plan H-1361), end to end: the coach finds it under People, adds a restaurant, edits it, logs a
 * touch that sets the next step, records a payment, sees the setup promise go OVERDUE on the program page, builds the month's
 * statement (half of the monthly payment), approves it, and adds an adjustment; on Coach → Agents the Partner Program tools
 * tick puts the `partner` scope on an agent's token, which then lists and updates restaurants through the connector, never
 * sees the owner's contact in a list, and loses the tools when the tick comes off; nothing scrolls sideways at 390.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}
async function submit(page: Page, selector: string): Promise<number> {
  const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  return res.status();
}
async function until(check: () => Promise<boolean>, msg: () => Promise<string>) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(await msg());
}
let rpcId = 0;
const rpc = (token: string, method: string, params: Record<string, unknown> = {}) =>
  fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; data: Record<string, unknown> | null; isError: boolean }> {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  if (res.status !== 200) return { text: await res.text(), data: null, isError: true };
  const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (j.error) return { text: j.error.message, data: null, isError: true };
  const full = j.result?.content?.[0]?.text ?? "";
  const cut = full.indexOf("\n\n{");
  return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), isError: Boolean(j.result?.isError) };
}
const listTools = async (token: string) => (((await (await rpc(token, "tools/list")).json()) as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const { makeAgentToken } = await import("@/lib/handoff");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const cm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const W = cm.workspaceId;
  const AGENT = "smoke-partner-agent";
  const BIZ = "Smoke Trattoria";
  const clear = async () => {
    await db.delete(schema.partnerRestaurants).where(and(eq(schema.partnerRestaurants.workspaceId, W), like(schema.partnerRestaurants.business, "Smoke %")));
    const toks = await db.query.agentTokens.findMany({ where: eq(schema.agentTokens.agentId, AGENT) });
    for (const t of toks) await db.delete(schema.connectedApps).where(eq(schema.connectedApps.id, t.appId));
    await db.delete(schema.agentTokens).where(eq(schema.agentTokens.agentId, AGENT));
    await db.delete(schema.forumAgents).where(eq(schema.forumAgents.id, AGENT));
    await db.delete(schema.handoffAudit).where(eq(schema.handoffAudit.agentId, AGENT));
  };
  await clear();
  // The month's statement is this walk's alone: other lines of the month are cleared.
  const month = new Date().toISOString().slice(0, 7);
  await db.delete(schema.partnerPayoutLines).where(and(eq(schema.partnerPayoutLines.workspaceId, W), eq(schema.partnerPayoutLines.month, month)));
  await db.insert(schema.forumAgents).values({ id: AGENT, workspaceId: W, userId: coach.id, name: "Smoke Mercator", nameKey: "smoke mercator", platform: "Claude Code", createdBy: "member", confirmed: true });
  const token = (await makeAgentToken({ workspaceId: W, userId: coach.id, membershipId: cm.id }, AGENT))!;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  try {
    await login(page);
    // ── The menu item under People, the empty program, the first restaurant. ──
    await page.goto(`${base}/coach/partners`);
    await page.locator('[data-testid="partner-stats"]').waitFor({ timeout: 20000 });
    must((await page.locator('a[href="/coach/partners"]').count()) >= 1, "Partner Program sits in the menu");
    await page.fill('[data-testid="partner-add-business"]', BIZ);
    await page.selectOption('[data-testid="partner-add-stage"]', "signed");
    await submit(page, '[data-testid="partner-add"]');
    await page.waitForURL(/\/coach\/partners\/[^/?]+\?saved=1/, { timeout: 20000 });
    const id = page.url().split("/coach/partners/")[1].split("?")[0];
    const row = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, id) }))!;
    must(row.business === BIZ && row.stage === "signed" && row.workspaceId === W, `the restaurant is saved to the coach's program: ${JSON.stringify({ business: row.business, stage: row.stage })}`);
    console.log("✓ Partner Program in the menu; the first restaurant added from the program page");

    // ── Edit: handed to WalletPush nine days ago, no live date: the setup promise is OVERDUE. ──
    await page.fill('[data-testid="partner-handedToWalletpushAt"]', daysAgo(9));
    await page.selectOption('[data-testid="partner-stage"]', "handed to WalletPush");
    await page.selectOption('[data-testid="partner-walletpush"]', "in setup");
    await page.fill('[data-testid="partner-ownerContact"]', "Smoke Owner, 555-0100");
    await page.fill('[data-testid="partner-pass-holders"]', "12");
    const saveStatus = await submit(page, '[data-testid="partner-save"]');
    const savedRow = async () => (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, id) }))!;
    const rowWords = async () => {
      const r = await savedRow();
      return JSON.stringify({ post: saveStatus, stage: r.stage, handed: r.handedToWalletpushAt, walletpush: r.walletpushStatus, passHolders: r.passHolders, updatedAt: r.updatedAt, url: page.url() });
    };
    await until(async () => (await savedRow()).handedToWalletpushAt === daysAgo(9), async () => `the edit form saves the handover date: ${await rowWords()}`);
    const edited = await savedRow();
    must(edited.stage === "handed to WalletPush" && edited.passHolders === 12 && edited.walletpushStatus === "in setup" && edited.ownerContact === "Smoke Owner, 555-0100", `the edit form saves the stage, numbers, lists and the contact: ${await rowWords()}`);
    await page.goto(`${base}/coach/partners/${id}`);
    await page.locator('[data-testid="partner-standing"]').waitFor({ timeout: 20000 });
    const standing = await page.locator('[data-testid="partner-standing"]').innerText();
    must(standing.includes("OVERDUE"), `the setup promise is OVERDUE after nine days: ${standing.replace(/\s+/g, " ")}`);

    // ── A touch sets the next step; a payment is recorded, nothing charged. ──
    await page.selectOption('[data-testid="touch-channel"]', "call");
    await page.fill('[data-testid="touch-note"]', "Owner wants the pass live before the weekend.");
    await page.fill('[data-testid="touch-next-step"]', "Chase WalletPush");
    await submit(page, '[data-testid="touch-add"]');
    await page.locator('[data-testid="touch-row"]').first().waitFor({ timeout: 20000 });
    must((await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, id) }))!.nextStep === "Chase WalletPush", "the touch's next step becomes the restaurant's");
    await page.fill('[data-testid="payment-amount"]', "100");
    await page.fill('[data-testid="payment-fees"]', "3");
    await submit(page, '[data-testid="payment-add"]');
    await page.locator('[data-testid="payment-row"]').first().waitFor({ timeout: 20000 });
    const pays = await db.query.partnerPayments.findMany({ where: eq(schema.partnerPayments.restaurantId, id) });
    must(pays.length === 1 && pays[0].amount === 100 && pays[0].month === month && pays[0].status === "paid", `one paid payment of 100 in ${month}: ${JSON.stringify(pays.map((p) => [p.amount, p.month, p.status]))}`);
    console.log("✓ the restaurant's page: OVERDUE setup promise, a touch that sets the next step, a payment on file");

    // ── The program page: the promise under Setup promise, the statement built (50), approved, and an adjustment. ──
    await page.goto(`${base}/coach/partners?month=${month}`);
    const promise = page.locator(`[data-testid="partner-promise"][data-business="${BIZ}"]`);
    must((await promise.getAttribute("data-promise")) === "OVERDUE", "the program page lists the OVERDUE promise");
    must((await page.locator('[data-testid="partner-risk"]').innerText()).includes(BIZ), "and the restaurant under At risk");
    must((await page.locator('[data-testid="statement-empty"]').count()) === 1, "no statement lines before the build");
    await submit(page, '[data-testid="statement-build"]');
    await page.locator('[data-testid="statement-lines"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="statement-total"]').innerText()) === "$50.00", `half of the 100 (fees left in): ${await page.locator('[data-testid="statement-total"]').innerText()}`);
    await page.check('[data-testid="statement-fees"]');
    await submit(page, '[data-testid="statement-build"]');
    await page.locator('[data-testid="statement-lines"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="statement-total"]').innerText()) === "$48.50", "fees off first: half of 97");
    await submit(page, '[data-testid="statement-approve"]');
    await page.locator('[data-testid="statement-all-approved"]').waitFor({ timeout: 20000 });
    const approved = await db.query.partnerPayoutLines.findMany({ where: and(eq(schema.partnerPayoutLines.workspaceId, W), eq(schema.partnerPayoutLines.month, month)) });
    must(approved.length === 1 && approved[0].approvedByDannoAt && approved[0].amount === 48.5, "the one line is stamped by Danno's Approve");
    await page.locator('summary:has-text("Add an adjustment line")').click();
    await page.selectOption('[data-testid="adjustment-restaurant"]', id);
    await page.fill('[data-testid="adjustment-amount"]', "-8.5");
    await page.fill('[data-testid="adjustment-note"]', "Refund already sent");
    await submit(page, '[data-testid="adjustment-add"]');
    await page.locator('[data-testid="statement-line"][data-kind="adjustment"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="statement-total"]').innerText()) === "$40.00", "the adjustment joins the total");
    await submit(page, '[data-testid="statement-build"]');
    await page.locator('[data-testid="statement-lines"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="statement-line"]').count()) === 2 && (await page.locator('[data-testid="statement-line"][data-approved="1"]').count()) === 1, "a rebuild keeps the approved line and the adjustment");
    console.log("✓ the statement: built at half, fees off first on request, approved by Danno's tap, an adjustment, kept through a rebuild");

    // ── The agent's token: no Partner tools until the tick; then list, get, upsert and touch through the connector. ──
    must(!(await listTools(token)).some((n) => n.startsWith("partner_")), "an agent token starts without the Partner tools");
    await page.goto(`${base}/coach/agents`);
    const agentRow = `[data-testid="agent-row"][data-agent="Smoke Mercator"]`;
    must((await page.locator(`${agentRow} [data-testid="agent-partner-state"]`).getAttribute("data-on")) === "0", "the tick starts off");
    await submit(page, `${agentRow} [data-testid="agent-partner-toggle"]`);
    await page.waitForURL(/#agent-/, { timeout: 20000 });
    must((await page.locator(`${agentRow} [data-testid="agent-partner-state"]`).getAttribute("data-on")) === "1", "the tick turns on");
    const names = await listTools(token);
    for (const n of ["partner_restaurants_list", "partner_restaurant_get", "partner_restaurant_upsert", "partner_touch_add", "partner_payment_add", "partner_payouts_build", "partner_payouts_list"]) must(names.includes(n), `${n} is on the token now`);
    let r = await tool(token, "partner_restaurants_list", { stage: "handed to WalletPush" });
    must(!r.isError && r.text.includes(BIZ) && r.text.includes("OVERDUE") && !JSON.stringify(r.data).includes("555-0100"), `the list names the restaurant and its promise, never the contact: ${r.text}`);
    r = await tool(token, "partner_restaurant_get", { restaurant: BIZ });
    must(!r.isError && (r.data?.restaurant as { ownerContact: string }).ownerContact === "Smoke Owner, 555-0100" && (r.data?.touches as unknown[]).length === 1, "a get of one brings the contact and the touches");
    r = await tool(token, "partner_restaurant_upsert", { business: "Smoke Bakehouse", type: "bakery", city: "Tucson", source: "nominated", stage: "talking" });
    must(!r.isError && r.text.startsWith("Added"), `the agent adds a restaurant: ${r.text}`);
    r = await tool(token, "partner_touch_add", { restaurant: "Smoke Bakehouse", who: "Mercator", channel: "DM", nextStep: "Book the demo", nextStepDate: daysAgo(-2) });
    must(!r.isError, `and logs a touch: ${r.text}`);
    r = await tool(token, "partner_payment_add", { restaurant: "Smoke Bakehouse", amount: 60, externalId: "smoke-ext-1" });
    must(!r.isError && r.text.includes("recorded"), `and records a payment: ${r.text}`);
    r = await tool(token, "partner_payment_add", { restaurant: "Smoke Bakehouse", amount: 60, externalId: "smoke-ext-1" });
    must(!r.isError && r.text.includes("already"), "the same external id lands once");
    r = await tool(token, "partner_payouts_build", { month });
    must(!r.isError && r.text.includes("1 line built, 1 approved kept"), `the agent builds the statement for Danno's approval: ${r.text}`);
    r = await tool(token, "partner_payouts_list", { month });
    must(!r.isError && (r.data?.lines as unknown[]).length === 3 && r.text.includes("1 approved"), `three lines, one approved: ${r.text}`);
    must((await db.query.partnerRestaurants.findFirst({ where: and(eq(schema.partnerRestaurants.workspaceId, W), eq(schema.partnerRestaurants.business, "Smoke Bakehouse")) }))!.nextStep === "Book the demo", "the agent's touch set the next step");
    await page.goto(`${base}/coach/agents`);
    await submit(page, `${agentRow} [data-testid="agent-partner-toggle"]`);
    await page.waitForURL(/#agent-/, { timeout: 20000 });
    must(!(await listTools(token)).some((n) => n.startsWith("partner_")), "off again: the tools leave the token");
    r = await tool(token, "partner_restaurants_list");
    must(r.isError, "and a call is refused");
    console.log("✓ Partner Program tools on the agent's token by the tick: list without the contact, get with it, add, touch, payment once, statement; off again on untick");

    // ── 390: nothing scrolls sideways on the program page or the restaurant's. ──
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of [`${base}/coach/partners?month=${month}`, `${base}/coach/partners/${id}`]) {
      await page.goto(url);
      await page.locator("main").waitFor({ timeout: 20000 });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      must(wide <= 390, `${url} fits a phone: ${wide}px wide`);
    }
    console.log("✓ both pages fit 390");
  } finally {
    await browser.close();
    await clear();
    await db.delete(schema.partnerPayoutLines).where(and(eq(schema.partnerPayoutLines.workspaceId, W), eq(schema.partnerPayoutLines.month, month)));
  }
  if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
  console.log("The Partner Program walk passed");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
