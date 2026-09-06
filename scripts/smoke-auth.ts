/**
 * Auth walks: first-run /setup (token gate, 404 once a workspace exists, 404 when SETUP_TOKEN is unset), forgot → reset with session
 * invalidation, and change-password. Spawns two extra `next start` servers (needs a current `next build`) on fresh databases for the
 * setup cases, since Next allows only one dev server per directory; needs the main dev server on :3000.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const scratch = process.env.SMOKE_SCRATCH ?? "/tmp/helixos-smoke-auth";
mkdirSync(scratch, { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 20000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}

async function waitFor(url: string, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server at ${url} did not come up`);
}

/** A production server (from the existing build) on its own fresh database, with the env we choose. */
async function devServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const dbFile = `${scratch}/db-${port}.db`;
  rmSync(dbFile, { force: true });
  const common = { ...process.env, DATABASE_URL: `file:${dbFile}`, SESSION_SECRET: "smoke-session-secret-smoke-session-secret", ...env };
  await new Promise<void>((resolve, reject) => {
    const m = spawn("npx", ["tsx", "scripts/migrate.ts"], { env: common, stdio: "ignore" });
    m.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("migrate failed"))));
  });
  const child = spawn("npx", ["next", "start", "-p", String(port)], { env: common, stdio: "ignore" });
  await waitFor(`http://localhost:${port}/login`);
  return child;
}

async function setupWalk(browser: Browser) {
  const server = await devServer(3001, { SETUP_TOKEN: "setup-secret-token" });
  try {
    const page = await (await browser.newContext()).newPage();
    const b = "http://localhost:3001";
    let r = await page.goto(`${b}/setup`);
    if (r?.status() !== 404) throw new Error(`/setup without token should be 404, got ${r?.status()}`);
    r = await page.goto(`${b}/setup?token=wrong`);
    if (r?.status() !== 404) throw new Error(`/setup with wrong token should be 404, got ${r?.status()}`);
    await page.goto(`${b}/setup?token=setup-secret-token`);
    await expectText(page, "Set up your workspace", "setup form");
    await page.fill('input[name="name"]', "Evolve Omega Academy");
    await page.fill('input[name="coachName"]', "Danno Hanfling");
    await page.fill('input[name="coachEmail"]', "danno@example.com");
    await page.fill('input[name="password"]', "strongpass123");
    await page.fill('input[name="confirm"]', "strongpass123");
    await page.click('button:has-text("Create workspace")');
    await page.waitForURL(/\/setup\/done/);
    await expectText(page, "Save these two links now", "invite links shown once");
    const coachLink = await page.locator('[data-testid="coach-link"]').textContent();
    if (!coachLink?.includes("/join/")) throw new Error("coach link missing");
    await Promise.all([page.waitForURL(/\/today/), page.click('a:has-text("Take me in")')]);
    await expectText(page, "Evolve Omega Academy", "signed in as coach after setup");
    r = await page.goto(`${b}/setup/done`);
    if (r?.status() !== 404) throw new Error(`/setup/done after leaving should be 404, got ${r?.status()}`);
    r = await page.goto(`${b}/setup?token=setup-secret-token`);
    if (r?.status() !== 404) throw new Error(`/setup after setup should be 404, got ${r?.status()}`);
    // Coach login works with the chosen password
    await page.goto(`${b}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.fill('input[name="email"]', "danno@example.com");
    await page.fill('input[name="password"]', "strongpass123");
    await Promise.all([page.waitForURL(/\/today/), page.click('button:has-text("Sign in")')]);
    console.log("✓ setup: token gate, form, links once, signed in, 404 afterwards, login works");
  } finally {
    server.kill();
  }
}

async function setupDisabledWalk(browser: Browser) {
  const server = await devServer(3002, {});
  try {
    const page = await (await browser.newContext()).newPage();
    const r = await page.goto("http://localhost:3002/setup?token=anything");
    if (r?.status() !== 404) throw new Error(`/setup with SETUP_TOKEN unset should be 404, got ${r?.status()}`);
    console.log("✓ setup: 404 when SETUP_TOKEN is unset, even on an empty database");
  } finally {
    server.kill();
  }
}

async function resetWalk(browser: Browser) {
  // A second device stays signed in as the client; it must be signed out after the reset.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${base}/login`);
  await other.click('button:has-text("As a client")');
  await other.waitForURL(/\/today/);

  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}/login`);
  await page.click('a:has-text("Forgot your password?")');
  await page.waitForURL(/\/forgot/);
  await page.fill('input[name="email"]', "nobody@example.com");
  await page.click('button:has-text("Send reset link")');
  await expectText(page, "If that email has an account", "generic reply for unknown email");
  await page.goto(`${base}/forgot`);
  await page.fill('input[name="email"]', "client@demo.helixos.app");
  await page.click('button:has-text("Send reset link")');
  await expectText(page, "If that email has an account", "generic reply for known email");
  const link = await page.locator('[data-testid="dev-reset-link"]').getAttribute("href");
  if (!link) throw new Error("dev reset link not shown (RESEND_API_KEY must be unset in dev)");
  await page.goto(link);
  await page.fill('input[name="password"]', "brand-new-pass-1");
  await page.fill('input[name="confirm"]', "brand-new-pass-1");
  await Promise.all([page.waitForURL(/\/today/), page.click('button:has-text("Save new password")')]);
  console.log("✓ reset: link used, signed in");
  // Single use
  await page.goto(link);
  await page.fill('input[name="password"]', "another-pass-123");
  await page.fill('input[name="confirm"]', "another-pass-123");
  await page.click('button:has-text("Save new password")');
  await expectText(page, "expired or was already used", "token single use");
  // The other device is signed out
  await other.goto(`${base}/today`);
  await other.waitForURL(/\/login/);
  console.log("✓ reset: other session invalidated");
  // Old password fails, new works
  await other.fill('input[name="email"]', "client@demo.helixos.app");
  await other.fill('input[name="password"]', "demo1234");
  await other.click('button:has-text("Sign in")');
  await expectText(other, "don't match", "old password rejected");
  await other.fill('input[name="email"]', "client@demo.helixos.app");
  await other.fill('input[name="password"]', "brand-new-pass-1");
  await Promise.all([other.waitForURL(/\/today/), other.click('button:has-text("Sign in")')]);
  console.log("✓ reset: new password works");

  // Change password from Settings on the first device; the second device gets signed out again
  await page.goto(`${base}/settings`);
  await page.fill('input[name="current"]', "wrong-current");
  await page.fill('input[name="password"]', "changed-pass-123");
  await page.fill('input[name="confirm"]', "changed-pass-123");
  await page.click('button:has-text("Change password")');
  await expectText(page, "isn't your current password", "wrong current password rejected");
  await page.fill('input[name="current"]', "brand-new-pass-1");
  await page.fill('input[name="password"]', "changed-pass-123");
  await page.fill('input[name="confirm"]', "changed-pass-123");
  await page.click('button:has-text("Change password")');
  await expectText(page, "Password changed", "password changed");
  await page.goto(`${base}/today`);
  await expectText(page, "Today", "changer stays signed in");
  await other.goto(`${base}/today`);
  await other.waitForURL(/\/login/);
  console.log("✓ change password: current required, other session invalidated, own session kept");
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const r = await fetch(`${base}/setup?token=${process.env.SETUP_TOKEN ?? "main-setup-token"}`);
    if (r.status !== 404) throw new Error(`/setup on the main server (workspace exists) should be 404, got ${r.status}`);
    console.log("✓ setup: 404 once a workspace exists");
    await resetWalk(browser);
    await setupWalk(browser);
    await setupDisabledWalk(browser);
  } finally {
    await browser.close();
  }
  console.log("Auth smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
