/**
 * Community Loyalty bot fields: the coach saves a client's own uChat API token on the Coach page (a credential: sealed, never
 * shown back), Re-sync pushes exactly the Stage 1 names and nothing the client or the agent wrote, an offer edit re-pushes
 * the changed price with the bot-written fields still intact, an unchanged save pushes nothing, and the record of the push
 * carries the names and values and never the token or a webhook address. Against scripts/mock-uchat.ts on :4060.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4060;
const mock = `http://localhost:${mockPort}`;
const TOKEN = "uchat-test-token-for-maya-0123456789";
const DRIP_URL = "http://localhost:4010/api/iwh/abcdef0123456789abcdef0123456789";

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
async function fillField(page: Page, selector: string, value: string) {
  await page.waitForLoadState("networkidle");
  await page.fill(selector, value);
  if ((await page.inputValue(selector)) !== value) await page.fill(selector, value);
  if ((await page.inputValue(selector)) !== value) throw new Error(`${selector} did not take the value typed into it`);
}
const requests = async () => (await (await fetch(`${mock}/__requests`)).json()) as { fields: { name: string; value: string }[]; token: string }[];
const store = async () => (await (await fetch(`${mock}/__fields`)).json()) as Record<string, string>;

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { STAGE1_FIELDS, BOT_WRITTEN_FIELDS, houseConstraints, QUALIFYING_DEFAULTS } = await import("@/lib/engine/bot-fields");
  const up = await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(mockPort)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${mock}/__reset`, { method: "POST" });
  // What the client and the agent wrote on the bot's side, before any push
  const botWritten = { calendar_id: "cal_chosen_at_onboarding", appointment_id: "appt_20261001_777", booked_time: "2026-10-01T17:00:00Z" };
  await fetch(`${mock}/__seed`, { method: "POST", body: JSON.stringify(botWritten) });
  // The bot holds more fields than one read-back page: the client must page or it misses the ones it pushed
  const { READ_BACK_LIMIT } = await import("@/lib/engine/bot-fields");
  const filler = Object.fromEntries(Array.from({ length: READ_BACK_LIMIT }, (_, i) => [`other_field_${i + 1}`, `v${i + 1}`]));
  await fetch(`${mock}/__seed`, { method: "POST", body: JSON.stringify(filler) });
  if (JSON.stringify(Object.keys(botWritten).sort()) !== JSON.stringify([...BOT_WRITTEN_FIELDS].sort())) throw new Error("the walk seeds exactly the fields the push must never touch");

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/coach`);
    const mayaRow = page.locator('form:has(input[name="eoPassUrl"][value*="maya-torres"])').first();
    await mayaRow.waitFor({ timeout: 15000 });
    // The drip webhook is on the row too: the push must never carry it anywhere
    await mayaRow.locator('input[name="clDripWebhookUrl"]').fill(DRIP_URL);
    await mayaRow.locator('[data-testid="cl-api-token"]').fill(TOKEN);
    await submit(page, 'form:has(input[name="eoPassUrl"][value*="maya-torres"]) button:has-text("Save")');
    if ((await page.content()).includes(TOKEN)) throw new Error("the API token is rendered back on the page");
    if (!/saved \(blank keeps it/.test((await page.locator('form:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="cl-api-token"]').getAttribute("placeholder")) ?? "")) throw new Error("the coach cannot tell the token is set");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    if (!membership.clApiToken || membership.clApiToken === TOKEN) throw new Error("the token is stored sealed, not in clear");
    if ((await requests()).length !== 0) throw new Error("saving a token pushes nothing on its own");

    // Re-sync: exactly the Stage 1 names, every one of them, none of the bot-written ones
    const resync = page.locator(`form:has(input[name="membershipId"][value="${membership.id}"]) [data-testid="resync-bot"]`);
    await resync.waitFor({ timeout: 10000 });
    await submit(page, `form:has(input[name="membershipId"][value="${membership.id}"]) [data-testid="resync-bot"]`);
    let reqs = await requests();
    if (reqs.length !== 1) throw new Error(`one push on Re-sync, got ${reqs.length}`);
    const names = reqs[0].fields.map((f) => f.name).sort();
    if (JSON.stringify(names) !== JSON.stringify([...STAGE1_FIELDS].sort())) throw new Error(`the push is the named Stage 1 subset, got ${names.join(", ")}`);
    for (const n of BOT_WRITTEN_FIELDS) if (names.includes(n)) throw new Error(`${n} is written by the bot and was pushed`);
    if (reqs[0].token !== TOKEN) throw new Error("the push carries the client's own token");
    const sent = Object.fromEntries(reqs[0].fields.map((f) => [f.name, f.value]));
    if (sent.business_name_cbf !== "Torres Nutrition Coaching") throw new Error(`the business name is the membership's, got "${sent.business_name_cbf}"`);
    const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, membership.workspaceId) }))!;
    if (sent.business_time_zone_cbf !== (membership.timezone ?? ws.timezone)) throw new Error(`the zone is the member's else the workspace's, got "${sent.business_time_zone_cbf}"`);
    if (!/^90-Day Reset · .* · Group program · USD \$1,500 · 90 days$/.test(sent["ai_product_&_service_cbf"]) || /Holiday Survival/.test(sent["ai_product_&_service_cbf"])) throw new Error(`the product line is the live offer's facts and not the draft's, got "${sent["ai_product_&_service_cbf"]}"`);
    if (sent.ai_constraints_cbf !== houseConstraints("Torres Nutrition Coaching") || !sent.ai_constraints_cbf.includes("Never claim to be Torres Nutrition Coaching.")) throw new Error("the constraints are the house block with the business name written in");
    if (sent.qualifying_question_1 !== QUALIFYING_DEFAULTS[0] || sent.qualifying_question_3 !== QUALIFYING_DEFAULTS[2]) throw new Error("the questions are the house defaults until written");
    let after = await store();
    for (const [k, v] of Object.entries(botWritten)) if (after[k] !== v) throw new Error(`${k} was changed by the push: "${after[k]}"`);
    if (Object.keys(after).length !== STAGE1_FIELDS.length + BOT_WRITTEN_FIELDS.length + READ_BACK_LIMIT) throw new Error(`the store holds the pushed fields beside the bot-written ones and the filler, got ${Object.keys(after).length}`);
    const reads = (await (await fetch(`${mock}/__reads`)).json()) as { limit: number; page: number; returned: number }[];
    if (reads.length < 2 || reads.some((r) => r.limit !== READ_BACK_LIMIT) || reads[0].page !== 1 || reads[1].page !== 2 || reads[0].returned !== READ_BACK_LIMIT || reads[1].returned >= READ_BACK_LIMIT) throw new Error(`the read-back pages at an explicit limit until a page comes back short, got ${JSON.stringify(reads)}`);
    await page.reload();
    const pushed = await page.locator(`form:has(input[name="membershipId"][value="${membership.id}"]) [data-testid="bot-fields-pushed"]`).innerText();
    if (!new RegExp(`^${STAGE1_FIELDS.length} fields pushed `).test(pushed)) throw new Error(`the row says what was pushed and when, got "${pushed}"`);
    console.log(`✓ re-sync: ${names.length} Stage 1 fields pushed by name; calendar_id, appointment_id and booked_time untouched; the token never on the page`);
    // A 200 is not a match: the mock accepts the next push and silently drops one field; the read-back catches it, the record does not move
    const pushedAtFirst = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.clBotFieldsPushedAt;
    await fetch(`${mock}/__skip`, { method: "POST", body: JSON.stringify({ name: "qualifying_question_3" }) });
    await submit(page, `form:has(input[name="membershipId"][value="${membership.id}"]) [data-testid="resync-bot"]`);
    if ((await requests()).length !== 2) throw new Error("the second re-sync pushed once");
    const dropped = (await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, membership.workspaceId), eq(schema.syncEvents.event, "botfields.push")) })).at(-1)!;
    if (dropped.status !== "failed" || !/read-back differs on qualifying_question_3/.test(dropped.note ?? "")) throw new Error(`a field the bot did not write is a failed push with the field named, got ${JSON.stringify([dropped.status, dropped.note])}`);
    if ((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.clBotFieldsPushedAt !== pushedAtFirst) throw new Error("a push that did not read back does not move the record");
    await fetch(`${mock}/__skip`, { method: "POST", body: JSON.stringify({}) });
    await submit(page, `form:has(input[name="membershipId"][value="${membership.id}"]) [data-testid="resync-bot"]`);
    if ((await requests()).length !== 3) throw new Error("the third re-sync pushed once");
    console.log("✓ a 200 with a field silently dropped is a failed push, named; the record moves only on a read-back that matches");

    // The record of the push: names and values, never the token, never a webhook address
    const row = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!;
    const recorded = JSON.stringify(row.clBotFields);
    if (Object.keys(row.clBotFields).length !== STAGE1_FIELDS.length || !row.clBotFieldsPushedAt) throw new Error("the last push is on the record");
    if (recorded.includes(TOKEN) || recorded.includes("/api/iwh/") || recorded.includes("abcdef0123456789") || recorded.includes("/api/webhooks/")) throw new Error("the recorded payload carries a credential");
    const events = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, membership.workspaceId), eq(schema.syncEvents.event, "botfields.push")) });
    if (events.length !== 3 || events.map((e) => e.status).join() !== "sent,failed,sent") throw new Error(`sent, failed, sent on the log, got ${JSON.stringify(events.map((e) => [e.status, e.note]))}`);
    const logged = JSON.stringify(events);
    if (logged.includes(TOKEN) || logged.includes("/api/iwh/") || logged.includes("Torres Nutrition Coaching")) throw new Error("the sync log carries names and a reason, never a value or a credential");
    console.log("✓ the record and the log hold the names; the token and the webhook are in neither");

    // The client edits the offer's price: the changed price is re-pushed, the bot-written fields still intact; the same save again pushes nothing
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/offers`);
    await page.click('a:has-text("90-Day Reset")');
    await page.waitForURL(/\/offers\//);
    await fillField(page, 'input[name="price"]', "1997");
    await fillField(page, '[data-testid="qualifying-2"]', "Who else is part of this decision?");
    await submit(page, 'button:has-text("Save offer")');
    reqs = await requests();
    if (reqs.length !== 4) throw new Error(`the price change re-pushed once, got ${reqs.length} pushes`);
    const sent2 = Object.fromEntries(reqs[3].fields.map((f) => [f.name, f.value]));
    if (!/USD \$1,997/.test(sent2["ai_product_&_service_cbf"])) throw new Error(`the bot got the new price, got "${sent2["ai_product_&_service_cbf"]}"`);
    if (sent2.qualifying_question_2 !== "Who else is part of this decision?" || sent2.qualifying_question_1 !== QUALIFYING_DEFAULTS[0]) throw new Error("a written question replaces its default; the others keep theirs");
    if (reqs[3].fields.map((f) => f.name).sort().join() !== [...STAGE1_FIELDS].sort().join()) throw new Error("the re-push is the same named subset");
    after = await store();
    for (const [k, v] of Object.entries(botWritten)) if (after[k] !== v) throw new Error(`${k} was changed by the re-push: "${after[k]}"`);
    await submit(page, 'button:has-text("Save offer")');
    if ((await requests()).length !== 4) throw new Error("an unchanged save pushes nothing");
    console.log("✓ an offer edit re-pushes the price and a written question by name, leaves the bot's own fields alone, and an unchanged save sends nothing");
  } finally {
    await browser.close();
    if (proc?.pid) try { process.kill(-proc.pid); } catch { /* already gone */ }
  }
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Bot fields smoke passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
