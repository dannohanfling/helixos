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
    // Enough to cross the next tier line whatever the seed's date-relative streak and close points add up to today.
    const { TIERS } = await import("@/lib/engine/tiers");
    const total = (await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })).reduce((s, r) => s + r.points, 0);
    const nextTier = TIERS.find((t) => t.minPoints > total);
    if (!nextTier) throw new Error("the demo client is already on the top tier; nothing to cross");
    await db.insert(schema.pointsLedger).values({ id: crypto.randomUUID(), workspaceId: closedRows[0].workspaceId, userId: maya.id, type: "bonus", points: nextTier.minPoints - total + 1, reason: "Smoke: level up" });
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
    const prefillTimes: Record<string, string> = { contactSubmitted: new Date().toISOString() };
    await page.goto(`${base}/today`);
    prefillTimes.todayLoaded = new Date().toISOString();
    const early = page.locator('[data-testid="close-early"] > summary');
    const earlyVisible = await early.isVisible();
    if (earlyVisible) await early.click();
    prefillTimes.summaryClicked = new Date().toISOString();
    // This step has failed intermittently with nothing to go on. On failure, everything that could explain it is written to a
    // file under screenshots/logs (which the gate keeps) and printed, so the next occurrence is diagnosable rather than re-run.
    await expectText(page, "Filled in from what you logged today", "close prefill").catch(async (e: Error) => {
      prefillTimes.assertionFailed = new Date().toISOString();
      const { todayActivity } = await import("@/lib/queries/daily");
      const { todayInTz, hourInTz } = await import("@/lib/dates");
      const membership = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) });
      const tz = membership?.timezone || "UTC";
      const prefill = page.locator('[data-testid="close-prefill"]');
      const details = page.locator('[data-testid="close-early"]');
      const diag = {
        step: "close prefill",
        expected: "Filled in from what you logged today",
        actual: (await prefill.count()) ? await prefill.first().innerText() : "(no close-prefill element on the page)",
        closeCard: (await page.locator("#close").count()) ? (await page.locator("#close").innerText()).replace(/\s+/g, " ").slice(0, 600) : "(no #close card)",
        earlyDisclosure: { presentBeforeClick: earlyVisible, presentNow: (await details.count()) > 0, openNow: (await details.count()) ? await details.evaluate((el) => (el as HTMLDetailsElement).open) : null },
        url: page.url(),
        times: { ...prefillTimes, loadToAssertMs: Date.parse(prefillTimes.assertionFailed) - Date.parse(prefillTimes.todayLoaded), submitToAssertMs: Date.parse(prefillTimes.assertionFailed) - Date.parse(prefillTimes.contactSubmitted) },
        member: { timezone: tz, today: todayInTz(tz), hour: hourInTz(tz), serverNow: new Date().toISOString() },
        activity: await todayActivity(membership!.workspaceId, maya.id, todayInTz(tz)),
        contactsToday: (await db.query.contacts.findMany({ where: eq(schema.contacts.userId, maya.id) })).filter((c) => c.createdAt.startsWith(todayInTz(tz))).map((c) => ({ name: c.name, createdAt: c.createdAt })),
        screenshot: "screenshots/fail-close-prefill.png",
      };
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync("screenshots/logs", { recursive: true });
      const file = `screenshots/logs/close-prefill-failure-${prefillTimes.assertionFailed.replace(/[:.]/g, "-")}.json`;
      writeFileSync(file, JSON.stringify(diag, null, 2));
      console.error(`[close prefill] diagnostics written to ${file}\n${JSON.stringify(diag, null, 2)}`);
      throw e;
    });
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

    // A future stage opens read-only: greyed tasks, what unlocks it in the stage's own words, and the NOW card never follows the preview
    await page.goto(`${base}/pathway`);
    await page.click('a[href="/pathway?stage=optimize"]');
    await page.waitForURL(/\/pathway\?stage=optimize/);
    const preview = page.locator('[data-testid="stage-preview"][data-stage="optimize"]');
    await preview.waitFor({ timeout: 5000 });
    if ((await preview.getAttribute("data-relation")) !== "future") throw new Error("optimize should be a future stage for the demo client");
    await expectText(page, "First conversion event delivered with real numbers captured.", "what unlocks the stage, in its own entry criteria");
    const previewTasks = page.locator('[data-testid="preview-task"]');
    if (!(await previewTasks.count())) throw new Error("the previewed stage should list its tasks");
    if ((await previewTasks.evaluateAll((els) => els.filter((e) => e.getAttribute("aria-disabled") !== "true").length)) !== 0) throw new Error("every task in a future stage must be greyed and disabled");
    if (await page.locator('[data-testid="preview-task"] a').count()) throw new Error("a future stage's tasks must not be links");
    const nowStage = await page.locator('[data-testid="now-card"]').getAttribute("data-stage");
    if (!nowStage || nowStage === "optimize") throw new Error(`the NOW card must keep the current stage, got ${nowStage}`);
    await page.goto(`${base}/pathway?view=all&stage=optimize`);
    await page.locator('[data-testid="stage-preview"][data-stage="optimize"]').waitFor({ timeout: 5000 });
    await expectText(page, "Unlocks when:", "whole map: future stage read-only too");
    console.log("✓ a future pathway stage opens read-only with its unlock line; the NOW card stays on the current stage");

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
