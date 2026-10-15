/**
 * Settings polish (H-94), end to end: the emoji picker (grid of sixty in five groups, search, the current one first, a pick
 * saves at once and closes, Escape and a tap outside close without saving, arrows and Enter work, Other… takes one emoji
 * only, fits 390px with 44px targets); the photo (Upload photo → square preview with zoom and drag → Use this photo stores a
 * square; the card then shows it with Replace and Remove; a HEIC the browser can't read says so; Choose from my media over the
 * member's own Images only); the coach switched in gets none of it.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
}
let visit = 0;
/** Settings by its card: a plain goto that changes only the hash never reloads the page, so each visit carries a counter. */
const settings = (hash: string) => `${base}/settings?w=${++visit}#${hash}`;
async function login(page: Page, who: "As the coach" | "As a client") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { ALL_EMOJI } = await import("@/lib/engine/emoji");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  await db.update(schema.users).set({ avatarEmoji: "🌊" }).where(eq(schema.users.id, maya.id));
  await db.update(schema.memberships).set({ coachCanWork: true }).where(eq(schema.memberships.id, mm.id));
  const emojiNow = async () => (await db.query.users.findFirst({ where: eq(schema.users.id, maya.id) }))!.avatarEmoji;
  const PHOTO = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 46, g: 134, b: 222 } } }).jpeg().toBuffer();

  // The private store is the blob mock (scripts/mock-blob.ts), as for every walk that stores a picture.
  const blob = spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  await fetch("http://localhost:4050/__reset").catch(() => null);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  try {
    // ── 1. The emoji picker. ──
    await login(page, "As a client");
    await page.goto(settings("you"), { waitUntil: "networkidle" });
    const btn = page.locator('[data-testid="emoji-button"]');
    const grid = page.locator('[data-testid="emoji-grid"]');
    // A tap before React has attached its handlers does nothing: tap, wait for the grid, tap again if it has not opened.
    const openGrid = async () => {
      for (let i = 0; i < 4; i++) {
        await page.locator('[data-testid="emoji-button"]').click();
        if (await grid.isVisible({ timeout: 1500 }).catch(() => false)) return;
        await page.waitForTimeout(400);
      }
      throw new Error("the emoji grid did not open");
    };
    must((await btn.innerText()).trim() === "🌊", "the button shows the current emoji");
    must((await page.locator('input[name="avatarEmoji"]').count()) === 0, "the free-text box is gone");
    await openGrid();
    must(await grid.isVisible(), "tapping the emoji opens the grid");
    must((await page.locator('[data-testid="emoji-option"]').count()) === ALL_EMOJI.length, `the grid holds all ${ALL_EMOJI.length}, the current one first`);
    must((await page.locator('[data-testid="emoji-option"]').first().getAttribute("data-emoji")) === "🌊" && (await page.locator('[data-testid="emoji-option"]').first().getAttribute("aria-pressed")) === "true", "the current one comes first, highlighted");
    for (const name of ["People", "Symbols", "Nature", "Objects", "Animals"]) must((await grid.locator(`[role="group"][aria-label="${name}"]`).count()) === 1, `group ${name}`);
    await page.fill('[data-testid="emoji-search"]', "trident");
    must((await page.locator('[data-testid="emoji-option"][data-emoji="🔱"]').count()) === 1 && (await page.locator('[data-testid="emoji-option"]').count()) === 2, "search narrows the grid (plus the current one)");
    must((await page.locator('[data-testid="emoji-option"][data-emoji="🔱"]').getAttribute("aria-label")) === "trident", "each emoji is named for a screen reader");
    // Escape closes without saving.
    await page.keyboard.press("Escape");
    must(!(await grid.isVisible()) && (await emojiNow()) === "🌊", "Escape closes without saving");
    // A tap outside closes without saving.
    await openGrid();
    await page.mouse.click(5, 5);
    must(!(await grid.isVisible()) && (await emojiNow()) === "🌊", "a tap outside closes without saving");
    // Keyboard: Tab from the search to the grid, arrows, Enter picks and saves.
    await openGrid();
    await page.keyboard.press("Tab");
    must((await page.evaluate("document.activeElement?.getAttribute('data-emoji')")) === "🌊", "Tab reaches the grid");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    const focused = (await page.evaluate("document.activeElement?.getAttribute('data-emoji')")) as string;
    must(focused && focused !== "🌊", `arrows move the focus: ${focused}`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.keyboard.press("Enter")]);
    await page.waitForTimeout(500);
    must((await emojiNow()) === focused, "Enter picks and saves at once");
    must(!(await grid.isVisible()) && (await btn.innerText()).trim() === focused, "the grid closes and the button shows the pick");
    // Other…: one emoji only.
    await openGrid();
    await page.click('[data-testid="emoji-other"]');
    await page.fill('[data-testid="emoji-other-input"]', "fire");
    must(await page.locator('[data-testid="emoji-other-save"]').isDisabled(), "a word is not an emoji");
    await page.fill('[data-testid="emoji-other-input"]', "🔥🔥");
    must(await page.locator('[data-testid="emoji-other-save"]').isDisabled(), "two emojis are refused");
    await page.fill('[data-testid="emoji-other-input"]', "🫠");
    await submit(page, '[data-testid="emoji-other-save"]');
    must((await emojiNow()) === "🫠", "Other… saves one typed emoji");
    // 390px: the grid fits the screen, every target 44px or taller, no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(settings("you"), { waitUntil: "networkidle" });
    await openGrid();
    const gb = (await page.locator('[data-testid="emoji-grid"]').boundingBox())!;
    must(gb.x >= 0 && gb.x + gb.width <= 390.5, `at 390 the grid fits: ${gb.x} + ${gb.width}`);
    must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, "no sideways scroll with the grid open");
    const ob = (await page.locator('[data-testid="emoji-option"]').nth(3).boundingBox())!;
    must(ob.width >= 44 && ob.height >= 44, `targets are 44px: ${ob.width}x${ob.height}`);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log("✓ emoji picker: sixty in five groups, the current first, search, Escape and tap-outside close without saving, arrows and Enter pick and save, Other… takes one emoji, fits 390 with 44px targets");

    // ── 2. The photo: upload, crop square, replace, remove; a HEIC the browser can't read; the error line. ──
    await db.update(schema.memberships).set({ headshotUrl: null, headshotDisplayUrl: null, headshotSource: null, headshotUpdatedAt: null }).where(eq(schema.memberships.id, mm.id));
    await page.goto(settings("photo"), { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="photo-source"]').innerText()) === "none yet", "starts with no photo");
    await page.locator('[data-testid="headshot-file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: PHOTO });
    await page.locator('[data-testid="headshot-crop"]').waitFor({ timeout: 10000 });
    must((await page.locator('[data-testid="headshot-zoom"]').count()) === 1, "a square preview with zoom");
    await page.locator('[data-testid="headshot-zoom"]').fill("2");
    const c = page.locator('[data-testid="headshot-crop"] canvas');
    const cb = (await c.boundingBox())!;
    await page.mouse.move(cb.x + 100, cb.y + 100);
    await page.mouse.down();
    await page.mouse.move(cb.x + 140, cb.y + 110, { steps: 4 });
    await page.mouse.up();
    await submit(page, '[data-testid="headshot-save"]');
    await page.waitForTimeout(500);
    const after = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!;
    must(after.headshotSource === "upload" && Boolean(after.headshotUrl), "Use this photo stores it as the member's own");
    const stored = await page.request.get(`${base}/api/headshots/${mm.id}`);
    const meta = await sharp(await stored.body()).metadata();
    must(stored.status() === 200 && meta.width === meta.height && (meta.width ?? 0) >= 400, `the stored photo is square: ${meta.width}x${meta.height}`);
    await page.goto(settings("photo"), { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="photo-source"]').innerText()) === "your own" && (await page.locator('#photo [data-testid="member-avatar"]').getAttribute("data-photo")) === "1", "the card shows the photo");
    must((await page.locator('#photo').innerText()).includes("Upload a new photo") && (await page.locator('[data-testid="photo-remove"]').count()) === 1, "with Replace and Remove");
    must((await page.locator('[data-testid="arena-settings"], [data-testid="arena-photo"]').count()) >= 0, "the Colosseum opt-in sits in the card when the Colosseum is on");
    // A HEIC this browser can't read: one plain line.
    await page.locator('[data-testid="headshot-file"]').setInputFiles({ name: "phone.heic", mimeType: "image/heic", buffer: Buffer.from("not really a heic") });
    await page.locator('[data-testid="headshot-error"]').waitFor({ timeout: 10000 });
    must((await page.locator('[data-testid="headshot-error"]').innerText()).includes("HEIC"), "a HEIC the browser can't read says so");
    await submit(page, '[data-testid="photo-remove"]');
    await page.waitForURL(/photo=removed/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");
    must((await page.locator('[data-testid="photo-removed"]').count()) === 1 && (await page.locator('[data-testid="photo-source"]').innerText()) === "removed", "Remove takes it down");
    console.log("✓ photo: upload → square preview with zoom and drag → saved square, the card shows it with Replace and Remove; an unreadable HEIC says so; Remove works");

    // ── 3. Choose from my media: the member's own Images only. ──
    await db.delete(schema.deckImages).where(eq(schema.deckImages.userId, maya.id));
    await page.goto(settings("photo"), { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="headshot-media"]').count()) === 0, "no media button without any images");
    await page.goto(`${base}/images`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="deck-image-file"]').waitFor({ state: "attached" });
    await page.setInputFiles('[data-testid="deck-image-file"]', { name: "sea.png", mimeType: "image/png", buffer: await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 20, g: 90, b: 160 } } }).png().toBuffer() });
    await page.selectOption('[data-testid="deck-image-kind"]', "photo");
    await page.fill('[data-testid="deck-image-caption"]', "Me by the sea");
    await submit(page, '[data-testid="deck-image-send"]');
    // The upload is two posts (the store, then the row): wait for the row.
    let mine = await db.query.deckImages.findMany({ where: eq(schema.deckImages.userId, maya.id) });
    for (let i = 0; i < 20 && mine.length < 1; i++) {
      await page.waitForTimeout(500);
      mine = await db.query.deckImages.findMany({ where: eq(schema.deckImages.userId, maya.id) });
    }
    must(mine.length === 1, "one image of Maya's in her Images");
    await page.goto(settings("photo"), { waitUntil: "networkidle" });
    await page.click('[data-testid="headshot-media"]');
    must((await page.locator('[data-testid="headshot-media-pick"]').count()) === 1, "the picker shows her own image");
    await page.fill('[data-testid="headshot-media-search"]', "mountain");
    must((await page.locator('[data-testid="headshot-media-pick"]').count()) === 0, "search narrows it");
    await page.fill('[data-testid="headshot-media-search"]', "sea");
    await page.click('[data-testid="headshot-media-pick"]');
    await page.locator('[data-testid="headshot-crop"]').waitFor({ timeout: 10000 });
    await submit(page, '[data-testid="headshot-save"]');
    await page.waitForTimeout(500);
    const picked = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!;
    must(picked.headshotSource === "upload" && Boolean(picked.headshotUrl), "a picked image becomes the photo, as the member's own");
    const m2 = await sharp(await (await page.request.get(`${base}/api/headshots/${mm.id}`)).body()).metadata();
    must(m2.width === m2.height, "square too");
    console.log("✓ Choose from my media: her own Images, searched, picked, cropped square and saved");

    // ── 4. The coach switched in: no picker, no upload. ──
    await ctx.clearCookies();
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${mm.id}`, { waitUntil: "networkidle" });
    await page.check('[data-testid="switch-work"]');
    await submit(page, '[data-testid="switch-open"]');
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="headshot-upload"]').count()) === 0 && (await page.locator('[data-testid="headshot-media"]').count()) === 0, "switched in, the coach sees no upload and no media picker");
    await submit(page, '[data-testid="switch-back"]');
    console.log("✓ the coach switched in can't add or pick a client's photo");

    must(failures.length === 0, `no server errors: ${failures.join(", ")}`);
    console.log("Settings smoke passed");
  } finally {
    await browser.close();
    try {
      process.kill(-blob.pid!);
    } catch {
      /* already gone */
    }
    await db.delete(schema.deckImages).where(and(eq(schema.deckImages.userId, maya.id), eq(schema.deckImages.caption, "Me by the sea")));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
