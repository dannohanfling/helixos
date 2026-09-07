/**
 * End-to-end smoke walk through the demo workspace. Run with the dev server up:
 *   npx tsx scripts/smoke.ts [baseUrl]
 * Captures screenshots into ./screenshots and fails loudly on any 500 or missing text.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const ok = (await page.getByText(re).filter({ visible: true }).count().catch(() => 0)) > 0;
  if (!ok) {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected to see "${text}" on ${page.url()}`);
  }
}

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));

  // Login
  await page.goto(`${base}/login`);
  await expectText(page, "Welcome back", "login");
  await shot(page, "00-login");
  await page.fill('input[name="email"]', "client@demo.helixos.app");
  await page.fill('input[name="password"]', "demo1234");
  await page.click('button[type="submit"]:has-text("Sign in")');
  await page.waitForURL(/\/today/);
  await expectText(page, "Next best action", "today");
  await shot(page, "01-today-before-lockin");

  // Morning lock-in (expand the form if today is already locked in)
  const redo = page.locator('summary:has-text("Redo lock-in")');
  if (await redo.isVisible()) await redo.click();
  await page.locator('label:has(input[name="energy"][value="4"])').click();
  await page.fill('input[name="intention"]', "Three real conversations before noon.");
  await page.fill('input[name="newFocus"]', "Smoke focus task");
  await submit(page, 'button:has-text("Lock it in")');
  await expectText(page, "Done · +10", "lock-in done");
  const errors = await page.locator("nextjs-portal").count();
  console.log(`dev overlay portals: ${errors}`);
  await shot(page, "02-today-locked-in");

  // Complete a focus task
  const before = await page.locator("text=/\\d+\\/\\d+ done/").first().textContent();
  await submit(page, '[data-testid="task-row"]:has-text("Smoke focus task") [data-testid="task-toggle"]');
  const after = await page.locator("text=/\\d+\\/\\d+ done/").first().textContent();
  if (before === after) throw new Error(`task completion did not change counter (${before} -> ${after})`);
  console.log(`✓ task toggled (${before?.trim()} -> ${after?.trim()})`);

  // Evening close (expand if already closed today)
  const editClose = page.locator('summary:has-text("Edit today")');
  if (await editClose.isVisible()) await editClose.click();
  const early = page.locator('[data-testid="close-early"] > summary');
  if (await early.isVisible()) await early.click();
  await page.fill('input[name="dmsStarted"]', "3");
  await page.fill('input[name="callsBooked"]', "1");
  await page.fill('input[name="win"]', "Booked a call from a cold DM.");
  await submit(page, 'button:has-text("Close the day")');
  await expectText(page, "Day closed", "close");
  await shot(page, "03-today-closed");

  // Tasks
  await page.goto(`${base}/tasks`);
  await expectText(page, "Top 3 today", "tasks");
  await page.click('summary:has-text("+ New task")');
  await page.fill('input[name="title"]', "Smoke-test task");
  await submit(page, 'button:has-text("Add task")');
  await expectText(page, "Smoke-test task", "tasks create");
  await shot(page, "04-tasks");

  // Content
  await page.goto(`${base}/content`);
  await expectText(page, "Ideas", "content board");
  await shot(page, "05-content-board");
  await page.goto(`${base}/content?view=calendar`);
  await expectText(page, "This week", "content calendar");
  await shot(page, "06-content-calendar");
  await page.goto(`${base}/content?view=posted`);
  await expectText(page, "Client win", "content posted");

  // Conversations
  await page.goto(`${base}/conversations`);
  await expectText(page, "Priya Natarajan", "conversations");
  await shot(page, "07-conversations");
  await page.click('a:has-text("Priya Natarajan")');
  await page.waitForURL(/\/conversations\//);
  await expectText(page, "Thread", "contact");
  await page.check('input[name="direction"][value="in"]');
  await page.fill('textarea[name="body"]', "10am works for me!");
  await submit(page, 'button:has-text("Log it")');
  await expectText(page, "10am works for me!", "log message");
  await shot(page, "08-contact");
  await page.goto(`${base}/conversations/playbook`);
  await expectText(page, "Proactive Outreach", "playbook");
  await shot(page, "09-playbook");

  // Pathway
  await page.goto(`${base}/pathway`);
  await expectText(page, "Your pathway", "pathway");
  await page.locator('a[href^="/pathway?task="]').first().click();
  await page.waitForLoadState("networkidle");
  await expectText(page, "How to complete", "pathway task");
  await shot(page, "10-pathway");

  // Numbers, rewards, settings
  await page.goto(`${base}/numbers`);
  await expectText(page, "last 12 weeks", "numbers");
  await expectText(page, "Revenue by pillar", "revenue by pillar");
  if ((await page.locator('[data-testid="pillars"] > div').count()) !== 3) throw new Error("expected three pillar cards");
  await shot(page, "11-numbers");
  await page.goto(`${base}/rewards`);
  await expectText(page, "The ladder", "rewards");
  await shot(page, "12-rewards");
  await page.goto(`${base}/settings`);
  await expectText(page, "Your one goal", "settings");

  // Mobile view of Today
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const mp = await mobile.newPage();
  await mp.goto(`${base}/login`);
  await mp.fill('input[name="email"]', "client@demo.helixos.app");
  await mp.fill('input[name="password"]', "demo1234");
  await mp.click('button[type="submit"]:has-text("Sign in")');
  await mp.waitForURL(/\/today/);
  await mp.screenshot({ path: "screenshots/13-mobile-today-dark.png", fullPage: false });
  console.log("✓ 13-mobile-today-dark");
  await mobile.close();

  // Coach
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/coach`);
  await expectText(page, "Verify submissions", "coach");
  await shot(page, "14-coach");
  const verify = page.locator('button:has-text("Verify · award points")').first();
  if (await verify.isVisible()) {
    await submit(page, 'button:has-text("Verify · award points")');
    console.log("✓ verified a submission");
  }
  await page.goto(`${base}/settings`);
  await expectText(page, "Invite links", "coach settings");

  // Join flow
  await page.click('button:has-text("Log out")');
  await page.goto(`${base}/join/ACADEMY1`);
  await expectText(page, "Join Evolve Omega Academy", "join");
  const stamp = Date.now();
  await page.fill('input[name="name"]', "Smoke Tester");
  await page.fill('input[name="email"]', `smoke+${stamp}@example.com`);
  await page.fill('input[name="password"]', "password123");
  await page.click('button:has-text("Join and start Day 1")');
  await page.waitForURL(/\/today/);
  await expectText(page, "Lock in your day", "new client today");
  await shot(page, "15-new-client-day-one");

  // Cron
  const cron = await page.request.get(`${base}/api/cron/reminders?force=morning`, { headers: { Authorization: "Bearer change-me" } });
  console.log(`✓ cron ${cron.status()} ${(await cron.text()).slice(0, 120)}`);

  await browser.close();
  if (failures.length) {
    console.error("FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Smoke walk passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
