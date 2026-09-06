/** Smoke walk for doctrine, proof, groups, distribution, simple pathway, targets, courses, certification, integrations and the EO pass. Run with the dev server up. */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const ok = (await page.getByText(re).filter({ visible: true }).count().catch(() => 0)) > 0;
  if (!ok) {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  }
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);

  // Doctrine
  await page.goto(`${base}/doctrine`);
  await expectText(page, "Community Is Not a Monetization Strategy", "doctrine list");
  await shot(page, "x01-doctrine");
  await page.click('a:has-text("Connection Precedes Conversion")');
  await page.waitForURL(/\/doctrine\//);
  await page.goto(page.url().split("?")[0] + "?tab=content");
  await expectText(page, "Reel script", "principle content tab");
  await shot(page, "x02-principle-content");
  await submit(page, 'button:has-text("Turn into content")');
  await page.waitForURL(/\/content\//);
  await expectText(page, "Connection Precedes Conversion", "content created from principle");

  // Proof bank
  await page.goto(`${base}/proof`);
  await expectText(page, "Sarah: 11 lbs", "proof list");
  await shot(page, "x03-proof");
  await page.fill('input[name="name"]', "Priya: energy back in 14 days");
  await page.fill('input[name="resultAfter"]', "Back to pre-baby energy by day 14.");
  await submit(page, 'button:has-text("Save proof")');
  await page.waitForURL(/\/proof\//);
  await expectText(page, "Ready to paste", "proof detail");
  await submit(page, 'button:has-text("Draft a win post")');
  await page.waitForURL(/\/content\//);
  await expectText(page, "Win: Priya", "win post drafted");

  // Groups
  await page.goto(`${base}/groups`);
  await expectText(page, "Fit Moms Over 35", "groups top3");
  await expectText(page, "Busy Moms Who Actually Lose It", "own group");
  await shot(page, "x04-groups");
  await page.click('a:has-text("Fit Moms Over 35")');
  await page.waitForURL(/\/groups\//);
  await expectText(page, "No links. Drafts strip them", "group rules read");
  await shot(page, "x05-group-detail");
  await page.fill('textarea[name="notes"]', "Jess replied to my comment on Tuesday.");
  await submit(page, 'button:has-text("Save")');
  await expectText(page, "Jess replied", "group saved");

  // Distribution with group sections
  await page.goto(`${base}/content`);
  await page.click('a[href^="/content/"]:has-text("12-minute")').catch(async () => page.click('main a[href^="/content/"]:not([href*="compose"])'));
  await page.waitForURL(/\/content\/[^/]+$/);
  await page.goto(page.url() + "/repurpose");
  await expectText(page, "Top 3 to prospect in", "repurpose sections");
  await submit(page, 'button:has-text("Generate group drafts")');
  await expectText(page, "Matches the group", "group drafts generated");
  await shot(page, "x06-distribute");

  // Simple pathway
  await page.goto(`${base}/pathway`);
  await expectText(page, "up to 3 open at a time", "simple pathway");
  await shot(page, "x07-pathway-simple");
  await page.goto(`${base}/pathway?view=all`);
  await expectText(page, "Simple view", "whole map toggle");

  // Numbers targets
  await page.goto(`${base}/numbers`);
  await expectText(page, "targets", "numbers month");
  await expectText(page, "Webinar funnel", "numbers optional groups");
  await shot(page, "x08-numbers-targets");

  // Today close optional groups
  await page.goto(`${base}/today`);
  await page.locator('summary:has-text("Edit today")').click().catch(() => null);
  const funnel = page.locator('details:has(summary:has-text("Webinar funnel"))').first();
  if (!(await funnel.evaluate((el) => (el as HTMLDetailsElement).open))) await funnel.locator("summary").click();
  await page.fill('input[name="webinarRegs"]', "7");
  await submit(page, 'button:has-text("Close the day")');
  await expectText(page, "Day closed", "close with optional groups");

  // Courses
  await page.goto(`${base}/courses`);
  await expectText(page, "Launch Pad", "courses");
  await page.goto(`${base}/courses?program=Accelerator`);
  await expectText(page, "Week 1", "accelerator");
  await submit(page, 'button:has-text("Done")');
  await shot(page, "x09-courses");

  // Certification (client)
  await page.goto(`${base}/certification`);
  await expectText(page, "Client Intake", "certification modules");
  await expectText(page, "Passed", "passed deliverable");
  await shot(page, "x10-certification");

  // Rewards pass card
  await page.goto(`${base}/rewards`);
  await expectText(page, "My Evolve Omega pass", "pass card");
  await submit(page, 'button:has-text("Send me a test push")');
  await shot(page, "x11-rewards-pass");

  // Coach side
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/integrations`);
  await expectText(page, "Community Loyalty", "integrations");
  await expectText(page, "GoHighLevel", "ghl");
  await shot(page, "x12-integrations");
  await page.fill('textarea[name="body"]', "Call in 30. Bring one win.");
  await submit(page, 'button:has-text("Push to passes")');
  await expectText(page, "pass.push", "broadcast logged");
  await page.goto(`${base}/certification`);
  await expectText(page, "To score", "coach cert queue");
  await page.fill('input[name="score"]', "96");
  await submit(page, 'button:has-text("Score it")');
  await page.goto(`${base}/coach`);
  await expectText(page, "Programs and passes", "coach programs card");
  await shot(page, "x13-coach");

  // Inbound webhook: from a fresh context with no session cookie, exactly like GHL or Community Loyalty would call it
  const machine = await (await browser.newContext()).newPage();
  const res = await machine.request.post(`${base}/api/webhooks/community-loyalty?secret=hx_demo_community_loyalty_secret`, { data: { event: "points.earned", email: "client@demo.helixos.app", points: 15, reason: "Referred a friend", id: "evt-smoke-1" } });
  if (!res.ok()) throw new Error(`webhook ${res.status()}`);
  const bad = await machine.request.post(`${base}/api/webhooks/ghl?secret=wrong`, { data: {} });
  if (bad.status() !== 401) throw new Error(`webhook should reject bad secret, got ${bad.status()}`);
  console.log("✓ webhooks");

  await browser.close();
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Wave 3 smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
