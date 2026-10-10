/**
 * Business goals (BG1): the client's plan under Grow. The one goal from Today is there as the Primary business goal; a key
 * result goes under it and an initiative under that, with a task added and ticked; the tree and the table read them; the
 * coach sees the read-only line. BG2: a KPI read from the Numbers on the key result, with its pace in the tree; the Primary
 * goal's Cash collected KPI on Today's bar; a close-asked KPI logged through the evening close. Nothing here touches Body's
 * Health goals.
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

    // ── BG2: a KPI read from the Numbers on the key result; its actual is this month's calls booked, its pace in the tree. ──
    const { todayInTz } = await import("@/lib/dates");
    const { readKpi, PACE_LABEL } = await import("@/lib/engine/kpi");
    const ws = (await db.query.workspaces.findFirst())!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const today = todayInTz(mayaM.timezone || ws.timezone);
    await page.goto(`${base}/goals/${krId}`);
    await page.locator('[data-testid="kpi-new"]').click();
    await page.fill('[data-testid="kpi-form-name"]', "Calls booked");
    await page.fill('[data-testid="kpi-form-target"]', "12");
    await page.selectOption('[data-testid="kpi-form-source"]', "numbers");
    await page.selectOption('[data-testid="kpi-form-metric"]', "callsBooked");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="kpi-form-save"]').click()]);
    await page.locator('[data-testid="kpi-row"]', { hasText: "Calls booked" }).waitFor({ timeout: 20000 });
    const kpi = (await db.query.kpis.findFirst({ where: and(eq(schema.kpis.userId, maya.id), eq(schema.kpis.name, "Calls booked")) }))!;
    if (kpi.source !== "numbers" || kpi.metric !== "callsBooked" || kpi.unit !== "count" || kpi.target !== 12 || kpi.recordId !== krId) throw new Error(`the KPI reads the Numbers counter: ${JSON.stringify(kpi)}`);
    const logs = await db.query.dailyLogs.findMany({ where: eq(schema.dailyLogs.userId, maya.id) });
    const expected = readKpi(kpi, today, logs, []);
    const row = page.locator('[data-testid="kpi-row"]', { hasText: "Calls booked" });
    if ((await row.getAttribute("data-pace")) !== expected.pace || !(await row.locator('[data-testid="kpi-actual"]').innerText()).startsWith(`${expected.actual} / 12`)) throw new Error(`the KPI reads ${expected.actual} of 12 and ${expected.pace}: ${await row.innerText()}`);
    if (!(await row.locator('[data-testid="kpi-chart"]').count())) throw new Error("the KPI has its weekly chart");
    await page.goto(`${base}/goals`);
    const kpiLine = page.locator('[data-testid="plan-kpi"]', { hasText: "Calls booked" });
    await kpiLine.waitFor({ timeout: 20000 });
    if ((await kpiLine.getAttribute("data-pace")) !== expected.pace || !(await kpiLine.innerText()).includes(`${expected.actual} / 12`)) throw new Error(`the tree carries the KPI line: ${await kpiLine.innerText()}`);
    const onTrack = expected.pace === "behind" ? 0 : 1;
    await page.locator('[data-testid="plan-goal-pace"]', { hasText: `${onTrack} of 1 key results on track` }).waitFor({ timeout: 20000 });
    console.log(`✓ a Numbers KPI on the key result reads ${expected.actual} of 12 calls booked this month, ${PACE_LABEL[expected.pace]}; the tree shows it and the key result reads by its pace`);

    // ── The Primary goal's Cash collected KPI is on Today's bar; a close-asked KPI goes through the evening close. ──
    const cash = (await db.query.kpis.findFirst({ where: and(eq(schema.kpis.userId, maya.id), eq(schema.kpis.recordId, primary.id), eq(schema.kpis.metric, "cashCollected")) }))!;
    if (!cash || cash.source !== "numbers" || cash.unit !== "$" || cash.target !== legacy.target) throw new Error(`the Primary goal carries Cash collected as its KPI from the goals row: ${JSON.stringify(cash)}`);
    const cashRead = readKpi(cash, today, logs, []);
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="today-goal-bar"]').waitFor({ timeout: 30000 });
    const bar = await page.locator('[data-testid="today-goal-bar"]').innerText();
    if ((await page.locator('[data-testid="today-goal-link"]').getAttribute("href")) !== `/goals/${primary.id}` || !bar.includes(`$${cashRead.actual.toLocaleString()} / $${legacy.target.toLocaleString()}`)) throw new Error(`Today's bar reads the Cash collected KPI and links to the goal: ${bar}`);
    await page.goto(`${base}/goals/${primary.id}`);
    await page.locator('[data-testid="kpi-new"]').click();
    await page.fill('[data-testid="kpi-form-name"]', "Discovery calls");
    await page.fill('[data-testid="kpi-form-target"]', "10");
    await page.selectOption('[data-testid="kpi-form-source"]', "close");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="kpi-form-save"]').click()]);
    await page.locator('[data-testid="kpi-row"]', { hasText: "Discovery calls" }).waitFor({ timeout: 20000 });
    const asked = (await db.query.kpis.findFirst({ where: and(eq(schema.kpis.userId, maya.id), eq(schema.kpis.name, "Discovery calls")) }))!;
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="close-form"]').waitFor({ state: "attached", timeout: 30000 });
    const editClose = page.locator('summary:has-text("Edit today")');
    if (await editClose.isVisible()) await editClose.click();
    const early = page.locator('[data-testid="close-early"] > summary');
    if (await early.isVisible()) {
      // Opened only once the page has settled: a click before Today finishes loading is undone when it does.
      await page.waitForLoadState("networkidle");
      for (let i = 0; i < 5 && !(await page.locator('[data-testid="close-early"]').evaluate((d) => (d as HTMLDetailsElement).open)); i++) {
        await early.click();
        await page.waitForTimeout(300);
      }
    }
    await page.fill(`[data-testid="close-kpi-${asked.id}"]`, "2");
    await page.fill('input[name="win"]', "Two discovery calls held.");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('button:has-text("Close the day")').first().click()]);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    const value = await db.query.kpiValues.findFirst({ where: and(eq(schema.kpiValues.kpiId, asked.id), eq(schema.kpiValues.date, today)) });
    if (value?.value !== 2) throw new Error(`the close writes the KPI's value for the day: ${JSON.stringify(value)}`);
    await page.goto(`${base}/goals/${primary.id}`);
    const askedRow = page.locator('[data-testid="kpi-row"]', { hasText: "Discovery calls" });
    await askedRow.waitFor({ timeout: 20000 });
    if (!(await askedRow.locator('[data-testid="kpi-actual"]').innerText()).startsWith("2 / 10")) throw new Error(`the close-asked KPI reads the day's value: ${await askedRow.innerText()}`);
    // A value by hand replaces the day's: 3, never 2 + 3.
    await askedRow.locator('[data-testid="kpi-value"]').fill("3");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), askedRow.locator('[data-testid="kpi-log-save"]').click()]);
    await page.locator('[data-testid="kpi-row"]', { hasText: "Discovery calls" }).locator('[data-testid="kpi-actual"]', { hasText: "3 / 10" }).waitFor({ timeout: 20000 });
    console.log(`✓ Today's bar reads the Primary goal's Cash collected KPI ($${cashRead.actual.toLocaleString()} of $${legacy.target.toLocaleString()}) and links to it; a close-asked KPI has its box in the close, 2 lands on the goal, a value by hand replaces the day's`);

    // ── The coach reads a line, read-only. ──
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await signIn(page, "As the coach");
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    await page.goto(`${base}/coach/${m.id}`);
    await page.locator('[data-testid="coach-plan-line"]').waitFor({ timeout: 30000 });
    const line = await page.locator('[data-testid="coach-plan-line"]').innerText();
    // The key result's KPI decides (BG2): on track only while its pace is not behind, whatever its status says.
    if (!line.includes(`1 goal · ${onTrack} of 1 key results on track · 1 of 1 initiatives not started`)) throw new Error(`the coach's line counts the plan by the KPIs' pace: ${line}`);
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
