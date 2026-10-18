/**
 * Living scenes PR A (H-327 §1 and §2, H-400): the rank-up ceremony once per rank and only the highest of several crossed at
 * once, after the welcome when both are due, the struck medal while the rank has no clip and the clip window when one exists
 * (a broken file still strikes), See my seat, Share saves a picture, Skip, Escape, reduced motion, a hidden tab; the evening
 * close once per close with the ledger row's own credit and the line about tomorrow, a reload shows nothing; sounds only after
 * a gesture and never with the Settings switch off; 390 and 1440. Runs against the dev server; fixtures go straight to the
 * database, the way the welcome walk's do.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, rmdirSync, renameSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { todayInTz } = await import("@/lib/dates");
  const { activityDate } = await import("@/lib/engine/streak");
  const { streakFor } = await import("@/lib/queries/daily");
  const { TIERS, tierFor } = await import("@/lib/engine/tiers");
  const { rankCard, tomorrowLine } = await import("@/lib/engine/scenes");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mm.workspaceId) }))!;
  const tz = mm.timezone || ws.timezone;
  const today = todayInTz(tz);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const login = async (page: Page) => {
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
  };
  const member = async () => (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!;
  const total = async () => (await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })).reduce((s, r) => s + r.points, 0);
  const sounds = (page: Page) => page.evaluate(() => ((window as unknown as { __hxSounds?: string[] }).__hxSounds ?? []).slice());
  const ranksDir = path.join(process.cwd(), "public", "ranks");
  let fakeClip: string | null = null;
  // The real relic clips (H-605) are set aside while the walk checks the medal and a broken file, and put back for the real-clip
  // check and at the end, whatever happens. A stash left by a walk that was killed is put back first.
  const stash = path.join(process.cwd(), ".smoke-ranks-stash");
  const setAside = () => {
    if (existsSync(ranksDir)) renameSync(ranksDir, stash);
  };
  const putBack = () => {
    if (!existsSync(stash)) return;
    if (existsSync(ranksDir)) {
      if (readdirSync(ranksDir).length) throw new Error(`both ${ranksDir} and ${stash} hold files: sort them out by hand`);
      rmdirSync(ranksDir);
    }
    renameSync(stash, ranksDir);
  };
  putBack();
  setAside();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // ── Fixture: two ranks crossed at once by a hand adjustment (never an active day, H-289 §1); the welcome due; the seen rank recorded at today's. ──
    const before = await total();
    const now = tierFor(before);
    const next1 = TIERS.find((t) => t.minPoints > before);
    const next2 = next1 ? TIERS.find((t) => t.minPoints > next1.minPoints) : null;
    must(next1 && next2, "the demo client has two ranks above them to cross");
    await db.insert(schema.pointsLedger).values({ id: crypto.randomUUID(), workspaceId: mm.workspaceId, userId: maya.id, type: "bonus", points: next2!.minPoints - before + 40, reason: "Smoke: two ranks at once", adjustedBy: "smoke" });
    const points = await total();
    const card = rankCard(next2!, points);
    await db.update(schema.memberships).set({ celebratedTierLevel: now.level, welcomeShownOn: null, soundsOn: true }).where(eq(schema.memberships.id, mm.id));

    // ── After the welcome: the ceremony waits while the welcome plays, then opens on its close. The medal, no clip yet. ──
    await login(page);
    const dw = page.locator('[data-testid="daily-welcome"]');
    const rk = page.locator('[data-testid="rank-up"]');
    await dw.waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    must((await rk.count()) === 0, "a rank-up due on the same open waits for the welcome");
    await page.locator('[data-testid="welcome-skip"]').click();
    await page.locator('[data-testid="welcome-skip"]').click();
    await rk.waitFor({ timeout: 5000 });
    must((await dw.count()) === 0, "the welcome is gone when the ceremony opens");
    must((await rk.getAttribute("data-window")) === "medal" && (await page.locator('[data-testid="rank-medal"]').count()) === 1, "no clip file: the struck medal plays");
    must((await rk.getAttribute("data-rank")) === card.slug && (await rk.getAttribute("data-level")) === String(next2!.level), `only the highest of the two ranks crossed: ${card.slug}`);
    await page.waitForFunction(() => document.querySelector('[data-testid="rank-up"]')?.getAttribute("data-state") === "ended", null, { timeout: 8000 });
    // textContent: the eyebrow is set in capitals by CSS.
    must((await page.locator('[data-testid="rank-eyebrow"]').textContent())?.trim() === card.eyebrow, `the eyebrow in numerals: ${card.eyebrow}`);
    must((await page.locator('[data-testid="rank-name"]').textContent())?.trim() === next2!.name, "the rank's name struck");
    must((await page.locator('[data-testid="rank-line"]').textContent())?.trim() === card.line, `the points passed and the seat: ${card.line}`);
    const pips = page.locator('[data-testid="rank-pip"]');
    must((await pips.count()) === TIERS.length && (await page.locator('[data-testid="rank-pip"][data-state="now"]').count()) === 1, "a nine-step ladder with one rank lit");
    must((await pips.nth(next2!.level - 1).getAttribute("data-state")) === "now", "the lit step is the new rank's");
    must((await page.locator('[data-testid="rank-next"]').textContent())?.replace(/\s+/g, " ").trim() === card.nextLine.replace(/\s+/g, " "), `the next rank: ${card.nextLine}`);
    must((await sounds(page)).includes("cheer-rankup"), "the cheer under the strike, after the member's taps on the welcome (a gesture)");
    await page.screenshot({ path: "screenshots/sc00-rankup-medal.png" });
    // Share: no share sheet in this browser, so the picture is saved.
    const dl = page.waitForEvent("download", { timeout: 10000 });
    await page.locator('[data-testid="rank-share"]').click();
    must((await dl).suggestedFilename() === `helixos-rank-${card.slug}.png`, "Share saves a picture of the card");
    await page.waitForFunction(() => document.querySelector('[data-testid="rank-up"]')?.getAttribute("data-shared") === "saved", null, { timeout: 3000 });
    // See my seat: the Colosseum, and the rank recorded as seen.
    await page.locator('[data-testid="rank-seat"]').click();
    await page.waitForURL(/\/colosseum/);
    must((await rk.count()) === 0, "See my seat closes the ceremony");
    await page.waitForTimeout(800);
    must((await member()).celebratedTierLevel === next2!.level, "the rank seen is recorded at the highest");
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="streak-badge"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    must((await rk.count()) === 0, "once per rank, ever: not on the next open, and the skipped rank below never plays");
    console.log(`✓ rank-up after the welcome: ${next2!.name} (the highest of two crossed), the medal, the card's words from the engine, Share saved, See my seat opened the Colosseum, recorded once`);

    // ── A clip file: the window plays it; a broken file still strikes the card. No gesture on this open: no cheer. ──
    mkdirSync(ranksDir, { recursive: true });
    fakeClip = path.join(ranksDir, `rank-${card.slug}.webm`);
    writeFileSync(fakeClip, "not a video");
    await db.update(schema.memberships).set({ celebratedTierLevel: next2!.level - 1 }).where(eq(schema.memberships.id, mm.id));
    await page.goto(`${base}/today`);
    await rk.waitFor({ timeout: 15000 });
    must((await rk.getAttribute("data-window")) === "clip" && (await page.locator('[data-testid="rank-clip"]').count()) === 1, "a clip file in public/ranks: the window plays it");
    await page.waitForFunction(() => ["card", "ended"].includes(document.querySelector('[data-testid="rank-up"]')?.getAttribute("data-state") ?? ""), null, { timeout: 8000 });
    must(!(await sounds(page)).includes("cheer-rankup"), "nothing plays without a gesture on the page");
    await page.keyboard.press("Escape");
    must((await rk.getAttribute("data-state")) === "done", "Escape jumps to the end");
    await page.keyboard.press("Escape");
    must((await rk.count()) === 0, "Escape again closes it");
    await page.waitForTimeout(800);
    rmSync(fakeClip);
    fakeClip = null;
    console.log("✓ the clip window when a file exists (a broken file strikes the card all the same), no sound before a gesture, Escape twice");

    // ── The real relic clip for this rank (H-605): the WebM plays to its end with the last frame as its poster, then the card. ──
    if (existsSync(ranksDir) && readdirSync(ranksDir).length === 0) rmdirSync(ranksDir);
    putBack();
    if (existsSync(path.join(ranksDir, `rank-${card.slug}.webm`))) {
      await db.update(schema.memberships).set({ celebratedTierLevel: next2!.level - 1 }).where(eq(schema.memberships.id, mm.id));
      await page.goto(`${base}/today`);
      await rk.waitFor({ timeout: 15000 });
      const clipEl = page.locator('[data-testid="rank-clip"]');
      must((await rk.getAttribute("data-window")) === "clip" && (await clipEl.count()) === 1, "the real clip: the window plays it");
      must((await clipEl.getAttribute("poster")) === `/ranks/rank-${card.slug}-end.jpg`, "its last frame is the poster");
      await page.waitForFunction(() => (document.querySelector('[data-testid="rank-clip"]') as HTMLVideoElement | null)?.ended === true, null, { timeout: 14000 });
      const played = await clipEl.evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc, error: v.error?.code ?? null, duration: v.duration, w: v.videoWidth }));
      must(played.error === null && played.src.endsWith(`/ranks/rank-${card.slug}.webm`) && played.w === 1280 && played.duration > 5 && played.duration < 12, `the WebM played to its end: ${JSON.stringify(played)}`);
      await page.waitForFunction(() => ["card", "ended"].includes(document.querySelector('[data-testid="rank-up"]')?.getAttribute("data-state") ?? ""), null, { timeout: 5000 });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      must((await rk.count()) === 0, "Escape twice closes it");
      await page.waitForTimeout(800);
      console.log(`✓ the real ${card.slug} clip played to its end (${played.duration.toFixed(1)} s, 1280 wide) with its last frame as the poster, then the card`);
    } else {
      console.log(`· no real clip for ${card.slug} in public/ranks: skipped the real-clip check`);
    }
    setAside();

    // ── Reduced motion: the finished card at once. Then 390 and 1440, Skip, a hidden tab. ──
    await db.update(schema.memberships).set({ celebratedTierLevel: next2!.level - 1 }).where(eq(schema.memberships.id, mm.id));
    const quiet = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const q = await quiet.newPage();
    await q.goto(`${base}/today`);
    await q.locator('[data-testid="rank-up"]').waitFor({ timeout: 15000 });
    await q.waitForFunction(() => document.querySelector('[data-testid="rank-up"]')?.getAttribute("data-state") === "done", null, { timeout: 3000 });
    must((await q.locator('[data-testid="rank-medal"]').count()) === 1 && (await q.locator('[data-testid="rank-seat"]').evaluate((el) => el === document.activeElement)), "reduced motion: the finished card, focus on the button");
    await q.screenshot({ path: "screenshots/sc01-rankup-quiet.png" });
    await q.locator('[data-testid="rank-skip"]').click();
    await q.waitForTimeout(800);
    await quiet.close();
    for (const width of [390, 1440]) {
      await db.update(schema.memberships).set({ celebratedTierLevel: next2!.level - 1 }).where(eq(schema.memberships.id, mm.id));
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.goto(`${base}/today`);
      await rk.waitFor({ timeout: 15000 });
      must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px: nothing wider than the screen`);
      const col = await page.locator(".rk-col").boundingBox();
      must(col && col.width <= 392 && col.x >= 0, `${width}px: the column is 390 at most (${JSON.stringify(col)})`);
      if (width >= 480) must(col && Math.abs(col.x + col.width / 2 - width / 2) < 3, `${width}px: the column sits centred`);
      must((await page.locator('[data-testid="rank-skip"]').boundingBox())!.height >= 44, `${width}px: Skip is 44px tall`);
      if (width === 390) {
        // A hidden tab holds everything.
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(100);
        must((await rk.getAttribute("class"))?.includes("sc-paused"), "a hidden tab pauses the scene");
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(100);
        must(!(await rk.getAttribute("class"))?.includes("sc-paused"), "back in view, it goes on");
      }
      await page.locator('[data-testid="rank-skip"]').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="rank-up"]')?.getAttribute("data-state") === "done", null, { timeout: 3000 });
      await page.screenshot({ path: `screenshots/sc02-rankup-${width}.png` });
      must((await page.locator('[data-testid="rank-seat"]').boundingBox())!.height >= 44, `${width}px: the buttons are 44px tall`);
      await page.locator('[data-testid="rank-skip"]').click();
      must((await rk.count()) === 0, `${width}px: Close closes it`);
      await page.waitForTimeout(800);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    console.log("✓ reduced motion shows the finished card; 390 and 1440 with the column 390 wide and centred; a hidden tab pauses; Skip then Close");

    // ── The sounds switch off: the strike plays no cheer, even after a gesture. ──
    await page.goto(`${base}/settings#sounds`);
    const box = page.locator('[data-testid="sounds-on"]');
    await box.waitFor({ timeout: 15000 });
    must(await box.isChecked(), "sounds are on by default");
    await box.uncheck();
    await page.locator('[data-testid="sounds-save"]').click();
    await page.waitForFunction(() => !(document.querySelector('[data-testid="sounds-on"]') as HTMLInputElement | null)?.checked, null, { timeout: 10000 });
    must((await member()).soundsOn === false, "the switch is remembered on the membership");
    await db.update(schema.memberships).set({ celebratedTierLevel: next2!.level - 1 }).where(eq(schema.memberships.id, mm.id));
    await page.goto(`${base}/today`);
    await rk.waitFor({ timeout: 15000 });
    await page.mouse.click(5, 5);
    await page.waitForFunction(() => ["card", "ended", "done"].includes(document.querySelector('[data-testid="rank-up"]')?.getAttribute("data-state") ?? ""), null, { timeout: 8000 });
    must(!(await sounds(page)).includes("cheer-rankup"), "with the switch off, nothing plays after a gesture either");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await db.update(schema.memberships).set({ soundsOn: true }).where(eq(schema.memberships.id, mm.id));
    console.log("✓ Settings → Sounds: on by default, off is remembered and silences the strike");

    // ── The evening close: once per close, the ledger row's own credit, the line about tomorrow; a reload shows nothing. ──
    await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, today)));
    for (const r of await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })) if ((r.type !== "bonus" && activityDate(r, tz) === today) || ((r.type === "streak" || r.type === "close") && r.refId === today)) await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.id, r.id));
    await db.update(schema.memberships).set({ welcomeShownOn: today }).where(eq(schema.memberships.id, mm.id));
    const s = await streakFor(mm.workspaceId, maya.id, { today, hour: 12, tz, days: mm.workDays });
    await page.goto(`${base}/today#close`);
    const early = page.locator('[data-testid="close-early"]');
    // The close's optional groups are details of their own: the outer summary is the first.
    if (await early.count()) await early.locator("summary").first().click();
    const form = page.locator('[data-testid="close-form"]');
    await form.waitFor({ timeout: 15000 });
    await form.locator('button[type="submit"]').last().click();
    const ec = page.locator('[data-testid="evening-close"]');
    await ec.waitFor({ timeout: 20000 });
    const closeRow = await db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "close"), eq(schema.pointsLedger.refId, today)) });
    must(closeRow, "the close wrote its ledger row for today");
    must((await ec.getAttribute("data-close")) === closeRow!.id, "the scene is keyed on the close's own ledger row");
    must((await page.locator('[data-testid="evening-credit"]').getAttribute("data-value")) === String(closeRow!.points), `the credit is the ledger row's own (+${closeRow!.points})`);
    must((await page.locator('[data-testid="evening-title"]').textContent())?.trim() === "The arena is lit.", "Day closed. The arena is lit.");
    must((await page.locator('[data-testid="evening-tomorrow"]').textContent())?.trim() === tomorrowLine(today, mm.workDays, s.activity.ladder), `the line about tomorrow from the streak engine: ${tomorrowLine(today, mm.workDays, s.activity.ladder)}`);
    must((await sounds(page)).includes("crowd-murmur"), "the arena's murmur, after the close's tap (a gesture)");
    await page.waitForFunction(() => document.querySelector('[data-testid="evening-close"]')?.getAttribute("data-state") === "ended", null, { timeout: 8000 });
    await page.screenshot({ path: "screenshots/sc03-close-1280.png" });
    await page.locator('[data-testid="evening-cta"]').click();
    must((await ec.count()) === 0, "Good night closes it");
    await page.reload();
    await page.locator('[data-testid="streak-badge"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    must((await ec.count()) === 0, "once per close: a reload shows nothing");
    const closeRows = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "close"), eq(schema.pointsLedger.refId, today)) });
    must(closeRows.length === 1, "one close row for the day");
    // Skip and 390: the finished state, the card on screen.
    await page.evaluate((id) => localStorage.removeItem(`hx-close-${id}`), closeRow!.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await ec.waitFor({ timeout: 15000 });
    await page.locator('[data-testid="evening-skip"]').click();
    must((await ec.getAttribute("data-state")) === "done", "Skip jumps to the end");
    must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390px: nothing wider than the screen");
    const ecCard = await page.locator(".ec-card").boundingBox();
    must(ecCard && ecCard.x >= 0 && ecCard.x + ecCard.width <= 391, "390px: the card on screen");
    await page.screenshot({ path: "screenshots/sc04-close-390.png" });
    await page.keyboard.press("Escape");
    must((await ec.count()) === 0, "Escape closes the finished card");
    console.log(`✓ evening close: once per close, keyed on the ledger row, +${closeRow!.points} from the row itself, tomorrow's line from the engine, the murmur after the tap, Skip and 390`);
  } finally {
    if (fakeClip && existsSync(fakeClip)) rmSync(fakeClip);
    if (existsSync(ranksDir) && readdirSync(ranksDir).length === 0) rmdirSync(ranksDir);
    putBack();
    await browser.close();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Scenes smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
