/**
 * Times Today's first load for a coach switched into the demo client (H-164 §9): signs in as the coach, opens the client in
 * View, then loads /today a few times and prints the wall time of each navigation. The server's own breakdown is the
 * "[today] viewer=… reads=… rest=…" line in the dev server log. Usage: npx tsx scripts/time-today.ts [http://localhost:3000] [runs]
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const runs = Number(process.argv[4] ?? process.argv[3] ?? 3) || 3;

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  try {
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/coach`);
    await Promise.all([page.waitForURL(/\/today/), page.locator('[data-testid="list-switch"]').first().click()]);
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = Date.now();
      await page.goto(`${base}/today`, { waitUntil: "load" });
      await page.locator("main h1").first().waitFor({ timeout: 60000 });
      times.push(Date.now() - t0);
    }
    console.log(`today (switched in): ${times.map((t) => `${t}ms`).join(" ")} · median ${[...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]}ms`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
