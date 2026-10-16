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
  const { addDays, todayInTz } = await import("@/lib/dates");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const today = todayInTz("America/Los_Angeles");
  // Between 00:00 and 04:00 in Los Angeles yesterday can still be closed (rev 731), so the missed-day and close checks below
  // would meet the late close-out instead (it has its own checks further down). London is on the same date then and past
  // 04:00, so Maya keeps her day, outside the window; the timezone check below puts Los Angeles back.
  const { LATE_CLOSE_UNTIL_HOUR } = await import("@/lib/engine/streak");
  const { hourInTz } = await import("@/lib/dates");
  if (hourInTz("America/Los_Angeles") < LATE_CLOSE_UNTIL_HOUR) await db.update(schema.memberships).set({ timezone: "Europe/London" }).where(eq(schema.memberships.userId, maya.id));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // Streak state (H-289: every day counts, Maya's default): Maya was active every day up to the day before yesterday, then
    // missed yesterday. Today is open. A missed day is one with nothing done: no lock-in, no close, no points earned that day
    // in her own time, so the fixture clears the log and every ledger row dated that day.
    const missedDay = addDays(today, -1);
    const { activityDate } = await import("@/lib/engine/streak");
    const mayaMembership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const mayaTz = mayaMembership.timezone || "America/Los_Angeles";
    if (mayaMembership.workDays !== "all") throw new Error(`a member starts on every day (H-289 §2), not ${mayaMembership.workDays}`);
    await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, today)));
    await db.update(schema.dailyLogs).set({ eveningDoneAt: null, repairedAt: null, morningDoneAt: null }).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, missedDay)));
    for (const r of await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })) {
      const on = activityDate(r, mayaTz);
      if (on === missedDay || on === today) await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.id, r.id));
    }
    const closedRows = await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, maya.id), isNotNull(schema.dailyLogs.eveningDoneAt)) });
    // make sure the run before the missed day is unbroken for at least 3 days, weekend or not
    let d = addDays(missedDay, -1);
    let ensured = 0;
    while (ensured < 3) {
      if (!closedRows.some((r) => r.date === d)) {
        const ex = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, d)) });
        if (ex) await db.update(schema.dailyLogs).set({ eveningDoneAt: `${d}T23:00:00.000Z` }).where(eq(schema.dailyLogs.id, ex.id));
        else await db.insert(schema.dailyLogs).values({ id: crypto.randomUUID(), workspaceId: closedRows[0].workspaceId, userId: maya.id, date: d, eveningDoneAt: `${d}T23:00:00.000Z` });
      }
      ensured++;
      d = addDays(d, -1);
    }

    await login(page, "client");
    if (await page.locator('[data-testid="rank-up"]').count()) throw new Error("a member is congratulated for the rank they already had");
    await page.waitForTimeout(1200); // the first visit stamps the current tier silently; let that land before crossing a tier
    const stamped = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) });
    if (stamped?.celebratedTierLevel === null) throw new Error("the first visit did not stamp the member's current tier");
    // Crossing into a new tier is celebrated once, on the next page, then never again
    // Enough to cross the next tier line whatever the seed's date-relative streak and close points add up to today.
    const { TIERS } = await import("@/lib/engine/tiers");
    const total = (await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })).reduce((s, r) => s + r.points, 0);
    const nextTier = TIERS.find((t) => t.minPoints > total);
    if (!nextTier) throw new Error("the demo client is already on the top tier; nothing to cross");
    // A hand adjustment, so the fixture never makes today an active day (H-289 §1).
    await db.insert(schema.pointsLedger).values({ id: crypto.randomUUID(), workspaceId: closedRows[0].workspaceId, userId: maya.id, type: "bonus", points: nextTier.minPoints - total + 1, reason: "Smoke: level up", adjustedBy: "smoke" });
    await page.goto(`${base}/today`);
    // The rank-up ceremony (H-327 §1): Skip jumps to the end, Close closes it and records the rank seen.
    const rankUp = page.locator('[data-testid="rank-up"]');
    await rankUp.waitFor({ timeout: 10000 });
    await expectText(page, "You have risen to", "rank-up shown");
    await page.click('[data-testid="rank-skip"]');
    await page.screenshot({ path: "screenshots/lp00-rank-up.png" });
    await page.click('[data-testid="rank-skip"]');
    if (await rankUp.count()) throw new Error("the ceremony did not close");
    await page.waitForTimeout(600);
    await page.reload();
    if (await page.locator('[data-testid="rank-up"]').count()) throw new Error("the ceremony showed twice");
    console.log("✓ rank-up celebrated once, then not again");
    await page.goto(`${base}/today`);
    await expectText(page, "streak ended", "streak break acknowledged");
    await expectText(page, "One day slipped", "repairable on every day");
    await page.screenshot({ path: "screenshots/lp01-streak-broken.png", fullPage: true });
    await submit(page, 'button:has-text("Repair the streak")');
    if (await page.locator('[data-testid="streak-broken"]').count()) throw new Error("notice still shown after repair");
    const streakBadge = await page.locator('[data-testid="streak-badge"]').innerText();
    if (!/[1-9]\d*-day streak/.test(streakBadge)) throw new Error(`streak not restored: ${streakBadge}`);
    console.log(`✓ broken streak acknowledged and repaired on every day (${streakBadge.trim()})`);

    // My work days (H-289 §2): every day by default; Monday to Friday brings the weekday rule back; both show on the badge.
    await page.goto(`${base}/settings`);
    const workDays = page.locator('[data-testid="work-days"]');
    if ((await workDays.inputValue()) !== "all") throw new Error("Settings → You starts on every day");
    await workDays.selectOption("weekdays");
    await submit(page, 'form:has([data-testid="work-days"]) button[type="submit"]');
    await page.goto(`${base}/today`);
    if ((await page.locator('[data-testid="streak-badge"]').getAttribute("title")) !== "Weekday streak") throw new Error("on Monday to Friday the badge says so");
    await page.goto(`${base}/settings`);
    await page.locator('[data-testid="work-days"]').selectOption("all");
    await submit(page, 'form:has([data-testid="work-days"]) button[type="submit"]');
    await page.goto(`${base}/today`);
    if ((await page.locator('[data-testid="streak-badge"]').getAttribute("title")) !== "Streak, every day counts") throw new Error("back on every day the badge says so");
    console.log("✓ My work days: every day by default, Monday to Friday and back, the badge follows");

    // Close pre-filled from today's activity: create a contact first (an outbound today), then open the close
    await page.goto(`${base}/conversations?new=1`);
    await page.fill('input[name="name"]', "Prefill Lead");
    await submit(page, 'form:has(input[name="name"]) button[type="submit"]');
    const prefillTimes: Record<string, string> = { contactSubmitted: new Date().toISOString() };
    await page.goto(`${base}/today`);
    prefillTimes.todayLoaded = new Date().toISOString();
    // The close card streams in after navigation resolves; judging the disclosure before the card exists skipped the click
    // (diagnosed from the instrumented failure below: presentBeforeClick false, presentNow true, openNow false).
    await page.locator("#close").waitFor({ timeout: 15000 });
    const early = page.locator('[data-testid="close-early"] > summary');
    const earlyVisible = await early.isVisible();
    if (earlyVisible) {
      // Opened only once the page has settled: a click before Today finishes loading is undone when it does.
      await page.waitForLoadState("networkidle");
      for (let i = 0; i < 5 && !(await page.locator('[data-testid="close-early"]').evaluate((d) => (d as HTMLDetailsElement).open)); i++) {
        await early.click();
        await page.waitForTimeout(300);
      }
    }
    prefillTimes.summaryClicked = new Date().toISOString();
    // This step has failed intermittently with nothing to go on. On failure, everything that could explain it is written to a
    // file under screenshots/logs (which the gate keeps) and printed, so the next occurrence is diagnosable rather than re-run.
    await expectText(page, "Filled in from what you logged today", "close prefill").catch(async (e: Error) => {
      prefillTimes.assertionFailed = new Date().toISOString();
      const { todayActivity } = await import("@/lib/queries/daily");
      const { todayInTz, hourInTz } = await import("@/lib/dates");
      const membership = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) });
      const workspace = membership ? await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, membership.workspaceId) }) : null;
      // The app's own rule: the member's timezone, else the workspace's. Never a unit of the harness's choosing.
      const tz = membership?.timezone || workspace?.timezone || "UTC";
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

    // Late close-outs (rev 731, Danno's answers at rev 746). Maya goes to a timezone where it is 01:00 now, with yesterday open:
    // Today's card is "Close yesterday", the close lands on yesterday with yesterday's points, and the scoreboard counts it there.
    {
      const { formatDate, startOfWeek } = await import("@/lib/dates");
      const { scoreboardFor } = await import("@/lib/scoreboard");
      const { viewerFor } = await import("@/lib/auth");
      const { todayClose } = await import("@/lib/mcp/tools/today");
      const zones = Array.from({ length: 27 }, (_, i) => i - 12).map((n) => (n >= 0 ? `Etc/GMT-${n}` : `Etc/GMT+${-n}`));
      // An Etc zone where it is 01:00 now and stays inside the window for the next minutes (not 01:59).
      const zone = zones.find((z) => hourInTz(z) === 1 && new Date().getUTCMinutes() < 50) ?? zones.find((z) => hourInTz(z) === 2)!;
      const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
      await db.update(schema.memberships).set({ timezone: zone }).where(eq(schema.memberships.id, mm.id));
      const mt = todayInTz(zone);
      const y = addDays(mt, -1);
      const { inArray } = await import("drizzle-orm");
      // Both days' rows and their close points as they were, put back at the end so the later walks find Maya's days unchanged.
      const keptLogs = await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, maya.id), inArray(schema.dailyLogs.date, [y, mt])) });
      const keptPoints = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), inArray(schema.pointsLedger.type, ["close", "streak", "dm"]), inArray(schema.pointsLedger.refId, [y, mt, `activity:${y}`, `activity:${mt}`])) });
      await db.update(schema.dailyLogs).set({ eveningDoneAt: null, repairedAt: null, streakDay: 0 }).where(and(eq(schema.dailyLogs.userId, maya.id), inArray(schema.dailyLogs.date, [y, mt])));
      await db.update(schema.dailyLogs).set({ morningDoneAt: null }).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, mt)));
      await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.userId, maya.id), inArray(schema.pointsLedger.type, ["close", "streak"]), inArray(schema.pointsLedger.refId, [y, mt])));
      const which = startOfWeek(y) === startOfWeek(mt) ? "this" : "last";
      const closesBefore = (await scoreboardFor({ workspaceId: mm.workspaceId, userId: maya.id }, zone, mt, which)).closes;
      const yName = formatDate(y, { weekday: "short", month: "short", day: "numeric" }).replace(",", "");

      await page.goto(`${base}/today`);
      await page.locator('[data-testid="close-title"]').waitFor({ timeout: 15000 });
      // The card title is set in capitals by CSS, so compare without case.
      const title = (await page.locator('[data-testid="close-title"]').innerText()).trim();
      if (title.toLowerCase() !== `Close yesterday (${yName})`.toLowerCase()) throw new Error(`at 01:00 with yesterday open, the close card is yesterday's: "${title}"`);
      if (await page.locator('[data-testid="close-early"]').count()) throw new Error("the late close isn't folded away as 'not evening yet'");
      if (await page.locator('[data-testid="streak-broken"]').count()) throw new Error("yesterday isn't a missed day while it can still be closed");
      await page.fill('input[name="win"]', "Closed after midnight");
      await submit(page, '[data-testid="close-form"] button[type="submit"]');
      const yLog = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, y)) });
      const tLog = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, mt)) });
      if (!yLog?.eveningDoneAt || yLog.win !== "Closed after midnight") throw new Error("the close at 01:00 lands on yesterday");
      if (tLog?.eveningDoneAt) throw new Error("the new day stays open");
      const paid = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), inArray(schema.pointsLedger.type, ["close", "streak"])) });
      if (!paid.some((p) => p.type === "close" && p.refId === y) || paid.some((p) => p.refId === mt)) throw new Error("yesterday's points, none for the new day");
      const closesAfter = (await scoreboardFor({ workspaceId: mm.workspaceId, userId: maya.id }, zone, mt, which)).closes;
      if (closesAfter !== closesBefore + 1) throw new Error(`the scoreboard counts the late close on yesterday: ${closesBefore} → ${closesAfter}`);
      if ((await page.locator('[data-testid="close-title"]').innerText()).trim().toLowerCase() !== `Yesterday closed (${yName})`.toLowerCase()) throw new Error("Today shows yesterday closed");
      console.log(`✓ a close at 01:00 with yesterday open: "${title}", saved on yesterday with its points, counted on yesterday's scoreboard`);

      // The same close-out (rev 746): closing again within 6 hours with no lock-in between edits yesterday's, no new points.
      const v = (await viewerFor(maya.id, mm.workspaceId))!;
      const r = await todayClose.handler(v, { win: "Edited by voice" });
      const yAgain = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, y)) });
      const tAgain = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, mt)) });
      const paidAgain = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), inArray(schema.pointsLedger.type, ["close", "streak"])) });
      if (!r.text.startsWith(`Updated ${formatDate(y, { weekday: "long", month: "short", day: "numeric" }).replace(",", "")}`) || yAgain?.win !== "Edited by voice" || tAgain?.eveningDoneAt || paidAgain.length !== paid.length) throw new Error(`today_close again within 6 hours edits yesterday's close-out: ${r.text}`);
      // The lock-in isn't affected: Maya can still start today, and after it a close is the new day's.
      if (!(await page.locator('[data-testid="lockin-hero"], [data-testid="lockin-win"]').count())) throw new Error("the morning lock-in is still there for today");
      await db.update(schema.dailyLogs).set({ morningDoneAt: new Date().toISOString() }).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, mt)));
      await db.insert(schema.dailyLogs).values({ id: crypto.randomUUID(), workspaceId: mm.workspaceId, userId: maya.id, date: mt, morningDoneAt: new Date().toISOString() }).onConflictDoNothing();
      const r2 = await todayClose.handler(v, { win: "The new day's" });
      const tNew = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, mt)) });
      if (!r2.text.startsWith(`Closed ${mt}`) || tNew?.win !== "The new day's" || !tNew.eveningDoneAt) throw new Error(`after a lock-in, a close is the new day's: ${r2.text}`);
      console.log("✓ the same close-out within 6 hours edits yesterday's by voice, no new points; after a lock-in the close is the new day's");

      // Clean up: both days and their points as they were, Maya back to Los Angeles.
      await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), inArray(schema.dailyLogs.date, [y, mt])));
      if (keptLogs.length) await db.insert(schema.dailyLogs).values(keptLogs);
      await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.userId, maya.id), inArray(schema.pointsLedger.type, ["close", "streak", "dm"]), inArray(schema.pointsLedger.refId, [y, mt, `activity:${y}`, `activity:${mt}`])));
      if (keptPoints.length) await db.insert(schema.pointsLedger).values(keptPoints);
      await db.update(schema.memberships).set({ timezone: "America/Los_Angeles" }).where(eq(schema.memberships.id, mm.id));
    }

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
    await page.goto(`${base}/coach?connections=open`);
    await expectText(page, "Who needs a nudge", "nudge card");
    await submit(page, '[data-testid="nudge-row"] button:has-text("Nudge")');
    await expectText(page, "nudged today", "nudge recorded");
    const pathCount = await page.locator("main").innerText();
    if (/\/215\b/.test(pathCount)) throw new Error("pathway denominator is still the whole library");
    console.log("✓ coach nudge sent and recorded; pathway denominator is the must-do path");

    // Coach → Late close-outs (rev 731): the dry run, counts only, and it changes nothing. A qualifying close (00:30 Los Angeles,
    // the day before open) raises "closes found" by one.
    {
      const { inArray } = await import("drizzle-orm");
      const readCount = async () => Number((await page.locator('[data-testid="late-closes-found"]').innerText()).replace(/\D/g, ""));
      await page.goto(`${base}/coach?connections=open`);
      await page.click('[data-testid="coach-late-link"]');
      await page.waitForURL(/\/coach\/late-closes/);
      const before = await readCount();
      const d0 = addDays(today, -40);
      const d1 = addDays(d0, 1);
      const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
      const saved = await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, maya.id), inArray(schema.dailyLogs.date, [d0, d1])) });
      await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), inArray(schema.dailyLogs.date, [d0, d1])));
      const lateAt = new Date(`${d1}T00:30:00-07:00`);
      const fixtureId = crypto.randomUUID();
      await db.insert(schema.dailyLogs).values({ id: fixtureId, workspaceId: mm.workspaceId, userId: maya.id, date: d1, eveningDoneAt: lateAt.toISOString(), win: "Smoke: a late close" });
      await page.reload();
      const after = await readCount();
      const line = (await page.locator('[data-testid="late-line"]').innerText()).trim();
      const row = await db.query.dailyLogs.findFirst({ where: eq(schema.dailyLogs.id, fixtureId) });
      const credited = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, d0)) });
      await db.delete(schema.dailyLogs).where(eq(schema.dailyLogs.id, fixtureId));
      if (saved.length) await db.insert(schema.dailyLogs).values(saved);
      if (after !== before + 1) throw new Error(`a qualifying late close is found: ${before} → ${after}`);
      if (!/^Late close-outs dry run: \d+ closes? found, \d+ members?, \d+ days? credited/.test(line) || /Maya|Torres|@/.test(line)) throw new Error(`the counts line, counts only: ${line}`);
      if (row?.date !== d1 || row.eveningDoneAt !== lateAt.toISOString() || credited) throw new Error("the dry run changes nothing");
      console.log(`✓ Coach → Late close-outs: the dry run finds a late close, counts only, and changes nothing (${line})`);
    }

    // The streak recount (H-289 §4): the dry run as a table, Apply pays once through the ledger, a rerun adds nothing, and
    // the member sees one line on Today until they tap Got it.
    {
      const { SEVEN_DAY_STREAK_SINCE } = await import("@/lib/engine/streak");
      const { sum } = await import("drizzle-orm");
      const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
      const totalOf = async () => Number((await db.select({ t: sum(schema.pointsLedger.points) }).from(schema.pointsLedger).where(eq(schema.pointsLedger.userId, maya.id)))[0]?.t ?? 0);
      await page.goto(`${base}/coach/late-closes`);
      await page.locator('[data-testid="recount-table"]').waitFor({ timeout: 15000 });
      const recountLine = (await page.locator('[data-testid="recount-line"]').innerText()).trim();
      if (!/^Streak recount dry run: \d+ members?, \d+ days? to pay, \d+ points? to add, \d+ days? paid by hand and skipped\.$/.test(recountLine) || /Maya|Torres|@/.test(recountLine)) throw new Error(`the recount line, counts only: ${recountLine}`);
      const rows = page.locator('[data-testid="recount-row"]');
      if ((await rows.count()) < 1) throw new Error("the dry run lists each client");
      const toPay = Number((await page.locator('[data-testid="recount-points"]').innerText()).replace(/,/g, ""));
      const mayaRow = rows.filter({ hasText: "M.T." }).first();
      const mayaToPay = Number((await mayaRow.getAttribute("data-points")) ?? "0");
      const before = await totalOf();
      const streakRowsBefore = (await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "streak")) })).length;
      if (!(await rows.first().innerText()).match(/🔥 \d+/)) throw new Error("each row shows the new streak");
      await submit(page, '[data-testid="recount-apply"]');
      await page.locator('[data-testid="recount-applied"]').waitFor({ timeout: 15000 });
      const applied = (await page.locator('[data-testid="recount-applied"]').innerText()).trim();
      if (!applied.startsWith(`Applied: ${toPay.toLocaleString()} points`)) throw new Error(`Apply pays what the dry run showed: ${applied} vs ${toPay}`);
      const after = await totalOf();
      if (after - before !== mayaToPay) throw new Error(`the member's ledger grew by their row (${mayaToPay}), not ${after - before}`);
      const recountRows = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "streak")) });
      const added = recountRows.filter((r) => /^Streak recount: \d{4}-\d\d-\d\d$/.test(r.reason));
      if (recountRows.length - streakRowsBefore !== added.length || (mayaToPay > 0 && !added.length)) throw new Error("each paid day is one streak row, reason \"Streak recount: {date}\"");
      await page.goto(`${base}/coach/late-closes`);
      if ((await page.locator('[data-testid="recount-points"]').innerText()).trim() !== "0") throw new Error("after Apply the dry run has nothing left to pay");
      await submit(page, '[data-testid="recount-apply"]');
      await page.locator('[data-testid="recount-applied"]').waitFor({ timeout: 15000 });
      if (!(await page.locator('[data-testid="recount-applied"]').innerText()).startsWith("Applied: 0 points over 0 days")) throw new Error("a second Apply adds nothing");
      if ((await totalOf()) !== after) throw new Error("a second Apply changes no ledger");
      console.log(`✓ Streak recount: the dry run lists clients by initials, Apply paid ${toPay} points once, a rerun adds nothing`);

      // The member's one line on Today, with their own number, until Got it.
      await login(page, "client");
      const lineBox = page.locator('[data-testid="streak-recount-line"]');
      await lineBox.waitFor({ timeout: 15000 });
      const lineText = await lineBox.innerText();
      if (!lineText.includes("Your streak now counts every day you show up, weekends too.")) throw new Error(`the recount line: ${lineText}`);
      if (mayaToPay > 0 ? !lineText.includes(`+${mayaToPay.toLocaleString()} points`) : /recounted/.test(lineText)) throw new Error(`the line carries the member's own number (${mayaToPay}): ${lineText}`);
      await submit(page, '[data-testid="streak-recount-line"] button');
      await page.goto(`${base}/today`);
      if (await page.locator('[data-testid="streak-recount-line"]').count()) throw new Error("Got it keeps the line away");
      console.log(`✓ Today's one line about the recount (+${mayaToPay}), gone after Got it`);

      // The settle (H-289 §3): an active day in the last fourteen whose bonus never landed is paid when Today loads, once.
      const mt = todayInTz(mm.timezone || "America/Los_Angeles");
      const d2 = addDays(mt, -2);
      if (d2 >= SEVEN_DAY_STREAK_SINCE) {
        const active = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, d2)) });
        if (active?.morningDoneAt || active?.eveningDoneAt) {
          await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "streak"), eq(schema.pointsLedger.refId, d2)));
          const b = await totalOf();
          await page.goto(`${base}/today`);
          await page.locator('[data-testid="streak-badge"]').waitFor({ timeout: 15000 });
          const paid = await db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "streak"), eq(schema.pointsLedger.refId, d2)) });
          if (!paid || !/^(Streak day [1-5]|Weekend streak \+40)$/.test(paid.reason)) throw new Error(`the settle pays the unpaid active day (${d2}): ${paid?.reason ?? "nothing"}`);
          await page.goto(`${base}/today`);
          await page.locator('[data-testid="streak-badge"]').waitFor({ timeout: 15000 });
          if ((await totalOf()) !== b + paid.points) throw new Error("the settle pays a day once");
          console.log(`✓ the settle paid ${d2} (${paid.reason}) on Today's load, once`);
        } else console.log(`· settle check skipped: ${d2} isn't an active day in the demo data`);
      } else console.log(`· settle check skipped until two days after ${SEVEN_DAY_STREAK_SINCE}`);
    }
  } finally {
    await browser.close();
  }
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Loop smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
