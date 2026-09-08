/** Smoke walk for the composer (the CTA as its own field, on desktop and on a phone), per-channel previews, one-click distribute and the collapsible nav. Run with the dev server up. */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // A page answers at once with its loading skeleton; it must clear within 3 seconds, then the text must be there.
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "hidden", timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
const occurrences = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0);
const CTA_SELECT = 'select[aria-label="Pick a CTA from the library"]';
const BODY = 'textarea[placeholder^="Type content"]';
/** Picks two library CTAs in a row: the field holds the last one, the body never grows, the Facebook version carries it exactly once. */
async function ctaIsItsOwnField(page: Page, where: string) {
  await page.locator(CTA_SELECT).waitFor({ timeout: 10000 });
  const labels = (await page.locator(`${CTA_SELECT} option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).label))).filter(Boolean);
  const bodyBefore = await page.inputValue(BODY);
  await page.selectOption(CTA_SELECT, { label: labels[1] });
  const cta1 = await page.inputValue('[data-testid="cta-field"]');
  if (!cta1.trim()) throw new Error(`[${where}] the CTA picker did not fill the CTA field`);
  await page.selectOption(CTA_SELECT, { label: labels[1] }); // the same one again, as a phone's picker wheel does
  await page.selectOption(CTA_SELECT, { label: labels[2] });
  const cta2 = await page.inputValue('[data-testid="cta-field"]');
  if (cta2 === cta1 || !cta2.trim()) throw new Error(`[${where}] a second pick must replace the CTA, not add to it`);
  const bodyAfter = await page.inputValue(BODY);
  if (bodyAfter !== bodyBefore) throw new Error(`[${where}] picking a CTA changed the body:\n${bodyAfter}`);
  // The full rendered Facebook version (the customize tab shows it whole; the preview clamps long text)
  await page.click('label:has-text("Customize for each channel") input');
  await page.locator('div.border-b button:has-text("Facebook")').first().click();
  const fb = await page.inputValue("textarea.field.min-h-56");
  await page.locator('div.border-b button:has-text("Source")').click();
  await page.click('label:has-text("Customize for each channel") input');
  if (occurrences(fb, cta2) !== 1 || occurrences(fb, cta1) !== 0) throw new Error(`[${where}] the Facebook version must carry the chosen CTA exactly once (chosen ×${occurrences(fb, cta2)}, previous ×${occurrences(fb, cta1)}):\n${fb}`);
  if (/Want the full version\?/.test(fb)) throw new Error(`[${where}] a canned CTA line was added beside the chosen one`);
  return cta2;
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
  const cta = await ctaIsItsOwnField(page, "desktop");
  // "# Hashtags" adds its line once, however many times it is pressed
  await page.click('button:has-text("# Hashtags")');
  await page.click('button:has-text("# Hashtags")');
  const tagged = await page.inputValue(BODY);
  const tagLine = tagged.split("\n").pop() ?? "";
  if (!tagLine.startsWith("#") || occurrences(tagged, tagLine) !== 1) throw new Error(`hashtags were added twice:\n${tagged}`);
  console.log("✓ CTA is its own field: a pick replaces it, the body never grows, each version carries it once");
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
  const itemId = page.url().match(/\/content\/([a-z0-9-]+)\/repurpose/i)![1];
  await expectText(page, "Custom Instagram caption", "variant saved");
  await expectText(page, "scheduled", "variant scheduled");
  await expectText(page, cta.split("\n")[0].slice(0, 40), "saved versions carry the chosen CTA");
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
  // The post written above (the posted view opens a seeded post of the same title) keeps its CTA as its own field
  await page.goto(`${base}/content/${itemId}/compose`);
  await expectText(page, "Redistribute:", "own post in the edit composer");
  if ((await page.inputValue('[data-testid="cta-field"]')) !== cta) throw new Error("the CTA did not come back as its own field on the edit page");

  // The same on a phone (where this was first seen): a pick replaces, nothing appends
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })).newPage();
  phone.on("pageerror", (e) => failures.push(`phone pageerror ${e.message}`));
  await phone.goto(`${base}/login`);
  await phone.click('button:has-text("As a client")');
  await phone.waitForURL(/\/today/);
  await phone.goto(`${base}/content/compose`);
  await expectText(phone, "Post preview", "phone composer");
  await phone.fill('input[placeholder^="Hook"]', "It's not willpower. It's the plan.");
  await phone.fill(BODY, "Every plan asks for 3 hours on Sunday.\nNobody has 3 hours on Sunday.");
  await ctaIsItsOwnField(phone, "phone");
  await phone.screenshot({ path: "screenshots/c05-phone-cta.png", fullPage: true });
  await phone.context().close();
  console.log("✓ phone: same field, same once-per-version rendering");

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
