/**
 * Submissions to verify (H-1280, plan H-1296), end to end: Maya hands in a Pathway task and a certification deliverable; the
 * coach sees "Submissions to verify" under People with 2, on the sidebar at 1440 and on the More page and the More tab at
 * 390; the item lands on the Verify submissions card with the certification line; verifying the task drops the count to 1;
 * switched into Maya the item is gone; signed in as Maya it is gone; nothing scrolls sideways at 390.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page, who: "As the coach" | "As a client") {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function until(page: Page, check: () => Promise<boolean>, msg: string) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await page.waitForTimeout(250);
  }
  throw new Error(msg);
}
const ITEM = 'a[href="/coach#verify"]';

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const W = mm.workspaceId;
  const TASK_KEY = "smoke-verify-task-key";
  const clear = async () => {
    await db.delete(schema.pathwayProgress).where(and(eq(schema.pathwayProgress.workspaceId, W), like(schema.pathwayProgress.id, "smoke-verify-%")));
    await db.delete(schema.pathwayProgress).where(eq(schema.pathwayProgress.libraryTaskKey, TASK_KEY));
    await db.delete(schema.libraryTasks).where(eq(schema.libraryTasks.key, TASK_KEY));
    await db.delete(schema.certSubmissions).where(and(eq(schema.certSubmissions.workspaceId, W), like(schema.certSubmissions.id, "smoke-verify-%")));
    await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.workspaceId, W), like(schema.pointsLedger.refId, "%smoke-verify-%")));
  };
  await clear();
  // Everything else waiting is cleared out of the way so the counts are exactly this walk's: the seed's own hand-ins go to verified.
  await db.update(schema.pathwayProgress).set({ status: "verified" }).where(and(eq(schema.pathwayProgress.workspaceId, W), eq(schema.pathwayProgress.status, "submitted")));
  await db.update(schema.certSubmissions).set({ status: "passed", score: 90 }).where(and(eq(schema.certSubmissions.workspaceId, W), eq(schema.certSubmissions.status, "submitted")));
  // One row per member and task, and the seed gives Maya every task: the walk hands in a Pathway task of its own.
  const stage = (await db.query.pathwayStages.findFirst())!;
  const task = (await db.query.libraryTasks.findFirst({ where: eq(schema.libraryTasks.key, TASK_KEY) })) ?? (await db.insert(schema.libraryTasks).values({ key: TASK_KEY, stageKey: stage.key, order: 999, name: "Smoke: the verify walk's task", points: 10 }).returning())[0];
  let deliverable = await db.query.certDeliverables.findFirst();
  if (!deliverable) {
    const mod = (await db.query.certModules.findFirst()) ?? (await db.insert(schema.certModules).values({ id: "smoke-verify-module", name: "Smoke module", order: 99 }).returning())[0];
    deliverable = (await db.insert(schema.certDeliverables).values({ id: "smoke-verify-deliverable", moduleId: mod.id, name: "Smoke deliverable", order: 99 }).returning())[0];
  }
  await db.insert(schema.pathwayProgress).values({ id: "smoke-verify-task", workspaceId: W, userId: maya.id, libraryTaskKey: task.key, status: "submitted", submittedAt: new Date().toISOString(), submissionText: "Done, draft attached." });
  await db.insert(schema.certSubmissions).values({ id: "smoke-verify-cert", workspaceId: W, userId: maya.id, deliverableId: deliverable.id, url: "https://example.com/evidence", status: "submitted" });
  const waitingCount = async () =>
    (await db.query.pathwayProgress.findMany({ where: and(eq(schema.pathwayProgress.workspaceId, W), eq(schema.pathwayProgress.status, "submitted")) })).length +
    (await db.query.certSubmissions.findMany({ where: and(eq(schema.certSubmissions.workspaceId, W), eq(schema.certSubmissions.status, "submitted")) })).length;
  must((await waitingCount()) === 2, "two hand-ins wait");

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  try {
    // ── The coach: the item under People with 2, landing on the card. ──
    await login(page, "As the coach");
    await page.goto(`${base}/today`, { waitUntil: "networkidle" });
    const item = page.locator(`[data-testid="side-nav"] ${ITEM}`);
    await item.waitFor({ timeout: 15000 });
    const group = page.locator('[data-testid="nav-group"]', { has: page.locator(ITEM) });
    must((await group.getAttribute("data-group")) === "People", "the item sits under People");
    must((await item.innerText()).includes("Submissions to verify"), "the item is named");
    must((await item.locator('[data-testid="due-badge"]').innerText()).trim() === "2", `the badge reads 2: ${await item.innerText()}`);
    await item.click();
    await page.waitForURL(/\/coach#verify$/);
    await page.locator("#verify").waitFor({ timeout: 15000 });
    must((await page.locator('[data-testid="verify-count"]').innerText()).trim() === "1", "the card counts the one Pathway hand-in");
    must((await page.locator('[data-testid="verify-certs-line"]').innerText()).includes("1 certification hand-in to score"), "the card says a certification hand-in waits");
    must((await page.locator('[data-testid="verify-certs-line"] a').getAttribute("href")) === "/certification", "the line goes to Certification");
    must(/2 submissions waiting/.test(await page.locator("h1 + *, header").first().innerText().catch(() => "")) || (await page.getByText("2 submissions waiting").count()) > 0, "the subtitle counts both kinds");
    console.log("✓ the coach sees Submissions to verify under People with 2, landing on the card with the certification line");

    // ── Verifying the task drops the count to 1. ──
    const row = page.locator("#verify li", { hasText: "Done, draft attached." });
    await row.locator('button[name="decision"][value="verify"]').click();
    await until(page, async () => (await waitingCount()) === 1, "the task was verified");
    await page.goto(`${base}/today`, { waitUntil: "networkidle" });
    must((await page.locator(`[data-testid="side-nav"] ${ITEM} [data-testid="due-badge"]`).innerText()).trim() === "1", "the badge reads 1 after verifying");
    console.log("✓ verifying one drops the count to 1");

    // ── Switched into Maya: gone. Back: there. ──
    await page.goto(`${base}/coach`, { waitUntil: "networkidle" });
    const mayaRow = page.locator("li, tr", { hasText: maya.name ?? "Maya" }).filter({ has: page.locator('[data-testid="list-switch"]') }).first();
    await mayaRow.locator('[data-testid="list-switch"]').click();
    await page.waitForURL(/\/today/);
    await page.locator('[data-testid="switch-back"]').waitFor({ timeout: 15000 });
    must((await page.locator(`[data-testid="side-nav"] ${ITEM}`).count()) === 0, "switched into Maya, the item is gone");
    await page.locator('[data-testid="switch-back"]').click();
    // The switch back is a POST and a redirect: wait for the banner to go before judging the menu.
    await page.locator('[data-testid="switch-back"]').waitFor({ state: "hidden", timeout: 15000 });
    await page.goto(`${base}/today`, { waitUntil: "networkidle" });
    await until(page, async () => (await page.locator(`[data-testid="side-nav"] ${ITEM}`).count()) === 1, "back as the coach, the item is there");
    console.log("✓ switched into a member the item is gone; back as the coach it returns");

    // ── At 390: the More page shows it with its count, the More tab totals it, nothing scrolls sideways. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/more`, { waitUntil: "networkidle" });
    const moreItem = page.locator(`main ${ITEM}, ${ITEM}`).first();
    await moreItem.waitFor({ timeout: 15000 });
    must((await moreItem.locator('[data-testid="due-badge"]').innerText()).trim() === "1", "the More page shows the count");
    const label = (await page.locator('[data-testid="bottom-nav"] a[href="/more"]').getAttribute("aria-label")) ?? "";
    must(/^More, \d+ waiting$/.test(label) && Number(label.match(/\d+/)![0]) >= 1, `the More tab totals it: ${label}`);
    must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, "at 390 nothing scrolls sideways");
    console.log("✓ at 390 the More page shows the count, the More tab totals it, nothing scrolls sideways");

    // ── Maya herself never sees it. ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, "As a client");
    await page.goto(`${base}/today`, { waitUntil: "networkidle" });
    must((await page.locator(ITEM).count()) === 0, "a client has no Submissions to verify item");
    console.log("✓ a client never sees the item");

    must(failures.length === 0, `server errors: ${failures.join(", ")}`);
    console.log("verify-badge walk passed");
  } finally {
    await browser.close();
    await clear();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
