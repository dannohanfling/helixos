/**
 * The daily loop's fixes: editing a close scores the difference and moves the goal, the close is pre-filled from the day's
 * activity, a broken streak is acknowledged and repairable once a month, the member's timezone is theirs, and the coach can
 * nudge a quiet client. Runs against the dev server; sets up streak state directly in the database.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

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
  await page.waitForTimeout(500);
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
const points = async (page: Page) => Number(((await page.locator("header, main").first().innerText()).match(/([\d,]+) pts/)?.[1] ?? "0").replace(/,/g, ""));

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, isNotNull } = await import("drizzle-orm");
  const { addDays, isWeekday, todayInTz } = await import("@/lib/dates");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const today = todayInTz("America/Los_Angeles");

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // Streak state: Maya closed every weekday up to the day before the last weekday, then missed one. Today is open.
    const lastWeekday = (() => {
      let d = addDays(today, -1);
      while (!isWeekday(d)) d = addDays(d, -1);
      return d;
    })();
    await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, today)));
    await db.update(schema.dailyLogs).set({ eveningDoneAt: null, repairedAt: null }).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, lastWeekday)));
    const closedRows = await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, maya.id), isNotNull(schema.dailyLogs.eveningDoneAt)) });
    // make sure the run before the missed day is unbroken for at least 2 weekdays
    let d = addDays(lastWeekday, -1);
    let ensured = 0;
    while (ensured < 3) {
      if (isWeekday(d)) {
        if (!closedRows.some((r) => r.date === d)) {
          const ex = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, d)) });
          if (ex) await db.update(schema.dailyLogs).set({ eveningDoneAt: `${d}T23:00:00.000Z` }).where(eq(schema.dailyLogs.id, ex.id));
          else await db.insert(schema.dailyLogs).values({ id: crypto.randomUUID(), workspaceId: closedRows[0].workspaceId, userId: maya.id, date: d, eveningDoneAt: `${d}T23:00:00.000Z` });
        }
        ensured++;
      }
      d = addDays(d, -1);
    }

    await login(page, "client");
    if (await page.locator('[data-testid="level-up"]').count()) throw new Error("a member is congratulated for the tier they already had");
    await page.waitForTimeout(1200); // the first visit stamps the current tier silently; let that land before crossing a tier
    const stamped = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) });
    if (stamped?.celebratedTierLevel === null) throw new Error("the first visit did not stamp the member's current tier");
    // Crossing into a new tier is celebrated once, on the next page, then never again
    await db.insert(schema.pointsLedger).values({ id: crypto.randomUUID(), workspaceId: closedRows[0].workspaceId, userId: maya.id, type: "bonus", points: 4000, reason: "Smoke: level up" });
    await page.goto(`${base}/today`);
    const levelUp = page.locator('[data-testid="level-up"]');
    await levelUp.waitFor({ timeout: 10000 });
    await expectText(page, "You reached", "level up shown");
    await page.screenshot({ path: "screenshots/lp00-level-up.png" });
    await page.click('[data-testid="level-up"] button:has-text("Keep going")');
    if (await levelUp.count()) throw new Error("the celebration did not close");
    await page.waitForTimeout(600);
    await page.reload();
    if (await page.locator('[data-testid="level-up"]').count()) throw new Error("the celebration showed twice");
    console.log("✓ level up celebrated once, then not again");
    await page.goto(`${base}/today`);
    await expectText(page, "streak ended", "streak break acknowledged");
    await expectText(page, "One weekday slipped", "repairable");
    await page.screenshot({ path: "screenshots/lp01-streak-broken.png", fullPage: true });
    await submit(page, 'button:has-text("Repair the streak")');
    if (await page.locator('[data-testid="streak-broken"]').count()) throw new Error("notice still shown after repair");
    const streakBadge = await page.locator('span[title="Weekday streak"]').innerText();
    if (!/[1-9]\d*-day streak/.test(streakBadge)) throw new Error(`streak not restored: ${streakBadge}`);
    console.log(`✓ broken streak acknowledged and repaired (${streakBadge.trim()})`);

    // Close pre-filled from today's activity: create a contact first (an outbound today), then open the close
    await page.goto(`${base}/conversations?new=1`);
    await page.fill('input[name="name"]', "Prefill Lead");
    await submit(page, 'form:has(input[name="name"]) button[type="submit"]');
    await page.goto(`${base}/today`);
    const early = page.locator('[data-testid="close-early"] > summary');
    if (await early.isVisible()) await early.click();
    await expectText(page, "Filled in from what you logged today", "close prefill");
    const dmsPrefill = await page.locator('input[name="dmsStarted"]').inputValue();
    if (Number(dmsPrefill) < 1) throw new Error(`dmsStarted should be pre-filled, got ${dmsPrefill}`);
    console.log(`✓ close pre-filled (DMs started = ${dmsPrefill})`);

    // First close, then an edit that adds a booked call and cash: +25 points and the goal moves by the cash delta
    await page.fill('input[name="callsBooked"]', "0");
    await page.fill('input[name="cashCollected"]', "100");
    await page.fill('input[name="win"]', "Closed the day");
    await submit(page, 'button:has-text("Close the day")');
    await expectText(page, "Day closed", "first close");
    const before = await points(page);
    const goalBefore = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, maya.id), eq(schema.goals.primary, true)) });
    await page.locator('summary:has-text("Edit today")').click();
    await page.fill('input[name="callsBooked"]', "1");
    await page.fill('input[name="cashCollected"]', "350");
    await submit(page, 'button:has-text("Close the day"), button:has-text("Save")');
    const after = await points(page);
    const goalAfter = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, maya.id), eq(schema.goals.primary, true)) });
    if (after - before !== 25) throw new Error(`editing the close should award +25 for the booked call, got ${after - before}`);
    if ((goalAfter?.actual ?? 0) - (goalBefore?.actual ?? 0) !== 250) throw new Error(`goal should move by the cash delta (250), moved ${(goalAfter?.actual ?? 0) - (goalBefore?.actual ?? 0)}`);
    console.log("✓ editing a close awards the delta and moves the goal by the cash difference");

    // Audience: one member-level field beside the Big Promise
    await page.goto(`${base}/settings`);
    await page.fill('[data-testid="audience-field"]', "Coaches with a Facebook group");
    await submit(page, 'form:has([data-testid="audience-field"]) button:has-text("Save")');
    const withAudience = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) });
    if (withAudience?.audience !== "Coaches with a Facebook group") throw new Error(`audience not saved: ${withAudience?.audience}`);
    console.log("✓ audience saved on the membership");

    // Member timezone
    await page.goto(`${base}/settings`);
    await page.selectOption('select[name="timezone"]', "America/New_York");
    await submit(page, 'form:has(select[name="timezone"]) button:has-text("Save")');
    const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) });
    if (m?.timezone !== "America/New_York") throw new Error(`member timezone not saved: ${m?.timezone}`);
    await page.selectOption('select[name="timezone"]', "America/Los_Angeles");
    await submit(page, 'form:has(select[name="timezone"]) button:has-text("Save")');
    console.log("✓ member timezone saved and restored");

    // Coach nudge for the quiet client (Jordan)
    await login(page, "coach");
    await page.goto(`${base}/coach`);
    await expectText(page, "Who needs a nudge", "nudge card");
    await submit(page, '[data-testid="nudge-row"] button:has-text("Nudge")');
    await expectText(page, "nudged today", "nudge recorded");
    const pathCount = await page.locator("main").innerText();
    if (/\/215\b/.test(pathCount)) throw new Error("pathway denominator is still the whole library");
    console.log("✓ coach nudge sent and recorded; pathway denominator is the must-do path");
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Loop smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
