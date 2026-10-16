/**
 * The Daily welcome (H-312, plan H-314, reading A): once per member per local day on first open, over whatever page they opened;
 * opening counts as showing up, so the day's streak bonus lands through the ledger and today's coin shows that credit; this
 * week's coins, the fire stage, days in the arena; never on /coach pages, never on the member's first day; a missed day gives
 * rings, the comeback words and an ember; Skip, Escape, a scrim tap and reduced motion go to the finished state; 390, 768 and
 * 1440 in both looks. Runs against the dev server; sets fixtures directly in the database.
 */
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { addDays, todayInTz } = await import("@/lib/dates");
  const { activityDate, bonusFor } = await import("@/lib/engine/streak");
  const { streakFor } = await import("@/lib/queries/daily");
  const { fireStage } = await import("@/lib/engine/welcome");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const cm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mm.workspaceId) }))!;
  const tz = mm.timezone || ws.timezone;
  const today = todayInTz(tz);
  const yesterday = addDays(today, -1);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const login = async (page: Page, who: "client" | "coach") => {
    await page.goto(`${base}/login`);
    await page.click(who === "client" ? 'button:has-text("As a client")' : 'button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
  };
  // /login sends a signed-in member to Today, so a change of member starts with the Log out button.
  const logout = async (page: Page) => {
    await page.goto(`${base}/settings`);
    await page.locator('button:has-text("Log out")').first().click();
    await page.waitForURL(/\/login/);
  };
  const clear = async (membershipId: string) => db.update(schema.memberships).set({ welcomeShownOn: null }).where(eq(schema.memberships.id, membershipId));
  const streakRow = async (userId: string, date: string) => db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, userId), eq(schema.pointsLedger.type, "streak"), eq(schema.pointsLedger.refId, date)) });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // ── Fixture: today not yet active, nothing paid for it; yesterday active (the seed's close); the welcome not seen. ──
    await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, today)));
    for (const r of await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })) if (activityDate(r, tz) === today || (r.type === "streak" && r.refId === today)) await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.id, r.id));
    await db.update(schema.memberships).set({ sceneLook: "night" }).where(eq(schema.memberships.id, mm.id));
    await clear(mm.id);
    const before = await streakFor(mm.workspaceId, maya.id, { today, hour: 12, tz, days: mm.workDays });
    must(before.activity.active.has(yesterday) && !before.activity.active.has(today), "the fixture: yesterday active, today not yet");
    const worth = bonusFor(before.activity.ladder, today, mm.workDays).points;

    // ── The first open of the day: the welcome over Today, today's coin struck with the ledger's own credit. ──
    await login(page, "client");
    const dw = page.locator('[data-testid="daily-welcome"]');
    await dw.waitFor({ timeout: 15000 });
    must((await dw.getAttribute("data-look")) === "night", "the member's own scene look");
    const paid = await streakRow(maya.id, today);
    must(paid && paid.points === worth && /^(Streak day [1-5]|Weekend streak \+40)$/.test(paid.reason), `opening counts as showing up: today's bonus (${worth}) landed through the ledger: ${JSON.stringify(paid)}`);
    const log = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, today)) });
    must(Boolean(log?.openedAt), "the day's log is marked opened");
    const after = await streakFor(mm.workspaceId, maya.id, { today, hour: 12, tz, days: mm.workDays });
    const todayCoin = page.locator('[data-testid="welcome-coin"][data-state="today"]');
    must((await todayCoin.count()) === 1 && (await todayCoin.getAttribute("data-amount")) === String(paid!.points), `today's coin carries the ledger's credit: ${await todayCoin.getAttribute("data-amount")}`);
    // textContent, not innerText: the label is set in capitals by CSS, and the words are what the test reads.
    must((await page.locator('[data-testid="welcome-gain"]').textContent())?.trim() === `+${paid!.points} today`, "the week line says +N today");
    must((await page.locator('[data-testid="welcome-streak"]').getAttribute("data-value")) === String(after.running) && after.running === before.running + 1, `the streak number is the shared read's (${after.running})`);
    must((await page.locator('[data-testid="welcome-flame"]').getAttribute("data-stage")) === String(fireStage(after.running)), "the fire stage is min(streak, 7)");
    must((await page.locator('[data-testid="welcome-days"]').getAttribute("data-value")) === String(after.activity.active.size), "days in the arena is every active day ever");
    must((await page.locator('[data-testid="welcome-coins"] [data-testid="welcome-coin"]').count()) === 7, "seven coins, Monday to Sunday");
    must((await page.locator('[data-testid="welcome-title"]').innerText()).startsWith(`Day ${after.running}`), `the title names the day: ${await page.locator('[data-testid="welcome-title"]').innerText()}`);
    must((await page.locator('[data-testid="welcome-summary"]').innerText()).includes(`Day ${after.running} streak`), "one aria-live summary");
    must((await page.locator('[data-testid="welcome-cta"]').textContent())?.trim() === "Lock in today", "the button goes to the lock-in while the day isn't locked in");
    // The sequence ends on its own; then the button takes the focus.
    await page.waitForFunction(() => document.querySelector('[data-testid="daily-welcome"]')?.getAttribute("data-state") === "ended", null, { timeout: 8000 });
    must(await page.locator('[data-testid="welcome-cta"]').evaluate((el) => el === document.activeElement), "focus moves to the button when the sequence ends");
    await page.screenshot({ path: "screenshots/dw00-streak-night.png" });
    await page.locator('[data-testid="welcome-cta"]').click();
    await page.waitForURL(/\/today/);
    must((await dw.count()) === 0, "Lock in today closes the welcome");
    // Once a day: a reload and a second device (a fresh context, same login) show nothing more.
    await page.reload();
    await page.locator('[data-testid="streak-badge"]').waitFor({ timeout: 15000 });
    must((await dw.count()) === 0, "shown once a day: not on a reload");
    const other: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await other.newPage();
    await login(p2, "client");
    await p2.locator('[data-testid="streak-badge"]').waitFor({ timeout: 15000 });
    must((await p2.locator('[data-testid="daily-welcome"]').count()) === 0, "shown once a day across devices");
    await other.close();
    must((await streakRow(maya.id, today))!.id === paid!.id, "the day's bonus was paid once");
    console.log(`✓ first open of the day: the welcome over Today, the day's bonus (+${paid!.points}) landed once through the ledger and struck on today's coin, streak ${after.running}, fire stage ${fireStage(after.running)}, ${after.activity.active.size} days in the arena; once a day across devices`);

    // ── Skip, the scrim tap, Escape and the widths in both looks. ──
    for (const [width, look] of [[390, "night"], [768, "day"], [1440, "night"], [390, "day"]] as const) {
      await db.update(schema.memberships).set({ sceneLook: look }).where(eq(schema.memberships.id, mm.id));
      await clear(mm.id);
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.goto(`${base}/today`);
      await dw.waitFor({ timeout: 15000 });
      must((await dw.getAttribute("data-look")) === look, `${width}px: the ${look} look`);
      must((await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), `${width}px: nothing wider than the screen`);
      const card = await page.locator(".dw-card").boundingBox();
      must(card && card.width <= 392 && card.x >= 0 && card.x + card.width <= width + 1, `${width}px: the card is 390 at most and on screen (${JSON.stringify(card)})`);
      if (width >= 480) must(card && Math.abs(card.x + card.width / 2 - width / 2) < 3, `${width}px: the card sits centred`);
      must((await page.locator('[data-testid="welcome-skip"]').boundingBox())!.height >= 44 && (await page.locator('[data-testid="welcome-cta"]').boundingBox())!.height >= 44, `${width}px: tap targets at least 44px`);
      await page.locator('[data-testid="welcome-skip"]').click();
      // The picture is the finished card (the lines rise in over three seconds; a shot taken at once would show the card empty).
      await page.waitForFunction(() => document.querySelector('[data-testid="daily-welcome"]')?.getAttribute("data-state") === "done", null, { timeout: 3000 }).catch(() => {});
      await page.screenshot({ path: `screenshots/dw01-${look}-${width}.png` });
      must((await dw.getAttribute("data-state")) === "done", `${width}px: Skip jumps to the finished state`);
      await page.locator('[data-testid="welcome-scrim"]').click({ position: { x: 10, y: 10 } });
      must((await dw.count()) === 0, `${width}px: a second tap closes it`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await clear(mm.id);
    await page.goto(`${base}/today`);
    await dw.waitFor({ timeout: 15000 });
    await page.keyboard.press("Escape");
    must((await dw.getAttribute("data-state")) === "done", "Escape jumps to the finished state");
    await page.keyboard.press("Escape");
    must((await dw.count()) === 0, "Escape again closes it");
    // Reduced motion: the finished state straight away.
    await clear(mm.id);
    const quiet = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const q = await quiet.newPage();
    await q.goto(`${base}/today`);
    await q.locator('[data-testid="daily-welcome"]').waitFor({ timeout: 15000 });
    // The server can't know the browser's motion setting: the finished state lands with hydration, a moment after the card.
    await q.waitForFunction(() => document.querySelector('[data-testid="daily-welcome"]')?.getAttribute("data-state") === "done", null, { timeout: 3000 }).catch(() => {});
    must((await q.locator('[data-testid="daily-welcome"]').getAttribute("data-state")) === "done", "reduced motion shows the finished state with no motion");
    must(await q.locator('[data-testid="welcome-cta"]').evaluate((el) => el === document.activeElement), "reduced motion: focus on the button at once");
    await quiet.close();
    console.log("✓ Skip, the scrim, Escape and reduced motion all reach the finished state; 390, 768 and 1440 in both looks, the card 390 wide and centred on desktop");

    // ── A missed day: the comeback words, rings for the missed days, an ember; days in the arena holds. ──
    const d1 = addDays(today, -1);
    const d2 = addDays(today, -2);
    const activeBefore = (await streakFor(mm.workspaceId, maya.id, { today, hour: 12, tz, days: mm.workDays })).activity.active;
    // The fixture takes today and the two days before out of the set; the open puts today back.
    const daysBefore = activeBefore.size - [d1, d2, today].filter((d) => activeBefore.has(d)).length + 1;
    await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, today)));
    await db.update(schema.dailyLogs).set({ morningDoneAt: null, eveningDoneAt: null, repairedAt: null, openedAt: null }).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, d1)));
    await db.update(schema.dailyLogs).set({ morningDoneAt: null, eveningDoneAt: null, repairedAt: null, openedAt: null }).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, d2)));
    for (const r of await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })) {
      const on = activityDate(r, tz);
      if (on === d1 || on === d2 || on === today || (r.type === "streak" && [d1, d2, today].includes(r.refId ?? ""))) await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.id, r.id));
    }
    await clear(mm.id);
    await page.goto(`${base}/today`);
    await dw.waitFor({ timeout: 15000 });
    must((await page.locator('[data-testid="welcome-eyebrow"]').textContent())?.startsWith("Welcome back"), "after a gap: Welcome back");
    must((await page.locator('[data-testid="welcome-title"]').innerText()) === "Back in the arena.", "after a gap: Back in the arena.");
    must((await page.locator('[data-testid="welcome-flame"]').getAttribute("data-stage")) === "1", "after a gap: an ember");
    must((await page.locator('[data-testid="welcome-coin"][data-state="missed"]').count()) >= 1, "the missed days show as empty rings");
    must(Number(await page.locator('[data-testid="welcome-days"]').getAttribute("data-value")) === daysBefore, `days in the arena never reset: ${activeBefore.size} before the gap, now ${await page.locator('[data-testid="welcome-days"]').getAttribute("data-value")}`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[data-testid="daily-welcome"]')?.getAttribute("data-state") === "done", null, { timeout: 3000 }).catch(() => {});
    await page.screenshot({ path: "screenshots/dw02-comeback.png" });
    await page.keyboard.press("Escape");
    console.log("✓ after a gap: Welcome back, Back in the arena, an ember, rings for the missed days, days in the arena kept");

    // ── Never on /coach pages, never on the member's first day; the coach sees it on their own pages. ──
    await logout(page);
    await login(page, "coach");
    // Signing in lands on Today, which shows it; cleared again so /coach is the first page that could.
    await clear(cm.id);
    await page.goto(`${base}/coach`);
    await page.locator("main").waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    must((await dw.count()) === 0, "never on /coach pages");
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, cm.id) }))!.welcomeShownOn === null, "a /coach page doesn't mark it shown");
    await page.goto(`${base}/today`);
    await dw.waitFor({ timeout: 15000 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await db.update(schema.memberships).set({ welcomeShownOn: null, startedAt: today }).where(eq(schema.memberships.id, mm.id));
    await logout(page);
    await login(page, "client");
    await page.locator('[data-testid="streak-badge"]').waitFor({ timeout: 15000 });
    must((await dw.count()) === 0, "never on the member's first day");
    await db.update(schema.memberships).set({ startedAt: addDays(today, -24), welcomeShownOn: "9999-12-31" }).where(eq(schema.memberships.id, mm.id));
    console.log("✓ never on /coach pages (and not marked shown there), the coach's own Today has it, never on a member's first day");
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Welcome smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
