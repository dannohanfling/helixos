/**
 * A brand-new client's first five minutes, on a phone: join with the invite code, land on Today with the welcome card, no
 * contract/payment/access tasks as the next step, no $0 / $5,000 goal bar, no Community Pass upsell in the nav, task controls
 * visible without hover, delete asks first, and inputs at 16px so iOS Safari doesn't zoom.
 */
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

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // Join as a brand-new client
    await page.goto(`${base}/join/ACADEMY1`);
    await expectText(page, "Join Evolve Omega Academy", "join page");
    const email = `firstday-${Date.now()}@example.com`;
    await page.fill('input[name="name"]', "Priya Natarajan");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "firstday-pass-123");
    await Promise.all([page.waitForURL(/\/today/, { timeout: 20000 }), page.click('button[type="submit"]')]);

    // Welcome card, not raw operational data
    await expectText(page, "Welcome to HelixOS", "welcome card");
    await expectText(page, "Lock in your first day", "welcome cta");
    const body = await page.locator("main").innerText();
    for (const admin of ["Sign the agreement", "Make your first payment", "Complete your onboarding form", "Confirm your GoHighLevel access", "Confirm your HelixOS access", "Schedule your kickoff call"]) {
      if (body.includes(admin)) throw new Error(`admin task "${admin}" shown to a new client on Today`);
    }
    if (/\$0 \/ \$5,000/.test(body)) throw new Error("the $0 / $5,000 goal bar is shown on day one");
    await expectText(page, "Set your one goal", "goal prompt instead of bar");
    await page.screenshot({ path: "screenshots/fd01-first-today.png", fullPage: true });
    console.log("✓ first Today: welcome card, no admin tasks, no empty goal bar");

    // Pathway: the next step is a real action, admin tasks are extras
    await page.goto(`${base}/pathway`);
    const now = await page.locator("main").innerText();
    for (const admin of ["Sign the agreement", "Make your first payment", "Confirm your GoHighLevel access"]) {
      if (now.includes(admin) && !/extras?/i.test(now)) throw new Error(`admin task "${admin}" in the simple path`);
    }
    await expectText(page, "Choose where your community will live", "first real step");
    console.log("✓ pathway: first step is a real action");

    // No Community Pass upsell in the nav for a non-Elite client (mobile "More" and the desktop sidebar markup)
    await page.goto(`${base}/more`);
    const more = await page.locator("main").innerText();
    if (/Community Pass/.test(more)) throw new Error("Community Pass shown in More for a non-Elite client");
    const side = await page.locator("aside, nav").allInnerTexts();
    if (side.join(" ").includes("Community Pass")) throw new Error("Community Pass shown in the sidebar for a non-Elite client");
    console.log("✓ nav: no Community Pass upsell without the pass");

    // Task controls visible without hover, 40px targets, delete asks first
    await page.goto(`${base}/tasks`);
    const controls = page.locator('[data-testid="task-controls"]').first();
    await controls.waitFor();
    const opacity = await controls.evaluate((el) => Number(getComputedStyle(el).opacity));
    if (opacity < 0.5) throw new Error(`task controls hidden without hover (opacity ${opacity})`);
    const del = controls.locator('button[title="Delete"]');
    const box = await del.boundingBox();
    if (!box || box.height < 38 || box.width < 38) throw new Error(`delete target too small on touch: ${JSON.stringify(box)}`);
    const before = await page.locator('[data-testid="task-controls"]').count();
    page.once("dialog", (d) => d.dismiss());
    await del.click();
    await page.waitForTimeout(600);
    if ((await page.locator('[data-testid="task-controls"]').count()) !== before) throw new Error("cancelling the confirm still deleted the task");
    page.once("dialog", (d) => d.accept());
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), del.click()]);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const after = await page.locator('[data-testid="task-controls"]').count();
    if (after >= before) throw new Error(`confirming did not delete the task (${before} → ${after})`);
    console.log("✓ task controls visible on touch, 40px targets, delete confirms first");

    // Inputs at 16px
    const fs = await page.locator("input.field, textarea.field, select.field").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (fs < 16) throw new Error(`.field renders at ${fs}px; iOS Safari zooms below 16`);
    console.log(`✓ fields at ${fs}px`);
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("First-day smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
