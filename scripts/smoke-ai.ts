/**
 * Bring-your-own AI: key validation with real reasons, a ✨ feature running on the member's key, usage showing up for the member
 * and the coach, and the daily cap. Runs against scripts/mock-ai.ts; the dev server must be started with AI_BASE_URL=http://localhost:4020.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4020;

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
async function connect(page: Page, provider: string, key: string) {
  await page.goto(`${base}/settings`);
  await page.selectOption('select[name="provider"]', provider);
  await page.fill('input[name="key"]', key);
  await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');
}
async function login(page: Page, who: "client" | "coach") {
  await page.goto(`${base}/settings`).catch(() => null);
  if (await page.locator('button:has-text("Log out")').count()) {
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
  } else await page.goto(`${base}/login`);
  await page.click(who === "client" ? 'button:has-text("As a client")' : 'button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(mockPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await login(page, "client");

    // No key: the ✨ features point at Settings, nothing names an environment variable
    await page.goto(`${base}/content/compose`);
    await expectText(page, "Connect your AI key in Settings", "composer prompts to connect");
    const html = await page.content();
    if (/ANTHROPIC_API_KEY/.test(html)) throw new Error("client-facing copy still names the environment variable");
    await page.goto(`${base}/content/ladders`);
    await expectText(page, "Build the skeleton", "ladders without key");
    console.log("✓ no key: rule-based paths, no env var named");

    // Validation reasons
    await connect(page, "anthropic", "sk-ant-wrong");
    await expectText(page, "rejected the key (401)", "bad key reason");
    await connect(page, "anthropic", "sk-ant-nobill");
    await expectText(page, "no billing set up", "no billing reason");
    await connect(page, "anthropic", "sk-good");
    await expectText(page, "looks like an OpenAI key", "wrong provider reason");
    await connect(page, "openai", "sk-nobill");
    await expectText(page, "no billing set up", "openai no billing reason");
    await connect(page, "openai", "sk-good");
    await expectText(page, "connected · OpenAI · ····good", "openai connected");
    await connect(page, "anthropic", "sk-ant-good");
    await expectText(page, "connected · Anthropic · ····good", "anthropic connected");
    if ((await page.locator('input[name="key"]').inputValue()) !== "") throw new Error("key field should be cleared after save");
    if (/sk-ant-good/.test(await page.content())) throw new Error("full key must never be shown again");
    await page.screenshot({ path: "screenshots/ai01-settings.png", fullPage: true });
    console.log("✓ key validation: 401, no billing (both providers), wrong provider, connected; key never shown again");

    // A ✨ feature on the member's key: repurpose with AI, then usage appears
    await page.goto(`${base}/content`);
    await page.click('main a[href^="/content/"]:not([href*="compose"]):not([href*="ladders"])');
    await page.waitForURL(/\/content\/[^/]+$/);
    await page.goto(page.url() + "/repurpose");
    await submit(page, 'button:has-text("✨ With")');
    await expectText(page, "Mock AI draft", "ai draft used");
    await page.goto(`${base}/settings`);
    await expectText(page, "Group-aligned drafts", "usage by feature");
    const usage = await page.locator('[data-testid="ai-usage"]').innerText();
    if (!/[2-9] calls/.test(usage)) throw new Error(`expected at least 2 calls (key check + repurpose), got: ${usage.slice(0, 80)}`);
    console.log("✓ group drafts ran on the member's key and show in usage");

    // Coach sees who has a key and their volume; sets the cap to 2 so the member is blocked
    await login(page, "coach");
    await page.goto(`${base}/coach`);
    await expectText(page, "AI keys and usage", "coach card");
    const coachAi = await page.locator('[data-testid="coach-ai"]').innerText();
    if (!/anthropic ····good/.test(coachAi)) throw new Error("coach does not see the client's key");
    await page.fill('input[name="cap"]', "2");
    await submit(page, 'form:has(input[name="cap"]) button:has-text("Save")');
    await page.screenshot({ path: "screenshots/ai02-coach.png", fullPage: true });
    console.log("✓ coach sees keys and volume; cap set to 2");

    // Member: at the cap, ✨ is paused with a clear message; coach lifts it; ✨ is back
    await login(page, "client");
    await page.goto(`${base}/settings`);
    await expectText(page, "cap is reached", "cap message");
    await page.goto(`${base}/content/ladders`);
    await expectText(page, "Build the skeleton", "ai paused on ladders");
    await login(page, "coach");
    await page.goto(`${base}/coach`);
    await submit(page, '[data-testid="coach-ai"] li:has-text("Maya") button:has-text("cap on")');
    await expectText(page, "cap lifted", "exempt");
    await login(page, "client");
    await page.goto(`${base}/content/ladders`);
    await expectText(page, "Write the ladder", "ai back after override");
    console.log("✓ daily cap pauses ✨ with a message; coach override restores it");

    // Remove key
    await page.goto(`${base}/settings`);
    await submit(page, 'button:has-text("Remove key")');
    await expectText(page, "not connected", "removed");
    console.log("✓ key removed");
  } finally {
    await browser.close();
    try {
      if (mock.pid) process.kill(-mock.pid, "SIGTERM");
    } catch {
      mock.kill();
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("AI smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
