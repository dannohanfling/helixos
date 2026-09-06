/** Smoke walk for the wizards, clients, community pass, and repurposing. Run with the dev server up. */
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

  // Webinars
  await page.goto(`${base}/webinars`);
  await expectText(page, "Leaky Webinar", "webinars list");
  await shot(page, "w01-webinars");
  await page.click('a:has-text("Eat Like a Grown-Up")');
  await page.waitForURL(/\/webinars\//);
  await expectText(page, "Foundation", "wizard");
  await page.goto(page.url().split("?")[0] + "?step=script");
  await expectText(page, "Leaky Webinar version", "script step");
  await shot(page, "w02-webinar-script");
  await page.fill('textarea[name="script"]', "Hi everyone. If you've ever lost 10 pounds and gained it back, this is for you. Here's the plan for the next hour.");
  await submit(page, 'button:has-text("Save and next")');
  await expectText(page, "drafted", "section saved");
  await page.goto(page.url().split("?")[0] + "?step=beliefs");
  await shot(page, "w03-webinar-beliefs");
  await page.goto(page.url().split("?")[0] + "?step=deck");
  await expectText(page, "Deck outline", "deck");
  await shot(page, "w04-webinar-deck");
  await page.goto(page.url().split("?")[0] + "?step=review");
  await submit(page, 'button:has-text("Save review")');
  await expectText(page, "Verdict", "review saved");
  await shot(page, "w05-webinar-review");

  // Offers
  await page.goto(`${base}/offers`);
  await expectText(page, "90-Day Reset", "offers");
  await page.click('a:has-text("90-Day Reset")');
  await page.waitForURL(/\/offers\//);
  await expectText(page, "Optimizer", "offer wizard");
  await shot(page, "w06-offer-wizard");
  await page.fill('form:has(input[name="offerId"]) input[name="name"]', "Weekend & Wine Playbook v2");
  await submit(page, 'form:has(input[name="offerId"]) button:has-text("Add")');
  await expectText(page, "Weekend & Wine Playbook v2", "component added");

  // Repurpose
  await page.goto(`${base}/content?view=posted`);
  await page.click('a:has-text("Why most diets fail")');
  await page.waitForURL(/\/content\//);
  await page.click('a:has-text("Repurpose")');
  await page.waitForURL(/\/repurpose/);
  await expectText(page, "One post, ten channels", "repurpose");
  await submit(page, 'button:has-text("Generate drafts")');
  await expectText(page, "Threads", "variants");
  await shot(page, "w07-repurpose");

  // Clients
  await page.goto(`${base}/clients`);
  await expectText(page, "Sarah Kim", "clients");
  await shot(page, "w08-clients");
  await page.click('a:has-text("Priya Natarajan")');
  await page.waitForURL(/\/clients\//);
  await page.fill('textarea[name="wins"]', "Slept 7 hours twice this week.");
  await page.fill('input[name="mindset"]', "7");
  await submit(page, 'button:has-text("Save check-in")');
  await expectText(page, "Slept 7 hours", "checkin logged");
  await page.fill('input[name="reason"]', "First check-in done");
  await submit(page, 'button:has-text("Award")');
  await expectText(page, "First check-in done", "points awarded");
  await shot(page, "w09-client-detail");

  // Community pass
  await page.goto(`${base}/community`);
  await expectText(page, "Leaderboard", "community");
  await shot(page, "w10-community");

  // Today shows the new actions
  await page.goto(`${base}/today`);
  await expectText(page, "Next best action", "today");
  await shot(page, "w11-today");

  // Mobile more page
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await m.goto(`${base}/login`);
  await m.click('button:has-text("As a client")');
  await m.waitForURL(/\/today/);
  await m.goto(`${base}/more`);
  await m.screenshot({ path: "screenshots/w12-mobile-more.png" });
  console.log("✓ w12-mobile-more");

  // Coach toggles pass
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/coach`);
  await expectText(page, "Tier", "coach tier column");
  await browser.close();
  if (failures.length) {
    console.error("FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Wizard smoke passed.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
