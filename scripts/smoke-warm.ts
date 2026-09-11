/**
 * The warm-up before the first walk of a run: one pass through the routes every walk starts on (login, the demo sign-in,
 * Today, and the sign-out), with a long timeout and no assertion beyond "it responded". A cold dev server compiles these on
 * first request, which has taken minutes; after this, every walk's own 30-second wait is an honest signal again.
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const WARM_TIMEOUT_MS = 300000;

async function main() {
  const started = Date.now();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(WARM_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(WARM_TIMEOUT_MS);
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/, { timeout: WARM_TIMEOUT_MS });
    await page.waitForLoadState("networkidle");
    await page.goto(`${base}/settings`);
    if (await page.locator('button:has-text("Log out")').count()) {
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/, { timeout: WARM_TIMEOUT_MS });
    }
    console.log(`warm-up: login, sign-in, Today and settings responded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
