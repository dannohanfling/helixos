/**
 * Community Loyalty bot fields, Stage 1, as the coach meets it: the coach saves a client's own uChat API token on the Coach page
 * (a credential: sealed, never shown back) and nothing is sent. The Coach page names the older offers field when the bot still
 * carries it. "Review bot push" reads the bot and shows, per field, what it holds now against what HelixOS would write; a field
 * the agent does not read gets the plain line and no values, a field HelixOS has nothing for is left out (never sent as ""), and
 * nothing is sent until the push is pressed. Pressed twice in the same instant it sends once and records once, showing that it
 * is working while it is out. Only the fields that change are sent, by the name the bot has, and only those are read back; a
 * 200 with a field silently dropped is a failed push, named. Never quote prices on the Offer leaves the price out of what is
 * sent, and the Brief says so. A plan that moved since the page was read sends nothing. The record and the log never carry the
 * token or a webhook address. Against scripts/mock-uchat.ts on :4060.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4060;
const mock = `http://localhost:${mockPort}`;
// A fresh token each run: the agent list and the field names are cached a minute per bot, so back-to-back runs never share one.
const RUN = randomUUID().slice(0, 8);
const TOKEN = `uchat-test-token-for-maya-${RUN}-0123456789`;
const DRIP_URL = "http://localhost:4010/api/iwh/abcdef0123456789abcdef0123456789";

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
const post = (path: string, body: unknown) => fetch(`${mock}${path}`, { method: "POST", body: JSON.stringify(body) });
const requests = async () => (await (await fetch(`${mock}/__requests`)).json()) as { fields: { name: string; value: string }[]; token: string }[];
const store = async () => (await (await fetch(`${mock}/__fields`)).json()) as Record<string, string>;

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { BOT_WRITTEN_FIELDS, PRODUCT_FIELD, PRODUCT_FIELD_OLD, READ_BACK_LIMIT, STAGE1_NOTHING_CURRENT, QUALIFYING_DEFAULTS, houseConstraints } = await import("@/lib/engine/bot-fields");
  const up = await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(mockPort)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${mock}/__reset`, { method: "POST" });

  // The record, set to a known state: Maya's live offer at its seeded price with no questions written and prices quoted, the
  // draft beside it, no agent chosen (the bot has one, so it is taken), and no push on the record.
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, membership.workspaceId) }))!;
  const reset = await db.query.offers.findFirst({ where: and(eq(schema.offers.userId, maya.id), eq(schema.offers.name, "90-Day Reset")) });
  if (!reset) throw new Error("the demo seed has Maya's 90-Day Reset");
  await db.update(schema.offers).set({ status: "live", price: 1500, currency: "USD", neverQuotePrice: false, qualifyingQuestion1: null, qualifyingQuestion2: null, qualifyingQuestion3: null }).where(eq(schema.offers.id, reset.id));
  await db.update(schema.memberships).set({ clAgentNs: null, clApiToken: null, clBotFields: {}, clBotFieldsPushedAt: null }).where(eq(schema.memberships.id, membership.id));
  const zone = membership.timezone ?? ws.timezone;

  // What the bot holds before HelixOS ever writes: what the client and the agent wrote, a page of other fields, and the Stage 1
  // fields as someone set them by hand, the offers under the older name only.
  const botWritten = { calendar_id: "cal_chosen_at_onboarding", appointment_id: "appt_20261001_777", booked_time: "2026-10-01T17:00:00Z" };
  if (JSON.stringify(Object.keys(botWritten).sort()) !== JSON.stringify([...BOT_WRITTEN_FIELDS].sort())) throw new Error("the walk seeds exactly the fields the push must never touch");
  const byHand = { business_name_cbf: "Torres Nutrition", business_time_zone_cbf: zone, [PRODUCT_FIELD_OLD]: "Hand-written on 21 Sep: the Reset, ask me about price", ai_constraints_cbf: "Be kind.", qualifying_question_1: "What brings you here?", qualifying_question_2: QUALIFYING_DEFAULTS[1], qualifying_question_3: "A third question written by hand" };
  await post("/__seed", botWritten);
  await post("/__seed", Object.fromEntries(Array.from({ length: READ_BACK_LIMIT }, (_, i) => [`other_field_${i + 1}`, `v${i + 1}`])));
  await post("/__seed", byHand);
  // Two agents, as a Book 'em Danno bot is set up (Danno's, 23 Sep): the FAQ agent, chosen for the Brief, reads only the FAQ field;
  // the Appointment Setter reads every Stage 1 field but the third question, the offers by their older name. Bot fields belong to
  // the whole bot, so Stage 1 asks both, whichever one the FAQ chose.
  const reads = ["business_name_cbf", "business_time_zone_cbf", PRODUCT_FIELD_OLD, "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2"];
  const faqAgent = { ai_agent_ns: `maya-faq-${RUN}`, name: "Community FAQ Agent", description: "Answers questions.", prompts: [{ section: "Main", text: "{ai_faq_cbf}" }] };
  const setter = (fields: string[]) => ({ ai_agent_ns: `maya-setter-${RUN}`, name: "Appointment Setter", description: "Books calls.", prompts: [{ section: "Main", text: fields.map((r) => `{${r}}`).join("\n") }] });
  await post("/__agents", { agents: [faqAgent, setter(reads)] });
  await db.update(schema.memberships).set({ clAgentNs: faqAgent.ai_agent_ns }).where(eq(schema.memberships.id, membership.id));

  const pushEvents = async () => db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.userId, maya.id), eq(schema.syncEvents.event, "botfields.push")) });
  const eventsBefore = (await pushEvents()).length;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const signIn = async (who: "coach" | "client") => {
      await page.goto(`${base}/login`);
      await page.click(`button:has-text("${who === "coach" ? "As the coach" : "As a client"}")`);
      await page.waitForURL(/\/today/);
    };
    await signIn("coach");
    await page.goto(`${base}/coach`);
    const mayaForm = 'form:has(input[name="eoPassUrl"][value*="maya-torres"])';
    const mayaRow = page.locator(`li:has(${mayaForm})`).first();
    await mayaRow.waitFor({ timeout: 15000 });
    await page.locator(`${mayaForm} input[name="clDripWebhookUrl"]`).fill(DRIP_URL);
    await page.locator(`${mayaForm} [data-testid="cl-api-token"]`).fill(TOKEN);
    await submit(page, `${mayaForm} button:has-text("Save")`);
    if ((await page.content()).includes(TOKEN)) throw new Error("the API token is rendered back on the page");
    if (!/Saved ✓ — leave blank to keep it/.test((await page.locator(`${mayaForm} [data-testid="cl-api-token"]`).getAttribute("placeholder")) ?? "")) throw new Error("the coach cannot tell the token is set");
    const sealed = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.clApiToken;
    if (!sealed || sealed === TOKEN) throw new Error("the token is stored sealed, not in clear");
    if ((await requests()).length !== 0) throw new Error("saving a token pushes nothing on its own");
    const named = (await mayaRow.locator('[data-testid="bot-product-field"]').innerText()).trim();
    if (named !== `Offers go to ${PRODUCT_FIELD_OLD}: this bot has the older name, not ${PRODUCT_FIELD}.`) throw new Error(`the Coach page names the fallback, got "${named}"`);
    console.log(`✓ token saved sealed, nothing sent; the Coach page says "${named}"`);

    // ── The before-and-after: read from the bot, per field, nothing sent. ──
    await Promise.all([page.waitForURL(new RegExp(`/coach/${membership.id}/bot`)), mayaRow.locator('[data-testid="review-bot"]').click()]);
    const preview = page.locator('[data-testid="bot-preview"]');
    await preview.waitFor({ timeout: 20000 });
    const row = (field: string) => page.locator(`[data-testid="bot-field-row"][data-field="${field}"]`);
    const status = async (field: string) => row(field).getAttribute("data-status");
    const before = async (field: string) => (await row(field).locator('[data-testid="bot-field-before"]').innerText()).trim();
    const after = async (field: string) => (await row(field).locator('[data-testid="bot-field-after"]').innerText()).trim();
    if ((await page.locator('[data-testid="bot-agents"]').innerText()).trim() !== "Agents on this bot: Community FAQ Agent, Appointment Setter") throw new Error("the preview names every agent on the bot");
    if ((await row("business_name_cbf").locator('[data-testid="bot-field-readby"]').innerText()).trim() !== "read by Appointment Setter") throw new Error("each field names the agent that reads it, not the FAQ's chosen agent");
    if (!(await page.locator('[data-testid="bot-fallback"]').innerText()).includes(`the offers go into ${PRODUCT_FIELD_OLD}, the older name`)) throw new Error("the preview names the older field it writes the offers into");
    if ((await status("business_name_cbf")) !== "change" || (await before("business_name_cbf")) !== "Torres Nutrition" || (await after("business_name_cbf")) !== "Torres Nutrition Coaching") throw new Error("the business name shows what the bot holds against what HelixOS would write");
    if ((await status("business_time_zone_cbf")) !== "same") throw new Error("a field the bot already holds is shown unchanged");
    if ((await status(PRODUCT_FIELD)) !== "change" || !(await row(PRODUCT_FIELD).innerText()).includes(PRODUCT_FIELD_OLD) || !/^Hand-written on 21 Sep/.test(await before(PRODUCT_FIELD)) || !/^90-Day Reset · .* · Group program · USD \$1,500 · 90 days$/.test(await after(PRODUCT_FIELD))) throw new Error(`the offers row writes the live offer's facts into the older name, got "${await row(PRODUCT_FIELD).innerText()}"`);
    if ((await status("qualifying_question_2")) !== "same" || (await status("qualifying_question_1")) !== "change") throw new Error("the questions: the one the bot holds is unchanged, the one it does not is a change");
    const unread = row("qualifying_question_3");
    if ((await status("qualifying_question_3")) !== "unread" || (await unread.locator('[data-testid="bot-field-line"]').innerText()).trim() !== "Your bot does not use qualifying_question_3 yet, so nothing is sent to it.") throw new Error("a field the agent does not read gets the plain line");
    if ((await unread.locator('[data-testid="bot-field-before"], [data-testid="bot-field-after"], [data-testid="bot-field-same"]').count()) || (await page.content()).includes(byHand.qualifying_question_3)) throw new Error("a field the agent does not read shows no values");
    if ((await requests()).length !== 0) throw new Error("the preview sends nothing");
    const pushButton = page.locator('[data-testid="push-stage1"]');
    if ((await pushButton.innerText()).trim() !== "Push 4 changes to the bot") throw new Error(`the button says how many fields will change, got "${await pushButton.innerText()}"`);
    console.log("✓ the before-and-after: 4 changes (name, offers into the older field, constraints, question 1), 2 unchanged, question 3 unread and not shown; nothing sent");

    // ── Pressed twice in the same instant while the bot is slow to answer: it says so, sends once, records once. ──
    await post("/__delay", { ms: 1500 });
    await pushButton.dblclick();
    await page.locator('[data-testid="push-stage1"][data-pending="true"]').waitFor({ timeout: 1000 });
    if (!(await pushButton.isDisabled()) || !(await pushButton.innerText()).includes("Sending to your bot…")) throw new Error(`while the push is out the button is disabled and says it is sending, got "${await pushButton.innerText()}"`);
    await page.waitForURL(/\?pushed=/, { timeout: 20000 });
    await page.locator('[data-testid="bot-pushed"]').waitFor();
    let reqs = await requests();
    if (reqs.length !== 1) throw new Error(`a double press sends once, got ${reqs.length} pushes`);
    if ((await pushEvents()).length - eventsBefore !== 1) throw new Error(`a double press records once, got ${(await pushEvents()).length - eventsBefore} sync records`);
    const names = reqs[0].fields.map((f) => f.name).sort();
    if (JSON.stringify(names) !== JSON.stringify([PRODUCT_FIELD_OLD, "ai_constraints_cbf", "business_name_cbf", "qualifying_question_1"].sort())) throw new Error(`only the fields that change, by the bot's names, got ${names.join(", ")}`);
    if (reqs[0].token !== TOKEN) throw new Error("the push carries the client's own token");
    if (reqs[0].fields.some((f) => !f.value.trim())) throw new Error("an empty value was sent");
    const sent = Object.fromEntries(reqs[0].fields.map((f) => [f.name, f.value]));
    if (sent.ai_constraints_cbf !== houseConstraints("Torres Nutrition Coaching")) throw new Error("the constraints are the house block with the business name written in");
    const held = await store();
    for (const [k, v] of Object.entries(botWritten)) if (held[k] !== v) throw new Error(`${k} was changed by the push: "${held[k]}"`);
    if (held.qualifying_question_3 !== byHand.qualifying_question_3) throw new Error("the field the agent does not read keeps what was written by hand");
    if (held[PRODUCT_FIELD]) throw new Error("the push never writes a field the bot does not have");
    const pagedReads = (await (await fetch(`${mock}/__reads`)).json()) as { limit: number; page: number }[];
    if (pagedReads.some((r) => r.limit !== READ_BACK_LIMIT) || !pagedReads.some((r) => r.page === 2)) throw new Error(`the bot is read page by page at an explicit limit, got ${JSON.stringify(pagedReads.slice(0, 4))}`);
    const closing = (await page.locator('[data-testid="bot-nothing-to-push"]').innerText()).trim();
    if (closing !== "Nothing to push: 6 unchanged, 1 not read by any agent.") throw new Error(`after the push, the closing line counts what happened, got "${closing}"`);
    console.log(`✓ pressed twice: "Sending to your bot…" while out, one push of ${names.length} fields, one sync record; question 3, the calendar and the booking untouched`);

    // ── A 200 is not a match, and the read-back covers only what was sent. ──
    const pushedAt = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.clBotFieldsPushedAt;
    await post("/__skip", { name: "business_name_cbf" });
    await post("/__seed", { business_name_cbf: "Torres Nutrition" });
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await pushButton.waitFor({ timeout: 20000 });
    await Promise.all([page.waitForURL(/\?failed=/), pushButton.click()]);
    const refused = (await page.locator('[data-testid="bot-push-failed"]').innerText()).trim();
    if (!/read-back differs on business_name_cbf/.test(refused)) throw new Error(`a field the bot did not write is a failed push, named beside the button, got "${refused}"`);
    if ((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.clBotFieldsPushedAt !== pushedAt) throw new Error("a push that did not read back does not move the record");
    await post("/__skip", {});
    await post("/__seed", { business_name_cbf: "Torres Nutrition" });
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await Promise.all([page.waitForURL(/\?pushed=1/), pushButton.click()]);
    console.log(`✓ a 200 with a field silently dropped: "${refused.slice(0, 70)}"; the record moves only on a read-back that matches`);

    // ── The offer retired: HelixOS last wrote the offers field and now has nothing for it, so the bot is told there is none; ──
    // ── edited by hand since, it is left out and the bot keeps what it holds. Never "" either way. ──
    await db.update(schema.offers).set({ status: "draft" }).where(eq(schema.offers.id, reset.id));
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    const sentence = STAGE1_NOTHING_CURRENT[PRODUCT_FIELD];
    if ((await status(PRODUCT_FIELD)) !== "change" || !(await row(PRODUCT_FIELD).innerText()).includes("HelixOS wrote this and now has nothing for it, so your bot is told: no current offer.") || !(await before(PRODUCT_FIELD)).startsWith("90-Day Reset") || (await after(PRODUCT_FIELD)) !== "No current offer") throw new Error(`a retired offer HelixOS wrote is a change to "No current offer", got "${await row(PRODUCT_FIELD).innerText()}"`);
    if ((await page.content()).includes(sentence)) throw new Error("the preview says no current offer and never quotes the sentence back");
    await Promise.all([page.waitForURL(/\?pushed=1/), pushButton.click()]);
    reqs = await requests();
    const retired = reqs.at(-1)!;
    if (JSON.stringify(retired.fields) !== JSON.stringify([{ name: PRODUCT_FIELD_OLD, value: sentence }])) throw new Error(`the retired offer is replaced by its sentence, by the bot's name, got ${JSON.stringify(retired.fields)}`);
    if ((await store())[PRODUCT_FIELD_OLD] !== sentence) throw new Error("the read-back matches the sentence");
    if ((await status(PRODUCT_FIELD)) !== "same") throw new Error("once told, the field reads as unchanged");
    await post("/__seed", { [PRODUCT_FIELD_OLD]: "Edited by hand on the bot" });
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    if ((await status(PRODUCT_FIELD)) !== "empty" || !(await row(PRODUCT_FIELD).innerText()).includes("your bot holds text HelixOS did not send, so nothing is sent; your bot keeps what it holds.")) throw new Error("text HelixOS did not send is left out");
    const leftOut = (await page.locator('[data-testid="bot-nothing-to-push"]').innerText()).trim();
    if (leftOut !== "Nothing to push: 5 unchanged, 1 not read by any agent, 1 with nothing in HelixOS.") throw new Error(`the closing line counts the field left out, got "${leftOut}"`);
    if ((await requests()).length !== reqs.length || reqs.some((r) => r.fields.some((f) => !f.value.trim()))) throw new Error("nothing sent, and never an empty value");
    await db.update(schema.offers).set({ status: "live" }).where(eq(schema.offers.id, reset.id));
    console.log(`✓ offer retired: "No current offer" pushed over what HelixOS wrote and read back; edited by hand, it is left out ("${leftOut}")`);

    // ── Never quote prices: ticked on the Offer by the client, nothing sent on save; the Brief says so; the push leaves it out. ──
    const countBefore = reqs.length;
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await signIn("client");
    await page.goto(`${base}/offers/${reset.id}`);
    await page.locator('[data-testid="never-quote-price"]').check();
    await submit(page, 'button:has-text("Save offer")');
    if (!(await db.query.offers.findFirst({ where: eq(schema.offers.id, reset.id) }))!.neverQuotePrice) throw new Error("the tick is saved on the offer");
    if ((await requests()).length !== countBefore) throw new Error("saving an offer pushes nothing on its own");
    await page.goto(`${base}/brain`);
    const brief = (await page.locator('[data-testid="brief-price"]').innerText()).trim();
    if (!brief.includes("Never quote prices is ticked on 90-Day Reset, so that price is left out of what your bot is sent")) throw new Error(`the Brief says the price is left out, got "${brief}"`);
    if (/1,500/.test(await page.locator('[data-testid="brief-offers"]').innerText())) throw new Error("the Brief's offer line carries no price");
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await signIn("coach");
    // Nothing pushes on its own, so the Coach page says the record moved since the last push, from HelixOS's data alone.
    await page.goto(`${base}/coach`);
    const changedLine = page.locator(`li:has(${mayaForm}) [data-testid="bot-changed-since"]`);
    await changedLine.waitFor({ timeout: 15000 });
    if ((await changedLine.innerText()).trim() !== "changed since the last push") throw new Error("the row says changed since the last push");
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    if (!(await page.locator('[data-testid="bot-prices-left-out"]').innerText()).includes("90-Day Reset")) throw new Error("the preview says the price is left out");
    if (/\$|1,500|USD/.test(await after(PRODUCT_FIELD))) throw new Error(`the offers line goes without its price, got "${await after(PRODUCT_FIELD)}"`);
    await Promise.all([page.waitForURL(/\?pushed=1/), pushButton.click()]);
    const quiet = (await requests()).at(-1)!.fields.find((f) => f.name === PRODUCT_FIELD_OLD)?.value ?? "";
    if (!quiet.startsWith("90-Day Reset") || /\$|1,500/.test(quiet)) throw new Error(`the push leaves the price out, got "${quiet}"`);
    await page.goto(`${base}/coach`);
    await page.locator(`li:has(${mayaForm}) [data-testid="review-bot"]`).waitFor({ timeout: 15000 });
    if (await page.locator(`li:has(${mayaForm}) [data-testid="bot-changed-since"]`).count()) throw new Error("after the push, the row no longer says changed");
    console.log(`✓ never quote prices: the Brief says so, the offer line goes as "${quiet}"; the Coach row said "changed since the last push" until it went`);

    // ── What is sent is what was shown: a plan that moved since the page was read sends nothing. ──
    await post("/__seed", { business_time_zone_cbf: "Pacific/Chatham" });
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await pushButton.waitFor({ timeout: 20000 });
    await post("/__seed", { business_time_zone_cbf: "Pacific/Kiritimati" });
    const n = (await requests()).length;
    const e = (await pushEvents()).length;
    await Promise.all([page.waitForURL(/\?changed=1/), pushButton.click()]);
    if ((await requests()).length !== n || (await pushEvents()).length !== e) throw new Error("a push whose plan moved sends and records nothing");
    await page.locator('[data-testid="bot-push-changed"]').waitFor();
    if ((await before("business_time_zone_cbf")) !== "Pacific/Kiritimati") throw new Error("the page shows the new before-and-after");
    await Promise.all([page.waitForURL(/\?pushed=1/), pushButton.click()]);
    console.log("✓ the bot changed after the page was read: nothing sent, the new before-and-after shown, then pushed");

    // ── The bot gets the current name: the offers follow it, no fallback. ──
    await post("/__seed", { [PRODUCT_FIELD]: "Written on the renamed field" });
    await post("/__agents", { agents: [faqAgent, setter([...reads, PRODUCT_FIELD])] });
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="bot-fallback"]').count()) || (await status(PRODUCT_FIELD)) !== "change" || (await before(PRODUCT_FIELD)) !== "Written on the renamed field") throw new Error("with the current name on the bot, the offers go there and no fallback is named");
    console.log(`✓ with ${PRODUCT_FIELD} on the bot, the offers go there and the fallback line is gone`);

    // ── A bot whose only agent reads none of these: the closing line says so, not "already holds everything". ──
    await post("/__agents", { agents: [faqAgent] });
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    const unreadLine = (await page.locator('[data-testid="bot-nothing-to-push"]').innerText()).trim();
    if (unreadLine !== "Nothing to push: no agent on this bot reads these fields yet.") throw new Error(`with no agent reading the fields, the closing line says so, got "${unreadLine}"`);
    console.log(`✓ only the FAQ agent on the bot: "${unreadLine}"`);

    // ── The record and the log: names and values on the membership, names and a reason on the log, never a credential. ──
    const rec = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!;
    const recorded = JSON.stringify(rec.clBotFields);
    if (!rec.clBotFieldsPushedAt || rec.clBotFields.business_name_cbf !== "Torres Nutrition Coaching") throw new Error("the last push is on the record");
    if (recorded.includes(TOKEN) || recorded.includes("/api/iwh/") || recorded.includes("abcdef0123456789") || recorded.includes("/api/webhooks/")) throw new Error("the recorded payload carries a credential");
    const logged = JSON.stringify((await pushEvents()).slice(eventsBefore));
    if (logged.includes(TOKEN) || logged.includes("/api/iwh/") || logged.includes("Torres Nutrition Coaching")) throw new Error("the sync log carries names and a reason, never a value or a credential");
    const statuses = (await pushEvents()).slice(eventsBefore).map((x) => x.status).join();
    if (statuses !== "sent,failed,sent,sent,sent,sent") throw new Error(`one record per push that went out, got ${statuses}`);
    console.log(`✓ the record and the log hold names; the token and the webhook are in neither (${statuses})`);

    // ── The coach's own bot: the same page, from My bot. ──
    const coachUser = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const own = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, coachUser.id), eq(schema.memberships.workspaceId, membership.workspaceId)) }))!;
    await page.goto(`${base}/coach/${own.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    if (!/What a push would change on your bot/.test(await page.locator("h1").innerText())) throw new Error("the coach's own bot has the same page");
    console.log("✓ the coach's own bot: the same before-and-after page");
  } finally {
    await db.update(schema.offers).set({ neverQuotePrice: false, status: "live" }).where(eq(schema.offers.id, reset.id));
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
