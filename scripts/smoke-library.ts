/** Smoke walk for the Content Library: browse, search, use a hook in the composer, save a post to the library, coach shares an entry. */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(`pageerror ${e.message}`));
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);

  // Browse and search
  await page.goto(`${base}/library`);
  await expectText(page, "Swipe files, hooks and CTAs", "library");
  await expectText(page, "Bad reminders kill good webinars", "swipe post");
  await shot(page, "l01-library");
  await page.goto(`${base}/library?tab=hook`);
  await expectText(page, "Hot leads or ghosts?", "hooks tab");
  await page.goto(`${base}/library?tab=cta&q=bottleneck`);
  await expectText(page, "Stop being the bottleneck", "cta search");
  await page.goto(`${base}/library?tab=pattern`);
  await expectText(page, "Paid Trial launch post", "pattern");
  await page.click('a:has-text("Paid Trial launch post")');
  await page.waitForURL(/\/library\//);
  await expectText(page, "See the worked example", "pattern detail");
  await shot(page, "l02-pattern");

  // Use it: composer prefilled, use count goes up
  await submit(page, 'button:has-text("Use this")');
  await page.waitForURL(/\/content\/compose\?from=/);
  await expectText(page, "starting from", "composer prefilled");
  const hookVal = await page.inputValue('input[placeholder^="Hook"]');
  if (!hookVal.includes("regret")) throw new Error(`hook not prefilled: ${hookVal}`);
  // Pick a hook and a CTA from the library pickers
  await page.selectOption('select[aria-label="Pick a hook from the library"]', { label: "Hot leads or ghosts?" });
  const hook2 = await page.inputValue('input[placeholder^="Hook"]');
  if (!hook2.includes("hot leads")) throw new Error(`hook picker failed: ${hook2}`);
  await page.selectOption('select[aria-label="Pick a CTA from the library"]', { label: "Delegate deeper" });
  const bodyVal = await page.inputValue('textarea[placeholder^="Type content"]');
  if (!bodyVal.includes("delegate deeper")) throw new Error("cta picker failed");
  await shot(page, "l03-composer-from-library");
  console.log("✓ use + pickers");

  // Save one of my posts to the library
  await page.goto(`${base}/content?view=posted`);
  await page.click('a:has-text("Why most diets fail")');
  await page.waitForURL(/\/content\/[^/]+$/);
  await submit(page, 'button:has-text("Save to library")');
  await page.waitForURL(/\/library\//);
  await expectText(page, "mine", "saved as mine");
  await page.goto(`${base}/library?tab=mine`);
  await expectText(page, "Why most diets fail", "mine tab");
  await shot(page, "l04-mine");

  // Coach: add a shared entry, members see it
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/library?tab=post`);
  await page.locator('summary:has-text("New post")').click();
  await page.fill('form[action] input[name="title"]', "Coach template: the Tuesday plan");
  await page.fill('form[action] input[name="hook"]', "Twelve minutes on Tuesday beats three hours on Sunday.");
  await page.fill('form[action] textarea[name="body"]', "Here is the whole plan.\nPick, don't plan.\nTwelve minutes. Tuesday. Done.");
  await submit(page, 'button:has-text("Save to library")');
  await page.waitForURL(/\/library\//);
  await expectText(page, "from your coach", "coach shared entry");
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/library?tab=post&q=tuesday`);
  await expectText(page, "Coach template: the Tuesday plan", "member sees coach entry");
  console.log("✓ coach share");

  await browser.close();
  if (failures.length) throw new Error(`Errors:\n${failures.join("\n")}`);
  console.log("Library smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
