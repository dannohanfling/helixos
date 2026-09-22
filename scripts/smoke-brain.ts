/**
 * The coach's brain, phase 1: the §4 steps against scripts/mock-uchat.ts, every expected value read from the record or the
 * fixture, never typed. A file in the template's format imports as N entries (N counted from the fixture); an answer mentioning
 * a price lands in "Needs your eyes" and is not bulk-accepted; approve three, send, read back (three present, the unapproved
 * fourth absent, both halves of the read-back on the record); edit one, send (the Brief shows exactly one change, the read-back
 * shows the new words); over the budget the lowest-ranked drop whole and are listed; and a push is refused, in plain words,
 * when the agent's prompt does not read the field, when the field is not on the bot at all, when it holds text HelixOS did not
 * write (until the coach waives it on the Coach page), and when the bot has more than one agent and none is chosen. The agent is
 * chosen by name and stored by ns, and the coach sets their own bot's token and agent under My bot on the Coach page. The dev
 * server runs with UCHAT_BASE_URL at the mock (dev-server.sh sets it).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4060;
const mock = `http://localhost:${mockPort}`;
const TOKEN = "uchat-test-token-for-maya-0123456789";
const COACH_TOKEN = "uchat-test-token-for-the-coach-9876543210";
const FIXTURE = join(__dirname, "fixtures", "knowledge-base.md");

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
const store = async () => (await (await fetch(`${mock}/__fields`)).json()) as Record<string, string>;
const seedAgents = (agents: unknown[]) => fetch(`${mock}/__agents`, { method: "POST", body: JSON.stringify({ agents }) });
const READS_FIELD = (field: string) => [{ ai_agent_ns: "f1a2b3", name: "Booking Agent", description: "Books calls.", prompts: [{ section: "Persona & Role", text: "You are {ai_persona_role_cbf}." }, { section: "Product & Service Information", text: `What we offer: {${field}}` }] }];
const READS_NOTHING = [{ ai_agent_ns: "f1a2b3", name: "Booking Agent", description: "Books calls.", prompts: [{ section: "Persona & Role", text: "You are {ai_persona_role_cbf}." }] }];
/** Danno's bot's real shape: the agent that answers reads the FAQ field, and the Booking Agent beside it does not. */
const TWO_AGENTS = (field: string) => [
  { ai_agent_ns: "faq01", name: "Community FAQ Agent", description: "Answers questions.", prompts: [{ section: "Product & Service Information", text: `Answer from this first: {${field}}` }] },
  { ai_agent_ns: "book1", name: "Booking Agent", description: "Books calls.", prompts: [{ section: "Product & Service Information", text: "Offers: {ai_product_&_service_information_cbf}" }] },
];

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, desc, ne } = await import("drizzle-orm");
  const { FAQ_BOT_FIELD_DEFAULT, FAQ_FIELD_BUDGET, composeField, countEntries, needsEyes, rankEntries } = await import("@/lib/engine/faq");
  const { isApprovedOrigin } = await import("@/lib/community-loyalty");
  const field = FAQ_BOT_FIELD_DEFAULT;

  const up = await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(mockPort)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${mock}/__reset`, { method: "POST" });
  // The bot's own field types; ai_faq_cbf is created on the bot by hand (text on Danno's, 22 Sep), never by this push.
  await fetch(`${mock}/__types`, { method: "POST", body: JSON.stringify({ [field]: "text" }) });
  await seedAgents(READS_FIELD(field));

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const own = () => db.query.faqEntries.findMany({ where: and(eq(schema.faqEntries.workspaceId, membership.workspaceId), eq(schema.faqEntries.userId, maya.id)) });
  const syncs = () => db.query.faqSyncs.findMany({ where: eq(schema.faqSyncs.userId, maya.id), orderBy: [desc(schema.faqSyncs.createdAt)] });
  // A known start: this walk's own rows only.
  await db.delete(schema.faqSyncs).where(eq(schema.faqSyncs.userId, maya.id));
  await db.delete(schema.faqEntries).where(eq(schema.faqEntries.userId, maya.id));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // The coach saves Maya's own Community Loyalty token (sealed), as the botfields walk does; the Brief needs it to send.
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/coach`);
    const row = page.locator('form:has(input[name="eoPassUrl"][value*="maya-torres"])').first();
    await row.waitFor({ timeout: 15000 });
    await row.locator('[data-testid="cl-api-token"]').fill(TOKEN);
    await submit(page, 'form:has(input[name="eoPassUrl"][value*="maya-torres"]) button:has-text("Save")');
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);

    // ── Step 1: a file in the template's format imports as N entries, N counted from the fixture. ──
    const fixtureText = readFileSync(FIXTURE, "utf8");
    const N = countEntries(fixtureText);
    if (N < 4) throw new Error(`the fixture carries at least four entries, counted ${N}`);
    await page.goto(`${base}/brain`);
    await page.locator('[data-testid="faq-import"]').waitFor({ timeout: 20000 });
    await page.setInputFiles('[data-testid="faq-file"]', FIXTURE);
    await Promise.all([page.waitForURL(/imported=\d+/), page.click('[data-testid="faq-import-send"]')]);
    if (!page.url().includes(`imported=${N}`)) throw new Error(`the import reports the fixture's count, expected ${N}, url ${page.url()}`);
    let rows = await own();
    if (rows.length !== N || rows.some((r) => r.origin !== "ai_unreviewed" || r.source !== "upload")) throw new Error(`${N} drafts from the upload, each ai_unreviewed: got ${rows.length}, origins ${[...new Set(rows.map((r) => r.origin))]}`);
    console.log(`✓ step 1: the fixture imports as ${N} entries, every one a draft`);

    // ── Step 2: the answer naming a price is pinned under Needs your eyes and is not bulk-accepted. ──
    const priced = rows.filter((r) => needsEyes(r));
    if (priced.length !== 1) throw new Error(`the fixture carries exactly one answer that needs eyes, found ${priced.length}`);
    const eyes = await page.locator('[data-testid="needs-eyes"] [data-testid="faq-question"]').allInnerTexts();
    if (eyes.length !== 1 || eyes[0].trim() !== priced[0].question) throw new Error(`the priced answer is pinned under Needs your eyes, got ${JSON.stringify(eyes)}`);
    if (await page.locator('[data-testid="needs-eyes"] [data-testid="accept-safe"]').count()) throw new Error("Needs your eyes carries no bulk accept");
    await submit(page, '[data-testid="accept-safe"]');
    rows = await own();
    const stillDraft = rows.filter((r) => r.origin === "ai_unreviewed");
    if (stillDraft.length !== 1 || stillDraft[0].id !== priced[0].id) throw new Error("bulk accept leaves exactly the priced answer unaccepted");
    if (rows.filter((r) => r.origin === "ai_accepted").length !== N - 1) throw new Error("bulk accept accepted every safe draft");
    if (!(await page.locator('[data-testid="needs-eyes"]').count())) throw new Error("the priced answer is still pinned after the bulk accept");
    console.log("✓ step 2: the priced answer sits in Needs your eyes; Accept all took the other three and left it");

    // ── The field is not on the bot yet: the Brief says so plainly and offers no send. The API sets a field by name; it does not create one. ──
    if (await page.locator('[data-testid="send-bot"]').count()) throw new Error("no send button while the FAQ field is not on the bot");
    const missing = await page.locator('[data-testid="brief-blocked"]').innerText();
    if (!/needs the FAQ field added once/.test(missing) || !missing.includes(field)) throw new Error(`the Brief names the field to create, got "${missing}"`);
    console.log(`✓ the FAQ field is not on the bot: "${missing.slice(0, 60)}…" and nothing is sent`);
    // The coach (or Claude) creates it once on the bot, empty. Here the mock stands in for that one manual step.
    await fetch(`${mock}/__seed`, { method: "POST", body: JSON.stringify({ [field]: "" }) });
    await page.goto(`${base}/brain`);

    // ── Step 3: approve three, send, read back: three present, the unapproved fourth absent, both halves on the record. ──
    await page.locator('[data-testid="send-bot"]').waitFor({ timeout: 10000 });
    // The agent's prompt carries the field the way Community Loyalty's editor stores it: a chip holding the field's variable id,
    // the name only as its label. No brace form anywhere, so the send below goes only because the check reads the id.
    const served = JSON.stringify(await (await fetch(`${mock}/flow/ai-agent-info`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ ai_agent_ns: READS_FIELD(field)[0].ai_agent_ns }) })).json());
    const fieldNs = ((await (await fetch(`${mock}/flow/bot-fields?limit=100&page=1`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as { data: { name: string; var_ns: string }[] }).data.find((f) => f.name === field)?.var_ns;
    if (!fieldNs || !served.includes(`data-var-id=\\"${fieldNs}\\"`) || served.includes(`{${field}}`)) throw new Error(`the mock serves the field as a chip by its id, never in braces: ns ${fieldNs}, ${served.slice(0, 300)}`);
    if (!(await page.locator('[data-testid="agent-reads"]').innerText()).includes(field)) throw new Error("the Brief reads the chip: Your bot reads names the FAQ field");
    // A text field is the only type Community Loyalty offers: no warning asking for another; the budget line carries the cap.
    if (await page.locator('[data-testid="brief-warning"]').count()) throw new Error(`no warning about the field's type, got "${await page.locator('[data-testid="brief-warning"]').innerText()}"`);
    if (!/Budget 20,000 characters/.test(await page.locator('[data-testid="brief-budget"]').innerText())) throw new Error("the budget line names the platform's 20,000 cap");
    console.log(`✓ the agent reads ${field} through its chip (id ${fieldNs}, no brace form in the prompt); no type warning, the 20,000 budget stated`);
    await Promise.all([page.waitForURL(/sent=1|error=/), page.click('[data-testid="send-bot"]')]);
    if (!page.url().includes("sent=1")) throw new Error(`the send is accepted and read back, got ${decodeURIComponent(page.url())}`);
    const approved = rows.filter((r) => isApprovedOrigin(r.origin));
    const expected = composeField(rankEntries(approved)).text;
    let held = (await store())[field];
    if (held !== expected) throw new Error(`the bot holds exactly the composed approved answers:\n${held}\n---\n${expected}`);
    if (held.includes(priced[0].question)) throw new Error("the unapproved fourth is absent from the bot");
    for (const a of approved) if (!held.includes(a.question)) throw new Error(`approved "${a.question}" is present in the bot`);
    let sync = (await syncs())[0];
    if (sync.status !== "sent" || !sync.valueReadBack || !sync.tokenReadBack || sync.entryCount !== approved.length || sync.fieldName !== field || sync.budget !== FAQ_FIELD_BUDGET) throw new Error(`the sync is recorded sent with both halves read back: ${JSON.stringify([sync.status, sync.valueReadBack, sync.tokenReadBack, sync.entryCount, sync.fieldName, sync.budget])}`);
    console.log(`✓ step 3: three approved answers sent to ${field}; read back matched on value and token; the fourth is absent`);

    // ── Step 4: edit one, send: the Brief shows exactly one change, and the read-back shows the new words. ──
    const target = approved[0];
    const newWords = "We meet every Monday morning and talk through the week ahead together.";
    const card = page.locator(`#faq-${target.id}`);
    await card.locator("summary").click();
    await card.locator('[data-testid="faq-edit-answer"]').fill(newWords);
    await Promise.all([page.waitForURL(new RegExp(`#faq-${target.id}`)), card.locator('[data-testid="faq-edit-save"]').click()]);
    await page.goto(`${base}/brain`);
    await page.locator('[data-testid="brief-changes"]').waitFor({ timeout: 15000 });
    const edited = await page.locator('[data-testid="changed-edited"]').allInnerTexts();
    if (edited.length !== 1 || edited[0].trim() !== target.question || (await page.locator('[data-testid="changed-added"]').count()) || (await page.locator('[data-testid="changed-removed"]').count())) throw new Error(`the Brief shows exactly one change, the edited one, got edited=${JSON.stringify(edited)}`);
    const editedRow = (await own()).find((r) => r.id === target.id)!;
    if (editedRow.origin !== "edited") throw new Error("an edit is a review: origin edited");
    await Promise.all([page.waitForURL(/sent=1|error=/), page.click('[data-testid="send-bot"]')]);
    if (!page.url().includes("sent=1")) throw new Error(`the second send is accepted, got ${decodeURIComponent(page.url())}`);
    held = (await store())[field];
    if (!held.includes(newWords)) throw new Error("the read-back shows the new words");
    if ((await syncs()).length !== 2) throw new Error("two syncs on the record");
    console.log("✓ step 4: one edit shows as exactly one change; the bot reads back the new words");

    // ── Step 5: over the budget, the lowest-ranked drop whole and are listed. ──
    const filler = "Every week we meet and talk through what moved and what did not, then we set the next small step together. ";
    const longAnswer = filler.repeat(9); // ~900 characters, no digit and no price word: safe to bulk-accept
    const many = Array.from({ length: 30 }, (_, i) => `### Q: A longer question about the weekly rhythm, part ${["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][i % 10]} of ${["alpha", "beta", "gamma"][Math.floor(i / 10)]}\n**Answer:** ${longAnswer}\n**Category:** Process`).join("\n\n");
    if (many.length <= FAQ_FIELD_BUDGET) throw new Error("the walk's over-budget text is over the budget");
    await page.fill('[data-testid="faq-text"]', many);
    await Promise.all([page.waitForURL(/imported=30/), page.click('[data-testid="faq-import-send"]')]);
    await submit(page, '[data-testid="accept-safe"]');
    rows = await own();
    const allApproved = rows.filter((r) => isApprovedOrigin(r.origin));
    const composedNow = composeField(rankEntries(allApproved));
    if (!composedNow.dropped.length) throw new Error("the approved set now exceeds the budget");
    await page.goto(`${base}/brain`);
    const droppedText = await page.locator('[data-testid="brief-dropped"]').innerText();
    if (!droppedText.includes(`${composedNow.dropped.length} over the budget`)) throw new Error(`the Brief counts the dropped, got "${droppedText.slice(0, 80)}"`);
    for (const d of composedNow.dropped) if (!droppedText.includes(d.question)) throw new Error(`a dropped entry is listed by name: ${d.question}`);
    await Promise.all([page.waitForURL(/sent=1|error=/), page.click('[data-testid="send-bot"]')]);
    if (!page.url().includes("sent=1")) throw new Error(`the over-budget send goes with the drop, got ${decodeURIComponent(page.url())}`);
    held = (await store())[field];
    if (held.length > FAQ_FIELD_BUDGET || held !== composedNow.text) throw new Error(`the bot holds whole entries under the budget: ${held.length} chars`);
    sync = (await syncs())[0];
    if (sync.dropped.length !== composedNow.dropped.length || sync.dropped.join() !== composedNow.dropped.map((d) => d.question).join()) throw new Error("the sync records the dropped questions, lowest-ranked first");
    // The rank: no Times Asked, so recency; the dropped are the oldest of the ranked list, never a newer one.
    const ranked = rankEntries(allApproved);
    const tail = ranked.slice(ranked.length - composedNow.dropped.length).map((r) => r.question).join();
    if (tail !== sync.dropped.join()) throw new Error("the dropped entries are exactly the lowest-ranked");
    console.log(`✓ step 5: over the budget, ${sync.dropped.length} lowest-ranked entries dropped whole and listed; the bot holds ${held.length} of ${FAQ_FIELD_BUDGET} characters`);

    // ── Push only what the agent reads: with the token gone from the agent's prompt, the Brief warns and nothing is sent. ──
    await seedAgents(READS_NOTHING);
    await page.goto(`${base}/brain`);
    await page.locator('[data-testid="agent-not-read"]').waitFor({ timeout: 15000 });
    if (!/does not use/.test(await page.locator('[data-testid="agent-not-read"]').innerText())) throw new Error("the plain warning names the unread field");
    if (await page.locator('[data-testid="send-bot"]').count()) throw new Error("no send button while the agent does not read the field");
    await seedAgents(READS_FIELD(field));
    await page.goto(`${base}/brain`);
    await page.locator('[data-testid="send-bot"]').waitFor({ timeout: 15000 });
    console.log("✓ push only what the agent reads: an agent that does not read the field gets the warning and no send");

    // ── The field holds text HelixOS did not write: refused until the coach waives it on the Coach page. ──
    const foreign = "The coach typed this into the field by hand and it must not be erased.";
    await fetch(`${mock}/__seed`, { method: "POST", body: JSON.stringify({ [field]: foreign }) });
    await page.goto(`${base}/brain`);
    const blockedForeign = await page.locator('[data-testid="brief-blocked"]').innerText();
    if (!/already holds text HelixOS did not write/.test(blockedForeign)) throw new Error(`the Brief refuses a field holding someone else's text, got "${blockedForeign}"`);
    if (await page.locator('[data-testid="send-bot"]').count()) throw new Error("no send button while the field holds foreign text");
    if ((await store())[field] !== foreign) throw new Error("the coach's own text is still in the field, untouched");
    console.log("✓ a field holding text HelixOS did not write refuses the send, and the text is left alone");
    // The coach ticks the override on the Coach page, with the warning beside it, and the send goes.
    const clientPage = page;
    const coachPage = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    await coachPage.goto(`${base}/login`);
    await coachPage.click('button:has-text("As the coach")');
    await coachPage.waitForURL(/\/today/);
    await coachPage.goto(`${base}/coach`);
    const mayaForm = 'form:has(input[name="eoPassUrl"][value*="maya-torres"])';
    await coachPage.locator(`${mayaForm} [data-testid="faq-overwrite-ok"]`).check();
    await submit(coachPage, `${mayaForm} button:has-text("Save")`);
    if (!(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.faqOverwriteOk) throw new Error("the override is on the record");
    await clientPage.goto(`${base}/brain`);
    await clientPage.locator('[data-testid="send-bot"]').waitFor({ timeout: 15000 });
    if (!/override is on, so sending will replace it/.test(await clientPage.locator('[data-testid="brief-warning"]').innerText())) throw new Error("the override says plainly what it will do");
    await Promise.all([clientPage.waitForURL(/sent=1|error=/), clientPage.click('[data-testid="send-bot"]')]);
    if (!clientPage.url().includes("sent=1")) throw new Error(`with the override on, the send goes, got ${decodeURIComponent(clientPage.url())}`);
    if ((await store())[field] === foreign) throw new Error("with the override on, the push replaced the field");
    console.log("✓ the coach's override on the Coach page lets the send replace the field, and says so first");

    // ── More than one agent and none chosen: the Brief asks, and sends nothing. ──
    await seedAgents(TWO_AGENTS(field));
    await clientPage.goto(`${base}/brain`);
    const ask = await clientPage.locator('[data-testid="brief-blocked"]').innerText();
    if (!/2 agents \(Community FAQ Agent, Booking Agent\)/.test(ask) || !/Choose the one that answers/.test(ask)) throw new Error(`the Brief asks which agent answers, got "${ask}"`);
    if (await clientPage.locator('[data-testid="send-bot"]').count()) throw new Error("no send button while the agent is not chosen");
    // The coach chooses the agent that answers, by name: no coach knows an ai_agent_ns. The name is shown, the ns is stored.
    await coachPage.goto(`${base}/coach`);
    const named = await coachPage.locator(`${mayaForm} [data-testid="cl-agent-ns"] option`).allTextContents();
    for (const a of TWO_AGENTS(field)) if (!named.some((o) => o.trim() === a.name)) throw new Error(`the chooser lists every agent on the bot by name, missing ${a.name}, got ${JSON.stringify(named)}`);
    await coachPage.selectOption(`${mayaForm} [data-testid="cl-agent-ns"]`, { label: "Community FAQ Agent" });
    await submit(coachPage, `${mayaForm} button:has-text("Save")`);
    const chosen = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!.clAgentNs;
    if (chosen !== TWO_AGENTS(field)[0].ai_agent_ns) throw new Error(`the name the coach picked stores that agent's ns, got ${chosen}`);
    await clientPage.goto(`${base}/brain`);
    await clientPage.locator('[data-testid="send-bot"]').waitFor({ timeout: 15000 });
    if (!/Community FAQ Agent/.test(await clientPage.locator('[data-testid="brief-budget"]').innerText())) throw new Error("the Brief names the chosen agent");
    console.log("✓ two agents and none chosen: the Brief asks and sends nothing; once chosen it is the agent that answers");

    // ── The coach's own bot: a coach is a member too, and sets their own token under My bot rather than asking their coach. ──
    const coachMembership = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, membership.workspaceId), eq(schema.memberships.role, "coach")) }))!;
    await db.update(schema.memberships).set({ clApiToken: null, clAgentNs: null }).where(eq(schema.memberships.id, coachMembership.id));
    await coachPage.goto(`${base}/brain`);
    const noToken = await coachPage.locator('[data-testid="no-token"]').innerText();
    if (!/Add it yourself under My bot/.test(noToken)) throw new Error(`a coach's own Brief points at My bot, not at their coach, got "${noToken}"`);
    await coachPage.goto(`${base}/coach`);
    await coachPage.locator('[data-testid="my-cl-api-token"]').fill(COACH_TOKEN);
    await submit(coachPage, '[data-testid="my-bot"] button:has-text("Save")');
    const mineNow = () => db.query.memberships.findFirst({ where: eq(schema.memberships.id, coachMembership.id) });
    const sealed = (await mineNow())!.clApiToken;
    if (!sealed || sealed.includes(COACH_TOKEN)) throw new Error("the coach's own token is stored, and stored sealed");
    // With a token saved the agents are read with it, so the coach picks their own by name too.
    await coachPage.goto(`${base}/coach`);
    await coachPage.selectOption('[data-testid="my-cl-agent-ns"]', { label: "Community FAQ Agent" });
    await submit(coachPage, '[data-testid="my-bot"] button:has-text("Save")');
    if ((await mineNow())!.clAgentNs !== TWO_AGENTS(field)[0].ai_agent_ns) throw new Error("the coach's own agent is stored by ns from the name they picked");
    await coachPage.goto(`${base}/brain`);
    if (await coachPage.locator('[data-testid="no-token"]').count()) throw new Error("the coach's Brief has a token of its own now");
    if (!/Community FAQ Agent/.test(await coachPage.locator('[data-testid="brief-budget"]').innerText())) throw new Error("the coach's own Brief names their own bot's agent");
    console.log("✓ the coach sets their own token and agent under My bot, and their own Brief stops asking their coach for it");
    // The raw prompt, one log line, so the serialisation a chip takes is on the record rather than inferred.
    const devLog = readFileSync(join(__dirname, "..", "screenshots", "logs", "dev.log"), "utf8");
    const logLine = devLog.split("\n").reverse().find((l) => l.includes("[faq.agent-reads]") && l.includes(`"fieldNs":"${fieldNs}"`));
    if (!logLine || !logLine.includes("data-var-id") || logLine.includes(TOKEN) || logLine.includes(COACH_TOKEN)) throw new Error(`the raw prompt is logged in one line, with the field's id and never a token: ${logLine?.slice(0, 200)}`);
    console.log("✓ one log line carries the agent's raw prompt as the API returned it, with the field's id, and no token");
    // The agent list is cached a minute per bot: two more renders of the Coach page (Maya's bot and the coach's own) read it
    // no more times. The first render refills anything the walk's pace let expire.
    const listReads = async () => ((await (await fetch(`${mock}/__agent-list-reads`)).json()) as { reads: number }).reads;
    await coachPage.goto(`${base}/coach`);
    const before = await listReads();
    for (let i = 0; i < 2; i++) await coachPage.goto(`${base}/coach`);
    if ((await listReads()) !== before) throw new Error(`the agent list is cached for a minute per bot: ${before} reads before two renders, ${await listReads()} after`);
    console.log("✓ the agent list is cached a minute per bot: two Coach page renders read it no more times");
    await coachPage.close();

    // ── Removing every answer empties the field on the bot: an answer the coach took back must stop being answered from. ──
    const keep = (await own()).find((r) => isApprovedOrigin(r.origin))!;
    await db.delete(schema.faqEntries).where(and(eq(schema.faqEntries.userId, maya.id), ne(schema.faqEntries.id, keep.id)));
    await clientPage.goto(`${base}/brain`);
    await clientPage.locator(`#faq-${keep.id} [data-testid="faq-remove"]`).click();
    if (!/Remove this answer\?/.test(await clientPage.locator('dialog[open] [data-testid="confirm-delete-question"]').innerText())) throw new Error("removing an answer asks first");
    await clientPage.locator('dialog[open] [data-testid="confirm-delete-yes"]').click();
    await clientPage.waitForLoadState("networkidle");
    await clientPage.goto(`${base}/brain`);
    if ((await own()).length !== 0) throw new Error("the last answer is removed through the Brief");
    if (!/removed every answer/.test(await clientPage.locator('[data-testid="brief-will-empty"]').innerText())) throw new Error("the Brief says that sending now empties the field");
    await clientPage.locator('[data-testid="send-bot"]').waitFor({ timeout: 15000 });
    const readsBeforeSend = ((await (await fetch(`${mock}/__agent-list-reads`)).json()) as { reads: number }).reads;
    await Promise.all([clientPage.waitForURL(/sent=1|error=/), clientPage.click('[data-testid="send-bot"]')]);
    if (!clientPage.url().includes("sent=1")) throw new Error(`emptying the field is a send, got ${decodeURIComponent(clientPage.url())}`);
    // The check before a push and the read-back after it read live, never the cached list.
    if (((await (await fetch(`${mock}/__agent-list-reads`)).json()) as { reads: number }).reads < readsBeforeSend + 2) throw new Error("the pre-push check and the read-back each read the agent list live");
    if ((await store())[field] !== "") throw new Error(`the field reads back empty of every removed answer, got ${JSON.stringify((await store())[field]).slice(0, 80)}`);
    const emptySync = (await syncs())[0];
    if (emptySync.status !== "sent" || emptySync.entryCount !== 0 || !emptySync.valueReadBack) throw new Error("the emptying send is recorded, read back, with no entries");
    console.log("✓ removing every answer empties the bot's FAQ field, read back empty, and the sync records it");

    // ── The log: every approval and every send, with who and when. ──
    const events = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.userId, maya.id)) });
    const accepts = events.filter((e) => e.event === "faq.accept").length;
    const pushes = events.filter((e) => e.event === "faq.push" && e.status === "sent").length;
    if (accepts < N - 1 + 30 || pushes !== 5) throw new Error(`the log holds every approval and send, got ${accepts} accepts, ${pushes} sends`);
    if (JSON.stringify(events).includes(TOKEN)) throw new Error("the token is never in the log");
    if (!(await page.locator('[data-testid="faq-log"] li[data-event="faq.accept"]').count()) || !(await page.locator('[data-testid="sync-log"] li[data-status="sent"]').count())) throw new Error("the Brief shows the approval log and the sync log");
    console.log(`✓ the log: ${accepts} approvals and ${pushes} sends, who and when, never the token`);

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Brain walk passed.");
  } finally {
    await browser.close();
    if (proc?.pid) try { process.kill(-proc.pid); } catch { /* already gone */ }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
