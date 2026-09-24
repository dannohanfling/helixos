/**
 * The bot sales rules, walked end to end (handoff rev 80, §8 of the brief), on the demo client's own bot with Danno's data
 * entered the way the Offers, Settings, Essence and "Your bot" take it:
 * - it composes to scripts/fixtures/golden-bot-danno.json byte for byte, the two Link lines carrying the record's links;
 * - an entry offer with no payment link blocks the push, on the page and on the server;
 * - price mode "never" still sends the old deflect line;
 * - a client offer with no bot role, live and priced, never appears;
 * - the guarantee line and the links are in Needs your eyes, approved one at a time, never in bulk;
 * - the client pushes from their own "Your bot" page, the read-back matches the fixture, the sync record names who pushed, and
 *   the coach's Coach page shows "pushed by client …" with the time against that client's row;
 * - a changed line needs approving again.
 * Against scripts/mock-uchat.ts on :4060.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4060;
const mock = `http://localhost:${mockPort}`;
const RUN = randomUUID().slice(0, 8);
const TOKEN = `uchat-test-token-for-sales-${RUN}-0123456789`;
const ENTRY_LINK = `https://pay.example.com/accelerator-${RUN}`;
const CORE_LINK = `https://pay.example.com/academy-deposit-${RUN}`;

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
  const { PRODUCT_FIELD, STAGE1_FIELDS, priceDeflection } = await import("@/lib/engine/bot-fields");
  const golden = JSON.parse(readFileSync(join(__dirname, "fixtures", "golden-bot-danno.json"), "utf8")) as Record<string, string>;
  const placeholders = golden[PRODUCT_FIELD].split("\n").filter((l) => l.startsWith("Link: ")).map((l) => l.slice("Link: ".length));
  const expected: Record<string, string> = { ...golden, [PRODUCT_FIELD]: golden[PRODUCT_FIELD].replace(placeholders[0], ENTRY_LINK).replace(placeholders[1], CORE_LINK) };

  const up = await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(mockPort)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${mock}/__reset`, { method: "POST" });

  // ── Danno's data on the demo client's record, entered where each piece lives. ──
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = membership.workspaceId;
  await db.update(schema.memberships).set({
    businessName: "Evolve Omega",
    timezone: "America/Los_Angeles",
    whatIDo: golden[PRODUCT_FIELD].split("\n\n")[0].split("\n")[1],
    priceMode: "range",
    rangeLine: "Sure. It depends on what you need. Some partners start at $1,000, and some work with me one-on-one for up to $50,000 a year.",
    paymentPlanLine: null,
    priceAnswer: null,
    guaranteeLine: "Yes. On my partner programs, if you do the work with me and haven't doubled your investment in 12 months, I keep working with you at no extra cost until you do. I'll walk you through the full terms on the call.",
    guaranteeCoverageLine: "The guarantee covers the core offer and one-on-one programs only, not the entry offer. If someone on the entry offer path asks, say the guarantee is for the partner programs, and that their $500 is refunded if our call shows it's not a fit.",
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
  const at = (i: number) => `2026-01-0${i + 1} 09:00:00`;
  const ids = { epic: randomUUID(), acc: randomUUID(), acad: randomUUID(), elite: randomUUID(), luxe: randomUUID() };
  await db.insert(schema.offers).values([
    // A client's offer, live and priced: no bot role, so it never reaches the bot.
    { id: ids.epic, workspaceId: ws, userId: maya.id, name: `The Epic Voice Immersion ${RUN}`, status: "live", price: 4997, createdAt: at(0) },
    { id: ids.acc, workspaceId: ws, userId: maya.id, name: "Evolve Omega Accelerator", botName: "Accelerator", botRole: "entry", price: 6000, botFor: "new businesses with a budget under $1,000 who want help.", botTerms: "$500 today, then $500 a month for the rest of the year. 12 payments in all.", paymentLink: ENTRY_LINK, depositAmount: 500, refundableIfNotFit: true, botRefundLine: "The $500 is fully refunded if our call shows it's not a fit.", createdAt: at(1) },
    { id: ids.acad, workspaceId: ws, userId: maya.id, name: "Evolve Omega Academy", botName: "Academy", botRole: "core", price: 12000, botFor: "established businesses who say plainly they are ready to buy now.", botTerms: "$1,000 deposit today. The next payment is 30 days later. I'll go over the rest on the call.", paymentLink: CORE_LINK, depositAmount: 1000, refundableIfNotFit: true, guaranteeCovered: true, createdAt: at(2) },
    { id: ids.elite, workspaceId: ws, userId: maya.id, name: "Elite", botRole: "one_on_one", price: 25000, guaranteeCovered: true, createdAt: at(3) },
    { id: ids.luxe, workspaceId: ws, userId: maya.id, name: "Luxe", botRole: "one_on_one", price: 50000, guaranteeCovered: true, createdAt: at(4) },
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

    // ── The client's own "Your bot" page: Danno's data composes to the fixture, byte for byte. ──
    await signIn("client");
    await page.goto(`${base}/brain`);
    const preview = page.locator('[data-testid="bot-preview"]');
    await preview.waitFor({ timeout: 20000 });
    if ((await page.locator("h1").innerText()).trim() !== "Your bot") throw new Error("the page is called Your bot");
    const row = (field: string) => page.locator(`[data-testid="bot-field-row"][data-field="${field}"]`);
    const after = async (field: string) => (await row(field).locator('[data-testid="bot-field-after"]').textContent()) ?? "";
    // Each save starts from /brain with no "?saved" in the address, so the Saved banner can only be the page rendered after it:
    // wait for that before reading, or the old render's text is read (seen once, 24 Sep).
    const saveLines = async (mode: string) => {
      await page.goto(`${base}/brain`);
      await page.locator('[data-testid="bot-price-mode"]').selectOption(mode);
      await submit(page, '[data-testid="bot-lines-save"]');
      await page.locator('[data-testid="bot-lines-saved"]').waitFor({ timeout: 20000 });
      await preview.waitFor({ timeout: 20000 });
    };
    for (const f of ["ai_persona_role_cbf", PRODUCT_FIELD, "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3"]) {
      if ((await row(f).getAttribute("data-status")) !== "change") throw new Error(`${f} is a change`);
      if ((await after(f)) !== expected[f]) throw new Error(`${f} composes to the fixture byte for byte; got:\n${await after(f)}\n--- expected:\n${expected[f]}`);
    }
    const product = await after(PRODUCT_FIELD);
    if (/Epic Voice|4,997/.test(product) || (await page.locator(`[data-testid="bot-section"]`).evaluateAll((els) => els.map((e) => e.textContent ?? "").join(" "))).includes("Epic Voice")) throw new Error("a client offer with no bot role never appears");
    console.log(`✓ Danno's data composes to the fixture byte for byte (persona ${expected.ai_persona_role_cbf.length}, offers ${expected[PRODUCT_FIELD].length}, rules ${expected.ai_constraints_cbf.length}, questions); the live, priced offer with no role is absent`);

    // ── Needs your eyes: every price, term, link and guarantee line, one at a time; nothing in bulk; the Push shut until then. ──
    const eyes = async () => page.locator('[data-testid="eyes-row"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-key")}:${e.getAttribute("data-approved")}`));
    const keys = (await eyes()).map((k) => k.replace(/:(yes|no)$/, ""));
    const want = ["price.range", "price.plan", "guarantee.line", "guarantee.coverage", ...[ids.acc, ids.acad].flatMap((id) => [`offer:${id}.terms`, `offer:${id}.link`, `offer:${id}.refund`])];
    if (JSON.stringify(keys) !== JSON.stringify(want)) throw new Error(`the lines that need eyes, got ${keys.join(", ")}`);
    const eyesText = await page.locator('[data-testid="bot-eyes"]').innerText();
    if (!eyesText.includes(ENTRY_LINK) || !eyesText.includes(CORE_LINK) || !eyesText.includes("haven't doubled your investment in 12 months")) throw new Error("the guarantee line and both links are in Needs your eyes, word for word");
    if ((await page.locator('[data-testid="bot-eyes"] button').count()) !== want.length || (await page.locator('[data-testid="bot-eyes"] button:has-text("all")').count())) throw new Error("one Approve per line, and no approve-all");
    const pushButton = page.locator('[data-testid="push-stage1"]');
    if (!(await pushButton.isDisabled())) throw new Error("the Push is shut while any line is not approved");
    if ((await page.locator('[data-testid="bot-hold"]').count()) !== want.length) throw new Error("each unapproved line is named as a hold");
    console.log(`✓ Needs your eyes: ${want.length} lines (range, payment plan, guarantee, coverage, and each offer's terms, link and refund line), one Approve each, no bulk; the Push is shut`);

    // ── An entry offer with no payment link blocks the push: said on the page, and refused by the server if pressed anyway. ──
    await db.update(schema.offers).set({ paymentLink: null }).where(eq(schema.offers.id, ids.acc));
    await page.goto(`${base}/brain`);
    await preview.waitFor({ timeout: 20000 });
    const noLink = "Accelerator is an entry offer on your bot with no payment link. Add the link on the Offer, or change its role.";
    if (!(await page.locator('[data-testid="bot-hold"]').allInnerTexts()).map((h) => h.trim()).includes(noLink)) throw new Error("an entry offer with no link is named as a hold");
    if (!(await pushButton.isDisabled())) throw new Error("the Push is shut");
    const sentBefore = (await requests()).length;
    await pushButton.evaluate((b) => b.removeAttribute("disabled"));
    await Promise.all([page.waitForURL(/\?note=/, { timeout: 20000 }), pushButton.click()]);
    const note = (await page.locator('[data-testid="bot-push-note"]').innerText()).trim();
    if (!note.startsWith("Not sent.") || (await requests()).length !== sentBefore) throw new Error(`pressed anyway, the server sends nothing and says why, got "${note}"`);
    await db.update(schema.offers).set({ paymentLink: ENTRY_LINK }).where(eq(schema.offers.id, ids.acc));
    console.log(`✓ an entry offer with no link: "${noLink}"; pressed anyway, "${note.slice(0, 60)}…" and nothing sent`);

    // ── Price mode "never" still sends the old deflect line, and drops the range and plan lines from Needs your eyes. ──
    await saveLines("never");
    const never = await after(PRODUCT_FIELD);
    if (!never.includes(`PRICE\n${priceDeflection(null)}\n`) || never.includes("Some partners start at")) throw new Error(`price mode never sends the old deflect line, got:\n${never}`);
    if ((await eyes()).some((k) => k.startsWith("price."))) throw new Error("in never mode no price line needs eyes");
    await saveLines("range");
    if ((await after(PRODUCT_FIELD)) !== expected[PRODUCT_FIELD]) throw new Error(`back in range mode, the fixture again; got:\n${await after(PRODUCT_FIELD)}\nmode ${(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))?.priceMode}, url ${page.url()}`);
    console.log("✓ price mode never: the old deflect line, no range; back to range, the fixture again");

    // ── Approve each line, one press each. ──
    for (let i = 0; i < want.length; i++) {
      await submit(page, '[data-testid="eyes-row"][data-approved="no"] [data-testid="eyes-approve"]');
      await preview.waitFor({ timeout: 20000 });
      const approved = (await eyes()).filter((k) => k.endsWith(":yes")).length;
      if (approved !== i + 1) throw new Error(`one press approves one line, got ${approved} after ${i + 1}`);
    }
    if (await pushButton.isDisabled()) throw new Error("every line approved, the Push opens");
    if ((await page.locator('[data-testid="bot-hold"]').count())) throw new Error("no hold remains");
    const approvals = await db.query.botApprovals.findMany({ where: eq(schema.botApprovals.membershipId, membership.id) });
    if (approvals.length !== want.length || approvals.some((a) => a.approvedBy !== maya.id)) throw new Error("one approval row per line, naming who approved");

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

    // ── A changed line needs approving again, and the Push shuts until it is. ──
    await db.update(schema.memberships).set({ guaranteeLine: "Yes. If you do the work and haven't doubled your investment in 12 months, I keep working with you until you do." }).where(eq(schema.memberships.id, membership.id));
    await page.reload();
    await preview.waitFor({ timeout: 20000 });
    const again = await eyes();
    if (!again.includes("guarantee.line:no") || again.filter((k) => k.endsWith(":no")).length !== 1) throw new Error(`only the changed guarantee line needs approving again, got ${again.join(", ")}`);
    if (!(await pushButton.isDisabled())) throw new Error("the Push shuts until the changed line is approved");
    console.log("✓ a changed guarantee line needs approving again; the Push shuts until it is (the coach can approve and push for any client)");
  } finally {
    for (const id of Object.values(ids)) await db.delete(schema.offers).where(eq(schema.offers.id, id));
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
