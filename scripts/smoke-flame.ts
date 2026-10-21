/**
 * The streak flame (H-552, plan H-558): the pill replaces the old 🔥 badge, beside the member's name on a computer, above
 * Settings on the folded rail and at the right of the phone's top bar. Its name is "{n}-day streak. Open streak details"; it
 * opens the detail sheet (the fire large, the count, "Day streak", the tier and the days to the next one). The daily surge
 * waits for the daily welcome to close, plays once (the count ticks up by one) and is stored, so a reload doesn't play it again.
 * The filmed loops (H-952): the pill plays its tier's pill loop and the page fetches no other tier's file; the sheet's stage loop
 * loads when it opens; never more than two playing. Reduced motion: the still, no surge, the day still stored. A loop that won't
 * load: the still. On a phone (H-1063): the light copies, the poster at once and the video only once it plays, the stage loop
 * started on the press, the files cached as immutable; playback refused leaves the poster. Nothing wider than
 * 390 px. Waiting on you (H-927): the sheet's button reads Close the day and opens the close on Today; Not now only shuts it.
 * Runs against the dev server; fixtures go straight to the database.
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
  const { addDays, hourInTz, todayInTz } = await import("@/lib/dates");
  const { streakFor } = await import("@/lib/queries/daily");
  const { flameLabel, flameTier, nextTierLine, sheetAction, tierName, WAITING_FROM_HOUR } = await import("@/lib/engine/streak-flame");

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
  const playing = (page: Page) => page.locator('[data-flame="fire"][data-flame-mode="video"]').count();
  const stills = (page: Page) => page.locator('[data-flame="fire"][data-flame-mode="still"]').count();
  // Which flame files a page fetched, by name.
  const flameFiles = (page: Page) => {
    const got: string[] = [];
    page.on("request", (r) => {
      const m = /\/streak\/(streak-[a-z]+-[a-z]+(?:-m)?(?:-poster)?\.[a-z0-9]+)/.exec(r.url());
      if (m) got.push(m[1]);
    });
    return got;
  };
  const noSideways = async (page: Page, what: string) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    must(w <= 390, `${what}: nothing wider than 390 (${w})`);
  };
  try {
    // ── 1. A computer, the first open of the day: the welcome first, then the surge, once. ──
    await reset({ welcome: true });
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const fetched = flameFiles(page);
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
    await page.waitForFunction(() => document.querySelector('[data-testid="streak-pill-side"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "video", null, { timeout: 10000 });
    const mode = await pill.locator('[data-flame="fire"]').getAttribute("data-flame-mode");
    const fileTier = (await pill.getAttribute("data-waiting")) === "true" ? "ember" : flameTier(days);
    const src = await pill.locator("video").evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc, paused: v.paused, rate: v.playbackRate }));
    must(src.src.includes(`/streak/streak-${fileTier}-pill.webm`) && !src.paused, `the pill plays its tier's pill loop: ${JSON.stringify(src)}`);
    must(src.rate === ((await pill.getAttribute("data-waiting")) === "true" ? 0.7 : 1), `the loop's speed (${src.rate})`);
    must(fetched.every((f) => f.startsWith(`streak-${fileTier}-pill.`) || f === `streak-${fileTier}-still.jpg`), `only the current tier's pill was fetched: ${JSON.stringify(fetched)}`);
    must((await playing(page)) <= 1, "one loop playing with the sheet closed");
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
    await page.waitForFunction(() => document.querySelector('[data-testid="streak-sheet"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "video", null, { timeout: 10000 });
    must(fetched.some((f) => f === `streak-${fileTier}-stage.webm`), `the stage loop loads when the sheet opens: ${JSON.stringify(fetched)}`);
    must((await playing(page)) <= 2, `at most two loops playing with the sheet open (${await playing(page)})`);
    must((await page.locator('[data-testid="streak-sheet-close"]').boundingBox())!.height >= 44, "Close is 44 px");
    await page.screenshot({ path: "screenshots/fl01-sheet.png" });
    await page.keyboard.press("Escape");
    must((await sheet.count()) === 0, "Escape closes the sheet");
    must(await pill.evaluate((el) => el === document.activeElement), "focus goes back to the pill");
    await sleep(300);
    must((await playing(page)) <= 1, "the sheet's loop goes with it");
    // Folded to the rail: the rail's pill, above Settings.
    await page.locator('[data-testid="nav-rail-toggle"]').click();
    const railPill = page.locator('[data-testid="streak-pill-rail"]');
    await railPill.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="streak-pill-rail"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "video", null, { timeout: 5000 });
    must(!(await pill.isVisible()), "the sidebar's pill hides on the rail");
    const rb = await railPill.boundingBox();
    const sb = await page.locator('[data-testid="rail-settings"]').boundingBox();
    must(rb && sb && rb.y < sb.y, "the rail's pill sits above Settings");
    await sleep(400);
    must((await playing(page)) <= 1, `the folded sidebar plays one loop (${await playing(page)})`);
    await page.locator('[data-testid="nav-rail-toggle"]').click();
    await pill.waitFor({ state: "visible", timeout: 5000 });
    // Back from the rail, the sidebar's loop plays again.
    await page.waitForFunction(() => document.querySelector('[data-testid="streak-pill-side"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "video", null, { timeout: 5000 });
    must((await playing(page)) <= 1, "still one loop after the rail");
    console.log(`✓ a computer: the pill by the name (${days} days, ${mode}, the ${fileTier} loop), the surge after the welcome and once, the sheet's stage loop on tap, the rail, at most two playing`);
    await ctx.close();

    // ── 2. A phone at 390: the pill at the right of the top bar, the sheet, nothing sideways. ──
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await phone.newPage();
    watch(p);
    const phoneFetched = flameFiles(p);
    await login(p);
    const bar = p.locator('[data-testid="streak-pill-bar"]');
    await bar.waitFor({ state: "visible", timeout: 15000 });
    // Never a frozen look (H-1063): the phone copy's first frame is there at once as a plain image; the video stays invisible
    // until it plays. Chromium here can't decode H.264, so the phone's MP4 never plays: the poster has to carry it.
    const phoneTier = (await bar.getAttribute("data-waiting")) === "true" ? "ember" : flameTier(days);
    await p.waitForFunction(() => document.querySelector('[data-testid="streak-pill-bar"] [data-flame="fire"]')?.getAttribute("data-flame-phone") === "true", null, { timeout: 5000 });
    const poster = bar.locator('[data-flame-poster="true"]');
    await p.waitForFunction(() => ((document.querySelector('[data-testid="streak-pill-bar"] [data-flame-poster="true"]') as HTMLImageElement | null)?.naturalWidth ?? 0) > 0, null, { timeout: 5000 });
    const posterSrc = (await poster.getAttribute("src")) ?? "";
    const phoneMode = await bar.locator('[data-flame="fire"]').getAttribute("data-flame-mode");
    must(
      phoneMode === "still" ? posterSrc.includes(`streak-${phoneTier}-still.jpg`) : posterSrc.includes(`streak-${phoneTier}-pill-m-poster.jpg`),
      `the phone shows the tier's picture at once (${phoneMode}, ${posterSrc})`,
    );
    const vis = await bar.locator("video").evaluateAll((vs) => vs.map((v) => getComputedStyle(v).opacity));
    must(phoneMode === "video" || vis.every((o) => o === "0"), `a video that isn't playing stays invisible over the poster (${phoneMode}, ${JSON.stringify(vis)})`);
    await sleep(800);
    must(
      phoneFetched.every((f) => f.startsWith(`streak-${phoneTier}-pill-m`) || f === `streak-${phoneTier}-still.jpg`),
      `the phone fetches only the light pill copy: ${JSON.stringify(phoneFetched)}`,
    );
    const cache = await p.request.get(`${base}/streak/streak-${phoneTier}-pill-m.mp4?v=2`);
    must(/immutable/.test(cache.headers()["cache-control"] ?? ""), `the flame files are cached as immutable (${cache.headers()["cache-control"]})`);
    must((await bar.getAttribute("aria-label")) === flameLabel(days), "the phone pill's name");
    const bb = await bar.boundingBox();
    must(bb && bb.height >= 44 && bb.x + bb.width <= 390, `the phone pill fits the bar (${JSON.stringify(bb)})`);
    must((await p.locator('[data-testid="mobile-header"] [data-flame="fire"]').count()) === 1, "one fire in the phone bar");
    await noSideways(p, "the phone bar");
    await p.screenshot({ path: "screenshots/fl02-phone.png" });
    await bar.tap();
    await p.locator('[data-testid="streak-sheet"]').waitFor({ timeout: 5000 });
    // The press started the stage file; the sheet opens on its poster.
    must(phoneFetched.some((f) => f === `streak-${phoneTier}-stage-m.mp4`), `the press starts the phone's stage loop: ${JSON.stringify(phoneFetched)}`);
    await p.waitForFunction(() => ((document.querySelector('[data-testid="streak-sheet"] [data-flame-poster="true"]') as HTMLImageElement | null)?.naturalWidth ?? 0) > 0, null, { timeout: 5000 });
    must((await p.locator('[data-testid="streak-pill-bar"] [data-flame="fire"]').count()) === 1, "the pill stays under the sheet");
    await noSideways(p, "the sheet");
    await p.screenshot({ path: "screenshots/fl03-phone-sheet.png" });
    await p.locator('[data-testid="streak-sheet-close"]').tap();
    console.log("✓ a phone at 390: the pill in the top bar, 44 px; the light copy's poster at once, the video hidden until it plays; only the light files, cached as immutable; the press starts the stage loop and the sheet opens on its poster; nothing sideways");
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
    must((await qp.locator('[data-flame="fire"]').getAttribute("data-flame-mode")) === "still" && (await qp.locator("video").count()) === 0 && (await playing(q)) === 0, "reduced motion: the tier's still, no video");
    console.log("✓ reduced motion: the still, no surge, the day stored");
    await still.close();

    // ── 3b. Playback refused (Low Power Mode): the poster stays, nothing frozen, nothing errors. ──
    await unfold();
    const lowPower = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await lowPower.addInitScript(() => {
      HTMLMediaElement.prototype.play = function () {
        return Promise.reject(new DOMException("The request is not allowed by the user agent", "NotAllowedError"));
      };
    });
    const lp = await lowPower.newPage();
    watch(lp);
    await login(lp);
    const lpPill = lp.locator('[data-testid="streak-pill-side"]');
    await lpPill.waitFor({ timeout: 15000 });
    await sleep(2500);
    const lpMode = await lpPill.locator('[data-flame="fire"]').getAttribute("data-flame-mode");
    must(lpMode === "loading" || lpMode === "idle", `playback refused: it never claims to play (${lpMode})`);
    must(((await lpPill.locator('[data-flame-poster="true"]').evaluate((i: HTMLImageElement) => i.naturalWidth)) ?? 0) > 0, "playback refused: the poster shows");
    must((await lpPill.locator("video").evaluate((v) => getComputedStyle(v).opacity)) === "0", "playback refused: the video stays invisible");
    console.log("✓ playback refused (Low Power Mode): the poster stays, the video never shows a frozen frame");
    await lowPower.close();

    // ── 4. A loop that won't load: the still. ──
    await unfold();
    const flat = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const f = await flat.newPage();
    watch(f);
    await f.route(/\/streak\/.*\.(webm|mp4)(\?.*)?$/, (r) => r.abort());
    await login(f);
    const fp = f.locator('[data-testid="streak-pill-side"]');
    await fp.waitFor({ timeout: 15000 });
    await f
      .waitForFunction(() => document.querySelector('[data-testid="streak-pill-side"] [data-flame="fire"]')?.getAttribute("data-flame-mode") === "still", null, { timeout: 10000 })
      .catch(async (e) => {
        const at = await fp.evaluate((el) => {
          const fire = el.querySelector('[data-flame="fire"]');
          const v = el.querySelector("video");
          return { mode: fire?.getAttribute("data-flame-mode"), networkState: v?.networkState, readyState: v?.readyState, error: v?.error?.code ?? null, preload: v?.getAttribute("preload"), sources: Array.from(v?.querySelectorAll("source") ?? []).map((s) => s.getAttribute("src")) };
        });
        throw new Error(`a loop that won't load never fell back to the still: ${JSON.stringify(at)} (${String(e).split("\n")[0]})`);
      });
    must((await playing(f)) === 0 && (await stills(f)) >= 1, "no loop: the still, nothing playing");
    await fp.screenshot({ path: "screenshots/fl04-still.png" });
    console.log("✓ a loop that won't load: the tier's still");
    await flat.close();

    // ── 5. Waiting on you (H-927), at any hour of the run: Maya's own zone is set to one where it's evening now. ──
    const evening = Array.from({ length: 27 }, (_, i) => `Etc/GMT${i - 12 < 0 ? "+" : "-"}${Math.abs(i - 12)}`.replace("Etc/GMT+0", "Etc/GMT"))
      .find((z) => hourInTz(z) >= WAITING_FROM_HOUR + 1 && hourInTz(z) <= 22);
    must(evening, "a zone where it is evening now");
    const ownZone = mm!.timezone;
    let reopened: { id: string; at: string } | null = null;
    await db.update(schema.memberships).set({ timezone: evening!, welcomeShownOn: todayInTz(evening!), navState: {} }).where(eq(schema.memberships.id, mm!.id));
    try {
      const eveningDay = todayInTz(evening!);
      // The seed may have closed that day already: open it again for the run, and put the close back after.
      const closedThere = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.workspaceId, mm!.workspaceId), eq(schema.dailyLogs.userId, maya!.id), eq(schema.dailyLogs.date, eveningDay)) });
      if (closedThere?.eveningDoneAt) {
        reopened = { id: closedThere.id, at: closedThere.eveningDoneAt };
        await db.update(schema.dailyLogs).set({ eveningDoneAt: null }).where(eq(schema.dailyLogs.id, closedThere.id));
      }
      const w = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const wp = await w.newPage();
      watch(wp);
      await login(wp);
      const wbar = wp.locator('[data-testid="streak-pill-bar"]');
      await wbar.waitFor({ state: "visible", timeout: 15000 });
      {
        must((await wbar.getAttribute("data-waiting")) === "true", `the evening zone's day waits (${evening})`);
        const late = (await wbar.getAttribute("data-late")) === "true";
        const want = sheetAction({ waiting: true, late })!;
        await wbar.tap();
        const act = wp.locator('[data-testid="streak-sheet-act"]');
        await act.waitFor({ timeout: 5000 });
        must((await act.innerText()).trim() === want.label, `the sheet's button reads ${want.label} (${await act.innerText()})`);
        must(await act.evaluate((el) => el === document.activeElement), "the button to the close has the focus");
        must((await act.boundingBox())!.height >= 44 && (await wp.locator('[data-testid="streak-sheet-close"]').boundingBox())!.height >= 44, "both buttons are 44 px");
        must((await wp.locator('[data-testid="streak-sheet-close"]').innerText()).trim() === "Not now", "the other button says Not now");
        await noSideways(wp, "the waiting sheet");
        await wp.screenshot({ path: "screenshots/fl05-waiting-sheet.png" });
        // Not now only shuts the sheet: still on the same page, nothing closed.
        const where = wp.url();
        await wp.locator('[data-testid="streak-sheet-close"]').tap();
        must((await wp.locator('[data-testid="streak-sheet"]').count()) === 0 && wp.url() === where, "Not now shuts the sheet and goes nowhere");
        // From another page, the button lands on Today's close card.
        await wp.goto(`${base}/settings`, { waitUntil: "networkidle" });
        await wbar.tap();
        await act.waitFor({ timeout: 5000 });
        await act.tap();
        await wp.waitForURL(/\/today#close$/, { timeout: 15000 });
        const card = wp.locator("#close");
        await card.waitFor({ timeout: 10000 });
        must((await wp.locator('[data-testid="streak-sheet"]').count()) === 0, "the sheet is gone once the close opens");
        await wp.waitForFunction(() => {
          const r = document.getElementById("close")?.getBoundingClientRect();
          return Boolean(r && r.top < window.innerHeight && r.bottom > 0);
        }, null, { timeout: 5000 });
        await wp.screenshot({ path: "screenshots/fl06-close-card.png" });
        console.log(`✓ waiting on you at 390: ${want.label} opens the close on Today, Not now only shuts the sheet (${evening})`);
      }
      await w.close();
    } finally {
      await db.update(schema.memberships).set({ timezone: ownZone }).where(eq(schema.memberships.id, mm!.id));
      if (reopened) await db.update(schema.dailyLogs).set({ eveningDoneAt: reopened.at }).where(eq(schema.dailyLogs.id, reopened.id));
    }

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
