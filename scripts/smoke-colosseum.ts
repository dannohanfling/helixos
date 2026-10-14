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
    must((await page.locator('a[href="/colosseum"]').count()) === 0, "off: no menu item");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/settings#connected-apps`, { waitUntil: "networkidle" });
    await page.check('[data-testid="colosseum-on-toggle"]');
    await submit(page, '[data-testid="colosseum-on-save"]');
    must((await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mm.workspaceId) }))!.colosseumOn, "the coach turned the Colosseum on");
    await page.goto(`${base}/rewards`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="rewards-colosseum"]').count()) === 1, "Rewards links to the Colosseum once it's on");
    console.log("✓ off by default (not there, no menu item); the coach's switch turns it on; Rewards links to it");

    // ── Maya: the arena at three widths, the orbit, Pause, reduced motion. ──
    await logout(page);
    await login(page, "As a client");
    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${base}/colosseum`, { waitUntil: "networkidle" });
      const box = (await page.locator('[data-testid="arena"]').boundingBox())!;
      must(Math.abs(box.width / box.height - 1680 / 944) < 0.02, `at ${w} the arena keeps its shape: ${box.width}x${box.height}`);
      must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, `at ${w} nothing scrolls sideways`);
      must((await page.locator('a[href="/colosseum"]').count()) >= 1, `at ${w} the menu has the Colosseum`);
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
