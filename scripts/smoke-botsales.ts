/**
 * How the bot sells, walked end to end (handoff rev 110/111, the "Bot flow (rev 4)" tab), on the demo client's own bot with
 * Danno's data entered where each piece lives: the coach-level lines through the "Your bot" form, his offers, his examples and
 * stories, and eleven partner stories from his Proof Bank (one put on the bot through the proof's own page):
 * - it composes to scripts/fixtures/golden-bot-danno.json byte for byte;
 * - a live, priced client offer with no bot role, the Academy taken off the bot, a draft proof and an approved proof not on the
 *   bot never appear;
 * - every fact, each of his stories and each partner story is in Needs your eyes, approved one at a time, never in bulk; the
 *   examples, the money flow and the guarantee's lead-in are not;
 * - an example over its length and a story with a number are warned, never blocked; an entry offer with no link blocks;
 * - the client pushes from their own "Your bot" page, the read-back matches the fixture, the sync record names who pushed, and
 *   the coach's Coach page shows "pushed by client …" with the time against that client's row;
 * - a partner story whose number changes needs approving again, and only that one.
 * Against scripts/mock-uchat.ts on :4060. Nothing here reaches a real bot.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "@playwright/test";
import { COACH, ENTRY_LINK, EXAMPLES, OFFERS, PARTNERS, SCHOLARSHIP_LINK, STORIES, WHAT_I_DO, golden } from "./fixtures/danno-bot";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4060;
const mock = `http://localhost:${mockPort}`;
const RUN = randomUUID().slice(0, 8);
const TOKEN = `uchat-test-token-for-sales-${RUN}-0123456789`;

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
  const { PRODUCT_FIELD, STAGE1_FIELDS, exampleWarnings } = await import("@/lib/engine/bot-fields");
  // The approved rev 110 examples carry four warnings (rev 121): 1 names Jess, 2, 4 and 10 repeat the lead. Warnings, never blocks.
  const baseline = EXAMPLES.flatMap((e) => exampleWarnings(e));
  const expected = golden;

  const up = await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(mockPort)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${mock}/__reset`, { method: "POST" });

  // ── Danno's data on the demo client's record. The coach-level lines start empty: the client types them on "Your bot". ──
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = membership.workspaceId;
  await db.update(schema.memberships).set({
    businessName: "Evolve Omega",
    timezone: "America/Los_Angeles",
    whatIDo: WHAT_I_DO,
    priceAnswer: null,
    defaultPath: "call",
    callMinutes: null,
    oneOnOneRange: null,
    paymentPlanLine: null,
    guaranteeLine: null,
    guaranteeLeadIn: null,
    peopleWord: null,
    botExamples: EXAMPLES,
    botStories: STORIES,
    botQuestion1: golden.qualifying_question_1,
    botQuestion2: golden.qualifying_question_2,
    botQuestion3: golden.qualifying_question_3,
    clAgentNs: null,
    clApiToken: null,
    clBotFields: {},
    clBotFieldsPushedAt: null,
    clBotFieldsPushedBy: null,
  }).where(eq(schema.memberships.id, membership.id));
  await db.delete(schema.botApprovals).where(eq(schema.botApprovals.membershipId, membership.id));
  // Essence: his twelve rules one per line, unnumbered, and the persona sent verbatim.
  const essence = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, ws), eq(schema.essences.userId, maya.id)) });
  const data = { ...(essence?.data ?? {}) };
  data.guidelines_to_respond = { ...(data.guidelines_to_respond ?? {}), house_rules: golden.ai_constraints_cbf.split("\n").map((l) => l.replace(/^\d+\.\s/, "")) };
  data.identity = { ...(data.identity ?? {}), bot_persona: golden.ai_persona_role_cbf };
  if (essence) await db.update(schema.essences).set({ data }).where(eq(schema.essences.id, essence.id));
  else await db.insert(schema.essences).values({ id: randomUUID(), workspaceId: ws, userId: maya.id, data });
  // The offers, in the order they were made: every offer the demo already has stays off the bot (the default).
  const at = (i: number) => `2026-01-${String(i + 1).padStart(2, "0")} 09:00:00`;
  const ids = { epic: randomUUID(), gs: randomUUID(), schol: randomUUID(), acad: randomUUID(), elite: randomUUID(), luxe: randomUUID() };
  await db.insert(schema.offers).values([
    // A client's offer, live and priced: no bot role, so it never reaches the bot.
    { id: ids.epic, workspaceId: ws, userId: maya.id, name: `The Epic Voice Immersion ${RUN}`, status: "live", price: 4997, createdAt: at(0) },
    { id: ids.gs, workspaceId: ws, userId: maya.id, ...OFFERS.getStarted, paymentLink: ENTRY_LINK, createdAt: at(1) },
    { id: ids.schol, workspaceId: ws, userId: maya.id, ...OFFERS.scholarship, paymentLink: SCHOLARSHIP_LINK, createdAt: at(2) },
    { id: ids.acad, workspaceId: ws, userId: maya.id, ...OFFERS.academy, status: "live", paymentLink: "https://pay.example.com/academy", createdAt: at(3) },
    { id: ids.elite, workspaceId: ws, userId: maya.id, ...OFFERS.elite, createdAt: at(4) },
    { id: ids.luxe, workspaceId: ws, userId: maya.id, ...OFFERS.luxe, createdAt: at(5) },
  ]);
  // His Proof Bank: the eleven, approved with permission and on the bot; Candy approved but not yet on it (ticked on her page
  // below); a draft on the bot and an approved proof off it, which never reach the bot.
  const proofIds = PARTNERS.map(() => randomUUID());
  const extra = { draft: randomUUID(), off: randomUUID() };
  await db.insert(schema.proofs).values([
    ...PARTNERS.map((p, i) => ({ id: proofIds[i], workspaceId: ws, userId: maya.id, name: `${p.who} ${RUN}`, who: p.who, shortVersion: p.happened, status: "approved" as const, permissionAt: at(20), permissionBy: maya.id, onBot: i !== 0, botFits: i === 0 ? null : p.fits, createdAt: `2026-02-${String(i + 1).padStart(2, "0")} 09:00:00` })),
    { id: extra.draft, workspaceId: ws, userId: maya.id, name: `Draft ${RUN}`, who: "Rob", shortVersion: `A draft result ${RUN}.`, status: "draft" as const, onBot: true, botFits: "Anything", createdAt: "2026-02-20 09:00:00" },
    { id: extra.off, workspaceId: ws, userId: maya.id, name: `Off ${RUN}`, who: "Kate", shortVersion: `An approved result off the bot ${RUN}.`, status: "approved" as const, permissionAt: at(20), permissionBy: maya.id, onBot: false, createdAt: "2026-02-21 09:00:00" },
  ]);

  // ── The bot: one Booking Agent that reads every Stage 1 field, each holding something written by hand. ──
  await post("/__seed", Object.fromEntries(STAGE1_FIELDS.map((f) => [f, f === "business_time_zone_cbf" ? "America/Los_Angeles" : `Written by hand: ${f}`])));
  await post("/__agents", { agents: [{ ai_agent_ns: `sales-booking-${RUN}`, name: "Booking Agent", description: "Books calls.", prompts: [{ section: "Main", text: STAGE1_FIELDS.map((f) => `{${f}}`).join("\n") }] }] });
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
    const signOut = async () => {
      await page.goto(`${base}/settings`);
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);
    };
    // The coach saves the client's token on the Coach page, as always (sealed, never shown back).
    await signIn("coach");
    await page.goto(`${base}/coach`);
    const mayaForm = 'form:has(input[name="eoPassUrl"][value*="maya-torres"])';
    await page.locator(`li:has(${mayaForm})`).first().waitFor({ timeout: 15000 });
    await page.locator(`${mayaForm} [data-testid="cl-api-token"]`).fill(TOKEN);
    await submit(page, `${mayaForm} button:has-text("Save")`);
    await signOut();

    // ── The client, on her own pages: Candy goes on the bot from her proof's page; the lines go in on "Your bot". ──
    await signIn("client");
    await page.goto(`${base}/proof/${proofIds[0]}`);
    await page.locator('[data-testid="proof-on-bot"]').check();
    await page.fill('[data-testid="proof-bot-fits"]', PARTNERS[0].fits);
    await submit(page, 'form:has([data-testid="proof-on-bot"]) button:has-text("Save")');
    const candy = (await db.query.proofs.findFirst({ where: eq(schema.proofs.id, proofIds[0]) }))!;
    if (!candy.onBot || candy.botFits !== PARTNERS[0].fits || candy.status !== "approved") throw new Error("Candy's proof is on the bot, with when it fits, still approved");
    await page.goto(`${base}/brain`);
    const preview = page.locator('[data-testid="bot-preview"]');
    await preview.waitFor({ timeout: 20000 });
    if ((await page.locator("h1").innerText()).trim() !== "Your bot") throw new Error("the page is called Your bot");
    await page.fill('[data-testid="bot-price-answer"]', COACH.priceAnswer);
    await page.locator('[data-testid="bot-default-path"]').selectOption(COACH.defaultPath);
    await page.fill('[data-testid="bot-call-minutes"]', String(COACH.callMinutes));
    await page.fill('[data-testid="bot-one-on-one-range"]', COACH.oneOnOneRange);
    await page.fill('[data-testid="bot-plan-line"]', COACH.paymentPlanLine);
    await page.fill('[data-testid="bot-guarantee-line"]', COACH.guaranteeLine);
    await page.fill('[data-testid="bot-guarantee-lead-in"]', COACH.guaranteeLeadIn);
    await page.fill('[data-testid="bot-people-word"]', COACH.peopleWord);
    await submit(page, '[data-testid="bot-lines-save"]');
    await page.locator('[data-testid="bot-lines-saved"]').waitFor({ timeout: 20000 });
    await preview.waitFor({ timeout: 20000 });

    // ── Danno's data composes to the fixture, byte for byte. ──
    const row = (field: string) => page.locator(`[data-testid="bot-field-row"][data-field="${field}"]`);
    const after = async (field: string) => (await row(field).locator('[data-testid="bot-field-after"]').textContent()) ?? "";
    for (const f of ["ai_persona_role_cbf", PRODUCT_FIELD, "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3"]) {
      if ((await row(f).getAttribute("data-status")) !== "change") throw new Error(`${f} is a change`);
      if ((await after(f)) !== expected[f]) throw new Error(`${f} composes to the fixture byte for byte; got:\n${await after(f)}\n--- expected:\n${expected[f]}`);
    }
    const product = await after(PRODUCT_FIELD);
    for (const absent of ["Epic Voice", "4,997", "Academy", "Rob", "Kate", RUN]) if (product.includes(absent)) throw new Error(`"${absent}" never reaches the bot`);
    console.log(`✓ Danno's data composes to the fixture byte for byte (persona ${expected.ai_persona_role_cbf.length}, offers ${expected[PRODUCT_FIELD].length}, rules ${expected.ai_constraints_cbf.length}, questions); the client offer, the Academy off the bot, a draft proof and a proof off the bot are absent`);

    // ── The example checks (rev 121): the four on his approved examples, on the page and on each example's own row. ──
    const pageWarnings = async () => (await page.locator('[data-testid="bot-warning"]').allInnerTexts()).map((w) => w.trim());
    if (baseline.length !== 4 || JSON.stringify(await pageWarnings()) !== JSON.stringify(baseline)) throw new Error(`the four example warnings, got ${(await pageWarnings()).join(" | ")}`);
    if (!baseline.some((w) => w.includes("names Jess")) || !baseline.some((w) => w.includes('("two programs that didn\'t deliver")'))) throw new Error("the name and the repeated lead line are among them");
    if ((await page.locator('[data-testid="bot-example-warning"]').count()) !== 4) throw new Error("each warned example says so on its own row");
    console.log(`✓ the example checks: ${baseline.length} warnings on his approved examples (a named lead, three repeats of the lead's words), none blocking`);

    // ── Warnings, never blocks: an example over its length, and a story with a number, each added on the page. ──
    await page.locator('[data-testid="bot-example-add"]').click();
    const exForm = page.locator('#examples > details [data-testid="bot-example-form"]');
    await exForm.locator('input[name="moment"]').fill(`Too long ${RUN}.`);
    await exForm.locator('textarea[name="me"]').fill("One. Two. Three?");
    await submit(page, '#examples > details [data-testid="bot-example-form"] button');
    await preview.waitFor({ timeout: 20000 });
    await page.locator('[data-testid="bot-story-add"]').click();
    const stForm = page.locator('#stories > details [data-testid="bot-story-form"]');
    await stForm.locator('textarea[name="text"]').fill(`My first $5,000 week ${RUN}.`);
    await stForm.locator('input[name="when"]').fill("Never");
    await submit(page, '#stories > details [data-testid="bot-story-form"] button');
    await preview.waitFor({ timeout: 20000 });
    const warnings = (await page.locator('[data-testid="bot-warning"]').allInnerTexts()).map((w) => w.trim());
    if (!warnings.includes(`"Too long ${RUN}.": 3 sentences, and a normal message is at most 2.`) || !warnings.some((w) => w.startsWith(`Your story "My first $5,000 week ${RUN}." has a number in it.`))) throw new Error(`both are warned, got ${warnings.join(" | ")}`);
    if (!(await page.locator(`[data-testid="eyes-row"][data-key^="story:"]`).allInnerTexts()).some((t) => t.includes(`$5,000 week ${RUN}`))) throw new Error("a new story needs eyes");
    // Taken off again, on the page.
    await page.locator(`[data-testid="bot-example"]:has-text("Too long ${RUN}") summary`).click();
    await submit(page, `[data-testid="bot-example"]:has-text("Too long ${RUN}") button:has-text("Remove")`);
    await preview.waitFor({ timeout: 20000 });
    await page.locator(`[data-testid="bot-story"]:has-text("$5,000 week ${RUN}") summary`).click();
    await submit(page, `[data-testid="bot-story"]:has-text("$5,000 week ${RUN}") button:has-text("Remove")`);
    await preview.waitFor({ timeout: 20000 });
    if (JSON.stringify(await pageWarnings()) !== JSON.stringify(baseline) || (await after(PRODUCT_FIELD)) !== expected[PRODUCT_FIELD]) throw new Error("removed, only the four example warnings are left and the fixture composes again");
    console.log("✓ an example over two sentences and a story with a number are warned, not blocked, added and removed on the page");

    // ── Needs your eyes: every fact, his stories, the partner stories; one at a time; nothing in bulk; the Push shut. ──
    const eyes = async () => page.locator('[data-testid="eyes-row"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-key")}:${e.getAttribute("data-approved")}`));
    const keys = (await eyes()).map((k) => k.replace(/:(yes|no)$/, ""));
    const want = [`offer:${ids.gs}.terms`, `offer:${ids.gs}.link`, `offer:${ids.gs}.cancel`, `offer:${ids.schol}.terms`, `offer:${ids.schol}.link`, "oneonone.range", "refund", "price.plan", "call", "guarantee.line", ...STORIES.map((x) => `story:${x.id}`), ...proofIds.map((id) => `proof:${id}`)];
    if (JSON.stringify(keys) !== JSON.stringify(want)) throw new Error(`the lines that need eyes, got ${keys.join(", ")}`);
    const eyesText = await page.locator('[data-testid="bot-eyes"]').innerText();
    if (eyesText.includes("Hey Jess") || eyesText.includes("Money comes up inside")) throw new Error("the examples and the money flow need no eyes");
    if ((await page.locator('[data-testid="bot-eyes"] button').count()) !== want.length || (await page.locator('[data-testid="bot-eyes"] button:has-text("all")').count())) throw new Error("one Approve per line, and no approve-all");
    const pushButton = page.locator('[data-testid="push-stage1"]');
    if (!(await pushButton.isDisabled())) throw new Error("the Push is shut while any line is not approved");
    if ((await page.locator('[data-testid="bot-hold"]').count()) !== want.length) throw new Error("each unapproved line is named as a hold");
    console.log(`✓ Needs your eyes: ${want.length} lines (10 facts, 8 stories, 11 partner stories), one Approve each, no bulk; the examples and the money flow are not among them; the Push is shut`);

    // ── Prices on the bot, off and on again (rev 121): the no-prices rules compose, nothing is sent, and on is the fixture again. ──
    const pricesForm = page.locator('[data-testid="bot-prices"]');
    if ((await pricesForm.getAttribute("data-on")) !== "yes") throw new Error("prices are on by default");
    const sentBeforePrices = (await requests()).length;
    await submit(page, '[data-testid="bot-prices-toggle"]');
    await preview.waitFor({ timeout: 20000 });
    await page.locator('[data-testid="bot-prices"][data-on="no"]').waitFor({ timeout: 20000 });
    if ((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.botPricesOn !== false) throw new Error("prices off is saved on the member");
    const offText = await after(PRODUCT_FIELD);
    const beforePartners = offText.split("\n\nPARTNER STORIES")[0];
    if (/\$|Get started|Scholarship|evolveomega\.com|month to month/i.test(beforePartners) || !offText.includes("No prices for now.") || !offText.includes("everyone who is a fit gets the 15-minute call")) throw new Error(`prices off: no amount, term, link or entry offer's name, and everyone to the call; got\n${beforePartners}`);
    const offKeys = (await eyes()).map((k) => k.replace(/:(yes|no)$/, ""));
    if (JSON.stringify(offKeys) !== JSON.stringify(["refund", "call", "guarantee.line", ...STORIES.map((x) => `story:${x.id}`), ...proofIds.map((id) => `proof:${id}`)])) throw new Error(`prices off: Needs your eyes keeps the refund, the call, the promise and the stories, got ${offKeys.join(", ")}`);
    if ((await page.locator('[data-testid="bot-example-priced"]').count()) !== 4) throw new Error("prices off: four examples say they are left out");
    if ((await requests()).length !== sentBeforePrices) throw new Error("turning prices off sends nothing");
    await submit(page, '[data-testid="bot-prices-toggle"]');
    await preview.waitFor({ timeout: 20000 });
    await page.locator('[data-testid="bot-prices"][data-on="yes"]').waitFor({ timeout: 20000 });
    if ((await after(PRODUCT_FIELD)) !== expected[PRODUCT_FIELD] || JSON.stringify((await eyes()).map((k) => k.replace(/:(yes|no)$/, ""))) !== JSON.stringify(want) || (await page.locator('[data-testid="bot-example-priced"]').count())) throw new Error("prices back on: the fixture and every line again");
    if ((await requests()).length !== sentBeforePrices) throw new Error("turning prices on sends nothing");
    console.log(`✓ prices off: the no-prices rules compose, ${offKeys.length} lines need eyes, 4 examples left out, nothing sent; back on, the fixture byte for byte`);

    // ── An entry offer with no payment link blocks the push: said on the page, and refused by the server if pressed anyway. ──
    await db.update(schema.offers).set({ paymentLink: null }).where(eq(schema.offers.id, ids.gs));
    await page.goto(`${base}/brain`);
    await preview.waitFor({ timeout: 20000 });
    const noLink = "Get started is an entry offer on your bot with no payment link. Add the link on the Offer, or change its role.";
    if (!(await page.locator('[data-testid="bot-hold"]').allInnerTexts()).map((h) => h.trim()).includes(noLink)) throw new Error("an entry offer with no link is named as a hold");
    if (!(await pushButton.isDisabled())) throw new Error("the Push is shut");
    const sentBefore = (await requests()).length;
    await pushButton.evaluate((b) => b.removeAttribute("disabled"));
    await Promise.all([page.waitForURL(/\?note=/, { timeout: 20000 }), pushButton.click()]);
    const note = (await page.locator('[data-testid="bot-push-note"]').innerText()).trim();
    if (!note.startsWith("Not sent.") || (await requests()).length !== sentBefore) throw new Error(`pressed anyway, the server sends nothing and says why, got "${note}"`);
    await db.update(schema.offers).set({ paymentLink: ENTRY_LINK }).where(eq(schema.offers.id, ids.gs));
    await page.goto(`${base}/brain`);
    await preview.waitFor({ timeout: 20000 });
    console.log(`✓ an entry offer with no link: "${noLink}"; pressed anyway, "${note.slice(0, 60)}…" and nothing sent`);

    // ── Approve each line, one press each. ──
    // An approval goes back to the same address (#eyes only), so nothing in the URL says the new page is in: wait until the page
    // shows the count the database holds before each press, or the press lands on the row just approved and adds nothing (seen
    // once in the gate, 25 Sep: "got 8 after 9"). A press that approves nothing still fails, with the count it left.
    const approvedOnPage = async () => (await eyes()).filter((k) => k.endsWith(":yes")).length;
    const settle = async (n: number) => {
      for (let t = 0; t < 60 && (await approvedOnPage()) !== n; t++) await page.waitForTimeout(250);
      return approvedOnPage();
    };
    for (let i = 0; i < want.length; i++) {
      if ((await settle(i)) !== i) throw new Error(`before press ${i + 1}, the page shows ${await approvedOnPage()} approved, not ${i}`);
      await submit(page, '[data-testid="eyes-row"][data-approved="no"] [data-testid="eyes-approve"]');
      await preview.waitFor({ timeout: 20000 });
      const approved = await settle(i + 1);
      if (approved !== i + 1) throw new Error(`one press approves one line, got ${approved} after ${i + 1}`);
    }
    if (await pushButton.isDisabled()) throw new Error("every line approved, the Push opens");
    if ((await page.locator('[data-testid="bot-hold"]').count())) throw new Error("no hold remains");
    const approvals = await db.query.botApprovals.findMany({ where: eq(schema.botApprovals.membershipId, membership.id) });
    if (approvals.filter((a) => want.includes(a.elementKey)).length !== want.length || approvals.some((a) => a.approvedBy !== maya.id)) throw new Error("one approval row per line, naming who approved");

    // ── The client pushes their own bot; the read-back matches the fixture. ──
    await Promise.all([page.waitForURL(/\?pushed=/, { timeout: 30000 }), pushButton.click()]);
    await page.locator('[data-testid="bot-pushed"]').waitFor();
    const sent = (await requests()).at(-1)!;
    if (sent.token !== TOKEN) throw new Error("the push carries the client's own token");
    const held = await store();
    for (const f of ["ai_persona_role_cbf", PRODUCT_FIELD, "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3"]) if (held[f] !== expected[f]) throw new Error(`read back, ${f} is the fixture`);
    if (held.business_name_cbf !== "Evolve Omega") throw new Error("the business name went too");
    const rec = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!;
    if (rec.clBotFieldsPushedBy !== maya.id || !rec.clBotFieldsPushedAt) throw new Error("the record names who pushed");
    const ev = (await pushEvents()).slice(eventsBefore);
    const payload = ev.at(-1)?.payload as { reason?: string; by?: string; fields?: string[] } | undefined;
    // The refused press above never reached the bot and left no record; this push is the one.
    if (ev.length !== 1 || ev[0].status !== "sent" || payload?.reason !== "client push" || payload.by !== maya.id) throw new Error(`one sync record, naming the client, got ${JSON.stringify(ev.map((e) => [e.status, e.payload]))}`);
    if (JSON.stringify(ev).includes(TOKEN) || JSON.stringify(ev).includes("haven't doubled")) throw new Error("the sync record carries names, never a value or the token");
    if (!/by you\.$/.test((await page.locator('[data-testid="bot-last-pushed"]').innerText()).trim())) throw new Error("the client's page says they pushed it");
    console.log(`✓ the client pushed ${sent.fields.length} fields from their own page; read back, every field is the fixture; the sync record says "client push" and names them`);

    // ── The coach sees it against the client's row, with the time. ──
    await signOut();
    await signIn("coach");
    await page.goto(`${base}/coach`);
    const byClient = page.locator(`li:has(${mayaForm}) [data-testid="bot-pushed-by-client"]`);
    await byClient.waitFor({ timeout: 15000 });
    const line = (await byClient.innerText()).trim();
    if (!line.startsWith(`pushed by client ${maya.name}, `) || !/\d/.test(line)) throw new Error(`the Coach page says the client pushed, with the time, got "${line}"`);
    await page.goto(`${base}/coach/${membership.id}/bot`);
    await preview.waitFor({ timeout: 20000 });
    if (!(await page.locator('[data-testid="bot-last-pushed"]').innerText()).includes(`by ${maya.name}.`)) throw new Error("the coach's view of the bot names who pushed");
    console.log(`✓ the Coach page: "${line}"`);

    // ── A partner story whose number changes needs approving again, and only that one; the Push shuts until it is. ──
    await db.update(schema.proofs).set({ shortVersion: PARTNERS[3].happened.replace("$4,750", "$4,700") }).where(eq(schema.proofs.id, proofIds[3]));
    await page.reload();
    await preview.waitFor({ timeout: 20000 });
    const again = await eyes();
    if (!again.includes(`proof:${proofIds[3]}:no`) || again.filter((k) => k.endsWith(":no")).length !== 1) throw new Error(`only David's changed story needs approving again, got ${again.filter((k) => k.endsWith(":no")).join(", ")}`);
    if (!(await pushButton.isDisabled())) throw new Error("the Push shuts until the changed line is approved");
    console.log("✓ a partner story's number changed: only that line needs approving again, and the Push shuts until it is");
  } finally {
    for (const id of Object.values(ids)) await db.delete(schema.offers).where(eq(schema.offers.id, id));
    for (const id of [...proofIds, ...Object.values(extra)]) await db.delete(schema.proofs).where(eq(schema.proofs.id, id));
    await db.update(schema.memberships).set({ botExamples: [], botStories: [] }).where(eq(schema.memberships.id, membership.id));
    await db.delete(schema.botApprovals).where(eq(schema.botApprovals.membershipId, membership.id));
    await browser.close();
    if (proc?.pid) try { process.kill(-proc.pid); } catch { /* already gone */ }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Bot sales smoke passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
