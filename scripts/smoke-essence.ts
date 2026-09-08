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
    await submit(page, 'button:has-text("Write the ladder")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+/i);
    let sys = (await last()).system;
    if (sys.length !== 1 || sys[0].cached) throw new Error(`with no Essence the system message must be the task alone, got ${JSON.stringify(sys.map((b) => [b.cached, b.text.slice(0, 40)]))}`);
    if (/write in the coach's voice|4th-grade|reading level|## VOICE|brand voice:/i.test(sys[0].text)) throw new Error("no hard-coded voice may remain in a task instruction");
    console.log("✓ no Essence: the task runs alone, no voice invented");

    // The wizard: fourteen sections, save one at a time, count honestly, come back any time
    await page.goto(`${base}/essence`);
    await expectText(page, "0 of 14 sections", "empty wizard");
    if ((await page.locator('[data-testid="essence-section"]').count()) !== 14) throw new Error("fourteen sections");
    await page.goto(`${base}/essence?step=identity`);
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
    // A story from the client's own bank
    await page.goto(`${base}/essence?step=representative_stories`);
    const bank = await page.locator('[data-testid="story-from-bank"] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    if (!bank.length) throw new Error("the story step must offer the client's own bank");
    await page.selectOption('[data-testid="story-from-bank"]', bank[0]);
    await submit(page, 'button:has-text("Save")');
    await expectText(page, "3 of 14 sections", "story section filled from the bank");
    if ((await page.locator('[data-testid="story-row"]').count()) < 2) throw new Error("the picked story should now be a row");
    await page.screenshot({ path: "screenshots/e01-essence.png", fullPage: true });
    // The cap refuses, saving nothing
    await page.goto(`${base}/essence?step=ethical_standards`);
    await fillExact(page, '[data-testid="field-transparency"]', "x".repeat(20500));
    await submit(page, 'button:has-text("Save")');
    await page.waitForURL(/over=/);
    await expectText(page, "over the 20,000 limit", "cap refused");
    await expectText(page, "3 of 14 sections", "nothing saved past the cap");
    console.log("✓ wizard: sections save one at a time and count; a story from the bank; the cap refuses");

    // Filled: the promise line no longer warns; the system message leads with the Essence, cached, then the task
    await page.goto(`${base}/content/ladders`);
    if ((await page.locator('[data-testid="ai-promise"]').first().getAttribute("data-voice")) !== "1") throw new Error("with an Essence the promise line must not warn");
    await fillExact(page, 'input[name="topic"]', "Why my clients stop chasing leads, again");
    await submit(page, 'button:has-text("Write the ladder")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+/i);
    sys = (await last()).system;
    if (sys.length !== 2) throw new Error(`voice first, task second: expected two blocks, got ${sys.length}`);
    if (!sys[0].cached || !sys[0].text.includes('"identity"') || !sys[0].text.includes("Maya Torres")) throw new Error("the first block must be the client's Essence, marked for caching");
    if (sys[1].cached || !/comment ladder|rung/i.test(sys[1].text)) throw new Error("the second block must be the task, uncached");
    if (/4th-grade|reading level|## VOICE|brand voice:/i.test(sys[1].text)) throw new Error("the task must not carry a second voice after the Essence");
    console.log("✓ filled: the Essence leads every system message, cached; the task follows");

    // The cost display carries the prefix and the cache tokens
    await page.goto(`${base}/settings`);
    await expectText(page, "Your Essence rides on every call", "cost line names the prefix");
    await expectText(page, "written", "cache tokens counted");
    const { db, schema } = await import("@/db");
    const { desc } = await import("drizzle-orm");
    const row = (await db.query.aiUsage.findMany({ orderBy: desc(schema.aiUsage.createdAt), limit: 1 }))[0];
    if (!row || row.cacheWriteTokens <= 0) throw new Error(`the usage row must record the cache write, got ${JSON.stringify(row)}`);
    if (row.estimatedCostUsd <= 0) throw new Error("the estimate must include the cached prefix");
    await page.screenshot({ path: "screenshots/e02-essence-cost.png", fullPage: true });
    console.log("✓ cost: the prefix and its cache tokens are on the row and on the card");
  } finally {
    await browser.close();
    try {
      if (mock.pid) process.kill(-mock.pid, "SIGTERM");
    } catch {
      mock.kill();
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Essence smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
