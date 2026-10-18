/**
 * The streak flame (H-552, plan H-558): the pill replaces the old 🔥 badge, beside the member's name on a computer, above
 * Settings on the folded rail and at the right of the phone's top bar. Its name is "{n}-day streak. Open streak details"; it
 * opens the detail sheet (the fire large, the count, "Day streak", the tier and the days to the next one). The daily surge
 * waits for the daily welcome to close, plays once (the count ticks up by one) and is stored, so a reload doesn't play it again.
 * WebGL contexts: never more than two. Reduced motion: no surge, still stored. No WebGL: the SVG flame. Nothing wider than
 * 390 px. Runs against the dev server; fixtures go straight to the database.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(page: Page) {
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/, { timeout: 30000 });
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { addDays, todayInTz } = await import("@/lib/dates");
  const { streakFor } = await import("@/lib/queries/daily");
  const { flameLabel, flameTier, nextTierLine, tierName } = await import("@/lib/engine/streak-flame");

  const maya = await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") });
  must(maya, "the seed's client");
  const mm = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya!.id) });
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mm!.workspaceId) });
  const tz = ws!.timezone;
  const today = todayInTz(tz);
  const reset = (o: { welcome: boolean }) =>
    db.update(schema.memberships).set({ streakSurgeSeenOn: null, welcomeShownOn: o.welcome ? addDays(today, -1) : today, navState: {} }).where(and(eq(schema.memberships.id, mm!.id)));
  // The sidebar's fold is saved per member; each section starts open.
  const unfold = () => db.update(schema.memberships).set({ navState: {} }).where(eq(schema.memberships.id, mm!.id));
  const seenOn = async () => (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm!.id) }))!.streakSurgeSeenOn;
  const read = () => streakFor(mm!.workspaceId, maya!.id, { today, hour: 12, tz, days: mm!.workDays });

  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  };
  const webgl = (page: Page) => page.locator('[data-flame="fire"][data-flame-mode="webgl"]').count();
  const fires = (page: Page) => page.locator('[data-flame="fire"][data-flame-mode="webgl"], [data-flame="fire"][data-flame-mode="svg"]').count();
  const noSideways = async (page: Page, what: string) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    must(w <= 390, `${what}: nothing wider than 390 (${w})`);
  };
  try {
    // ── 1. A computer, the first open of the day: the welcome first, then the surge, once. ──
    await reset({ welcome: true });
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    watch(page);
    await login(page);
    const dw = page.locator('[data-testid="daily-welcome"]');
    await dw.waitFor({ timeout: 15000 });
    // A key press is the gesture sounds wait for (H-400); the welcome's coins then sound as they land (H-651).
    await page.keyboard.press("Shift");
    const after = await read();
    const days = Math.max(1, after.running);
    must(after.activity.active.has(after.asOf), "the welcome counted today as showing up");
    const pill = page.locator('[data-testid="streak-pill-side"]');
    await pill.waitFor({ timeout: 10000 });
    must((await page.locator('[data-testid="streak-pill-bar"]').isVisible()) === false && (await page.locator('[data-testid="streak-pill-rail"]').isVisible()) === false, "one pill shows on a computer: the sidebar's");
    must((await pill.getAttribute("aria-label")) === flameLabel(days), `the pill's name: ${await pill.getAttribute("aria-label")}`);
    must((await pill.getAttribute("data-surge")) === "due", "the surge waits while the welcome is open");
    must((await pill.locator('[data-testid="streak-count"]').innerText()).trim() === String(days - 1), "the count shows yesterday's number until the surge");
    must((await seenOn()) === null, "nothing stored before the surge plays");
    const box = await pill.boundingBox();
    must(box && box.height >= 44, `the pill is at least 44 px tall (${box?.height})`);
    // It fits its row: never past the sidebar's edge, Waiting on you or not (an amber dot there, the words only in the top bar).
    const fit = await pill.evaluate((el) => {
      const side = (el.closest("aside") ?? el.parentElement!.parentElement!) as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = side.getBoundingClientRect();
      return { right: r.right, edge: s.right, left: r.left, start: s.left };
    });
    must(fit.right <= fit.edge + 0.5 && fit.left >= fit.start - 0.5, `the sidebar pill stays inside the sidebar (${JSON.stringify(fit)})`);
    if ((await pill.getAttribute("data-waiting")) === "true") must((await pill.locator('[data-testid="streak-waiting"] .sf-dot').count()) === 1 && (await pill.locator(".sf-chip").count()) === 0, "waiting in the sidebar: the amber dot, no words to overflow");
    const played = () => page.evaluate(() => ((window as unknown as { __hxSounds?: string[] }).__hxSounds ?? []).slice());
    await page.waitForFunction(() => ((window as unknown as { __hxSounds?: string[] }).__hxSounds ?? []).includes("coin"), null, { timeout: 5000 });
    const welcomeLog = await played();
    must(welcomeLog.includes("coin") && welcomeLog.indexOf("coin") === welcomeLog.lastIndexOf("coin"), `today's coin sounds once as it lands: ${JSON.stringify(welcomeLog)}`);
    const ticksBefore = welcomeLog.filter((n) => n === "tick").length;
    // Close the welcome: Skip, then its button.
    await page.locator('[data-testid="welcome-skip"]').click();
    await page.locator('[data-testid="welcome-cta"]').click();
    await page.waitForURL(/\/today/);
    await page.waitForFunction(() => document.querySelector('[data-testid="streak-pill-side"]')?.getAttribute("data-surge") === "playing", null, { timeout: 8000 });
    await page.waitForFunction((d) => document.querySelector('[data-testid="streak-pill-side"] [data-testid="streak-count"]')?.textContent?.trim() === String(d), days, { timeout: 4000 });
    for (let i = 0; i < 20 && (await seenOn()) !== after.asOf; i++) await sleep(250);
    must((await seenOn()) === after.asOf, `the surge is stored for the streak day (${await seenOn()})`);
    must((await played()).filter((n) => n === "tick").length === ticksBefore + 1, `one tick as the count goes up: ${JSON.stringify(await played())}`);
    const mode = await pill.locator('[data-flame="fire"]').getAttribute("data-flame-mode");
    must(mode === "webgl", `the pill draws the live fire (${mode})`);
    must((await webgl(page)) <= 1, "one WebGL context with the sheet closed");
    await page.screenshot({ path: "screenshots/fl00-desktop.png" });
    // A reload: no surge.
    await page.reload();
    await pill.waitFor({ timeout: 15000 });
    await sleep(1200);
    must((await pill.getAttribute("data-surge")) === "none" && (await pill.locator('[data-testid="streak-count"]').innerText()).trim() === String(days), "a reload doesn't play the surge again");
    // The sheet: the fire large, the count, Day streak, the tier, the days to the next.
    await pill.click();
    const sheet = page.locator('[data-testid="streak-sheet"]');
    await sheet.waitFor({ timeout: 5000 });
    must((await page.locator('[data-testid="streak-sheet-count"]').innerText()).trim() === String(days), "the sheet's count");
    must((await sheet.innerText()).toUpperCase().includes("DAY STREAK"), "Day streak");
    must((await page.locator('[data-testid="streak-sheet-tier"]').innerText()).trim() === tierName(flameTier(days)), "the sheet names the tier");
    must((await page.locator('[data-testid="streak-sheet-next"]').innerText()).trim() === nextTierLine(days), "the days to the next tier");
    must((await sheet.locator('[data-flame="fire"]').count()) === 1, "the sheet's own fire");
    await sleep(300);
    must((await webgl(page)) <= 2, `at most two WebGL contexts with the sheet open (${await webgl(page)})`);
    must((await page.locator('[data-testid="streak-sheet-close"]').boundingBox())!.height >= 44, "Close is 44 px");
    await page.screenshot({ path: "screenshots/fl01-sheet.png" });
    await page.keyboard.press("Escape");
    must((await sheet.count()) === 0, "Escape closes the sheet");
    must(await pill.evaluate((el) => el === document.activeElement), "focus goes back to the pill");
    await sleep(300);
    must((await webgl(page)) <= 1, "the sheet's context is given back");
    // Folded to the rail: the rail's pill, above Settings.
    await page.locator('[data-testid="nav-rail-toggle"]').click();
    const railPill = page.locator('[data-testid="streak-pill-rail"]');
    await railPill.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="streak-pill-rail"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "webgl", null, { timeout: 5000 });
    must(!(await pill.isVisible()), "the sidebar's pill hides on the rail");
    const rb = await railPill.boundingBox();
    const sb = await page.locator('[data-testid="rail-settings"]').boundingBox();
    must(rb && sb && rb.y < sb.y, "the rail's pill sits above Settings");
    await sleep(400);
    must((await webgl(page)) <= 1, `the folded sidebar keeps one context (${await webgl(page)})`);
    await page.locator('[data-testid="nav-rail-toggle"]').click();
    await pill.waitFor({ state: "visible", timeout: 5000 });
    // Back from the rail, the sidebar's fire is live again (its context given back and restored, not an SVG).
    await page.waitForFunction(() => document.querySelector('[data-testid="streak-pill-side"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "webgl", null, { timeout: 5000 });
    must((await webgl(page)) <= 1, "still one context after the rail");
    console.log(`✓ a computer: the pill by the name (${days} days, ${mode}), the surge after the welcome and once, the sheet, the rail, at most two contexts`);
    await ctx.close();

    // ── 2. A phone at 390: the pill at the right of the top bar, the sheet, nothing sideways. ──
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await phone.newPage();
    watch(p);
    await login(p);
    const bar = p.locator('[data-testid="streak-pill-bar"]');
    await bar.waitFor({ state: "visible", timeout: 15000 });
    must((await bar.getAttribute("aria-label")) === flameLabel(days), "the phone pill's name");
    const bb = await bar.boundingBox();
    must(bb && bb.height >= 44 && bb.x + bb.width <= 390, `the phone pill fits the bar (${JSON.stringify(bb)})`);
    must((await p.locator('[data-testid="mobile-header"] [data-flame="fire"]').count()) === 1, "one fire in the phone bar");
    await noSideways(p, "the phone bar");
    await p.screenshot({ path: "screenshots/fl02-phone.png" });
    await bar.tap();
    await p.locator('[data-testid="streak-sheet"]').waitFor({ timeout: 5000 });
    await noSideways(p, "the sheet");
    await p.screenshot({ path: "screenshots/fl03-phone-sheet.png" });
    await p.locator('[data-testid="streak-sheet-close"]').tap();
    console.log("✓ a phone at 390: the pill in the top bar, 44 px, the sheet, nothing sideways");
    await phone.close();

    // ── 3. Reduced motion: no surge, the day still stored. ──
    await reset({ welcome: false });
    const still = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
    const q = await still.newPage();
    watch(q);
    await login(q);
    const qp = q.locator('[data-testid="streak-pill-side"]');
    await qp.waitFor({ timeout: 15000 });
    for (let i = 0; i < 20 && (await seenOn()) === null; i++) await sleep(250);
    must((await seenOn()) === after.asOf, "reduced motion: the day is stored without a surge");
    must((await qp.getAttribute("data-surge")) !== "playing" && (await qp.locator('[data-testid="streak-count"]').innerText()).trim() === String(days), "reduced motion: no surge, the count as it is");
    console.log("✓ reduced motion: no surge, the day stored");
    await still.close();

    // ── 4. No WebGL: the SVG flame. ──
    await unfold();
    const flat = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await flat.addInitScript(() => {
      // A device with no WebGL: every webgl context request fails.
      const proto = HTMLCanvasElement.prototype as unknown as { getContext: (...a: unknown[]) => unknown };
      const orig = proto.getContext;
      proto.getContext = function (this: unknown, ...a: unknown[]) {
        return typeof a[0] === "string" && a[0].includes("webgl") ? null : orig.apply(this, a);
      };
    });
    const f = await flat.newPage();
    watch(f);
    await login(f);
    const fp = f.locator('[data-testid="streak-pill-side"]');
    await fp.waitFor({ timeout: 15000 });
    await f.waitForFunction(() => document.querySelector('[data-testid="streak-pill-side"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "svg", null, { timeout: 5000 });
    must((await webgl(f)) === 0 && (await fires(f)) >= 1, "no WebGL: the SVG flame, no canvas context");
    await fp.screenshot({ path: "screenshots/fl04-svg.png" });
    console.log("✓ no WebGL: the static SVG flame");
    await flat.close();

    must(failures.length === 0, `no server errors or page errors:\n${failures.join("\n")}`);
    console.log("\nsmoke-flame: all good");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
