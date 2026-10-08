/**
 * Business goals (BG1): the client's plan under Grow. The one goal from Today is there as the Primary business goal; a key
 * result goes under it and an initiative under that, with a task added and ticked; the tree and the table read them; the
 * coach sees the read-only line. Nothing here touches Body's Health goals.
 *
 *   npx tsx scripts/smoke-goals.ts http://localhost:3000
 */
import { chromium, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

const base = process.argv[2] ?? "http://localhost:3000";

async function signIn(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
    await signIn(page, "As a client");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const legacy = (await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, maya.id), eq(schema.goals.primary, true)) }))!;

    // ── The one goal from Today is the Primary business goal, first in the tree. ──
    await page.goto(`${base}/goals`);
    await page.locator('[data-testid="plan-tree"]').waitFor({ timeout: 30000 });
    const primary = await db.query.planRecords.findFirst({ where: and(eq(schema.planRecords.userId, maya.id), eq(schema.planRecords.primary, true)) });
    if (!primary || primary.goalId !== legacy.id || primary.title !== legacy.title) throw new Error(`the primary goals row is mirrored as the Primary business goal: ${JSON.stringify(primary)}`);
    // A card's title renders in capitals: read it as the DOM has it.
    const firstGoal = (await page.locator('[data-testid="plan-tree"] section').first().innerText()).toUpperCase();
    if (!firstGoal.includes(`★ ${legacy.title}`.toUpperCase()) || !firstGoal.includes("NO KEY RESULTS YET")) throw new Error(`the Primary business goal leads the tree: ${firstGoal.slice(0, 120)}`);
    console.log(`✓ the one goal "${legacy.title}" is the ★ Primary business goal, first in the tree`);

    // ── A key result under it, from + New; then an initiative under the key result, from its page; then a task. ──
    await page.locator('[data-testid="plan-new"]').click();
    await page.fill('[data-testid="plan-title"]', "12 calls booked");
    await page.selectOption('[data-testid="plan-kind"]', "key_result");
    await page.selectOption('[data-testid="plan-parent"]', primary.id);
    await page.fill('[data-testid="plan-owner"]', "Maya");
    await page.fill('[data-testid="plan-due"]', "2026-10-31");
    await Promise.all([page.waitForURL(/\/goals\/[^/?]+$/), page.locator('[data-testid="plan-save"]').click()]);
    const krId = page.url().split("/goals/")[1];
    await page.locator('[data-testid="plan-crumb"]').waitFor({ timeout: 20000 });
    if (!(await page.locator('[data-testid="plan-crumb"]').innerText()).includes(`under ${legacy.title}`) || !(await page.title()).startsWith("12 calls booked")) throw new Error("the key result's page names its goal and carries its own title");
    await page.locator('[data-testid="plan-child-new"]').click();
    await page.fill('[data-testid="plan-form"] [data-testid="plan-title"]', "Daily DMs");
    await Promise.all([page.waitForURL(/\/goals\/[^/?]+$/), page.locator('[data-testid="plan-form"] [data-testid="plan-save"]').click()]);
    await page.locator('[data-testid="plan-children"] [data-testid="plan-child-link"]', { hasText: "Daily DMs" }).waitFor({ timeout: 20000 });
    await page.locator('[data-testid="plan-child-link"]', { hasText: "Daily DMs" }).click();
    await page.waitForURL(/\/goals\//);
    await page.locator('[data-testid="plan-task-new"]').waitFor({ timeout: 20000 });
    await page.fill('[data-testid="plan-task-title"]', "Send 3 DMs before lunch");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="plan-task-add"]').click()]);
    await page.locator('[data-testid="plan-tasks"]', { hasText: "Send 3 DMs before lunch" }).waitFor({ timeout: 20000 });
    const task = (await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.title, "Send 3 DMs before lunch")) }))!;
    const initiative = (await db.query.planRecords.findFirst({ where: and(eq(schema.planRecords.userId, maya.id), eq(schema.planRecords.title, "Daily DMs")) }))!;
    const link = await db.query.planLinks.findFirst({ where: and(eq(schema.planLinks.fromId, initiative.id), eq(schema.planLinks.toId, task.id)) });
    if (!task || !link || link.toKind !== "task") throw new Error("the task is made through the tasks' rules and linked to the initiative");
    await page.locator('[data-testid="plan-tasks"] button[aria-label="Mark done"]').first().click();
    await page.waitForTimeout(800);
    await page.reload();
    await page.locator("text=Tasks · 1 of 1 done").waitFor({ timeout: 20000 });
    console.log("✓ a key result under the goal, an initiative under it, a task added and ticked: 1 of 1 done on the initiative's page");

    // ── The tree and the table read them; the filter narrows. ──
    await page.goto(`${base}/goals`);
    const tree = (await page.locator('[data-testid="plan-tree"] section').first().innerText()).toUpperCase();
    if (!tree.includes("0 OF 1 KEY RESULTS ON TRACK") || !tree.includes("12 CALLS BOOKED") || !tree.includes("DAILY DMS") || !tree.includes("1 OF 1 TASKS DONE")) throw new Error(`the tree nests the key result and the initiative with its task count: ${tree.slice(0, 200)}`);
    await page.goto(`${base}/goals?view=table&kind=key_result`);
    const rows = page.locator('[data-testid="plan-table-row"]');
    if ((await rows.count()) !== 1 || !(await rows.first().innerText()).includes("Maya")) throw new Error("the table filtered to key results shows the one, with its owner");
    await page.goto(`${base}/goals?view=table&owner=nobody`);
    await page.locator("text=Nothing matches").waitFor({ timeout: 20000 });
    // The record page edits; archive takes an initiative off the tree, never the primary goal (it has no Archive).
    await page.goto(`${base}/goals/${krId}`);
    await page.selectOption('[data-testid="plan-edit-status"]', "on_track");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="plan-edit-save"]').click()]);
    await page.waitForTimeout(600);
    await page.goto(`${base}/goals`);
    await page.locator('[data-testid="plan-goal-pace"]', { hasText: "1 of 1 key results on track" }).waitFor({ timeout: 20000 });
    await page.goto(`${base}/goals/${primary.id}`);
    if (await page.locator('[data-testid="plan-archive"]').count()) throw new Error("the Primary business goal cannot be archived");
    await page.goto(`${base}/settings`);
    if ((await page.locator('[data-testid="goal-plan-link"]').getAttribute("href")) !== "/goals") throw new Error("Your one goal links to Business goals");
    console.log("✓ the tree counts, the table filters, a status edit moves the roll-up, the primary goal has no Archive, Settings links across");

    // ── The coach reads a line, read-only. ──
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await signIn(page, "As the coach");
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    await page.goto(`${base}/coach/${m.id}`);
    await page.locator('[data-testid="coach-plan-line"]').waitFor({ timeout: 30000 });
    const line = await page.locator('[data-testid="coach-plan-line"]').innerText();
    if (!line.includes("1 goal · 1 of 1 key results on track · 1 of 1 initiatives not started")) throw new Error(`the coach's line counts the plan: ${line}`);
    if (await page.locator('[data-testid="coach-plan"] a').count()) throw new Error("the coach's card is read-only");
    console.log(`✓ the coach reads "${line}" on the client page, nothing to click`);
    console.log("Goals walk passed.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
