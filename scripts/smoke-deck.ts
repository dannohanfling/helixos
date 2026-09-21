/**
 * Deck v2: the opening contract and the picture slots, read off the rendered Deck step. A fresh webinar is filled with the
 * opening contract, one line left blank; the Deck step must show the filled lines as slides in order, list the blank one as
 * omitted, and count the suggested pictures. Every expected string is the coach's own input or read from the record, never
 * typed from memory. Run with the dev server up.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
async function fillField(page: Page, selector: string, value: string) {
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`${selector} did not take the value`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);

    // A fresh webinar from the example: twenty empty sections, its own Foundation to fill.
    await page.goto(`${base}/webinars`);
    await submit(page, 'button:has-text("Start from the example")');
    await page.waitForURL(/\/webinars\/[^/?]+\?step=foundation/);
    const wizardBase = page.url().split("?")[0];

    // The coach's own opening contract, one line (permission) left blank on purpose.
    const contract = {
      "promise-line": "Leave with a plan you'll actually run this week.",
      "chat-prompt": "Say hi and drop where you're tuning in from.",
      "ground-rule": "Nothing here is a promise of income.",
      "session-goal": "Get you to your first booked call.",
      "outcome-1": "A clear next step",
      "outcome-2": "A plan for the week",
      "outcome-3": "One belief broken",
      "reflection-prompt": "What is this already costing you?",
    };
    await page.goto(`${wizardBase}?step=foundation`);
    await fillField(page, '[data-testid="presenter"]', "Lindsey Brittain");
    for (const [testid, value] of Object.entries(contract)) await fillField(page, `[data-testid="${testid}"]`, value);
    // Leave permission-line blank; turn the footer bar on.
    await page.check('[data-testid="footer-bar"]');
    await submit(page, 'button:has-text("Save and map beliefs")');

    // The Deck step: the filled lines are slides in order, the blank one is listed, the pictures are counted.
    await page.goto(`${wizardBase}?step=deck`);
    await page.locator('[data-testid="deck-honesty"]').waitFor({ timeout: 20000 });
    const headlines = await page.locator('[data-testid="deck-slide"] [data-testid="deck-headline"]').allInnerTexts();
    // The five filled opening lines appear, in the contract's order, after the cover and before the first act divider.
    const wanted = [contract["promise-line"], contract["chat-prompt"], contract["ground-rule"], "By the end you'll have", contract["session-goal"]];
    const positions = wanted.map((w) => headlines.findIndex((h) => h.trim() === w));
    if (positions.some((p) => p < 0)) throw new Error(`every filled opening line is a slide: ${JSON.stringify(wanted.map((w, i) => [w, positions[i]]))}`);
    for (let i = 1; i < positions.length; i++) if (positions[i] < positions[i - 1]) throw new Error(`the opening lines are in the coach's order, got ${positions.join(",")}`);
    // The reflection beat sits before the offer, so it appears only once an offer is linked (covered by the unit test); this fresh webinar has none.
    console.log("✓ the filled opening contract is five slides in the coach's order, all the coach's own words");

    // The blank line is listed, not a slide and not a placeholder.
    const omitted = (await page.locator('[data-testid="deck-opening-omitted"]').innerText()).trim();
    if (!/Permission to be direct/.test(omitted) || !/left out/.test(omitted)) throw new Error(`a blank opening line is listed as left out, got "${omitted}"`);
    if (headlines.some((h) => /\[.*\]/.test(h))) throw new Error("a blank opening line is never a placeholder on a face");
    console.log(`✓ the blank line is listed, not shown: "${omitted}"`);

    // Suggested pictures are counted (the cover's photo at least). Empty here, so every slide exports as text.
    const slots = (await page.locator('[data-testid="deck-slots"]').innerText()).trim();
    if (!/suggested picture/.test(slots) || !/exports as text/.test(slots)) throw new Error(`the suggested pictures are counted and named, got "${slots}"`);
    console.log(`✓ suggested pictures counted: "${slots}"`);

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Deck v2 walk passed.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
