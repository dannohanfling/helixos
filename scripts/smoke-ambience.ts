/**
 * Roma Vivit (H-327 PR B, plan H-637): the ambience under the big picture scenes. PR 1, the Colosseum: at 390, 1024 and 1440 in
 * both looks the layer draws the look's own parts (night: three flicker copies, twelve lights, the haze; golden hour: the cloud,
 * sixteen motes, three birds), nothing scrolls sideways, the avatars still take a tap through it, and it is running; Pause and a
 * hidden tab hold every animation; reduced motion draws none of it. The top-3 cheer plays once a week after the first tap, never
 * on a reload, never with Sounds off. Runs against the dev server; fixtures go straight to the database.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

/** Every animation inside the layer, with its state. */
const layerAnims = (page: Page, sel = '[data-testid="arena-ambience"]') =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return el.getAnimations({ subtree: true }).map((a) => a.playState);
  }, sel);
/** Hides or shows the tab, the way the browser would. */
// A string, not a function: tsx names inner arrow functions with a helper the page doesn't have.
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate(`(() => {
    const h = ${hidden};
    Object.defineProperty(document, "visibilityState", { configurable: true, get() { return h ? "hidden" : "visible"; } });
    Object.defineProperty(document, "hidden", { configurable: true, get() { return h; } });
    document.dispatchEvent(new Event("visibilitychange"));
  })()`);
const sounds = (page: Page) => page.evaluate(() => ((window as unknown as { __hxSounds?: string[] }).__hxSounds ?? []).slice());

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { mondayOf } = await import("@/lib/colosseum");
  const { todayInTz } = await import("@/lib/dates");
  const { top3CheerKey } = await import("@/lib/engine/ambience");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mm.workspaceId) }))!;
  const before = { colosseumOn: ws.colosseumOn, sceneLook: mm.sceneLook, soundsOn: mm.soundsOn, arenaPaused: mm.arenaPaused, arenaHidden: mm.arenaHidden };
  const monday = mondayOf(todayInTz(mm.timezone || ws.timezone));
  const cheerKey = top3CheerKey(mm.id, monday);
  // Maya on the sand: a hand adjustment this week puts her first among the champions (never an active day). Removed at the end.
  const boost = crypto.randomUUID();
  await db.insert(schema.pointsLedger).values({ id: boost, workspaceId: mm.workspaceId, userId: maya.id, type: "bonus", points: 100000, reason: "Smoke: a champion this week", adjustedBy: "smoke" });
  await db.update(schema.workspaces).set({ colosseumOn: true }).where(eq(schema.workspaces.id, mm.workspaceId));
  await db.update(schema.memberships).set({ arenaPaused: false, arenaHidden: false, soundsOn: true }).where(eq(schema.memberships.id, mm.id));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const arena = `${base}/rewards?tab=colosseum`;

    // ── Both looks at three widths. ──
    for (const look of ["night", "day"] as const) {
      await db.update(schema.memberships).set({ sceneLook: look }).where(eq(schema.memberships.id, mm.id));
      for (const w of [390, 1024, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(arena, { waitUntil: "networkidle" });
        const layer = page.locator('[data-testid="arena-ambience"]');
        await layer.waitFor();
        must((await layer.getAttribute("data-look")) === look, `${w}/${look}: the layer follows the scene's look`);
        const n = async (id: string) => page.locator(`[data-testid="arena-ambience"] [data-testid="${id}"]`).count();
        if (look === "night") must((await n("amb-flicker")) === 3 && (await n("amb-twinkle")) === 12 && (await n("amb-cloud")) === 0, `${w}/night: three flicker copies, twelve lights, no cloud`);
        else must((await n("amb-cloud")) === 1 && (await n("amb-mote")) === 16 && (await n("amb-bird")) === 3 && (await n("amb-flicker")) === 0, `${w}/day: the cloud, sixteen motes, three birds, no flicker`);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        must(sideways <= 0, `${w}/${look}: nothing scrolls sideways (${sideways}px)`);
        const anims = (await layerAnims(page))!;
        must(anims.length > 0 && anims.every((s) => s === "running"), `${w}/${look}: the ambience is running (${anims.length})`);
        // An avatar still takes a tap through the layer.
        // A champion: it stands still on the sand, right under the haze and the motes, so it proves the layer lets a tap through.
        await page.locator('[data-testid="arena-champ"]').first().click();
        must(await page.locator('[data-testid="arena-card"]').isVisible(), `${w}/${look}: an avatar opens its card through the layer`);
        await page.locator('[data-testid="arena-card"] button').click();
        await page.screenshot({ path: `screenshots/ambience-colosseum-${look}-${w}.png` });
      }
    }
    console.log("✓ the Colosseum's ambience at 390, 1024 and 1440 in both looks: its own parts, running, nothing sideways, avatars tappable");

    // ── Pause and a hidden tab hold everything. ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(arena, { waitUntil: "networkidle" });
    await page.click('[data-testid="arena-pause"]');
    let anims = (await layerAnims(page))!;
    must(anims.length > 0 && anims.every((s) => s === "paused"), `Pause holds every animation (${anims.join(",")})`);
    await page.click('[data-testid="arena-pause"]');
    anims = (await layerAnims(page))!;
    must(anims.every((s) => s === "running"), "Play sets it moving again");
    await setHidden(page, true);
    await page.waitForFunction(() => document.querySelector('[data-testid="arena-ambience"]')?.classList.contains("amb-still"));
    anims = (await layerAnims(page))!;
    must(anims.length > 0 && anims.every((s) => s === "paused"), "a hidden tab holds every animation");
    await setHidden(page, false);
    await page.waitForFunction(() => !document.querySelector('[data-testid="arena-ambience"]')?.classList.contains("amb-still"));
    console.log("✓ Pause and a hidden tab hold every animation, and both let go");

    // ── Reduced motion: none of it. ──
    const still = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const sp = await still.newPage();
    await sp.goto(arena, { waitUntil: "networkidle" });
    await sp.locator('[data-testid="arena"]').waitFor();
    must((await sp.locator('[data-testid="arena-ambience"]').count()) === 0, "reduced motion draws no ambience");
    await sp.screenshot({ path: "screenshots/ambience-colosseum-reduced.png" });
    await still.close();
    console.log("✓ reduced motion: no ambience");

    // ── The top-3 cheer: once a week, after the first tap; never on a reload; never with Sounds off. ──
    const tapQuiet = () => page.locator(".co-title").click();
    await page.goto(arena, { waitUntil: "networkidle" });
    await page.evaluate((k) => localStorage.removeItem(k), cheerKey);
    await page.reload({ waitUntil: "networkidle" });
    must(await page.locator('[data-testid="arena-champ"].co-you').count(), "Maya is among this week's champions");
    must(!(await sounds(page)).includes("cheer-top3"), "no cheer before a tap on the page");
    await tapQuiet();
    await page.waitForFunction(() => ((window as unknown as { __hxSounds?: string[] }).__hxSounds ?? []).includes("cheer-top3"));
    must((await sounds(page)).filter((s) => s === "cheer-top3").length === 1, "one cheer after the first tap");
    await tapQuiet();
    must((await sounds(page)).filter((s) => s === "cheer-top3").length === 1, "a second tap doesn't cheer again");
    must((await page.evaluate((k) => localStorage.getItem(k), cheerKey)) === "1", "the week is marked");
    await page.reload({ waitUntil: "networkidle" });
    await tapQuiet();
    await page.waitForTimeout(300);
    must(!(await sounds(page)).includes("cheer-top3"), "a reload doesn't cheer again this week");
    await db.update(schema.memberships).set({ soundsOn: false }).where(eq(schema.memberships.id, mm.id));
    await page.evaluate((k) => localStorage.removeItem(k), cheerKey);
    await page.reload({ waitUntil: "networkidle" });
    await tapQuiet();
    await page.waitForTimeout(300);
    must(!(await sounds(page)).includes("cheer-top3") && (await page.evaluate((k) => localStorage.getItem(k), cheerKey)) === null, "with Sounds off: no cheer, and the week stays unmarked");
    console.log("✓ the top-3 cheer: once after the first tap, not on a reload, never with Sounds off");

    must(failures.length === 0, `no server errors: ${failures.join(", ")}`);
    console.log("Ambience smoke passed");
  } finally {
    await browser.close();
    await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.id, boost));
    await db.update(schema.workspaces).set({ colosseumOn: before.colosseumOn }).where(eq(schema.workspaces.id, mm.workspaceId));
    await db.update(schema.memberships).set({ sceneLook: before.sceneLook, soundsOn: before.soundsOn, arenaPaused: before.arenaPaused, arenaHidden: before.arenaHidden }).where(eq(schema.memberships.id, mm.id));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
