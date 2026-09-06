/** End-to-end: a member's own Private Integration token → validation with real reasons → channel map → schedule → Social Planner → status sync, against scripts/mock-ghl.ts. */
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
async function saveConnection(page: Page, locationId: string, token: string) {
  await page.fill('input[name="locationId"]', locationId);
  await page.fill('input[name="manualToken"]', token);
  await submit(page, 'button:has-text("Connect and check"), button:has-text("Save and check")');
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(mockPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // Coach: enable GoHighLevel and point it at the mock (no agency token anywhere)
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/integrations`);
    const ghlForm = page.locator('form:has(input[name="provider"][value="gohighlevel"])').first();
    if ((await ghlForm.locator('input[name="apiKey"], input[name="companyId"]').count()) !== 0) throw new Error("agency token / company ID fields must be gone");
    await ghlForm.locator('input[name="enabled"]').check();
    await ghlForm.locator('input[name="apiUrl"]').fill(`http://localhost:${mockPort}`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), ghlForm.locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle");
    await expectText(page, "Client sub-accounts", "coach sees connection status list");
    console.log("✓ coach: GoHighLevel enabled without any agency credential");

    // Member: token validation with real reasons
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/settings`);
    await expectText(page, "Private Integrations → Create new integration", "guidance shown");
    await expectText(page, "socialplanner/post.write", "scopes listed");
    await saveConnection(page, "loc_maya", "wrong-token");
    await expectText(page, "rejected the token (401)", "bad token reason");
    await saveConnection(page, "loc_maya", "pit-noscope");
    await expectText(page, "missing Social Planner permissions (403)", "missing scope reason");
    await saveConnection(page, "loc_other", "pit-loc_maya");
    await expectText(page, "doesn't match this token", "wrong location reason");
    await saveConnection(page, "loc_maya", "pit-loc_maya");
    await expectText(page, "connected · 5 accounts", "valid token connected");
    await expectText(page, "5/5 channels will auto-publish", "auto-mapped");
    await page.selectOption('select[name="map_linkedin"]', "");
    await submit(page, 'button:has-text("Save channel map")');
    await expectText(page, "4/5 channels will auto-publish", "map saved");
    await page.screenshot({ path: "screenshots/g01-settings-ghl.png", fullPage: true });
    console.log("✓ member: 401, 403 and wrong-location reasons shown; valid token connects and maps");

    // Publish through the Social Planner
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
    console.log("✓ scheduled through the Social Planner with the member's token and synced status");

    // Coach sees it in the sync log and the status list
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/integrations`);
    await expectText(page, "Scheduled via Social Planner", "sync log sent");
    await expectText(page, "4/5 channels", "coach status list");
    console.log("✓ sync log and status list");
  } finally {
    await browser.close();
    try {
      if (mock.pid) process.kill(-mock.pid, "SIGTERM"); // the mock is npx's grandchild: kill the group
    } catch {
      mock.kill();
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("GHL smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
