/**
 * The Aqueduct (rev 711), end to end: seven fixtures (a leak at each of the six steps, and none) each show the right picture
 * in both looks with the waterfall on the painted one and the leak panel's words right; a period switch that moves the leak
 * swaps the picture; a missing count shows "—", its steps are left out and one quiet line says so; the water's widths follow
 * the counts; 1440, 1024 and 390 (the tags hide under 760px, no sideways scroll); reduced motion, Pause remembered, the tab
 * hidden, and keyboard reach for every toggle. H-966: the water's body and three flow layers at their own speeds, the channel
 * filling when the scene opens (not when it was left paused), the leak as a sheet with streaks and a splash, and under reduced
 * motion the same water, still.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
}
async function login(page: Page, who: "As the coach" | "As a client") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
let visit = 0;
const url = (q = "") => `${base}/aqueduct?w=${++visit}${q}`;

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, gte } = await import("drizzle-orm");
  const { FALLS, STEP_TOOLS, waterWidth, leakOf, slipped } = await import("@/lib/engine/aqueduct");
  const { newId } = await import("@/lib/ids");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = mm.workspaceId;
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  await db.update(schema.memberships).set({ aqueductPaused: false, aqueductPeriod: 30, sceneLook: "day" }).where(eq(schema.memberships.id, mm.id));

  // A fixture: one log per window carrying the counts, one posted item carrying the comments, N client records.
  type C = [number, number | null, number, number, number, number, number, number];
  // The windows hold only the fixture: Maya's logs of the last 70 days, her posted content and her client records go (the
  // seed puts them back before the next walk).
  const clear = async () => {
    await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), gte(schema.dailyLogs.date, daysAgo(70))));
    await db.delete(schema.contentItems).where(and(eq(schema.contentItems.userId, maya.id), eq(schema.contentItems.status, "posted")));
    await db.delete(schema.clientRecords).where(eq(schema.clientRecords.userId, maya.id));
  };
  const place = async (c: C, day: string) => {
    await db.insert(schema.dailyLogs).values({ id: newId(), workspaceId: ws, userId: maya.id, date: day, posts: c[0], dmsStarted: c[2], conversations: c[3], callsBooked: c[4], callsHeld: c[5], offersMade: c[6] });
    if (c[1] !== null) await db.insert(schema.contentItems).values({ id: newId(), workspaceId: ws, userId: maya.id, title: `Aqueduct fixture ${day}`, status: "posted", postedAt: `${day} 12:00:00`, engagements: c[1] });
    for (let i = 0; i < c[7]; i++) await db.insert(schema.clientRecords).values({ id: newId(), workspaceId: ws, userId: maya.id, name: `Aqueduct fixture ${day} ${i}`, createdAt: `${day} 12:00:00` });
  };
  const fixture = async (now: C, before: C, at: { now: number; before: number } = { now: 10, before: 40 }) => {
    await clear();
    await place(now, daysAgo(at.now));
    await place(before, daysAgo(at.before));
  };
  const BEFORE: C = [20, 100, 50, 25, 10, 8, 4, 2]; // rates 50 50 40 80 50 50
  const leakAt = (b: number): C => {
    const now: C = [...BEFORE] as C;
    // Halve stage b+2 so step b's rate falls by half its old value; the later steps keep their rates by scaling too.
    for (let i = b + 2; i < 8; i++) now[i] = Math.round((now[i] as number) / 2);
    return now;
  };

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  try {
    await login(page, "As a client");
    // ── Seven fixtures: a leak at each step, in both looks; the panel's words. ──
    for (let b = 0; b < 6; b++) {
      const now = leakAt(b);
      await fixture(now, BEFORE);
      const leak = leakOf(now, BEFORE)!;
      must(leak.step === b, `fixture ${b} leaks at step ${b} by the engine: ${JSON.stringify(leak)}`);
      await page.goto(url(), { waitUntil: "networkidle" });
      const scene = page.locator('[data-testid="aqueduct-scene"]');
      must((await scene.getAttribute("data-picture")) === `/aqueduct/aqueduct-day-${b}`, `fixture ${b}: the day picture is aqueduct-day-${b}`);
      must((await page.locator('[data-testid="aqueduct-photo"]').evaluate((el) => (el as HTMLImageElement).naturalWidth)) === 1680, `fixture ${b}: the picture loads`);
      const fall = page.locator('[data-testid="aqueduct-fall"]');
      must((await fall.getAttribute("data-step")) === String(b) && Number(await fall.getAttribute("data-x")) === FALLS.day[b][0], `fixture ${b}: the waterfall sits on the painted one (x ${FALLS.day[b][0]})`);
      if (b === 0) {
        // H-966: a falling sheet with five streaks, and a splash (mist, spray, ripples) where it lands; not a single stroke.
        must((await fall.locator('[data-testid="aqueduct-fall-sheet"]').count()) === 1 && (await fall.locator('[data-testid="aqueduct-fall-streak"]').count()) === 5 && (await fall.locator('[data-testid="aqueduct-mist"]').count()) === 1 && (await fall.locator(".aq-spray").count()) === 4 && (await fall.locator(".aq-ripple").count()) === 2, "the leak falls as a sheet with five streaks and lands in a splash");
      }
      must((await page.locator(`[data-testid="aqueduct-step-${b}"]`).getAttribute("data-kind")) === "leak" && (await page.locator('[data-testid^="aqueduct-step-"][data-kind="leak"]').count()) === 1, `fixture ${b}: only the leak's tag is amber`);
      const { n, expected } = slipped(now, leak);
      const headline = await page.locator('[data-testid="aqueduct-headline"]').innerText();
      must(headline.startsWith(`About ${n} `), `fixture ${b}: "About ${n} people slipped through this arch", got "${headline}"`);
      must((await page.locator('[data-testid="aqueduct-detail"]').innerText()).includes(`about ${expected} would have`), `fixture ${b}: the detail line's usual`);
      must((await page.locator('[data-testid="aqueduct-repair"]').getAttribute("href")) === STEP_TOOLS[b].href, `fixture ${b}: Repair this arch deep-links to ${STEP_TOOLS[b].href}`);
      must((await page.locator('[data-testid="aqueduct-ask-board"]').getAttribute("href"))?.startsWith("/my-board?ask=") === true, `fixture ${b}: Ask My Board carries the question`);
      must((await page.locator('[data-testid="aqueduct-row"][data-leak="1"]').count()) === 1, `fixture ${b}: the leak row is tinted`);
      // Night: the same leak, the night picture, the waterfall at the night point.
      await page.click('[data-testid="aqueduct-look-night"]');
      await page.waitForTimeout(300);
      must((await scene.getAttribute("data-picture")) === `/aqueduct/aqueduct-night-${b}` && Number(await fall.getAttribute("data-x")) === FALLS.night[b][0], `fixture ${b}: the night picture and its waterfall`);
      await page.click('[data-testid="aqueduct-look-day"]');
      await page.waitForTimeout(200);
    }
    await fixture(BEFORE, BEFORE);
    await page.goto(url(), { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="aqueduct-scene"]').getAttribute("data-picture")) === "/aqueduct/aqueduct-day-none" && (await page.locator('[data-testid="aqueduct-fall"]').count()) === 0 && (await page.locator('[data-testid="aqueduct-holding"]').count()) === 1, "no leak: the intact aqueduct, no waterfall, holding");
    console.log("✓ seven fixtures: the right picture and waterfall in both looks, the amber tag, the headline, the usual, the repair link, the tinted row; and holding");

    // ── The filmed loop (H-1180): Golden hour with no leak plays it over the photo, with no drawn water; Night draws. ──
    const sceneEl = page.locator('[data-testid="aqueduct-scene"]');
    const loopEl = page.locator('[data-testid="aqueduct-loop"]');
    const tagAt = async () => JSON.stringify(await page.locator('[data-testid="aqueduct-stage-3"]').boundingBox());
    // Back to no leak right after a leak is a repair moment (the old picture under the new, the drawn water, no loop). Once it
    // has been seen the page opens on the plain scene, so reload until then.
    for (let i = 0; i < 20 && (await sceneEl.getAttribute("data-loop")) !== "1"; i++) {
      await page.waitForTimeout(500);
      await page.goto(url(), { waitUntil: "networkidle" });
    }
    must((await sceneEl.getAttribute("data-loop")) === "1" && (await page.locator('[data-testid="aqueduct-photo"]').count()) === 1, "no leak, Golden hour: the photo, with its loop listed");
    await page.waitForFunction(() => document.querySelector('[data-testid="aqueduct-loop"]')?.getAttribute("data-loop-mode") === "video", null, { timeout: 15000 });
    const src = await loopEl.evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc, paused: v.paused, opacity: getComputedStyle(v).opacity, auto: v.autoplay }));
    must(/\/aqueduct\/aqueduct-day-none-loop\.(mp4|webm)\?v=\d+$/.test(src.src) && !src.paused && src.opacity === "1" && !src.auto, `the loop plays over the photo, started by the page: ${JSON.stringify(src)}`);
    must((await page.locator('[data-testid="aqueduct-water"]').count()) === 0 && (await page.locator('[data-testid="aqueduct-fountain"]').count()) === 0 && (await page.locator("[data-flow]").count()) === 0, "no drawn water, streaks or fountain over the loop");
    const loopBox = (await loopEl.boundingBox())!;
    const photoBox = (await page.locator('[data-testid="aqueduct-photo"]').boundingBox())!;
    must(Math.abs(loopBox.x - photoBox.x) < 1 && Math.abs(loopBox.width - photoBox.width) < 1 && Math.abs(loopBox.height - photoBox.height) < 1, "the loop sits exactly over the photo");
    const tagDay = await tagAt();
    await page.click('[data-testid="aqueduct-pause"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="aqueduct-loop"]')?.getAttribute("data-loop-mode") !== "video", null, { timeout: 5000 });
    must(await loopEl.evaluate((v: HTMLVideoElement) => v.paused), "Pause holds the loop, and the photo shows");
    await page.click('[data-testid="aqueduct-pause"]');
    await page.click('[data-testid="aqueduct-look-night"]');
    await page.waitForTimeout(300);
    must((await sceneEl.getAttribute("data-loop")) === "0" && (await loopEl.count()) === 0 && (await page.locator('[data-testid="aqueduct-water"]').count()) === 1, "Night keeps the drawn water until its own loop arrives");
    must((await tagAt()) === tagDay, "the labels sit where they were");
    const lres = await page.request.get(`${base}/aqueduct/aqueduct-day-none-loop.mp4?v=1`);
    must(lres.ok() && /immutable/.test(lres.headers()["cache-control"] ?? ""), `the loop files are cached as immutable (${lres.headers()["cache-control"]})`);
    const ql = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const qp = await ql.newPage();
    await qp.goto(url(), { waitUntil: "networkidle" });
    await qp.click('[data-testid="aqueduct-look-day"]');
    await qp.waitForTimeout(500);
    must((await qp.locator('[data-testid="aqueduct-loop"]').count()) === 0 && (await qp.locator('[data-testid="aqueduct-photo"]').count()) === 1, "reduced motion: the photo, and no video");
    await ql.close();
    const bl = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
    const bp = await bl.newPage();
    await bp.route(/\/aqueduct\/.*-loop\.(mp4|webm)(\?.*)?$/, (r) => r.abort());
    await bp.goto(url(), { waitUntil: "networkidle" });
    await bp.click('[data-testid="aqueduct-look-day"]');
    await bp.waitForTimeout(2500);
    const blocked = await bp.evaluate(() => { const v = document.querySelector('[data-testid="aqueduct-loop"]') as HTMLVideoElement | null; return v ? getComputedStyle(v).opacity : "gone"; });
    must((blocked === "gone" || blocked === "0") && (await bp.locator('[data-testid="aqueduct-photo"]').count()) === 1, `390, a loop that won't load: the photo stays (${blocked})`);
    must((await bp.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, "390: nothing scrolls sideways");
    await bl.close();
    console.log("✓ the filmed loop: Golden hour with no leak plays it over the photo with no drawn water, Pause holds it, Night draws, the labels stay, cached as immutable; reduced motion and a blocked loop keep the photo");

    // ── The water's widths follow the counts (drawn on Night); a period switch moves the leak and swaps the picture. ──
    const widths = await page.locator('[data-testid="aqueduct-segment"]').evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-width"))));
    must(widths[0] === waterWidth(BEFORE[1], BEFORE[1]) && widths[1] === waterWidth(BEFORE[2], BEFORE[1]) && widths[6] === waterWidth(BEFORE[7], BEFORE[1]), `the widths follow the counts: ${widths.join(", ")}`);
    await page.click('[data-testid="aqueduct-look-day"]');
    await page.waitForTimeout(300);
    // Over 7 days (the logs at 3 and 10 days ago) the leak is at step 4; over 30 days a tenfold batch at 20 days against one at
    // 45 days dominates, and the engine says where that leak falls (step 1 by construction, checked rather than assumed).
    const times = (c: C, k: number): C => c.map((x) => (x === null ? null : x * k)) as C;
    await clear();
    await place(leakAt(4), daysAgo(3));
    await place(BEFORE, daysAgo(10));
    await place(times(leakAt(1), 10), daysAgo(20));
    await place(times(BEFORE, 10), daysAgo(45));
    const sum = (a: C, b: C): C => a.map((x, i) => (x === null || b[i] === null ? null : x + (b[i] as number))) as C;
    const expected30 = leakOf(sum(sum(leakAt(4), BEFORE), times(leakAt(1), 10)), times(BEFORE, 10))!;
    must(expected30.step !== 4, `the 30-day fixture leaks elsewhere than step 4: ${expected30.step}`);
    await page.goto(url(), { waitUntil: "networkidle" });
    const thirty = await page.locator('[data-testid="aqueduct-leak"]').getAttribute("data-step");
    must(thirty === String(expected30.step), `over 30 days the leak is at step ${expected30.step}: ${thirty}`);
    await submit(page, '[data-testid="aqueduct-period-7"]');
    await page.goto(url(), { waitUntil: "networkidle" });
    const seven = await page.locator('[data-testid="aqueduct-leak"]').getAttribute("data-step");
    must(seven === "4" && thirty !== seven, `a period switch moves the leak: 30 days ${thirty}, 7 days ${seven}`);
    must((await page.locator('[data-testid="aqueduct-scene"]').getAttribute("data-picture")) === "/aqueduct/aqueduct-day-4", "and swaps the picture");
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!.aqueductPeriod === 7, "the period is remembered");
    await submit(page, '[data-testid="aqueduct-period-30"]');
    console.log("✓ the widths follow the counts; a period switch moves the leak, swaps the picture and is remembered");

    // ── A missing count: "—", its steps left out, one quiet line; nothing invented. ──
    await fixture([20, null, 50, 10, 10, 8, 4, 2], [20, null, 50, 25, 10, 8, 4, 2]);
    await page.goto(url(), { waitUntil: "networkidle" });
    const rows = await page.locator('[data-testid="aqueduct-row"]').allInnerTexts();
    must(rows[1].includes("—") && rows[2].includes("—"), `comments show "—" and step 0 has no rate: ${rows[1]} | ${rows[2]}`);
    must((await page.locator('[data-testid="aqueduct-missing"]').innerText()).includes("Comments"), "one quiet line says which count is missing");
    must((await page.locator('[data-testid="aqueduct-leak"]').getAttribute("data-step")) === "1", "the leak is still found on the steps that can be rated");
    must(((await page.locator('[data-testid="aqueduct-stage-1"]').evaluate((el) => el.textContent)) ?? "").includes("—"), "the stage pill shows the dash too");
    console.log('✓ a missing count shows "—", its steps are left out, one quiet line says so, and nothing is invented');

    // ── 1440, 1024, 390: the scene, no sideways scroll, the tags hidden on a phone. ──
    await fixture(leakAt(2), BEFORE);
    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url(), { waitUntil: "networkidle" });
      must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, `at ${w} nothing scrolls sideways`);
      const box = (await page.locator('[data-testid="aqueduct-scene"]').boundingBox())!;
      must(Math.abs(box.width / box.height - 1680 / 944) < 0.02, `at ${w} the picture keeps its shape`);
      const tagsShown = await page.locator('[data-testid="aqueduct-stage-0"]').isVisible();
      must(tagsShown === w >= 760, `at ${w} the tags are ${w >= 760 ? "shown" : "hidden"}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log("✓ 1440, 1024 and 390: the shape kept, no sideways scroll, the tags hide under 760px and the table carries the numbers");

    // ── Motion: Pause remembered, reduced motion, the tab hidden; keyboard reach. ──
    await page.goto(url(), { waitUntil: "networkidle" });
    must((await page.locator(".aq-streak-a").first().evaluate((el) => getComputedStyle(el).animationName)) === "aq-run", "the water moves");
    // H-966: every segment carries the body and the three flow layers, each running at its own speed.
    const layers = await page.locator('[data-testid="aqueduct-segment"]').evaluateAll((els) => els.map((el) => [...el.querySelectorAll("[data-flow]")].map((p) => p.getAttribute("data-flow")).join(",")));
    must(layers.length === 7 && layers.every((l) => l === "band,streak-a,streak-b,spark"), `each segment runs ripple bands, two lanes of streaks and a sparkle: ${layers[0]}`);
    const speeds = await page.locator('[data-testid="aqueduct-segment"]').first().evaluate((el) => [...el.querySelectorAll("[data-flow]")].map((p) => getComputedStyle(p).animationDuration.split(",")[0]));
    must(new Set(speeds).size === 4, `the layers run at their own speeds: ${speeds.join(" ")}`);
    // The channel fills when the scene opens: the front runs, then the mask goes and the water keeps flowing.
    await page.goto(url(), { waitUntil: "domcontentloaded" });
    must((await page.locator('[data-testid="aqueduct-water"]').getAttribute("data-filling")) === "1" && (await page.locator("mask#aq-front").count()) === 1, "the channel fills when the scene opens");
    await page.waitForFunction("document.querySelector('[data-testid=\"aqueduct-water\"]')?.getAttribute('data-filling') === '0'", undefined, { timeout: 8000 });
    must((await page.locator("mask#aq-front").count()) === 0 && (await page.locator(".aq-streak-a").first().evaluate((el) => getComputedStyle(el).animationPlayState)) === "running", "once full, the front's mask goes and the water keeps flowing");
    await page.waitForLoadState("networkidle");
    await page.click('[data-testid="aqueduct-pause"]');
    must((await page.locator('[data-testid="aqueduct-scene"]').getAttribute("data-paused")) === "1", "Pause the water holds it");
    must((await page.locator(".aq-streak-a").first().evaluate((el) => getComputedStyle(el).animationPlayState)) === "paused" && (await page.locator('[data-testid="aqueduct-fall-streak"]').first().evaluate((el) => getComputedStyle(el).animationPlayState)) === "paused", "every stroke pauses, the channel and the fall");
    await page.waitForTimeout(400);
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!.aqueductPaused, "Pause is remembered");
    // Left paused, the scene opens full and still: no front waiting on a Play.
    await page.goto(url(), { waitUntil: "domcontentloaded" });
    must((await page.locator('[data-testid="aqueduct-water"]').getAttribute("data-filling")) === "0", "a paused scene opens with the channel already full");
    await page.waitForLoadState("networkidle");
    await page.click('[data-testid="aqueduct-pause"]');
    await page.evaluate("Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))");
    await page.waitForTimeout(200);
    must((await page.locator('[data-testid="aqueduct-scene"]').getAttribute("data-paused")) === "1", "the tab hidden pauses it");
    const still = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const sp = await still.newPage();
    await sp.goto(url(), { waitUntil: "networkidle" });
    must((await sp.locator(".aq-streak-a").first().evaluate((el) => getComputedStyle(el).animationName)) === "none" && (await sp.locator(".aq-ripple").first().evaluate((el) => getComputedStyle(el).animationName)) === "none" && (await sp.locator('[data-testid="aqueduct-fall-streak"]').first().evaluate((el) => getComputedStyle(el).animationName)) === "none", "reduced motion stops all animation");
    // The still still looks like water: the body and its layers are drawn, with no front.
    must((await sp.locator('[data-testid="aqueduct-water"]').getAttribute("data-filling")) === "0" && (await sp.locator("[data-flow]").count()) === 28 && (await sp.locator(".aq-core").count()) === 7 && (await sp.locator('[data-testid="aqueduct-fall-sheet"]').count()) === 1, "reduced motion: the same water, still, with no front");
    await sp.screenshot({ path: "screenshots/aqueduct-reduced-1440.png" });
    await still.close();
    await page.goto(url(), { waitUntil: "networkidle" });
    const reached = { pause: false, look: false, period: false };
    for (let i = 0; i < 80 && !(reached.pause && reached.look && reached.period); i++) {
      await page.keyboard.press("Tab");
      const id = (await page.evaluate("document.activeElement?.getAttribute('data-testid') ?? ''")) as string;
      if (id === "aqueduct-pause") reached.pause = true;
      if (id.startsWith("aqueduct-look-")) reached.look = true;
      if (id.startsWith("aqueduct-period-")) reached.period = true;
    }
    must(reached.pause && reached.look && reached.period, `every toggle is reachable by keyboard: ${JSON.stringify(reached)}`);
    console.log("✓ Pause holds and is remembered, the tab hidden pauses it, reduced motion stops everything, every toggle reachable by keyboard");

    must(failures.length === 0, `no server errors: ${failures.join(", ")}`);
    console.log("Aqueduct smoke passed");
  } finally {
    await browser.close();
    await clear();
    await db.update(schema.memberships).set({ aqueductPaused: false, aqueductPeriod: 30 }).where(eq(schema.memberships.id, mm.id));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
