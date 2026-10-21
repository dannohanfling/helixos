/**
 * The intention chain (H-195 #14, H-198). Maya has an initiative and a key result in Business goals and a week's intention. On
 * Intentions, the chain shows the week with nothing linked; she links the week to the initiative and her first key result to
 * hers, and the chain names both. A tick on the week card ticks the same task in Tasks. The initiative's page lists the week.
 * Deleting an intention task in Tasks asks, and "Only from Tasks" keeps its words on the intention. At 390, nothing scrolls
 * sideways. Her week, tasks and records are put back after.
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

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { todayInTz } = await import("@/lib/dates");
  const { weekOf } = await import("@/lib/engine/intentions");
  const { saveWeekIntention } = await import("@/lib/intentions-core");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mm.workspaceId) }))!;
  const M = { workspaceId: mm.workspaceId, userId: maya.id };
  const today = todayInTz(mm.timezone || ws.timezone);
  const thisWeek = weekOf(today);
  const whereWeek = and(eq(schema.weeklyIntentions.workspaceId, M.workspaceId), eq(schema.weeklyIntentions.userId, M.userId), eq(schema.weeklyIntentions.weekOf, thisWeek));
  const before = await db.query.weeklyIntentions.findFirst({ where: whereWeek });
  const ids = { init: newId(), kr: newId(), kpi: newId() };
  await db.insert(schema.planRecords).values([
    { id: ids.init, ...M, kind: "initiative", title: "Walk chain initiative" },
    { id: ids.kr, ...M, kind: "key_result", title: "Walk chain key result" },
  ]);
  await db.insert(schema.kpis).values({ id: ids.kpi, ...M, recordId: ids.kr, name: "Walk chain calls", source: "manual", target: 3 });
  await saveWeekIntention({ ...M, today }, { word: "Chainwalk", keyResults: ["Book 3 calls", "Post 5 times"], initiative: "Slides", tasks: ["Chain walk task one", "Chain walk task two"] });
  const week = async () => (await db.query.weeklyIntentions.findFirst({ where: whereWeek }))!;
  const made = (await week()).tasks.map((t) => t.taskId).filter((x): x is string => Boolean(x));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/intentions`);
    const chain = page.locator('[data-testid="intention-chain"]');
    await chain.waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="chain-initiative"]').innerText()).includes("Not linked yet"), "nothing is linked before she chooses");
    must((await page.locator('[data-testid="chain-week"]').innerText()).includes("Chainwalk"), "the chain shows this week");
    await page.selectOption('[data-testid="chain-initiative-pick"]', ids.init);
    await page.selectOption('[data-testid="chain-kr1-pick"]', ids.kr);
    await submit(page, '[data-testid="chain-link-save"]');
    let w = await week();
    must(w.initiativeId === ids.init && w.keyResults[0]?.krId === ids.kr && !w.keyResults[1]?.krId, "the week links to her initiative and the first key result to hers");
    must((await page.locator('[data-testid="chain-initiative"]').innerText()).includes("Walk chain initiative"), "the chain names the initiative");
    must((await page.locator('[data-testid="chain-key-results"]').innerText()).includes("Walk chain key result"), "and the key result");

    await submit(page, '[data-testid="week-task"]:has-text("Chain walk task one") [data-testid="week-task-tick"]');
    const t1 = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, made[0]!) });
    must(t1?.status === "done", "a tick on the week card ticks the same task in Tasks");
    must((await page.locator('[data-testid="chain-tasks"]').innerText()).includes("1 of 2 done"), "the chain counts it");

    await page.goto(`${base}/goals/${ids.init}`);
    await page.locator('[data-testid="initiative-week"]').first().waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="initiative-week"]').first().innerText()).includes("Chainwalk"), "the initiative lists the week under it");

    await page.goto(`${base}/tasks`);
    const row = page.locator('[data-testid="task-row"]', { hasText: "Chain walk task two" });
    await row.waitFor({ timeout: 20000 });
    await row.locator('[title="Delete"]').click();
    const only = row.locator('[data-testid="confirm-delete-tasks-only"]');
    await only.waitFor({ timeout: 10000 });
    await only.click();
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      gone = !(await db.query.tasks.findFirst({ where: eq(schema.tasks.id, made[1]!) }));
      if (!gone) await page.waitForTimeout(250);
    }
    must(gone, "the task is deleted from Tasks");
    w = await week();
    must(w.tasks.some((t) => t.title === "Chain walk task two" && t.taskId === null), "and its words stay on the intention, unlinked");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/intentions`);
    await chain.waitFor({ timeout: 20000 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    must(over <= 1, `nothing scrolls sideways at 390 (${over}px over)`);
    must(!failures.length, `no server errors: ${failures.join(", ")}`);
  } finally {
    await browser.close();
    if (before) await db.update(schema.weeklyIntentions).set({ word: before.word, keyResults: before.keyResults, initiative: before.initiative, tasks: before.tasks, initiativeId: before.initiativeId, reviewedAt: before.reviewedAt }).where(whereWeek);
    else await db.delete(schema.weeklyIntentions).where(whereWeek);
    const keep = new Set((before?.tasks ?? []).map((t) => t.taskId).filter(Boolean));
    const drop = made.filter((id) => !keep.has(id));
    if (drop.length) {
      await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.userId, maya.id), inArray(schema.pointsLedger.refId, drop)));
      await db.delete(schema.tasks).where(inArray(schema.tasks.id, drop));
    }
    await db.delete(schema.kpiValues).where(eq(schema.kpiValues.kpiId, ids.kpi));
    await db.delete(schema.kpis).where(eq(schema.kpis.id, ids.kpi));
    await db.delete(schema.planRecords).where(inArray(schema.planRecords.id, [ids.init, ids.kr]));
  }
  console.log("Intention chain smoke passed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
