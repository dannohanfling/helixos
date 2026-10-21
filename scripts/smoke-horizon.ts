/**
 * On the horizon (H-385), at runtime, against the running dev server:
 *  1. What's new has two tabs; On the horizon opens with the seed's four lists, the area chips, "You asked for this" pills,
 *     Want this only on Next up and Exploring (44 px, aria-pressed), and a tap stores one want for the member alone.
 *  2. A second member sees no trace of the first's vote; a switched coach sees the board and cannot vote.
 *  3. The menu: Magic funnel reads Coming soon (one greyed item on More) while its item is on Next up.
 *  4. The coach: adds an item (it lands at the end of its list), hides it (gone from members), moves Magic funnel to Just
 *     shipped (the menu entry becomes a link; the member who wanted it gets the one-time notice, and Got it stamps it so it
 *     never shows again), moves it back (Coming soon returns), reorders, and reads the count and names.
 *  5. The phone at 390 px: the four tabs, Next up first, no sideways scroll; reduced motion stills the ember dot.
 */
import { chromium, type Browser, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { HORIZON_SEED } = await import("@/lib/engine/horizon");
  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  };
  try {
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = mayaM.workspaceId;

    // ── 1. The member's board. ──
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(page);
    await login(page, "As a client");
    await page.goto(`${base}/whats-new`);
    await page.locator('a[href="/whats-new/horizon"]').first().waitFor({ timeout: 20000 });
    await page.click('a[href="/whats-new/horizon"]');
    await page.locator('[data-testid="horizon-board"]').waitFor({ timeout: 20000 });
    const lists = page.locator('[data-testid="horizon-list"]');
    must((await lists.count()) === 4, "four lists");
    must((await lists.evaluateAll((els) => els.map((e) => e.getAttribute("data-list")))).join(",") === "shipped,building,next,exploring", "in order: shipped, building, next, exploring");
    const items = await db.query.horizonItems.findMany({ where: eq(schema.horizonItems.workspaceId, ws) });
    must(items.length === HORIZON_SEED.length, `the first read seeded the list: ${items.length}`);
    const shownNow = (await page.locator('[data-testid="horizon-item"]').count());
    must(shownNow === HORIZON_SEED.length, `every seed item is inside its window on day one: ${shownNow}`);
    must((await page.locator('[data-testid="horizon-asked"]').count()) === HORIZON_SEED.filter((s) => s.fromFeedback).length, "You asked for this on the feedback items");
    // Want this only on Next up and Exploring.
    for (const l of ["shipped", "building"]) must((await page.locator(`[data-testid="horizon-list"][data-list="${l}"] [data-testid="horizon-want"]`).count()) === 0, `no Want this on ${l}`);
    const nextWants = page.locator('[data-testid="horizon-list"][data-list="next"] [data-testid="horizon-want"]');
    must((await nextWants.count()) === HORIZON_SEED.filter((s) => s.status === "next").length, "Want this on every Next up item");
    const box = await nextWants.first().boundingBox();
    must(box && box.height >= 44, `Want this is at least 44 px tall: ${box?.height}`);
    must((await nextWants.first().getAttribute("aria-pressed")) === "false", "not pressed before the tap");
    // The chips: Grow hides the Board items.
    await page.click('[data-testid="horizon-chip"][data-chip="Board"]');
    must((await page.locator('[data-testid="horizon-item"][data-area="Grow"]').count()) === 0 && (await page.locator('[data-testid="horizon-item"][data-area="Board"]').count()) > 0, "the Board chip shows Board items and not Grow");
    must((await page.locator('[data-testid="horizon-item"][data-area="Everywhere"]').count()) > 0, "Everywhere shows under every chip");
    await page.click('[data-testid="horizon-chip"][data-chip="All"]');
    // Want Magic funnel.
    const mf = items.find((i) => i.menuKey === "magic-funnel")!;
    const mfCard = page.locator(`[data-testid="horizon-item"][data-item="${mf.id}"]`);
    await mfCard.locator('[data-testid="horizon-want"]').click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="horizon-item"][data-item="${id}"]`)?.getAttribute("data-wanted") === "1", mf.id, { timeout: 10000 });
    for (let i = 0; i < 20 && !(await db.query.horizonWants.findFirst({ where: and(eq(schema.horizonWants.userId, maya.id), eq(schema.horizonWants.itemId, mf.id)) })); i++) await sleep(300);
    must(await db.query.horizonWants.findFirst({ where: and(eq(schema.horizonWants.userId, maya.id), eq(schema.horizonWants.itemId, mf.id)) }), "the want is stored for the member");
    await page.reload();
    await mfCard.waitFor({ timeout: 20000 });
    must((await mfCard.locator('[data-testid="horizon-want"]').innerText()).trim() === "You want this" && (await mfCard.locator('[data-testid="horizon-want"]').getAttribute("aria-pressed")) === "true", "You want this after a reload");
    must(!(await page.locator("main").innerText()).match(/\b1 wants?\b/), "no count shows to a member");
    console.log("✓ the board: four lists, chips, You asked for this, Want this on the two votable lists, a vote stored and shown as the member's own");

    // ── 2. Another member, and a switched coach. ──
    const j = await browser.newPage();
    watch(j);
    await j.goto(`${base}/login`);
    await j.fill('input[name="email"]', jordan.email);
    await j.fill('input[name="password"]', "demo1234");
    await Promise.all([j.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), j.click('button:has-text("Sign in")')]);
    await j.goto(`${base}/whats-new/horizon`);
    await j.locator(`[data-testid="horizon-item"][data-item="${mf.id}"]`).waitFor({ timeout: 20000 });
    must((await j.locator(`[data-testid="horizon-item"][data-item="${mf.id}"]`).getAttribute("data-wanted")) === "0", "another member sees no trace of the first's vote");
    await j.close();
    const coach = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(coach);
    await login(coach, "As the coach");
    await coach.goto(`${base}/coach/${mayaM.id}`);
    await coach.locator('[data-testid="switch-view"]').waitFor({ timeout: 20000 });
    await coach.check('[data-testid="switch-view"]');
    await submit(coach, '[data-testid="switch-open"]');
    await coach.goto(`${base}/whats-new/horizon`);
    await coach.locator('[data-testid="horizon-board"]').waitFor({ timeout: 20000 });
    must((await coach.locator('[data-testid="horizon-want"]').count()) === 0, "a switched coach sees the board and cannot vote");
    await coach.goto(`${base}/settings`);
    await submit(coach, '[data-testid="switch-back"]');
    console.log("✓ another member sees no trace of the vote; a switched coach cannot vote");

    // ── 3. The menu: Coming soon while Magic funnel is on Next up. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/more`);
    await page.locator("main").waitFor({ timeout: 20000 });
    // Get the app (H-731) is Coming soon too until a store link is set; it isn't a horizon item, so it isn't counted here.
    const soon = page.locator('main [data-testid="nav-coming-soon"]:not([data-href="/get-the-app"])');
    must((await soon.count()) === 1 && (await soon.first().getAttribute("data-href")) === "/magic-funnel", "Magic funnel is the one horizon Coming soon item on More");
    await page.setViewportSize({ width: 1280, height: 900 });
    console.log("✓ Magic funnel reads Coming soon while its item is on Next up");

    // ── 4. The coach's page. ──
    await coach.goto(`${base}/coach/horizon`);
    await coach.locator('[data-testid="horizon-add"]').waitFor({ timeout: 20000 });
    const mfRow = coach.locator(`[data-testid="horizon-coach-item"][data-item="${mf.id}"]`);
    must((await mfRow.locator('[data-testid="horizon-wants"]').innerText()).includes(`1 wants this: ${maya.name}`), "the coach reads the count and the name");
    await coach.fill('[data-testid="horizon-add"] [data-testid="horizon-f-title"]', "Walk item");
    await coach.fill('[data-testid="horizon-add"] [data-testid="horizon-f-line"]', "A line for the walk.");
    await coach.selectOption('[data-testid="horizon-add"] [data-testid="horizon-f-area"]', "Grow");
    await coach.selectOption('[data-testid="horizon-add"] [data-testid="horizon-f-status"]', "exploring");
    await submit(coach, '[data-testid="horizon-add-submit"]');
    const added = (await db.query.horizonItems.findFirst({ where: and(eq(schema.horizonItems.workspaceId, ws), eq(schema.horizonItems.title, "Walk item")) }))!;
    must(added && added.status === "exploring" && added.sort > Math.max(...items.map((i) => i.sort)), "the new item lands at the end of its list");
    await page.goto(`${base}/whats-new/horizon`);
    await page.locator(`[data-testid="horizon-item"][data-item="${added.id}"]`).waitFor({ timeout: 20000 });
    // Hide it: gone for members.
    const addedRow = coach.locator(`[data-testid="horizon-coach-item"][data-item="${added.id}"]`);
    await addedRow.locator("summary").click();
    await submit(coach, `[data-testid="horizon-coach-item"][data-item="${added.id}"] [data-testid="horizon-hide"]`);
    await page.reload();
    await page.locator('[data-testid="horizon-board"]').waitFor({ timeout: 20000 });
    must((await page.locator(`[data-testid="horizon-item"][data-item="${added.id}"]`).count()) === 0, "a hidden item shows nowhere for members");
    // Reorder: the first Next up item moves down one.
    const nextBefore = items.filter((i) => i.status === "next").sort((a, b) => a.sort - b.sort);
    await coach.locator(`[data-testid="horizon-coach-item"][data-item="${nextBefore[0].id}"] summary`).click();
    await submit(coach, `[data-testid="horizon-coach-item"][data-item="${nextBefore[0].id}"] [data-testid="horizon-down"]`);
    const nextAfter = (await db.query.horizonItems.findMany({ where: and(eq(schema.horizonItems.workspaceId, ws), eq(schema.horizonItems.status, "next")) })).sort((a, b) => a.sort - b.sort);
    must(nextAfter[1].id === nextBefore[0].id && nextAfter[0].id === nextBefore[1].id, "Down swaps the first two Next up items");
    // Ship Magic funnel.
    await mfRow.locator("summary").click();
    await submit(coach, `[data-testid="horizon-coach-item"][data-item="${mf.id}"] [data-testid="horizon-move"][data-to="shipped"]`);
    const shipped = (await db.query.horizonItems.findFirst({ where: eq(schema.horizonItems.id, mf.id) }))!;
    must(shipped.status === "shipped" && shipped.shippedAt, "moving to Just shipped stamps shippedAt");
    console.log("✓ the coach adds (end of its list), hides, reorders and ships; the count and names show to the coach alone");

    // The menu entry becomes a link; the member who wanted it gets the one-time notice.
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="horizon-notice"]').waitFor({ timeout: 20000 });
    const noticeText = await page.locator('[data-testid="horizon-notice"]').innerText();
    must(noticeText.toLowerCase().includes("something you wanted just shipped") && noticeText.includes(mf.title), `the notice names the item: ${JSON.stringify(noticeText)} vs ${mf.title}`);
    must((await page.locator('nav a[href="/magic-funnel"]').count()) === 1 && (await page.locator('nav [data-testid="nav-coming-soon"][data-href="/magic-funnel"]').count()) === 0, "Magic funnel is a link in the menu once shipped");
    await page.click('[data-testid="horizon-notice-dismiss"]');
    for (let i = 0; i < 20 && !(await db.query.horizonWants.findFirst({ where: and(eq(schema.horizonWants.userId, maya.id), eq(schema.horizonWants.itemId, mf.id)) }))!.notifiedAt; i++) await sleep(300);
    must((await db.query.horizonWants.findFirst({ where: and(eq(schema.horizonWants.userId, maya.id), eq(schema.horizonWants.itemId, mf.id)) }))!.notifiedAt, "Got it stamps the want");
    await page.goto(`${base}/today`);
    await page.locator("h1").first().waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="horizon-notice"]').count()) === 0, "the notice shows once");
    await page.goto(`${base}/whats-new/horizon`);
    await mfCard.waitFor({ timeout: 20000 });
    must((await mfCard.locator('[data-testid="horizon-want"]').count()) === 0, "a shipped item has no Want this");
    // Back to Next up: Coming soon returns.
    await coach.goto(`${base}/coach/horizon`);
    await mfRow.locator("summary").click();
    await submit(coach, `[data-testid="horizon-coach-item"][data-item="${mf.id}"] [data-testid="horizon-move"][data-to="next"]`);
    await page.goto(`${base}/today`);
    await page.locator("h1").first().waitFor({ timeout: 20000 });
    must((await page.locator('nav [data-testid="nav-coming-soon"][data-href="/magic-funnel"]').count()) === 1, "Coming soon returns when the item leaves Just shipped");
    await coach.close();
    console.log("✓ shipping turns the menu's Coming soon into a link and tells the member once; moving back restores Coming soon");

    // ── 5. The phone. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/whats-new/horizon`);
    await page.locator('[data-testid="horizon-tabs"]').waitFor({ timeout: 20000 });
    must(await page.locator('[data-testid="horizon-tabs"]').isVisible(), "the phone shows the four tabs");
    must((await page.locator('[data-testid="horizon-tab"][aria-selected="true"]').getAttribute("data-list")) === "next", "Next up opens first");
    must((await page.locator('[data-testid="horizon-list"]:visible').count()) === 1, "one list at a time on the phone");
    await page.click('[data-testid="horizon-tab"][data-list="exploring"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="horizon-tab"][aria-selected="true"]')?.getAttribute("data-list") === "exploring");
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    must(widths.scroll <= widths.inner, `no sideways scroll at 390 px: ${widths.scroll} vs ${widths.inner}`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.click('[data-testid="horizon-tab"][data-list="building"]');
    const anim = await page.locator(".hz-ember").first().evaluate((el) => getComputedStyle(el).animationName);
    must(anim === "none", `reduced motion stills the ember dot: ${anim}`);
    await page.close();
    console.log("✓ the phone: four tabs, Next up first, one list at a time, no sideways scroll; reduced motion stills the ember");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Horizon smoke passed");
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
