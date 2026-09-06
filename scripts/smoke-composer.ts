/** Smoke walk for the composer, per-channel previews, one-click distribute and the collapsible nav. Run with the dev server up. */
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
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(`pageerror ${e.message}`));
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);

  // Collapsible nav
  await page.click('nav button:has-text("Build")');
  if (await page.locator('nav a:has-text("Webinars")').isVisible()) throw new Error("Build group did not collapse");
  await page.reload();
  await page.locator('nav button:has-text("Build")[aria-expanded="false"]').waitFor({ timeout: 10000 }).catch(() => {
    throw new Error("Collapse did not persist across reload");
  });
  await page.click('nav button:has-text("Build")');
  await expectText(page, "Webinars", "nav re-expanded");
  console.log("✓ nav collapse");

  // Composer
  await page.goto(`${base}/content/compose`);
  await expectText(page, "Post preview", "composer");
  await page.fill('input[placeholder^="Working title"]', "Why most diets fail by week 3");
  await page.fill('input[placeholder^="Hook"]', "It's not willpower. It's the plan.");
  await page.fill('textarea[placeholder^="Type content"]', "Every plan asks for 3 hours on Sunday.\nNobody has 3 hours on Sunday.\nSo the plan dies by Wednesday.\nTwelve minutes on Tuesday beats three hours on Sunday.");
  await expectText(page, "It's not willpower", "preview shows hook");
  await page.click('button[title="Email"]');
  await page.click('button[title="Fit Moms Over 35"]');
  await expectText(page, "Fit Moms Over 35 ·", "group preview added");
  await shot(page, "c01-composer");
  await page.click('label:has-text("Customize for each channel") input');
  await page.click('div.border-b button:has-text("Instagram")');
  await page.fill("textarea.field.min-h-56", "Custom Instagram caption for the test.");
  await expectText(page, "customized", "override marked");
  await expectText(page, "Custom Instagram caption", "preview reflects override");
  await shot(page, "c02-composer-custom");
  await page.click('button:has-text("Schedule")');
  await page.getByText(/Scheduled \d+ posts/).waitFor({ timeout: 20000 });
  await page.click('a:has-text("See every version")');
  await page.waitForURL(/\/repurpose/);
  await expectText(page, "Custom Instagram caption", "variant saved");
  await expectText(page, "scheduled", "variant scheduled");
  await shot(page, "c03-distribute-after-schedule");

  // One click everywhere
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('button:has-text("Schedule everywhere")')]);
  await page.waitForLoadState("networkidle");
  await page.reload();
  const scheduledCount = await page.locator("text=scheduled").count();
  if (scheduledCount < 10) throw new Error(`expected 10+ scheduled variants, saw ${scheduledCount}`);
  console.log(`✓ schedule everywhere (${scheduledCount} scheduled badges)`);

  // Redistribute an existing post through the composer
  await page.goto(`${base}/content?view=posted`);
  await page.click('a:has-text("Why most diets fail")');
  await page.waitForURL(/\/content\//);
  await page.click('a:has-text("Redistribute")');
  await page.waitForURL(/\/compose/);
  await expectText(page, "Redistribute:", "edit composer");
  await shot(page, "c04-redistribute");

  // Sync log shows the social planner attempts (skipped: GHL off)
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/integrations`);
  await expectText(page, "social.schedule", "social planner logged");
  await expectText(page, "Client sub-accounts", "sub-accounts card");

  await browser.close();
  if (failures.length) throw new Error(`Errors:\n${failures.join("\n")}`);
  console.log("Composer smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
