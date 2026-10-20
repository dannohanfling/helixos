/**
 * Frameworks in Doctrine (H-1262, plan H-1270), end to end: the coach pastes the library file; the dry run names 3 new, 1
 * flagged for a price and 1 unreadable, with nothing saved; Save makes three drafts; a re-import with one step changed
 * updates in place (1 changed, 2 unchanged); two are published and the priced one is refused with the reason; a client sees
 * the two published ones under Doctrine by pillar and never the draft, at 1440 and 390 with nothing sideways; a framework's
 * page shows its steps, the quote, the source link and the credit line; Post, Reel and Training each make a content item.
 */
import { chromium, type Page } from "@playwright/test";
import { FRAMEWORKS_MD, FRAMEWORKS_MD_V2 } from "./fixtures/frameworks";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page, who: "As the coach" | "As a client") {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const cm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const W = cm.workspaceId;
  const rows = async () => db.query.frameworks.findMany({ where: eq(schema.frameworks.workspaceId, W) });
  const clear = async () => {
    await db.delete(schema.frameworks).where(eq(schema.frameworks.workspaceId, W));
    await db.delete(schema.contentItems).where(and(eq(schema.contentItems.workspaceId, W), like(schema.contentItems.notes, "From framework %")));
  };
  await clear();

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  try {
    // ── The dry run saves nothing; Save makes drafts. ──
    await login(page, "As the coach");
    await page.goto(`${base}/coach/frameworks`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="framework-list-empty"]').count()) === 1, "none yet");
    await page.fill('[data-testid="frameworks-text"]', FRAMEWORKS_MD);
    await page.click('[data-testid="frameworks-dry"]');
    const dry = page.locator('[data-testid="frameworks-dry-result"]');
    await dry.waitFor({ timeout: 15000 });
    const counts = async (el: typeof dry) => ({ added: await el.getAttribute("data-added"), changed: await el.getAttribute("data-changed"), unchanged: await el.getAttribute("data-unchanged"), flagged: await el.getAttribute("data-flagged"), unreadable: await el.getAttribute("data-unreadable") });
    let c = await counts(dry);
    must(c.added === "3" && c.changed === "0" && c.flagged === "1" && c.unreadable === "1", `the dry run names 3 new, 1 flagged, 1 unreadable: ${JSON.stringify(c)}`);
    must((await dry.innerText()).includes("The Price Ladder") && (await dry.innerText()).includes("A heading with nothing under it"), "the dry run names the flagged and the unreadable");
    must((await rows()).length === 0, "a dry run saves nothing");
    await page.click('[data-testid="frameworks-save"]');
    const saved = page.locator('[data-testid="frameworks-saved"]');
    await saved.waitFor({ timeout: 15000 });
    must((await saved.getAttribute("data-added")) === "3", "Save adds three");
    let all = await rows();
    must(all.length === 3 && all.every((f) => f.status === "draft"), "three drafts");
    const priced = all.find((f) => f.slug === "the-price-ladder")!;
    must(priced.hasPrice && !all.find((f) => f.slug === "belief-before-the-call")!.hasPrice, "the price is flagged on the one that names it");
    must(all.find((f) => f.slug === "the-opener")!.borrowedFrom === "NEPQ, Jeremy Miner", "Borrowed from is read");
    must(JSON.stringify(all.find((f) => f.slug === "belief-before-the-call")!.steps.length) === "3", "the numbered steps are read");
    console.log("✓ the dry run names 3 new, 1 flagged, 1 unreadable and saves nothing; Save makes three drafts with the price flagged and the credit read");

    // ── A re-import with one step changed updates in place. ──
    await page.reload({ waitUntil: "networkidle" });
    await page.fill('[data-testid="frameworks-text"]', FRAMEWORKS_MD_V2);
    await page.click('[data-testid="frameworks-dry"]');
    await dry.waitFor({ timeout: 15000 });
    c = await counts(dry);
    must(c.added === "0" && c.changed === "1" && c.unchanged === "2", `the re-import names 1 changed, 2 unchanged: ${JSON.stringify(c)}`);
    await page.click('[data-testid="frameworks-save"]');
    await saved.waitFor({ timeout: 15000 });
    must((await saved.getAttribute("data-changed")) === "1" && (await saved.getAttribute("data-added")) === "0", "Save updates one in place");
    all = await rows();
    must(all.length === 3 && all.find((f) => f.slug === "belief-before-the-call")!.steps[2].includes("an hour before"), "the changed step is in, no second row");
    console.log("✓ a re-import updates in place by slug");

    // ── Publish two; the priced one is refused with the reason. ──
    const toggle = (slug: string) => page.locator(`[data-testid="framework-row"][data-slug="${slug}"] [data-testid="framework-toggle"]`);
    await page.reload({ waitUntil: "networkidle" });
    await Promise.all([page.waitForURL(/saved=1/), toggle("belief-before-the-call").click()]);
    await page.waitForLoadState("networkidle");
    await Promise.all([page.waitForURL(/saved=1/), toggle("the-opener").click()]);
    await page.waitForLoadState("networkidle");
    await Promise.all([page.waitForURL(/error=/), toggle("the-price-ladder").click()]);
    await page.waitForLoadState("networkidle");
    must((await page.locator('[data-testid="framework-error"]').innerText()).includes("names a price"), "publishing the priced one is refused with the reason");
    all = await rows();
    must(all.filter((f) => f.status === "published").length === 2 && all.find((f) => f.slug === "the-price-ladder")!.status === "draft", "two published, the priced one a draft");
    must((await page.locator('[data-testid="frameworks-count"]').innerText()).includes("2 of 3"), "the count reads 2 of 3");
    // The coach sees all three on Doctrine, the draft marked.
    await page.goto(`${base}/doctrine`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="framework-tile"]').count()) === 3 && (await page.locator('[data-testid="framework-tile"][data-status="draft"]').count()) === 1, "the coach sees three tiles, one a draft");
    console.log("✓ two published, the priced one refused; the coach sees the draft marked");

    // ── A client: the two published by pillar, never the draft; the page; content from it. ──
    await login(page, "As a client");
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${base}/doctrine`, { waitUntil: "networkidle" });
      const tiles = page.locator('[data-testid="framework-tile"]');
      must((await tiles.count()) === 2 && (await page.locator('[data-testid="framework-tile"][data-status="draft"]').count()) === 0, `at ${w} a client sees the two published, no draft`);
      must((await page.locator('[data-testid="doctrine-pillar"]').count()) === 2, `at ${w} grouped by pillar`);
      must((await page.locator('[data-testid="doctrine-import-frameworks"]').count()) === 0, `at ${w} no import button for a client`);
      must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, `at ${w} nothing scrolls sideways`);
    }
    await page.goto(`${base}/doctrine/frameworks/the-price-ladder`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="item-gone"]').count()) === 1, "a draft's address is gone for a client");
    await page.goto(`${base}/doctrine/frameworks/the-opener`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="framework-credit"]').innerText()).includes("After NEPQ"), "the credit line");
    must((await page.locator('[data-testid="framework-steps"] li').count()) === 3, "three steps");
    await page.goto(`${base}/doctrine/frameworks/belief-before-the-call?tab=story`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="framework-words"]').innerText()).includes("show up warmed"), "the quote");
    must(/at 10:12/.test(await page.locator('[data-testid="framework-source"]').innerText()), "the source link with its moment");
    must((await page.locator('[data-testid="framework-coach-notes"]').count()) === 0, "a client never sees the coach's notes");
    for (const kind of ["post", "reel", "training"]) {
      await page.goto(`${base}/doctrine/frameworks/belief-before-the-call?tab=content`, { waitUntil: "networkidle" });
      await Promise.all([page.waitForURL(/\/content\//, { timeout: 20000 }), page.click(`[data-testid="framework-make-${kind}"]`)]);
      await page.waitForLoadState("networkidle");
    }
    const made = await db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, W), like(schema.contentItems.notes, "From framework %")) });
    must(made.length === 3 && made.every((m) => (m.body ?? "").includes("Confirm the call the same day")) && made.some((m) => m.title.startsWith("Reel:")) && made.some((m) => m.title.startsWith("Training:")), `Post, Reel and Training each make a content item with the steps: ${made.map((m) => m.title).join(" | ")}`);
    console.log("✓ a client sees the two published by pillar at 1440 and 390, never the draft; the page shows steps, quote, source and credit; Post, Reel and Training each make a content item");

    must(failures.length === 0, `server errors: ${failures.join(", ")}`);
    console.log("frameworks walk passed");
  } finally {
    await browser.close();
    await clear();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
