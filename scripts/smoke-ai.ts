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
  // The app says when it is still loading a page; wait for that to clear before judging what is on it.
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "hidden", timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
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
  // Every mock reply is held 1.5s so the status line under a ✨ action is visible while the call runs.
  const mock = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(mockPort), "1500"], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await login(page, "client");

    // Before the click, every ✨ action says what it needs: without a key, the key
    await page.goto(`${base}/content/ladders`);
    const promiseNoKey = await page.locator('[data-testid="ai-promise"]').first().innerText();
    if (!/needs your own Anthropic or OpenAI key/.test(promiseNoKey)) throw new Error(`ladder page should say it needs a key before the click, got "${promiseNoKey}"`);
    if (!(await page.locator('[data-testid="ai-promise"] a[href="/settings#ai"]').count())) throw new Error("the key line has no way to Settings");
    console.log("✓ without a key the ✨ actions say so, with the way to Settings");

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
    await connect(page, "openai", "sk-nomodel");
    await expectText(page, "does not have access to the model gpt-5.6-sol", "openai model access reason");
    await connect(page, "anthropic", "sk-ant-nomodel");
    await expectText(page, "does not have access to the model claude-sonnet-5", "anthropic model access reason");
    await connect(page, "openai", "sk-good");
    await expectText(page, "connected · OpenAI · ····good", "openai connected");
    await connect(page, "anthropic", "sk-ant-good");
    await expectText(page, "connected · Anthropic · ····good", "anthropic connected");
    if ((await page.locator('input[name="key"]').inputValue()) !== "") throw new Error("key field should be cleared after save");
    if (/sk-ant-good/.test(await page.content())) throw new Error("full key must never be shown again");
    await page.screenshot({ path: "screenshots/ai01-settings.png", fullPage: true });
    console.log("✓ key validation: 401, no billing (both providers), no model access (both providers), wrong provider, connected; key never shown again");

    // With a key, every ✨ action says what comes back, counted, before the click
    await page.goto(`${base}/content/ladders`);
    const ladderPromise = await page.locator('[data-testid="ai-promise"][data-enabled="1"]').first().innerText();
    if (!/9–11 comment rungs/.test(ladderPromise) || !/Threads chain/.test(ladderPromise)) throw new Error(`ladder promise should count the artifacts, got "${ladderPromise}"`);
    console.log(`✓ ladder promise before the click: "${ladderPromise.trim().slice(0, 90)}…"`);

    // A ✨ feature on the member's key: repurpose with AI, then usage appears
    await page.goto(`${base}/content`);
    await page.click('main a[href^="/content/"]:not([href*="compose"]):not([href*="ladders"])');
    await page.waitForURL(/\/content\/[^/]+$/);
    await page.goto(page.url() + "/repurpose");
    const promises = await page.locator('[data-testid="ai-promise"][data-enabled="1"]').allInnerTexts();
    if (promises.length < 2 || !promises.some((t) => /one draft per channel/.test(t)) || !promises.some((t) => /one draft per group/.test(t))) throw new Error(`repurpose page should carry both promise lines: ${JSON.stringify(promises)}`);
    // While the call runs the ✨ action narrates what it is doing; the line is gone the moment the result lands
    await page.click('button:has-text("✨ With")');
    const status = page.locator('[data-testid="ai-status"]');
    await status.waitFor({ timeout: 5000 });
    const firstLine = await status.innerText();
    if (!/Reading the group's rules and tone\./.test(firstLine)) throw new Error(`status should narrate the group draft step, got "${firstLine}"`);
    if (/…|%/.test(firstLine)) throw new Error("status line must not animate dots or fake a percentage");
    await expectText(page, "Mock AI draft", "ai draft used");
    if (await status.count()) throw new Error("status line left stranded after the call returned");
    console.log(`✓ status line while the call runs: "${firstLine.trim()}"`);
    // A group draft is bounded by its channel's spec (own group or someone else's), the same rule every other channel post gets
    const lastCall = (await (await fetch(`http://localhost:${mockPort}/__last`)).json()) as { system: { text: string }[] };
    const task = lastCall.system.map((b) => b.text).join("\n");
    const bound = task.match(/Channel: (Your Facebook group|Other people's groups)\.(?: Format: [^\n]*?)? Max (2000|1200) chars\. Links: (ok|none)\./);
    if (!bound) throw new Error(`the group draft task must carry its channel's length and link rule, got: ${task.slice(-300)}`);
    console.log(`✓ group draft bounded by its channel: "${bound[0]}"`);
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
