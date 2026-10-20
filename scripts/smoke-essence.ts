/**
 * The Essence System: empty says so at the point of use; sections save one at a time and count; the cap refuses; once
 * filled, every AI call's system message leads with the client's Essence, marked for caching, then the task; the usage row
 * carries the cache tokens. Runs against scripts/mock-ai.ts; the dev server must be started with AI_BASE_URL=http://localhost:4020.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4020;

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
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector}`);
}
const last = async () => (await (await fetch(`http://localhost:${mockPort}/__last`)).json()) as { system: { text: string; cached: boolean }[]; instructions: string | null };

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(mockPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);

    // Connect the AI key so the ✨ actions are live
    await page.goto(`${base}/settings`);
    await page.selectOption('select[name="provider"]', "anthropic");
    await page.fill('input[name="key"]', "sk-ant-good");
    await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');
    await expectText(page, "connected · Anthropic", "ai connected");
    await expectText(page, "No Essence yet, so no voice prefix is sent", "cost line says no prefix");

    // Empty Essence: the point of use says the output will read generic, with the way in; nothing is blocked
    await page.goto(`${base}/content/ladders`);
    const promise = page.locator('[data-testid="ai-promise"]').first();
    if ((await promise.getAttribute("data-voice")) !== "0") throw new Error("with an empty Essence the promise line must say so");
    if (!(await page.locator('[data-testid="voice-line"] a[href="/essence"]').first().count())) throw new Error("the voice line must link into the wizard");
    if (await page.locator('button:has-text("Write the ladder")').first().isDisabled()) throw new Error("an empty Essence must not block the feature");
    console.log("✓ empty Essence: said at the point of use, linked to the wizard, nothing blocked");

    // A ✨ call with no Essence: the system message is the task alone, no voice invented
    await fillExact(page, 'input[name="topic"]', "Why my clients stop chasing leads");
    // The graphic is the ladders walk's; a full mock ladder would make one here (Voice to Ship's mock, rev 638).
    if (await page.locator('[data-testid="ladder-make-graphic"]').isChecked().catch(() => false)) await page.locator('[data-testid="ladder-make-graphic"]').uncheck();
    await submit(page, 'button:has-text("Write the ladder")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+/i);
    let sys = (await last()).system;
    if (sys.length !== 1 || sys[0].cached) throw new Error(`with no Essence the system message must be the task alone, got ${JSON.stringify(sys.map((b) => [b.cached, b.text.slice(0, 40)]))}`);
    if (/write in the coach's voice|Direct\. Clear\. Punchy|## VOICE|brand voice:/i.test(sys[0].text)) throw new Error("no hard-coded voice may remain in a task instruction");
    console.log("✓ no Essence: the task runs alone, no voice invented");

    // The wizard: fourteen sections plus the optional Brand one (27 Sep, filled by an Airtable import or by hand; counted only
    // once filled), save one at a time, count honestly, come back any time
    await page.goto(`${base}/essence`);
    await expectText(page, "0 of 14 sections", "empty wizard");
    if ((await page.locator('[data-testid="essence-section"]:not([data-optional])').count()) !== 14) throw new Error("fourteen sections");
    if ((await page.locator('[data-testid="essence-section"][data-optional="1"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-section")))).join() !== "brand") throw new Error("Brand is the one optional section");
    await page.goto(`${base}/essence?step=identity`);
    // A placeholder is only ever a placeholder: saving without typing leaves the section empty
    if (!(await page.locator('[data-testid="field-name"]').getAttribute("placeholder"))?.includes("Priya Raman")) throw new Error("the example text must be a placeholder inside the input");
    await submit(page, 'button:has-text("Save")');
    await expectText(page, "0 of 14 sections", "an untouched step saves nothing");
    if ((await page.locator('[data-testid="essence-section"][data-section="identity"]').getAttribute("data-filled")) !== "0") throw new Error("a placeholder must never become a value");
    await fillExact(page, '[data-testid="field-name"]', "Maya Torres");
    await fillExact(page, '[data-testid="field-role"]', "Nutrition coach for busy moms");
    await fillExact(page, '[data-testid="field-core_traits"]', "Direct\nWarm\nNo hype");
    await submit(page, 'button:has-text("Save and next")');
    await page.waitForURL(/step=mission_and_vision/);
    await expectText(page, "1 of 14 sections", "one section filled");
    if ((await page.locator('[data-testid="essence-section"][data-section="identity"]').getAttribute("data-filled")) !== "1") throw new Error("identity should show filled");
    await fillExact(page, '[data-testid="field-mission_statement"]', "Every mom gets her energy back without giving up her Saturday.");
    await submit(page, 'button:has-text("Save")');
    await expectText(page, "2 of 14 sections", "two sections filled");
    // A story from the client's own story bank, never the proof bank
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const mayaRow = await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") });
    const ws = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, mayaRow!.id) });
    await db.insert(schema.libraryAssets).values({ id: `walk-story-${Date.now()}`, workspaceId: ws!.workspaceId, userId: mayaRow!.id, type: "story", name: "The year I coached from a hospital car park", body: "What it taught me about systems.", summary: "What it taught me about systems.", useWhen: "Origin", isExample: false });
    await page.goto(`${base}/essence?step=representative_stories`);
    const bank = await page.locator('[data-testid="story-from-bank"] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    if (!bank.length) throw new Error("the story step must offer the client's own story bank");
    if (bank.some((v) => v.startsWith("proof:"))) throw new Error("client results belong in the proof bank, not in the Essence");
    await expectText(page, "Client results go in the proof bank, not here", "the stories line points at the gate");
    await page.selectOption('[data-testid="story-from-bank"]', bank[0]);
    await submit(page, 'button:has-text("Save")');
    await expectText(page, "3 of 14 sections", "story section filled from the bank");
    if ((await page.locator('[data-testid="story-row"]').count()) < 2) throw new Error("the picked story should now be a row");
    await page.screenshot({ path: "screenshots/e01-essence.png", fullPage: true });
    // The cap refuses, saving nothing, and keeps what was typed (H-802: the refusal used to read as a save, so the box came
    // back empty and the draft was dropped)
    await page.goto(`${base}/essence?step=ethical_standards`);
    const overText = `${"Tell the truth about what a program can do. ".repeat(470)}The end.`;
    const boxHolds = (want: string) => page.waitForFunction((w) => (document.querySelector('[data-testid="field-transparency"]') as HTMLTextAreaElement | null)?.value === w, want, { timeout: 8000 });
    await fillExact(page, '[data-testid="field-transparency"]', overText);
    await submit(page, 'button:has-text("Save")');
    await page.waitForURL(/error=over&chars=\d+/);
    await page.locator('[data-testid="essence-over"]').waitFor({ timeout: 10000 });
    await expectText(page, "over the 20,000 limit", "cap refused");
    await expectText(page, "3 of 14 sections", "nothing saved past the cap");
    await boxHolds(overText).catch(async () => {
      await page.screenshot({ path: "screenshots/fail-essence-cap-kept.png", fullPage: true });
      throw new Error("a save refused over the cap must keep the typed text in the box");
    });
    if (await page.locator('[data-testid="save-confirm"]').filter({ visible: true }).count()) throw new Error("a save refused over the cap must not show the green Saved");
    // A reload still has it: the draft was kept, not dropped as if it had saved
    await page.reload();
    await boxHolds(overText).catch(() => {
      throw new Error("the draft of a save refused over the cap must be kept, so a reload puts it back");
    });
    // The steps below start from the section as it was: its draft let go, here and on the server
    const draftId = `essence.${mayaRow!.id}.ethical_standards`;
    await page.evaluate(async (id) => {
      localStorage.removeItem(`helix.draft.${id}`);
      await fetch("/api/drafts", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: [id] }) });
    }, draftId);
    console.log("✓ over the cap: the red line, no green, and what was typed is still in the box and in its draft");
    // Already over (an Airtable import brings an Essence in whole, 28 Sep): flagged with its trim-to-fit, left out of the AI,
    // and a save that trims it goes through.
    const { and: andOp } = await import("drizzle-orm");
    const eRow = (await db.query.essences.findFirst({ where: andOp(eq(schema.essences.workspaceId, ws!.workspaceId), eq(schema.essences.userId, mayaRow!.id)) }))!;
    const before = eRow.data;
    await db.update(schema.essences).set({ data: { ...(before as Record<string, unknown>), ethical_standards: { transparency: "x".repeat(20500) } } }).where(eq(schema.essences.id, eRow.id));
    await page.goto(`${base}/essence?step=ethical_standards`);
    await page.locator('[data-testid="essence-over-cap"]').waitFor({ timeout: 15000 });
    if (!(await page.locator('[data-testid="essence-trim"] li').first().innerText()).startsWith("Ethical standards")) throw new Error("the trim-to-fit leads with the largest section");
    await fillExact(page, '[data-testid="field-transparency"]', "Always.");
    await submit(page, 'button:has-text("Save")');
    await page.waitForURL(/saved=1/);
    if (await page.locator('[data-testid="essence-over-cap"]').count()) throw new Error("a save that trims an Essence over the limit goes through, and the flag goes with it");
    // A multi-line Brand over its own budget, as an import leaves it ("\n" breaks): the browser posts the box back with "\r\n",
    // and deleting a few lines must save (20 Oct: each break used to count twice, so a real trim was refused as growing).
    const spine = Array.from({ length: 700 }, (_, i) => `Step ${i}: hold the line under pressure.`);
    await db.update(schema.essences).set({ data: { ...(before as Record<string, unknown>), brand: { operating_spine: spine.join("\n") } } }).where(eq(schema.essences.id, eRow.id));
    await page.goto(`${base}/essence?step=brand`);
    await page.locator('[data-testid="field-operating_spine"]').waitFor({ timeout: 15000 });
    // Delete the last three lines with the keyboard, as she would: real input events, so the page's draft keeps them too.
    const box = page.locator('[data-testid="field-operating_spine"]');
    await box.click();
    await page.keyboard.press("Control+End");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await submit(page, 'button:has-text("Save")');
    await page.waitForURL(/saved=1/, { timeout: 15000 }).catch(() => undefined);
    if (!page.url().includes("saved=1")) throw new Error(`a trimmed multi-line Brand over its budget saves, got ${page.url()}`);
    const kept = ((await db.query.essences.findFirst({ where: eq(schema.essences.id, eRow.id) }))!.data as { brand?: { operating_spine?: string } }).brand?.operating_spine ?? "";
    if (kept.includes("\r") || kept.split("\n").length !== 697) throw new Error(`the trimmed text is stored with plain line breaks, ${kept.split("\n").length} lines`);
    await db.update(schema.essences).set({ data: before }).where(eq(schema.essences.id, eRow.id));
    console.log("✓ wizard: sections save one at a time and count; a story from the bank; the cap refuses a save that grows it; one already over is flagged with its trim-to-fit and can be trimmed, a multi-line Brand too");

    // Key outcomes as named rows (H-811 A2): an Essence saved with the three old boxes opens as rows of those names, and the
    // member renames, adds one for another audience, and saves them in her order.
    await db.update(schema.essences).set({ data: { ...(before as Record<string, unknown>), key_outcomes_for_users: { clarity: "They know what they want", impact: "", connection: "Taken seriously" } } }).where(eq(schema.essences.id, eRow.id));
    await page.goto(`${base}/essence?step=key_outcomes_for_users`);
    await page.locator('[data-testid="outcome-row"]').first().waitFor({ timeout: 15000 });
    const names = await page.locator('[data-testid="outcome-name"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    if (JSON.stringify(names.slice(0, 2)) !== JSON.stringify(["Clarity", "Connection"]) || names.length !== 4) throw new Error(`the old boxes open as rows of their own names, with room to add: ${names.join(", ")}`);
    if ((await page.locator('[data-testid="outcome-line"]').first().inputValue()) !== "They know what they want") throw new Error("and keep their words");
    await fillExact(page, '[data-testid="outcome-name"] >> nth=0', "Calm");
    await fillExact(page, '[data-testid="outcome-name"] >> nth=2', "Craft");
    await fillExact(page, '[data-testid="outcome-line"] >> nth=2', "They teach it to others");
    await fillExact(page, '[data-testid="outcome-audience"] >> nth=2', "practitioners");
    await submit(page, 'button:has-text("Save")');
    await page.waitForURL(/saved=1/);
    const saved = (((await db.query.essences.findFirst({ where: eq(schema.essences.id, eRow.id) }))!.data as Record<string, Record<string, unknown>>).key_outcomes_for_users ?? {}) as { outcomes?: { name: string; line: string; audience: string }[]; clarity?: string };
    const rows = saved.outcomes ?? [];
    if (rows.map((r) => r.name).join("|") !== "Calm|Connection|Craft" || rows[2]?.audience !== "practitioners" || saved.clarity !== undefined) throw new Error(`the rows save in her order, named, with an audience, and the old boxes go: ${JSON.stringify(saved)}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/essence?step=key_outcomes_for_users`);
    await page.locator('[data-testid="outcome-row"]').first().waitFor({ timeout: 15000 });
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))) throw new Error("the outcome rows fit a phone");
    await page.setViewportSize({ width: 1400, height: 950 });
    await db.update(schema.essences).set({ data: before }).where(eq(schema.essences.id, eRow.id));
    console.log("✓ key outcomes: the three old boxes open as named rows; renamed, one added for practitioners, saved in order; fits 390");

    // Filled: the promise line no longer warns; the system message leads with the Essence, cached, then the task
    await page.goto(`${base}/content/ladders`);
    if ((await page.locator('[data-testid="ai-promise"]').first().getAttribute("data-voice")) !== "1") throw new Error("with an Essence the promise line must not warn");
    await fillExact(page, 'input[name="topic"]', "Why my clients stop chasing leads, again");
    // The graphic is the ladders walk's; a full mock ladder would make one here (Voice to Ship's mock, rev 638).
    if (await page.locator('[data-testid="ladder-make-graphic"]').isChecked().catch(() => false)) await page.locator('[data-testid="ladder-make-graphic"]').uncheck();
    await submit(page, 'button:has-text("Write the ladder")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+/i);
    sys = (await last()).system;
    if (sys.length !== 2) throw new Error(`voice first, task second: expected two blocks, got ${sys.length}`);
    if (!sys[0].cached || !sys[0].text.includes('"identity"') || !sys[0].text.includes("Maya Torres")) throw new Error("the first block must be the client's Essence, marked for caching");
    if (sys[1].cached || !/comment ladder|rung/i.test(sys[1].text)) throw new Error("the second block must be the task, uncached");
    if (/Direct\. Clear\. Punchy|## VOICE|brand voice:/i.test(sys[1].text)) throw new Error("the task must not carry a second voice after the Essence");
    if (!/## FORMAT/.test(sys[1].text) || !/4th-grade reading level/.test(sys[1].text)) throw new Error("the ladder's format rules (the medium) must stay in the task");
    // Format belongs to the channel: the Facebook line sits beside the fields that land on Facebook, and only there (no other channel has a line yet)
    const section = (name: string) => sys[1].text.split(`\n${name}\n`)[1]?.split("\n\n")[0] ?? "";
    const fbLine = /^FORMAT \(Facebook personal, Facebook business page\): 4th-grade reading level\. Sentences average 5–7 words\. Line break between every sentence or short thought\.$/m;
    if (!fbLine.test(section("COPY")) || !fbLine.test(section("SUPPORTING_COMMENTS"))) throw new Error("the Facebook format line must sit beside COPY and SUPPORTING_COMMENTS");
    if (!/^FORMAT \(Instagram caption\): The first line is the whole hook;/m.test(section("IG_CAPTION")) || !/^FORMAT \(Threads\): One idea per post in the chain\./m.test(section("THREADS_CHAIN"))) throw new Error("the caption and the chain must carry their own channel's format line");
    // Every channel field is bounded, from the spec: one body to two Facebook limits fits the tighter and says so; no number lives in prose
    if (!/^Max 1500 chars — this body posts to both Facebook business page \(1500\) and Facebook personal \(2000\)\.$/m.test(section("COPY"))) throw new Error("the post body must carry the tighter of its two Facebook limits, named");
    if (!/^Max 2200 chars\.$/m.test(section("IG_CAPTION")) || !/^Max 500 chars a post\.$/m.test(section("THREADS_CHAIN"))) throw new Error("the caption and the chain must carry their channel's bound");
    if (/Under 2,200|under 500 characters/.test(sys[1].text)) throw new Error("a character count must come from the spec, never from a prose literal");
    // The body carries Facebook personal's tone, never the page's "direct CTA": a ladder body has no CTA, the rungs do
    if (!/^TONE \(Facebook personal\): Story-first, personal\.$/m.test(section("COPY"))) throw new Error("the post body must carry Facebook personal's tone");
    if (/direct CTA/.test(sys[1].text)) throw new Error("the page's tone must not reach the ladder: its direct CTA contradicts the method");
    if (/daily hashtag/i.test(sys[1].text)) throw new Error("a house practice must never reach a client's prompt");
    if (/^- 4th-grade/m.test(sys[1].text)) throw new Error("the format line must not also sit at the top as a feature-level rule");
    if (/Priya Raman|hospital car park, and what it taught me about systems\./.test(sys[0].text)) throw new Error("placeholder text must never reach the model");
    console.log("✓ filled: the Essence leads every system message, cached; the task follows; placeholders never sent");

    // The cost display carries the prefix and the cache tokens
    await page.goto(`${base}/settings`);
    await expectText(page, "Your Essence rides on every call", "cost line names the prefix");
    await expectText(page, "written", "cache tokens counted");
    // db and schema are already imported above
    const { desc } = await import("drizzle-orm");
    const row = (await db.query.aiUsage.findMany({ orderBy: desc(schema.aiUsage.createdAt), limit: 1 }))[0];
    if (!row || row.cacheWriteTokens <= 0) throw new Error(`the usage row must record the cache write, got ${JSON.stringify(row)}`);
    if (row.estimatedCostUsd <= 0) throw new Error("the estimate must include the cached prefix");
    await page.screenshot({ path: "screenshots/e02-essence-cost.png", fullPage: true });

    // The coach sees which fields clients actually fill in, read-only
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/coach?connections=open`);
    await expectText(page, "Essence: what clients actually fill in", "coach counts card");
    const nameCount = await page.locator('[data-testid="essence-counts"] [data-field="identity.name"]').getAttribute("data-count");
    if (nameCount !== "1") throw new Error(`identity.name should count one client, got ${nameCount}`);
    const traitsCount = await page.locator('[data-testid="essence-counts"] [data-field="guidelines_to_respond.tone"]').getAttribute("data-count");
    if (traitsCount !== "0") throw new Error(`an unfilled field should count zero, got ${traitsCount}`);
    console.log("✓ coach: per-field fill counts across clients");
    console.log("✓ cost: the prefix and its cache tokens are on the row and on the card");
  } finally {
    await browser.close();
    try {
      if (mock.pid) process.kill(-mock.pid, "SIGTERM");
    } catch {
      mock.kill();
    }
  }
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Essence smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
