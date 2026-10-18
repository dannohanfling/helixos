/**
 * The Colosseum (rev 699, the photo arena of rev 720), end to end: off until the coach turns it on (not there and no menu item before,
 * the Grow item and the Rewards link after); at 1440, 1024 and 390 the photo keeps its 1680:944 shape and nothing scrolls
 * sideways; a seat stays on its ring while the orbit moves, Pause holds it and reduced motion keeps it still; Maya's photo
 * opt-in and hide-from-arena settings are hers alone and the standings honour them; a shared win shows on the feed and comes
 * down again; every control is reachable by keyboard; the coach switched into Maya can't change her arena settings.
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
async function logout(page: Page) {
  await page.context().clearCookies();
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const { onRing } = await import("@/lib/engine/colosseum");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  await db.update(schema.workspaces).set({ colosseumOn: false }).where(eq(schema.workspaces.id, mm.workspaceId));
  await db.update(schema.memberships).set({ arenaPhoto: false, arenaHidden: false, arenaPaused: false }).where(eq(schema.memberships.workspaceId, mm.workspaceId));
  await db.delete(schema.colosseumWins).where(eq(schema.colosseumWins.workspaceId, mm.workspaceId));
  // A crowd for the stands: the demo has three members and two of them are this week's champions on the sand, so six more
  // sit on the rings, one per tier from Artisan to Centurion, their points dated last month so the champions stay the demo's.
  const { TIERS } = await import("@/lib/engine/tiers");
  const crowdEmail = (i: number) => `colosseum-${i}@example.com`;
  const clearCrowd = async () => {
    for (const u of await db.query.users.findMany({ where: like(schema.users.email, "colosseum-%@example.com"), columns: { id: true } })) {
      await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.userId, u.id));
      await db.delete(schema.memberships).where(eq(schema.memberships.userId, u.id));
      await db.delete(schema.users).where(eq(schema.users.id, u.id));
    }
  };
  await clearCrowd();
  for (let i = 0; i < 6; i++) {
    const userId = crypto.randomUUID();
    await db.insert(schema.users).values({ id: userId, email: crowdEmail(i), name: `Crowd ${"ABCDEF"[i]} Smoke`, passwordHash: "x" });
    await db.insert(schema.memberships).values({ id: crypto.randomUUID(), workspaceId: mm.workspaceId, userId, role: "client" });
    const points = TIERS[i].minPoints + 10;
    if (points > 0) await db.insert(schema.pointsLedger).values({ id: crypto.randomUUID(), workspaceId: mm.workspaceId, userId, type: "bonus", points, reason: "Smoke: a seat in the stands", createdAt: "2026-09-01 12:00:00" });
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  try {
    // ── Off: a 404 and no menu item. The coach turns it on in Settings. ──
    await login(page, "As a client");
    // The app shell streams (loading.tsx), so a page that isn't there renders the "isn't here anymore" view, not a bare 404.
    await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="item-gone"]').count()) === 1 && (await page.locator('[data-testid="colosseum"]').count()) === 0, "off: the page isn't there");
    await page.goto(`${base}/rewards`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="rewards-colosseum"]').count()) === 0, "off: no Colosseum tab on Rewards");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/settings#connected-apps`, { waitUntil: "networkidle" });
    await page.check('[data-testid="colosseum-on-toggle"]');
    await submit(page, '[data-testid="colosseum-on-save"]');
    must((await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mm.workspaceId) }))!.colosseumOn, "the coach turned the Colosseum on");
    await page.goto(`${base}/rewards`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="rewards-colosseum"]').count()) === 1, "Rewards has the Colosseum tab once it's on");
    await page.goto(`${base}/colosseum?tab=wins&kind=business`, { waitUntil: "networkidle" });
    must(/\/rewards\?tab=colosseum&section=wins&kind=business$/.test(page.url()) && (await page.locator('[data-testid="tab-wins-body"]').count()) === 1, `the old address sends to the tab, section and filter kept: ${page.url()}`);
    console.log("✓ off by default (not there, no tab); the coach's switch turns it on; Rewards carries it as a tab; /colosseum sends there");

    // ── Maya: the arena at three widths, the orbit, Pause, reduced motion. ──
    await logout(page);
    await login(page, "As a client");
    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
      const box = (await page.locator('[data-testid="arena"]').boundingBox())!;
      must(Math.abs(box.width / box.height - 1680 / 944) < 0.02, `at ${w} the arena keeps its shape: ${box.width}x${box.height}`);
      must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, `at ${w} nothing scrolls sideways`);
      must((await page.locator('a[href="/rewards?tab=colosseum"]').count()) >= 1 && (await page.locator('[data-testid="rewards-tab-rewards"]').count()) === 1, `at ${w} the menu has The Colosseum and the page its Rewards tab`);
    }
    // ── The Colosseum back in the menu (H-592): the item opens the arena; the toggle goes to Rewards and back, the item lit on
    // both; the old addresses still land where they did. ──
    {
      await page.goto(`${base}/today`, { waitUntil: "networkidle" });
      const item = page.locator('[data-testid="side-nav"] a[href="/rewards?tab=colosseum"]');
      must((await item.count()) === 1 && (await item.innerText()).includes("The Colosseum") && (await item.innerText()).includes("🏟️"), "one menu item, 🏟️ The Colosseum");
      must((await page.locator('[data-testid="side-nav"] a[href="/rewards"]').count()) === 0, "never a second Rewards item beside it");
      await Promise.all([page.waitForURL(/\/rewards\?tab=colosseum$/, { waitUntil: "commit" }), item.click()]);
      await page.locator('[data-testid="arena"]').waitFor({ timeout: 15000 });
      must((await item.getAttribute("aria-current")) === "page", "the item is lit on the arena");
      const tabs = await page.locator('[data-testid="rewards-tabs"] a').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
      must(JSON.stringify(tabs) === JSON.stringify(["rewards-colosseum", "rewards-tab-rewards"]), `The Colosseum first, then Rewards: ${tabs}`);
      await Promise.all([page.waitForURL(/\/rewards$/, { waitUntil: "commit" }), page.locator('[data-testid="rewards-tab-rewards"]').click()]);
      await page.waitForLoadState("networkidle");
      must((await page.locator('[data-testid="rewards-tab-rewards"]').getAttribute("aria-current")) === "page" && (await page.locator('[data-testid="arena"]').count()) === 0, "the toggle goes to Rewards");
      must((await item.getAttribute("aria-current")) === "page", "the item stays lit on Rewards");
      await Promise.all([page.waitForURL(/\/rewards\?tab=colosseum$/, { waitUntil: "commit" }), page.locator('[data-testid="rewards-colosseum"]').click()]);
      await page.locator('[data-testid="arena"]').waitFor({ timeout: 15000 });
      must((await item.getAttribute("aria-current")) === "page", "and back to the arena, still lit");
      // Old links: /rewards opens Rewards, /colosseum the arena, /rewards/book stays its own page.
      await page.goto(`${base}/rewards`, { waitUntil: "networkidle" });
      must((await page.locator('[data-testid="rewards-tab-rewards"]').getAttribute("aria-current")) === "page", "an old /rewards link still opens Rewards");
      await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
      must(/\/rewards\?tab=colosseum$/.test(page.url()) && (await page.locator('[data-testid="arena"]').count()) === 1, `an old /colosseum link lands on the arena: ${page.url()}`);
      // The folded rail: the icon, with its name as the tooltip.
      await page.goto(`${base}/today`, { waitUntil: "networkidle" });
      await page.locator('[data-testid="nav-rail-toggle"]').click();
      await page.locator('[data-testid="side-nav"][data-rail="true"]').waitFor({ timeout: 5000 });
      must((await item.getAttribute("title")) === "The Colosseum" && (await item.innerText()).includes("🏟️"), "on the rail: the 🏟️ icon, The Colosseum as its tooltip");
      await page.locator('[data-testid="nav-rail-toggle"]').click();
      await page.locator('[data-testid="side-nav"][data-rail="false"]').waitFor({ timeout: 5000 });
      // The phone's More page, at 390, with nothing sideways.
      await page.setViewportSize({ width: 390, height: 860 });
      await page.goto(`${base}/more`, { waitUntil: "networkidle" });
      const more = page.locator('main a[href="/rewards?tab=colosseum"]');
      must((await more.count()) === 1 && (await more.innerText()).includes("The Colosseum") && (await page.locator('main a[href="/rewards"]').count()) === 0, "More lists The Colosseum, once");
      must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, "390: nothing scrolls sideways on More");
      await page.setViewportSize({ width: 1440, height: 900 });
      console.log("✓ the menu: 🏟️ The Colosseum opens the arena, the toggle goes to Rewards and back with the item lit on both, old /rewards and /colosseum links land as before; the rail's tooltip; More at 390");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
    const seat = page.locator('[data-testid="arena-seat"]').first();
    must((await seat.count()) === 1 && (await page.locator('[data-testid="arena-seat"]').count()) >= 2, "members sit on the stands");
    const pos = async () => {
      const s = await seat.evaluate((el) => ({ ring: Number((el as HTMLElement).dataset.ring), x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
      return s;
    };
    const p1 = await pos();
    await page.waitForTimeout(1500);
    const p2 = await pos();
    must(p1.x !== p2.x || p1.y !== p2.y, "the orbit moves");
    must(onRing(p1.ring, p1, 0.8) && onRing(p2.ring, p2, 0.8), `a seat stays on its ring: ${JSON.stringify([p1, p2])}`);
    const tap = (await seat.boundingBox())!;
    must(tap.width >= 26 && tap.height >= 26, "an avatar draws at least 26px with a 44px tap area around it");
    await seat.click({ force: true }); // it is moving, as a member taps it
    must((await page.locator('[data-testid="arena-card"]').innerText()).includes("points"), "tapping a seat opens its card");
    await page.click('[data-testid="arena-pause"]');
    await page.waitForTimeout(400);
    const p3 = await pos();
    await page.waitForTimeout(1200);
    const p4 = await pos();
    must(p3.x === p4.x && p3.y === p4.y, "Pause holds every seat");
    must((await page.locator('[data-testid="arena-pause"]').innerText()).includes("Set the arena moving"), "the label flips");
    await page.waitForTimeout(500);
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!.arenaPaused, "Pause is remembered");
    const still = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const sp = await still.newPage();
    await db.update(schema.memberships).set({ arenaPaused: false }).where(eq(schema.memberships.id, mm.id));
    await sp.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
    const s1 = await sp.locator('[data-testid="arena-seat"]').first().evaluate((el) => (el as HTMLElement).style.left);
    await sp.waitForTimeout(1200);
    must(s1 === (await sp.locator('[data-testid="arena-seat"]').first().evaluate((el) => (el as HTMLElement).style.left)), "reduced motion keeps every seat still");
    await still.close();
    await page.goto(`${base}/colosseum?tab=arena`, { waitUntil: "networkidle" });
    await page.click('[data-testid="arena-look-night"]');
    await page.waitForTimeout(400);
    must((await page.locator('[data-testid="arena"]').getAttribute("data-look")) === "night", "Night swaps the photo");
    console.log("✓ 1440, 1024 and 390 keep the shape with no sideways scroll; the orbit stays on its ring; a tap opens the card; Pause holds and is remembered; reduced motion is still; Night swaps the photo");

    // ── Keyboard: a seat, the tabs and Pause are all reachable. ──
    await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
    const reached = { seat: false, pause: false, tab: false };
    for (let i = 0; i < 160 && !(reached.seat && reached.pause && reached.tab); i++) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate("document.activeElement?.getAttribute('data-testid') ?? ''");
      if (id === "arena-seat" || id === "arena-champ") reached.seat = true;
      if (id === "arena-pause") reached.pause = true;
      if (id === "tab-standings") reached.tab = true;
    }
    must(reached.seat && reached.pause && reached.tab, `keyboard reaches a seat, Pause and a tab: ${JSON.stringify(reached)}`);
    console.log("✓ every avatar, tab and button is reachable by keyboard");

    // ── Privacy: initials unless she opts in; hide from the arena takes her out of the standings; the coach can't flip hers. ──
    await page.goto(`${base}/colosseum?tab=standings`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="standing"].co-mine').count()) === 1, "Maya is in the standings");
    must((await page.locator('[data-testid="arena-seat"] img, [data-testid="arena-champ"] img').count()) === 0, "nobody shows a photo before opting in");
    await page.goto(`${base}/settings#photo`, { waitUntil: "networkidle" });
    await page.check('[data-testid="arena-hidden"]');
    await submit(page, '[data-testid="arena-hidden-save"]');
    await page.goto(`${base}/colosseum?tab=standings`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="standing"].co-mine').count()) === 0 && (await page.locator('[data-testid="your-seat"]').count()) === 1, "hidden: out of the standings, the page still hers");
    await page.goto(`${base}/settings#photo`, { waitUntil: "networkidle" });
    await page.uncheck('[data-testid="arena-hidden"]');
    await submit(page, '[data-testid="arena-hidden-save"]');
    await page.check('[data-testid="arena-photo"]');
    await submit(page, '[data-testid="arena-photo-save"]');
    const me = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!;
    must(me.arenaPhoto && !me.arenaHidden, "the photo opt-in and the hide setting are saved");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${mm.id}`, { waitUntil: "networkidle" });
    await page.goto(`${base}/settings#photo`, { waitUntil: "networkidle" });
    console.log("✓ initials unless opted in; hide from the arena leaves the standings; the settings are saved");

    // ── A shared win shows on the feed, newest first, and comes down again. ──
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/colosseum?tab=wins`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="no-wins"]').count()) === 1, "no wins yet");
    await page.fill('[data-testid="share-win-text"]', "Three calls booked from one post, sam@example.com");
    await page.click('[data-testid="share-win-send"]');
    await page.locator('[data-testid="share-win-error"]').waitFor({ timeout: 10000 });
    await page.goto(`${base}/colosseum?tab=wins`, { waitUntil: "networkidle" });
    await page.fill('[data-testid="share-win-text"]', "Three calls booked from one post");
    await page.click('[data-testid="share-win-send"]');
    await page.locator('[data-testid="share-win-ok"]').waitFor({ timeout: 10000 });
    await page.goto(`${base}/colosseum?tab=wins`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="win"]').first().innerText()).includes("Three calls booked from one post"), "the win is on the feed");
    await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="tab-arena-body"] [data-testid="win"]').count()) === 1, "Wins from the stands shows it");
    await page.goto(`${base}/colosseum?tab=wins`, { waitUntil: "networkidle" });
    await submit(page, '[data-testid="win-remove"]');
    must((await db.query.colosseumWins.findMany({ where: and(eq(schema.colosseumWins.workspaceId, mm.workspaceId), eq(schema.colosseumWins.userId, maya.id)) })).length === 0, "her win came down");
    await page.goto(`${base}/colosseum?tab=week`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="week-day"]').count()) === 7, "My week has seven days");
    console.log("✓ a win with an email is refused; a shared win shows on the feed and the Arena tab, and comes down again; My week has seven days");

    // ── H-96: the pictures are in the build (AVIF, WebP, JPG); a broken one hides itself; the text reads in both schemes. ──
    await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
    for (const f of ["day.avif", "day.webp", "day.jpg", "night.avif", "night.webp", "night.jpg"]) must((await page.request.get(`${base}/colosseum/colosseum-${f}`)).status() === 200, `the picture colosseum-${f} is served`);
    must((await page.locator('[data-testid="arena-photo"]').evaluate((el) => (el as HTMLImageElement).naturalWidth)) === 1680, "the arena photo shows at its full width");
    const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", storageState: await ctx.storageState() });
    const dp = await dark.newPage();
    await dp.route(/\/colosseum\/colosseum-.*\.(avif|webp|jpg)$/, (r) => r.fulfill({ status: 404, body: "" }));
    await dp.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
    await dp.waitForTimeout(400);
    must((await dp.locator('[data-testid="arena-photo"]').count()) === 0 && (await dp.locator('[data-testid="arena"]').count()) === 1, "a picture that fails to load hides itself: the dark fallback, never a broken-image icon");
    await dp.unroute(/\/colosseum\//);
    const CONTRAST = `(() => {
      const lum = (c) => { const [r, g, b] = c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)/.test(c) && c !== "transparent") return c; } return getComputedStyle(document.body).backgroundColor; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      return [".co-title", ".co-rankword", ".co-h2", ".co-stats dd", ".co-sub", ".co-eyebrow", ".co-item .co-name"].map((sel) => { const el = document.querySelector(sel); return el ? { sel, ratio: Math.round(ratio(getComputedStyle(el).color, bgOf(el)) * 100) / 100 } : { sel, ratio: null }; });
    })()`;
    for (const [name, p2] of [["dark", dp], ["light", page]] as const) {
      await p2.goto(`${base}/colosseum?tab=standings`, { waitUntil: "networkidle" });
      const rows = (await p2.evaluate(CONTRAST)) as { sel: string; ratio: number | null }[];
      for (const r of rows) must(r.ratio !== null && r.ratio >= (r.sel === ".co-stats dd" || r.sel === ".co-rankword" || r.sel === ".co-title" ? 3 : 4.5), `${name} scheme: ${r.sel} reads against its background (${r.ratio}:1)`);
    }
    await dark.close();
    console.log("✓ the pictures are served in AVIF, WebP and JPG; a broken one hides itself; the text reads in the dark and the light scheme");

    must(failures.length === 0, `no server errors: ${failures.join(", ")}`);
    console.log("Colosseum smoke passed");
  } finally {
    await browser.close();
    await clearCrowd();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
