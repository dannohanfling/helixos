/**
 * Community Loyalty bot fields, Stage 1, as the coach meets it: the coach saves a client's own uChat API token on the Coach page
 * (a credential: sealed, never shown back) and nothing is sent. The Coach page names the older offers field when the bot still
 * carries it. "Review bot push" reads the bot and shows, per field, what it holds now against what HelixOS would write; a field
 * the agent does not read gets the plain line and no values, a field HelixOS has nothing for is left out (never sent as ""), and
 * nothing is sent until the push is pressed. Pressed twice in the same instant it sends once and records once, showing that it
 * is working while it is out. Only the fields that change are sent, by the name the bot has, and only those are read back; a
 * 200 with a field silently dropped is a failed push, named. Every price and link is approved line by line before the Push
 * opens. The early price answer carries the coach's words and no price, and the page says so. A plan that moved since the page was
 * read sends nothing. The record and the log never carry the token or a webhook address. Against scripts/mock-uchat.ts on :4060.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  const { BOT_WRITTEN_FIELDS, PRICE_ANSWER_DEFAULT, PRODUCT_FIELD, PRODUCT_FIELD_OLD, READ_BACK_LIMIT, STAGE1_NOTHING_CURRENT, QUALIFYING_DEFAULTS } = await import("@/lib/engine/bot-fields");
  const up = await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(mockPort)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${mock}/__reset`, { method: "POST" });

  // The record, set to a known state: Maya's live offer at its seeded price, the core offer on her bot with its payment link,
  // prices stated, no questions written, nothing approved, the draft beside it, no agent chosen, and no push on the record.
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, membership.workspaceId) }))!;
  const reset = await db.query.offers.findFirst({ where: and(eq(schema.offers.userId, maya.id), eq(schema.offers.name, "90-Day Reset")) });
  if (!reset) throw new Error("the demo seed has Maya's 90-Day Reset");
  const LINK = `https://pay.example.com/reset-${RUN}`;
  await db.update(schema.offers).set({ status: "live", price: 1500, currency: "USD", botRole: "core", botName: null, botFor: null, botTerms: null, botTermsWhen: null, botCancelLine: null, paymentLink: LINK, refundableIfNotFit: false, guaranteeCovered: false }).where(eq(schema.offers.id, reset.id));
  await db.update(schema.memberships).set({ clAgentNs: null, clApiToken: null, clBotFields: {}, clBotFieldsPushedAt: null, clBotFieldsPushedBy: null, priceAnswer: null, defaultPath: "call", callMinutes: null, oneOnOneRange: null, paymentPlanLine: null, guaranteeLine: null, guaranteeLeadIn: null, peopleWord: null, botExamples: [], botStories: [], whatIDo: null, botQuestion1: null, botQuestion2: null, botQuestion3: null }).where(eq(schema.memberships.id, membership.id));
  await db.delete(schema.botApprovals).where(eq(schema.botApprovals.membershipId, membership.id));
  const zone = membership.timezone ?? ws.timezone;
  // What the core offer with only its link composes to: the money flow with the early answer, then the facts (rev 4 flow).
  const offersText = (answer: string) => `HOW I TALK ABOUT MONEY\nMoney comes up inside the conversation, never as a price sheet.\nIf someone asks about price before I know their situation, answer with no numbers: "${answer}" Then ask a question.\nNumbers come only once I know enough to recommend something.\nAfter my questions, most people get the call.\n\nTHE FACTS\nKnow these. Never recite them as a list. Share one only when the conversation gets there or they ask.\n- 90-Day Reset link: ${LINK}. Send it only when they say yes.\n- The call: no pressure. When inviting.`;

  // What the bot holds before HelixOS ever writes: what the client and the agent wrote, a page of other fields, and the Stage 1
  // fields as someone set them by hand, the offers under the older name only.
  const botWritten = { calendar_id: "cal_chosen_at_onboarding", appointment_id: "appt_20261001_777", booked_time: "2026-10-01T17:00:00Z" };
  if (JSON.stringify(Object.keys(botWritten).sort()) !== JSON.stringify([...BOT_WRITTEN_FIELDS].sort())) throw new Error("the walk seeds exactly the fields the push must never touch");
  const byHand = { business_name_cbf: "Torres Nutrition", business_time_zone_cbf: zone, [PRODUCT_FIELD_OLD]: "Hand-written on 21 Sep: the Reset, ask me about price", ai_constraints_cbf: "Be kind.", ai_persona_role_cbf: "A persona written by hand", qualifying_question_1: "What brings you here?", qualifying_question_2: QUALIFYING_DEFAULTS[1], qualifying_question_3: "A third question written by hand" };
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
    const before = async (field: string) => ((await row(field).locator('[data-testid="bot-field-before"]').textContent()) ?? "").trim();
    const after = async (field: string) => ((await row(field).locator('[data-testid="bot-field-after"]').textContent()) ?? "").trim();
    if ((await page.locator('[data-testid="bot-agents"]').innerText()).trim() !== "Agents on this bot: Community FAQ Agent, Appointment Setter") throw new Error("the preview names every agent on the bot");
    if ((await row("business_name_cbf").locator('[data-testid="bot-field-readby"]').innerText()).trim() !== "read by Appointment Setter") throw new Error("each field names the agent that reads it, not the FAQ's chosen agent");
    if (!(await page.locator('[data-testid="bot-fallback"]').innerText()).includes(`the offers go into ${PRODUCT_FIELD_OLD}, the older name`)) throw new Error("the preview names the older field it writes the offers into");
    if ((await status("business_name_cbf")) !== "change" || (await before("business_name_cbf")) !== "Torres Nutrition" || (await after("business_name_cbf")) !== "Torres Nutrition Coaching") throw new Error("the business name shows what the bot holds against what HelixOS would write");
    if ((await status("business_time_zone_cbf")) !== "same") throw new Error("a field the bot already holds is shown unchanged");
    if ((await status(PRODUCT_FIELD)) !== "change" || !(await row(PRODUCT_FIELD).innerText()).includes(PRODUCT_FIELD_OLD) || !/^Hand-written on 21 Sep/.test(await before(PRODUCT_FIELD)) || (await after(PRODUCT_FIELD)) !== offersText(PRICE_ANSWER_DEFAULT)) throw new Error(`the offers row writes the live offer's facts into the older name, got "${await row(PRODUCT_FIELD).innerText()}"`);
    // The member has written no questions (rev 83): the bot's own question 1 is left alone, never replaced by the house default;
    // question 2 already holds the default; question 3 is read by no agent. Nothing is pushed for the questions.
    const q1Line = (await row("qualifying_question_1").locator('[data-testid="bot-field-line"]').innerText()).trim();
    if ((await status("qualifying_question_1")) !== "empty" || q1Line !== "Your bot has its own question here. Type yours under Settings to manage it from HelixOS.") throw new Error(`the bot's own question is left alone, with the line, got ${await status("qualifying_question_1")} "${q1Line}"`);
    if ((await status("qualifying_question_2")) !== "same") throw new Error("the question the bot already holds is unchanged");
    // No house rules written either (rev 87): the six house lines never go over the bot's own "Be kind.".
    const rulesLine = (await row("ai_constraints_cbf").locator('[data-testid="bot-field-line"]').innerText()).trim();
    if ((await status("ai_constraints_cbf")) !== "empty" || rulesLine !== "Your bot has its own house rules here. Write yours in Essence to manage them from HelixOS.") throw new Error(`the bot's own rules are left alone, with the line, got ${await status("ai_constraints_cbf")} "${rulesLine}"`);
    const unread = row("qualifying_question_3");
    if ((await status("qualifying_question_3")) !== "unread" || (await unread.locator('[data-testid="bot-field-line"]').innerText()).trim() !== "No agent on this bot reads qualifying_question_3 yet, so nothing is sent to it.") throw new Error("a field no agent reads gets the plain line");
    if ((await unread.locator('[data-testid="bot-field-before"], [data-testid="bot-field-after"], [data-testid="bot-field-same"]').count()) || (await page.content()).includes(byHand.qualifying_question_3)) throw new Error("a field the agent does not read shows no values");
    if ((await status("ai_persona_role_cbf")) !== "unread") throw new Error("the persona, read by no agent here, is not sent");
    if ((await requests()).length !== 0) throw new Error("the preview sends nothing");
    const pushButton = page.locator('[data-testid="push-stage1"]');
    if ((await pushButton.innerText()).trim() !== "Push 2 changes to the bot") throw new Error(`the button says how many fields will change, got "${await pushButton.innerText()}"`);
    // Every price and link is approved on its own before the Push opens; the button stays shut until then, and says why.
    const eyesKeys = await page.locator('[data-testid="eyes-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
    if (JSON.stringify(eyesKeys) !== JSON.stringify([`offer:${reset.id}.link`, "call"])) throw new Error(`the link and the call need eyes, got ${eyesKeys.join(", ")}`);
    if (!(await pushButton.isDisabled())) throw new Error("the Push is shut while a line is not approved");
    const holds = await page.locator('[data-testid="bot-hold"]').allInnerTexts();
    if (JSON.stringify(holds.map((h) => h.trim())) !== JSON.stringify(["Not approved yet: 90-Day Reset: the link.", "Not approved yet: The call."])) throw new Error(`the holds name each line, got ${holds.join(" | ")}`);
    for (let i = 0; i < 2; i++) {
      await submit(page, '[data-testid="eyes-row"][data-approved="no"] [data-testid="eyes-approve"]');
      await preview.waitFor({ timeout: 20000 });
    }
    if ((await page.locator('[data-testid="eyes-row"][data-approved="yes"]').count()) !== 2 || (await pushButton.isDisabled())) throw new Error("both lines approved, one at a time, and the Push opens");
    // One log line per read of the bot: counts and times, never a value or the token.
    const readLine = readFileSync(join(__dirname, "..", "screenshots", "logs", "dev.log"), "utf8").split("\n").reverse().find((l) => l.includes("[stage1.read]") && l.includes(membership.id));
    if (!readLine || !/"agents":2,"fields":\d+,"agentsMs":\d+,"fieldsMs":\d+,"readMs":\d+/.test(readLine) || readLine.includes(TOKEN) || readLine.includes("Torres Nutrition")) throw new Error(`the read is logged with its counts and times and nothing else, got ${readLine}`);
    console.log(`✓ the before-and-after: 2 changes (name, offers into the older field), 2 unchanged; the bot's own rules and question 1 left alone ("${rulesLine}"), question 3 unread and not shown; nothing sent`);

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
    if (JSON.stringify(names) !== JSON.stringify([PRODUCT_FIELD_OLD, "business_name_cbf"].sort())) throw new Error(`only the fields that change, by the bot's names, got ${names.join(", ")}`);
    if (reqs[0].token !== TOKEN) throw new Error("the push carries the client's own token");
    if (reqs[0].fields.some((f) => !f.value.trim())) throw new Error("an empty value was sent");
    const sent = Object.fromEntries(reqs[0].fields.map((f) => [f.name, f.value]));
    if (sent.ai_constraints_cbf !== undefined) throw new Error("the house lines are not sent over the bot's own rules");
    const held = await store();
    for (const [k, v] of Object.entries(botWritten)) if (held[k] !== v) throw new Error(`${k} was changed by the push: "${held[k]}"`);
    if (held.qualifying_question_3 !== byHand.qualifying_question_3) throw new Error("the field the agent does not read keeps what was written by hand");
    if (held.ai_constraints_cbf !== byHand.ai_constraints_cbf) throw new Error("the bot's own rules keep what was written by hand");
    if (held.qualifying_question_1 !== byHand.qualifying_question_1) throw new Error("the bot's own question keeps what was written by hand");
    if (held[PRODUCT_FIELD]) throw new Error("the push never writes a field the bot does not have");
    const pagedReads = (await (await fetch(`${mock}/__reads`)).json()) as { limit: number; page: number }[];
    if (pagedReads.some((r) => r.limit !== READ_BACK_LIMIT) || !pagedReads.some((r) => r.page === 2)) throw new Error(`the bot is read page by page at an explicit limit, got ${JSON.stringify(pagedReads.slice(0, 4))}`);
    const closing = (await page.locator('[data-testid="bot-nothing-to-push"]').innerText()).trim();
    if (closing !== "Nothing to push: 4 unchanged, 2 not read by any agent, 2 with nothing in HelixOS.") throw new Error(`after the push, the closing line counts what happened, got "${closing}"`);
    console.log(`✓ pressed twice: "Sending to your bot…" while out, one push of ${names.length} fields, one sync record; the bot's own rules and questions, the persona, the calendar and the booking untouched`);

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

    // ── The offer taken off the bot: HelixOS last wrote the offers field and now has nothing for it, so the bot is told there is none; ──
    // ── edited by hand since, it is left out and the bot keeps what it holds. Never "" either way. ──
    await db.update(schema.offers).set({ botRole: "not_on_bot" }).where(eq(schema.offers.id, reset.id));
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    const sentence = STAGE1_NOTHING_CURRENT[PRODUCT_FIELD];
    if ((await status(PRODUCT_FIELD)) !== "change" || !(await row(PRODUCT_FIELD).innerText()).includes("HelixOS wrote this and now has nothing for it, so your bot is told: no current offer.") || !(await before(PRODUCT_FIELD)).startsWith("HOW I TALK ABOUT MONEY\n") || (await after(PRODUCT_FIELD)) !== "No current offer") throw new Error(`a retired offer HelixOS wrote is a change to "No current offer", got "${await row(PRODUCT_FIELD).innerText()}"`);
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
    if (leftOut !== "Nothing to push: 3 unchanged, 2 not read by any agent, 3 with nothing in HelixOS.") throw new Error(`the closing line counts the field left out, got "${leftOut}"`);
    if ((await requests()).length !== reqs.length || reqs.some((r) => r.fields.some((f) => !f.value.trim()))) throw new Error("nothing sent, and never an empty value");
    await db.update(schema.offers).set({ botRole: "core" }).where(eq(schema.offers.id, reset.id));
    console.log(`✓ offer off the bot: "No current offer" pushed over what HelixOS wrote and read back; edited by hand, it is left out ("${leftOut}")`);

    // ── The early price answer (rev 90: it replaces price mode), set by the client on their own "Your bot" page: nothing sent ──
    // ── on save; the page says so; the push sends the coach's words, no numbers, and still no price. ──
    const countBefore = reqs.length;
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await signIn("client");
    // The coach's own answer to an early price question, one for the coach, not per offer.
    const PRICE_LINE = "Happy to walk you through the options on a call, once I know what you need.";
    await page.goto(`${base}/brain`);
    await page.fill('[data-testid="bot-price-answer"]', PRICE_LINE);
    await submit(page, '[data-testid="bot-lines-save"]');
    await page.locator('[data-testid="bot-lines-saved"]').waitFor({ timeout: 15000 });
    const saved = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!;
    if (saved.priceAnswer !== PRICE_LINE) throw new Error("the early price answer is saved on the member");
    if ((await requests()).length !== countBefore) throw new Error("saving the lines pushes nothing on its own");
    const brief = (await page.locator('[data-testid="brief-price"]').innerText()).trim();
    if (brief !== `How it handles price: asked early, it answers with no numbers, “${PRICE_LINE}”, then asks a question. Numbers come only once it knows enough to recommend something.`) throw new Error(`the page quotes the coach's early answer, got "${brief}"`);
    if (/1,500/.test(await page.locator('[data-testid="brief-offers"]').innerText())) throw new Error("the offer line carries no price");
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
    if ((await after(PRODUCT_FIELD)) !== offersText(PRICE_LINE)) throw new Error(`the offers field carries the coach's early answer, got "${await after(PRODUCT_FIELD)}"`);
    // The early answer is how the coach talks, not a fact: the link and the call stay approved, nothing new needs eyes.
    const answerKeys = await page.locator('[data-testid="eyes-row"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-key")}:${e.getAttribute("data-approved")}`));
    if (JSON.stringify(answerKeys) !== JSON.stringify([`offer:${reset.id}.link:yes`, "call:yes"])) throw new Error(`the early answer needs no eyes, got ${answerKeys.join(", ")}`);
    await Promise.all([page.waitForURL(/\?pushed=1/), pushButton.click()]);
    const quiet = (await requests()).at(-1)!.fields.find((f) => f.name === PRODUCT_FIELD_OLD)?.value ?? "";
    if (quiet !== offersText(PRICE_LINE) || /\$|1,500/.test(quiet.replace(LINK, ""))) throw new Error(`the push sends what the preview showed, with no price, got "${quiet}"`);
    // An empty answer uses the house default, never an empty quote.
    await db.update(schema.memberships).set({ priceAnswer: null }).where(eq(schema.memberships.id, membership.id));
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    if ((await after(PRODUCT_FIELD)) !== offersText(PRICE_ANSWER_DEFAULT) || (await after(PRODUCT_FIELD)).includes('""')) throw new Error("an empty answer uses the default, never an empty quote");
    await db.update(schema.memberships).set({ priceAnswer: PRICE_LINE }).where(eq(schema.memberships.id, membership.id));
    await page.goto(`${base}/coach`);
    await page.locator(`li:has(${mayaForm}) [data-testid="review-bot"]`).waitFor({ timeout: 15000 });
    if (await page.locator(`li:has(${mayaForm}) [data-testid="bot-changed-since"]`).count()) throw new Error("after the push, the row no longer says changed");
    console.log(`✓ the early price answer: set on the client's page, nothing sent on save, the page quotes it; the offers field goes with it and no price, no new line to approve; the Coach row said "changed since the last push" until it went`);

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
    // Only the new name on the bot, as on Danno's: no fallback named anywhere on the page.
    await post("/__skip", { name: PRODUCT_FIELD_OLD });
    await post("/__skip", {});
    if (PRODUCT_FIELD_OLD in (await store())) throw new Error("the walk's bot now carries only the new name");
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="bot-fallback"]').count()) || (await page.content()).includes(PRODUCT_FIELD_OLD.replace("&", "&amp;")) || (await page.content()).includes("Older names")) throw new Error("with only the new name on the bot, the page names no older name");
    if ((await row(PRODUCT_FIELD).locator("code").innerText()).trim() !== PRODUCT_FIELD) throw new Error("the offers row is the new name, matched with its & as spelled");
    console.log(`✓ with ${PRODUCT_FIELD} on the bot, the offers go there; with only that name, no older name appears anywhere`);

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
    if ((await page.locator("h1").innerText()).trim() !== "Your bot") throw new Error("the coach's own bot has the same page");
    console.log("✓ the coach's own bot: the same before-and-after page");
  } finally {
    await db.update(schema.offers).set({ status: "live", botRole: "not_on_bot" }).where(eq(schema.offers.id, reset.id));
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
