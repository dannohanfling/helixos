/** End-to-end: agency token → per-client sub-account → accounts → channel map → schedule → Social Planner → status sync, against scripts/mock-ghl.ts. */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4010;

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

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(mockPort)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // A member must not be able to bind themselves to someone else's sub-account and mint an agency token for it
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', "client2@demo.helixos.app");
    await page.fill('input[name="password"]', "demo1234");
    await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]:has-text("Sign in")')]);
    await page.goto(`${base}/settings`);
    await page.fill('input[name="locationId"]', "loc_maya");
    await submit(page, 'button:has-text("Connect"), button:has-text("Save and refresh")');
    await expectText(page, "Paste your sub-account", "member blocked from foreign location");
    await page.fill('input[name="locationId"]', "loc_jordan");
    await page.fill('input[name="manualToken"]', "pit-token");
    await submit(page, 'button:has-text("Save and refresh")');
    await expectText(page, "own token", "member connected with own token");
    console.log("✓ member cannot hijack another sub-account; own token works");
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);


    // Coach: point the agency integration at the mock
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/integrations`);
    const ghlForm = page.locator('form:has(input[name="provider"][value="gohighlevel"])').first();
    await ghlForm.locator('input[name="enabled"]').check();
    await ghlForm.locator('input[name="apiUrl"]').fill(`http://localhost:${mockPort}`);
    await ghlForm.locator('input[name="apiKey"]').fill("agency-token");
    await ghlForm.locator('input[name="companyId"]').fill("agency_demo");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), ghlForm.locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle");
    await expectText(page, "Client sub-accounts", "coach sub-accounts card");
    // Coach connects Jordan's sub-account from here
    await page.locator('summary:has-text("Jordan Lee")').click();
    const jordan = page.locator('details:has(summary:has-text("Jordan Lee")) form:has(input[name="locationId"])').first();
    await jordan.locator('input[name="locationId"]').fill("loc_jordan");
    await jordan.locator('input[name="ghlUserId"]').fill("user_jordan");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), jordan.locator('button:has-text("Connect"), button:has-text("Save and refresh")').first().click()]);
    await page.waitForLoadState("networkidle");
    await expectText(page, "5 accounts", "coach-side accounts fetched");
    console.log("✓ coach connected a client sub-account");

    // Client: connect own sub-account on Settings (token minted from the agency token)
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/settings`);
    await expectText(page, "Publishing (your GoHighLevel sub-account)", "settings publishing card");
    await submit(page, 'button:has-text("Save and refresh")');
    await expectText(page, "5 accounts", "client accounts fetched");
    await expectText(page, "5/5 channels will auto-publish", "auto-mapped");
    await page.selectOption('select[name="map_linkedin"]', "");
    await submit(page, 'button:has-text("Save channel map")');
    await expectText(page, "4/5 channels will auto-publish", "map saved");
    await page.screenshot({ path: "screenshots/g01-settings-ghl.png", fullPage: true });

    // Schedule from the composer
    await page.goto(`${base}/content/compose`);
    await page.fill('input[placeholder^="Working title"]', "GHL end to end");
    await page.fill('input[placeholder^="Hook"]', "Twelve minutes on Tuesday.");
    await page.fill('textarea[placeholder^="Type content"]', "Beats three hours on Sunday.\nEvery single week.");
    await page.click('button[title="Facebook business page"]');
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Scheduled \d+ posts/).waitFor({ timeout: 20000 });
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await page.waitForTimeout(1500);
    await page.reload();
    await expectText(page, "Social Planner: scheduled", "variant pushed to social planner");
    await expectText(page, "paste by hand", "manual channels marked");
    await submit(page, 'button:has-text("Check status")');
    await expectText(page, "Social Planner: published", "status synced");
    await page.screenshot({ path: "screenshots/g02-distribute-ghl.png", fullPage: true });
    console.log("✓ scheduled through the Social Planner and synced status");

    // Coach sees it in the sync log
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/integrations`);
    await expectText(page, "Scheduled via Social Planner", "sync log sent");
    console.log("✓ sync log");
  } finally {
    await browser.close();
    mock.kill();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("GHL smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
