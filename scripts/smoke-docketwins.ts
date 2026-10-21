/**
 * Docket PR 2, the quick wins (H-195). Jordan, the second demo client, signs in. On Today, "Did something else? Add it" logs
 * a win that wasn't on the list as a task done today, with its points. Close the day has its "Also today" counters, and
 * My Helix's Customer journey rung leads to the Pathway. At 390, nothing scrolls sideways. The win and its points are taken
 * back after.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
const noSideways = async (page: Page, where: string) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  must(over <= 1, `${where}: nothing scrolls sideways at 390 (${over}px over)`);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
  const title = `Walked a prospect through the offer ${Date.now().toString(36)}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', "client2@demo.helixos.app");
    await page.fill('input[name="password"]', "demo1234");
    await Promise.all([page.waitForURL(/\/today/, { timeout: 30000 }), page.click('button:has-text("Sign in")')]);
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="log-win-title"]').fill(title);
    await submit(page, '[data-testid="log-win-add"]');
    const task = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, jordan.id), eq(schema.tasks.title, title)) });
    must(task?.status === "done" && Boolean(task.completedAt), `the win is a task done today: ${task?.status}`);
    const paid = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, jordan.id), eq(schema.pointsLedger.refId, task!.id)) });
    must(paid.length === 1 && paid[0]!.type === "task" && paid[0]!.points > 0, "with the usual task points");
    must((await page.locator('[data-testid="close-also"]').count()) === 1, "Close the day has its Also today counters");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="log-win"]').waitFor({ timeout: 20000 });
    await noSideways(page, "Today");
    await page.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
    await noSideways(page, "My Helix");
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
    await page.click('[data-testid="helix-phase-2"]');
    must((await page.locator('[data-testid="helix-rungs-2"] a[href="/pathway"]').count()) >= 1, "Customer journey mapped leads to the Pathway");
    must(!failures.length, `no server errors: ${failures.join(", ")}`);
    await db.delete(schema.pointsLedger).where(inArray(schema.pointsLedger.id, paid.map((p) => p.id)));
    await db.delete(schema.tasks).where(eq(schema.tasks.id, task!.id));
  } finally {
    await browser.close();
  }
  console.log("Docket quick wins smoke passed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
