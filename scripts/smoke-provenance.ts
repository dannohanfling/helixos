/**
 * The provenance mark on AI drafts, walked on the four store-on-return paths: a webinar section, a lead magnet, a doctrine post
 * and group variants. Each is drafted by the model (scripts/mock-ai.ts) and read off the record as ai_unreviewed with the
 * "AI draft, not reviewed" label and a per-item Accept beside it; each action that sends content out (deck export, magnet
 * publish, post status, the composer's schedule, one-click distribute, a variant's status) names the drafts and offers Review
 * or Continue anyway; Continue anyway is read back off the review_confirms table with who and when; an edit or an Accept
 * clears the line. Every expected string is read from the engine or the record, never typed here. The dev server must be
 * started with AI_BASE_URL=http://localhost:4020 (scripts/dev-server.sh sets it).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "hidden", timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
async function submit(page: Page, selector: string) {
  if (!(await page.locator(selector).count())) {
    await page.screenshot({ path: `screenshots/fail-no-${selector.replace(/\W+/g, "-").slice(0, 60)}.png`, fullPage: true });
    throw new Error(`nothing matches ${selector} on ${page.url()}`);
  }
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
/** Fill after hydration and check the value took: a fill that lands mid-hydration inserts at the caret instead of replacing. */
async function fillField(page: Page, selector: string, value: string) {
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`${selector} did not take the value typed into it`);
}
/** A request with no cookie at all: what a reader who has never seen HelixOS sends. */
const anon = (url: string) => fetch(url, { redirect: "manual" });

/** The gate as rendered: its line, the names under it, and that both choices are offered. */
async function readGate(page: Page, label: string) {
  const gate = page.locator('[data-testid="review-gate"]');
  await gate.first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] no gate on ${page.url()}`);
  });
  if ((await gate.count()) !== 1) throw new Error(`[${label}] one gate, got ${await gate.count()}`);
  const line = (await page.locator('[data-testid="review-gate-line"]').innerText()).trim();
  const items = (await page.locator('[data-testid="review-gate-items"] li').allInnerTexts()).map((t) => t.trim());
  if (!(await page.locator('[data-testid="review-gate-review"]').count()) || !(await page.locator('[data-testid="review-gate-continue"]').count())) throw new Error(`[${label}] the gate offers Review and Continue anyway`);
  return { line, items };
}
async function noGate(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  if (await page.locator('[data-testid="review-gate"]').count()) throw new Error(`[${label}] a gate is showing on ${page.url()}: "${await page.locator('[data-testid="review-gate-line"]').innerText()}"`);
}
/** The label beside the draft, and exactly one Accept for it. */
async function readMark(page: Page, label: string, expectedLabel: string) {
  const marks = page.locator('[data-testid="ai-unreviewed"]');
  if (!(await marks.count())) throw new Error(`[${label}] no "AI draft, not reviewed" mark on ${page.url()}`);
  const text = (await marks.first().innerText()).trim();
  if (!text.includes(expectedLabel)) throw new Error(`[${label}] the mark reads "${text}", not the ruling's label`);
  if ((await marks.first().locator('[data-testid="ai-accept"]').count()) !== 1) throw new Error(`[${label}] one Accept beside the mark`);
  return marks.count();
}

async function main() {
  const ai = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const { db, schema } = await import("@/db");
    const { and, eq, desc } = await import("drizzle-orm");
    const { UNREVIEWED_LABEL, gateLine, sectionGate, unreviewedCountLine } = await import("@/lib/engine/provenance");
    const { SECTION_TEMPLATES } = await import("@/lib/engine/webinar");
    const { ORIGINS } = await import("@/db/schema");

    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const confirms = async () => db.query.reviewConfirms.findMany({ where: eq(schema.reviewConfirms.userId, user.id), orderBy: desc(schema.reviewConfirms.createdAt) });
    if ((await confirms()).length) throw new Error("the reseed leaves no confirms behind");
    // Nothing on the record is marked before this walk drafts anything: the seed's rows stay null, never guessed, never flagged.
    const seededSections = await db.query.webinarSections.findMany();
    const seededItems = await db.query.contentItems.findMany();
    if (!seededSections.length || !seededItems.length) throw new Error("the seed has sections and posts to read");
    if (seededSections.some((s) => s.origin !== null) || seededItems.some((i) => i.origin !== null)) throw new Error("rows from before the mark are null");
    if (!(ORIGINS as readonly string[]).includes("ai_unreviewed")) throw new Error("the schema names the unreviewed state");
    console.log(`✓ before: ${seededSections.length} seeded sections and ${seededItems.length} seeded posts carry no mark; no confirms`);

    // The key the ✨ actions run on, against the mock
    await page.goto(`${base}/settings`);
    await page.selectOption('select[name="provider"]', "anthropic");
    await page.fill('input[name="key"]', "sk-ant-good");
    await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');

    /* ── 1. A webinar section: draft, export names it; edit, the line is gone; a confirm covers only what it named ── */
    await page.goto(`${base}/webinars`);
    await page.click('a:has-text("Eat Like a Grown-Up")');
    await page.waitForURL(/\/webinars\//);
    const wizardBase = page.url().split("?")[0];
    const webinarId = wizardBase.split("/webinars/")[1];
    const sectionRows = () => db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, webinarId) });
    // Clean to begin with: the seed exports, no gate, the files offered
    await page.goto(`${wizardBase}?step=deck`);
    await noGate(page, "deck before drafting");
    if (!(await page.locator('[data-testid="deck-pptx"]').count())) throw new Error("the seeded deck offers its files");
    // Draft the first section the seed left to do (its key from the wizard's own definition, its name from the record)
    const todo = (await sectionRows()).filter((s) => s.status === "todo").sort((a, b) => a.order - b.order);
    if (todo.length < 2) throw new Error("the seed leaves at least two sections to draft");
    const first = todo[0];
    if (!SECTION_TEMPLATES.some((t) => t.key === first.sectionKey)) throw new Error("the section is one of the template's");
    await page.goto(`${wizardBase}?step=script&section=${first.sectionKey}`);
    await submit(page, 'button:has-text("Draft this section for me")');
    await page.waitForURL((u) => u.search.includes(`section=${first.sectionKey}`) && !u.search.includes("example=1"));
    const drafted = (await sectionRows()).find((s) => s.sectionKey === first.sectionKey)!;
    if (drafted.origin !== "ai_unreviewed" || !drafted.script || drafted.status !== "drafted") throw new Error(`the model's script is stored as ai_unreviewed, got origin ${drafted.origin}, status ${drafted.status}`);
    if ((await page.locator('textarea[name="script"]').inputValue()) !== drafted.script) throw new Error("the editor shows the stored draft");
    await readMark(page, "section mark", UNREVIEWED_LABEL);
    console.log(`✓ webinar: "${drafted.name}" drafted by the model is ai_unreviewed on the record and labelled in the editor with one Accept`);
    // The run sheet, read aloud to a live room, marks the section and counts at the top; a page, so it gates nothing and offers no confirm.
    await page.goto(`${wizardBase}/runsheet`);
    await page.locator('[data-testid="run-sheet"]').waitFor({ timeout: 20000 });
    const sheetMarks = page.locator('[data-testid="runsheet-unreviewed"]');
    if ((await sheetMarks.count()) !== 1 || !(await sheetMarks.first().innerText()).includes(UNREVIEWED_LABEL)) throw new Error(`the run sheet marks the one unread script, got ${await sheetMarks.count()}`);
    if ((await page.locator(`[data-testid="runsheet-section"][data-key="${first.sectionKey}"] [data-testid="runsheet-unreviewed"]`).count()) !== 1) throw new Error("the mark sits on the drafted section");
    const sheetCount = (await page.locator('[data-testid="runsheet-unreviewed-count"]').innerText()).trim();
    if (sheetCount !== `${unreviewedCountLine([drafted.name])}.`) throw new Error(`the count at the top is the engine's line naming the section: "${sheetCount}"`);
    if (await page.locator('[data-testid="review-gate"], [data-testid="review-gate-continue"]').count()) throw new Error("the run sheet is a page: no gate, no confirm");
    console.log(`✓ run sheet: "${sheetCount}" at the top and the mark on ${drafted.name}; no gate`);
    // Export: the line names it, the files are not offered, the route refuses with the same names
    await page.goto(`${wizardBase}?step=deck`);
    const g1 = await readGate(page, "deck gate");
    const expected1 = sectionGate(await sectionRows())!;
    if (g1.line !== expected1.line || g1.line !== gateLine(1)) throw new Error(`the line is the engine's: "${g1.line}" vs "${expected1.line}"`);
    if (g1.items.length !== 1 || g1.items[0] !== drafted.name) throw new Error(`the line names the section: ${JSON.stringify(g1.items)}`);
    if (await page.locator('[data-testid="deck-pptx"], [data-testid="deck-txt"]').count()) throw new Error("no file is offered past an unread draft");
    const deckHref = `/api/webinars/${webinarId}/deck?format=pptx`;
    const refused = await page.request.get(`${base}${deckHref}`);
    const refusedBody = (await refused.json()) as { unreviewed?: string[]; line?: string };
    if (refused.status() !== 409 || JSON.stringify(refusedBody.unreviewed) !== JSON.stringify([drafted.name]) || refusedBody.line !== g1.line) throw new Error(`the route refuses with the same names: ${refused.status()} ${JSON.stringify(refusedBody)}`);
    console.log(`✓ export: "${g1.line}" naming ${g1.items[0]}; no file offered; the route answers 409 with the same name`);
    // Continue anyway: logged with who and when, the files offered under that confirm, the route serves under it and not without it
    await submit(page, '[data-testid="review-gate-continue"]');
    await page.waitForURL(/confirmed=/);
    await noGate(page, "after continue");
    const c1 = (await confirms())[0];
    if (!c1 || c1.surface !== "deck_export" || c1.subjectId !== webinarId || JSON.stringify(c1.items) !== JSON.stringify([drafted.name]) || c1.userName !== user.name || !c1.createdAt) throw new Error(`the confirm carries who, when, what: ${JSON.stringify(c1)}`);
    const confirmedNote = await page.locator('[data-testid="deck-confirmed"]').innerText();
    if (!confirmedNote.includes(drafted.name) || !confirmedNote.includes(user.name)) throw new Error(`the deck step says who continued past which draft: "${confirmedNote}"`);
    const pptxHref = await page.locator('[data-testid="deck-pptx"]').getAttribute("href");
    if (!pptxHref?.includes(`confirmed=${c1.id}`)) throw new Error(`the file is offered under the confirm: ${pptxHref}`);
    const served = await page.request.get(`${base}${pptxHref}`);
    if (served.status() !== 200 || !(served.headers()["content-type"] ?? "").includes("presentationml")) throw new Error(`the route serves under the confirm: ${served.status()}`);
    if ((await page.request.get(`${base}${deckHref}`)).status() !== 409) throw new Error("without the confirm the route still refuses");
    console.log(`✓ continue anyway: logged for ${c1.userName} at ${c1.createdAt}; the .pptx is served under the confirm and refused without it`);
    // Edit it: the edit is the review; the line is gone from the step and the route
    await page.goto(`${wizardBase}?step=script&section=${first.sectionKey}`);
    await fillField(page, 'textarea[name="script"]', "Here is the plan in my own words. Three swaps, one week, no wine given up.");
    await submit(page, 'button[type="submit"]:has-text("Save")');
    const edited = (await sectionRows()).find((s) => s.sectionKey === first.sectionKey)!;
    if (edited.origin !== "edited" || !edited.script?.startsWith("Here is the plan")) throw new Error(`an edit reviews the draft: origin ${edited.origin}`);
    await page.goto(`${wizardBase}?step=script&section=${first.sectionKey}`);
    if (await page.locator('[data-testid="ai-unreviewed"]').count()) throw new Error("the label goes with the edit");
    await page.goto(`${wizardBase}/runsheet`);
    await page.locator('[data-testid="run-sheet"]').waitFor({ timeout: 20000 });
    if (await page.locator('[data-testid="runsheet-unreviewed"], [data-testid="runsheet-unreviewed-count"]').count()) throw new Error("the run sheet's mark and count go with the edit");
    await page.goto(`${wizardBase}?step=deck`);
    await noGate(page, "deck after edit");
    if (!(await page.locator('[data-testid="deck-pptx"]').count()) || (await page.locator('[data-testid="deck-pptx"]').getAttribute("href"))?.includes("confirmed")) throw new Error("the files are offered plainly once every draft is reviewed");
    if ((await page.request.get(`${base}${deckHref}`)).status() !== 200) throw new Error("the route serves a reviewed deck without a confirm");
    console.log("✓ edit: origin edited, the label and the line are gone, the route serves without a confirm");
    // A second draft: the old confirm does not cover it, on the step or at the route; Accept clears it, one section per click
    const second = todo[1];
    await page.goto(`${wizardBase}?step=script&section=${second.sectionKey}`);
    await submit(page, 'button:has-text("Draft this section for me")');
    await page.waitForURL((u) => u.search.includes(`section=${second.sectionKey}`) && !u.search.includes("example=1"));
    await page.goto(`${wizardBase}?step=deck&confirmed=${c1.id}`);
    const g2 = await readGate(page, "deck gate, stale confirm");
    if (g2.items[0] !== second.name) throw new Error(`the old confirm covers only what it named; the new draft is gated: ${JSON.stringify(g2.items)}`);
    if ((await page.request.get(`${base}${deckHref}&confirmed=${c1.id}`)).status() !== 409) throw new Error("the route refuses the old confirm for a draft it did not name");
    await page.goto(`${wizardBase}?step=script&section=${second.sectionKey}`);
    if ((await page.locator('[data-testid="ai-accept"]').count()) !== 1) throw new Error("one Accept, for this section");
    await submit(page, '[data-testid="ai-accept"]');
    const accepted = (await sectionRows()).find((s) => s.sectionKey === second.sectionKey)!;
    if (accepted.origin !== "ai_accepted" || accepted.script !== (await sectionRows()).find((s) => s.sectionKey === second.sectionKey)!.script) throw new Error(`Accept marks the section accepted and changes no words: ${accepted.origin}`);
    await page.goto(`${wizardBase}?step=deck`);
    await noGate(page, "deck after accept");
    if ((await page.request.get(`${base}${deckHref}`)).status() !== 200) throw new Error("an accepted deck exports plainly");
    console.log(`✓ a second draft ("${second.name}") is gated on its own; the old confirm does not cover it; Accept clears it without touching a word`);

    /* ── 2. A lead magnet: draft and publish, the line appears; accept and publish again, nothing appears; the public page shows nothing ── */
    await page.goto(`${base}/magnets`);
    await page.selectOption('[data-testid="new-magnet"] select[name="type"]', "checklist");
    await fillField(page, '[data-testid="new-magnet"] input[name="title"]', "Three Swaps Checklist");
    await fillField(page, '[data-testid="new-magnet"] input[name="promise"]', "Three swaps that take the first five pounds off.");
    await fillField(page, '[data-testid="new-magnet"] input[name="keyword"]', "swaps");
    await submit(page, '[data-testid="new-magnet"] button[type="submit"]');
    await page.waitForURL(/\/magnets\/[a-z0-9-]+$/i);
    const magnetId = page.url().split("/").pop()!;
    const magnet = async () => (await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, magnetId) }))!;
    if ((await magnet()).origin !== "rule" || (await magnet()).publishedAt !== null) throw new Error(`a new magnet is the type's scaffold, rule-composed and unpublished: origin ${(await magnet()).origin}`);
    if (await page.locator('[data-testid="ai-unreviewed"]').count()) throw new Error("a scaffold is not an AI draft");
    await submit(page, '[data-testid="magnet-generate"]');
    await page.waitForURL(/stripped=1/);
    const m1 = await magnet();
    if (m1.origin !== "ai_unreviewed" || m1.generatedBy !== "claude") throw new Error(`the model's magnet is ai_unreviewed: ${m1.origin}`);
    await readMark(page, "magnet mark", UNREVIEWED_LABEL);
    const slugUrl = `${base}/m/${m1.slug}`;
    if ((await anon(slugUrl)).status !== 404) throw new Error("before publish the hosted page is a 404");
    await submit(page, '[data-testid="magnet-publish"]');
    await page.waitForURL(/gate=publish/);
    const g3 = await readGate(page, "publish gate");
    if (g3.line !== gateLine(1) || JSON.stringify(g3.items) !== JSON.stringify([m1.title])) throw new Error(`publish names the magnet: "${g3.line}" ${JSON.stringify(g3.items)}`);
    if ((await magnet()).publishedAt !== null || (await anon(slugUrl)).status !== 404) throw new Error("the first click publishes nothing");
    console.log(`✓ magnet: drafted by the model, publish shows "${g3.line}" naming ${g3.items[0]}; nothing published`);
    await submit(page, '[data-testid="review-gate-continue"]');
    await page.waitForURL(/published=1/);
    await noGate(page, "after publish continue");
    const c2 = (await confirms())[0];
    if (c2.surface !== "magnet_publish" || c2.subjectId !== magnetId || JSON.stringify(c2.items) !== JSON.stringify([m1.title]) || c2.userName !== user.name) throw new Error(`the publish confirm: ${JSON.stringify(c2)}`);
    if (!(await magnet()).publishedAt) throw new Error("continue anyway publishes");
    const pub = await anon(slugUrl);
    const html = await pub.text();
    if (pub.status !== 200 || !html.includes(m1.title)) throw new Error(`the hosted page is live: ${pub.status}`);
    if (html.includes(UNREVIEWED_LABEL) || /ai_unreviewed|review-gate/.test(html)) throw new Error("the public page shows nothing of the mark");
    console.log("✓ continue anyway: logged, published, the public page carries no mark");
    await submit(page, '[data-testid="magnet-unpublish"]');
    await page.waitForURL(/unpublished=1/);
    if ((await anon(slugUrl)).status !== 404 || (await magnet()).publishedAt !== null) throw new Error("unpublish takes the page down");
    await submit(page, '[data-testid="ai-accept"]');
    const m2 = await magnet();
    if (m2.origin !== "ai_accepted" || JSON.stringify(m2.content) !== JSON.stringify(m1.content)) throw new Error("Accept marks the magnet accepted and changes no words");
    if (await page.locator('[data-testid="ai-unreviewed"]').count()) throw new Error("the label goes with the Accept");
    await submit(page, '[data-testid="magnet-publish"]');
    await page.waitForURL(/published=1/);
    await noGate(page, "publish after accept");
    if ((await anon(slugUrl)).status !== 200 || (await confirms()).length !== 2) throw new Error("an accepted magnet publishes with no gate and no new confirm");
    console.log("✓ accept, publish again: no line, live, no confirm needed");

    /* ── 3. A doctrine post: status, the composer and one-click distribute each name it; Review saves nothing; Continue anyway is logged ── */
    const principle = (await db.query.principles.findFirst())!;
    await page.goto(`${base}/doctrine/${encodeURIComponent(principle.code)}?tab=content`);
    await page.locator('form:has(input[name="kind"][value="post"]) button[name="ai"]').waitFor({ timeout: 15000 });
    await submit(page, 'form:has(input[name="kind"][value="post"]) button[name="ai"]');
    await page.waitForURL(/\/content\/[a-z0-9-]+$/i);
    const itemId = page.url().split("/").pop()!;
    const item = async () => (await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, itemId) }))!;
    const i1 = await item();
    if (i1.origin !== "ai_unreviewed" || !i1.body) throw new Error(`the model's post is ai_unreviewed: ${i1.origin}`);
    await readMark(page, "post mark", UNREVIEWED_LABEL);
    await page.selectOption('select[name="status"]', "scheduled");
    await submit(page, 'button:has-text("Save changes")');
    await page.waitForURL(/gate=status&status=scheduled/);
    const g4 = await readGate(page, "status gate");
    if (JSON.stringify(g4.items) !== JSON.stringify([i1.title]) || (await item()).status !== i1.status) throw new Error(`a status change names the post and moves nothing: ${JSON.stringify(g4.items)}, status ${(await item()).status}`);
    // The save carried the draft's own words back (the browser's CRLF line breaks and all): that is not an edit, and the mark stays.
    if ((await item()).origin !== "ai_unreviewed") throw new Error(`a save of the unchanged draft is not a review: origin ${(await item()).origin}`);
    await page.click('[data-testid="review-gate-review"]');
    await page.waitForURL((u) => !u.search.includes("gate="));
    await noGate(page, "review on the post");
    if ((await item()).status !== i1.status || (await confirms()).length !== 2) throw new Error("Review saves and logs nothing");
    await page.selectOption('select[name="status"]', "scheduled");
    await submit(page, 'button:has-text("Save changes")');
    await page.waitForURL(/gate=status/);
    await submit(page, '[data-testid="review-gate-continue"]');
    await page.waitForLoadState("networkidle");
    const c3 = (await confirms())[0];
    if ((await item()).status !== "scheduled" || c3.surface !== "post_status" || c3.subjectId !== itemId || JSON.stringify(c3.items) !== JSON.stringify([i1.title])) throw new Error(`continue anyway schedules and logs: ${JSON.stringify(c3)}`);
    console.log(`✓ doctrine post "${i1.title}": the status change names it, Review moves nothing, Continue anyway schedules and is logged`);
    // The composer: the same post, sent as stored, is named at the send; Review stays; Continue anyway saves the versions
    await page.goto(`${base}/content/${itemId}/compose`);
    await expectText(page, "Redistribute:", "composer");
    await page.click('button:has-text("Schedule")');
    const g5 = await readGate(page, "composer gate");
    if (JSON.stringify(g5.items) !== JSON.stringify([i1.title]) || g5.line !== gateLine(1)) throw new Error(`the composer names the post: ${JSON.stringify(g5)}`);
    if ((await db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, itemId) })).length) throw new Error("the gate saves no version");
    await page.click('[data-testid="review-gate-review"]');
    await page.waitForTimeout(300);
    await noGate(page, "composer review");
    await page.click('button:has-text("Schedule")');
    await readGate(page, "composer gate again");
    await page.click('[data-testid="review-gate-continue"]');
    await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
    const c4 = (await confirms())[0];
    const versions = await db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, itemId) });
    if (c4.surface !== "post_schedule" || c4.subjectId !== itemId || !versions.length || versions.some((x) => x.status !== "scheduled")) throw new Error(`the composer's continue anyway is logged and schedules ${versions.length} versions`);
    console.log(`✓ composer: schedule names the post at the send, Review saves nothing, Continue anyway is logged and schedules ${versions.length} versions`);

    /* ── 4. Group variants: each is labelled with its own Accept, no accept-all; a status change names the one going out ── */
    await page.goto(`${base}/content/${itemId}/repurpose`);
    await submit(page, 'form:has(input[name="groupIds"]) button[name="ai"]');
    const groupVariants = (await db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, itemId) })).filter((x) => x.groupId);
    const ticked = await page.locator('input[name="groupIds"]:checked').count();
    if (!groupVariants.length || groupVariants.length !== ticked) throw new Error(`one draft per ticked group: ${groupVariants.length} of ${ticked}`);
    const unread = groupVariants.filter((x) => x.origin === "ai_unreviewed" && x.generatedBy === "claude");
    if (unread.length !== groupVariants.length) throw new Error(`every model-drafted group variant is ai_unreviewed: ${unread.length} of ${groupVariants.length}`);
    await page.reload();
    const marks = await readMark(page, "variant marks", UNREVIEWED_LABEL);
    if (marks !== unread.length) throw new Error(`one mark per unread variant: ${marks} marks for ${unread.length}`);
    if ((await page.locator('[data-testid="ai-accept"]').count()) !== unread.length) throw new Error("one Accept per variant, nothing that accepts them all");
    if (await page.getByText(/accept all/i).count()) throw new Error("no accept-all");
    // The composer above scheduled the coach's own group; the AI regenerate replaced that scheduled version's text with an unread
    // draft. No path publishes a group post automatically (compose.ts pushes only versions with no group id; the ladder's stale
    // query takes groupId "" only), so the schedule stands and the label on the page the coach pastes from is the mark, as ruled.
    const regenerated = unread.filter((x) => x.status === "scheduled");
    if (!regenerated.length) throw new Error("the composer's send scheduled the coach's own group before the regenerate");
    for (const x of regenerated) {
      if ((await page.locator(`form:has(input[name="id"][value="${x.id}"]) [data-testid="ai-accept"]`).count()) !== 1) throw new Error("a regenerated scheduled version carries the mark and its own Accept");
      if ((await page.locator(`form#variant-${x.id} select[name="status"]`).inputValue()) !== "scheduled") throw new Error("the schedule stands after a regenerate");
    }
    // The status gate is walked on the drafts still to go out.
    const unreadDrafts = unread.filter((x) => x.status === "draft");
    if (unreadDrafts.length < 2) throw new Error(`at least two unread group drafts still to go out, got ${unreadDrafts.length} of ${unread.length}`);
    const v1 = unreadDrafts[0];
    const groupOf = (x: { groupId: string }) => db.query.groups.findFirst({ where: eq(schema.groups.id, x.groupId) });
    const form1 = page.locator(`form#variant-${v1.id}`);
    await form1.locator('select[name="status"]').selectOption("scheduled");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), form1.locator('button[type="submit"]').click()]);
    await page.waitForURL(new RegExp(`gate=variant&variant=${v1.id}`));
    const g6 = await readGate(page, "variant gate");
    const name1 = (await groupOf(v1))!.name;
    const v1after = (await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, v1.id) }))!;
    if (JSON.stringify(g6.items) !== JSON.stringify([name1]) || v1after.status !== v1.status) throw new Error(`the variant's status change names its group and moves nothing: ${JSON.stringify(g6.items)}, ${v1after.status}`);
    await submit(page, '[data-testid="review-gate-continue"]');
    const c5 = (await confirms())[0];
    const v1done = (await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, v1.id) }))!;
    if (v1done.status !== "scheduled" || v1done.origin !== "ai_unreviewed" || c5.surface !== "variant_status" || c5.subjectId !== v1.id || JSON.stringify(c5.items) !== JSON.stringify([name1])) throw new Error(`continue anyway schedules the variant and logs it: ${JSON.stringify(c5)}`);
    // Accept another, then schedule it: no line
    const v2 = unreadDrafts[1];
    await page.goto(`${base}/content/${itemId}/repurpose`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(`form:has(input[name="id"][value="${v2.id}"]) [data-testid="ai-accept"]`).click()]);
    await page.waitForLoadState("networkidle");
    const v2acc = (await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, v2.id) }))!;
    if (v2acc.origin !== "ai_accepted" || v2acc.body !== v2.body) throw new Error("Accept marks one variant and changes no words");
    const form2 = page.locator(`form#variant-${v2.id}`);
    await form2.locator('select[name="status"]').selectOption("scheduled");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), form2.locator('button[type="submit"]').click()]);
    await page.waitForLoadState("networkidle");
    await noGate(page, "accepted variant scheduled");
    if ((await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, v2.id) }))!.status !== "scheduled") throw new Error("an accepted variant schedules plainly");
    console.log(`✓ group variants: ${unread.length} drafts each labelled with its own Accept, ${regenerated.length} of them regenerated over a schedule that stands; scheduling one names "${name1}"; Continue anyway logged; an accepted one goes plainly`);
    // One click everywhere: the post itself is still unread, so the send names it; Continue anyway carries the date it was given
    await submit(page, 'button:has-text("Schedule everywhere")');
    await page.waitForURL(/gate=distribute/);
    const g7 = await readGate(page, "distribute gate");
    if (JSON.stringify(g7.items) !== JSON.stringify([i1.title])) throw new Error(`one click names the unread post: ${JSON.stringify(g7.items)}`);
    await submit(page, '[data-testid="review-gate-continue"]');
    await page.waitForURL((u) => !u.search.includes("gate="));
    const c6 = (await confirms())[0];
    if (c6.surface !== "post_schedule" || c6.subjectId !== itemId || (await confirms()).length !== 6) throw new Error(`distribute's continue anyway is logged: ${JSON.stringify(c6)}`);
    const all = await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.contentItemId, itemId), eq(schema.contentVariants.status, "scheduled")) });
    if (all.length < 10) throw new Error(`everywhere is scheduled: ${all.length}`);
    console.log(`✓ one click everywhere: names the post, Continue anyway logged, ${all.length} versions scheduled; ${(await confirms()).length} confirms in all, each with who and when`);

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Provenance walk passed.");
  } finally {
    await browser.close();
    try {
      process.kill(-ai.pid!);
    } catch {
      /* already gone */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
