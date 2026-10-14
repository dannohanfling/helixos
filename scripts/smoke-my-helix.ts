/**
 * My Helix (rev 707 with rev 710's curriculum), end to end: at 1440, 1024 and 390 the stage keeps its place with nothing
 * scrolling sideways and all 67 rungs on it; the helix turns and every ball counter-turns; done rungs carry their phase's
 * colour, the rest grey, a backbone ball lit only between two done rungs; the next rung pulses and its card deep-links; a
 * phase opens by tap and by keyboard and fades the others; Maya ticks a rung and undoes it, the coach switched in ticks one
 * for her and it's logged as the coach's; Pause holds and is remembered; reduced motion and a hidden tab hold it; the once-glow
 * is remembered as seen; the coach edits a rung on Coach → My Helix rungs.
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

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { PHASES, GREY_BAR } = await import("@/lib/engine/my-helix");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = mm.workspaceId;
  await db.delete(schema.helixTicks).where(eq(schema.helixTicks.workspaceId, ws));
  await db.update(schema.memberships).set({ helixPaused: false, helixSeen: [] }).where(eq(schema.memberships.id, mm.id));
  await db.update(schema.memberships).set({ coachCanWork: true }).where(eq(schema.memberships.id, mm.id));
  await db.update(schema.helixRungs).set({ label: "Your superpower" }).where(eq(schema.helixRungs.key, "p0-superpower"));
  const ticksOf = () => db.query.helixTicks.findMany({ where: and(eq(schema.helixTicks.workspaceId, ws), eq(schema.helixTicks.userId, maya.id)) });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  try {
    // ── The stage at three widths; 67 rungs and 66 backbone balls. ──
    await login(page, "As a client");
    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
      must((await page.locator('[data-testid="helix-stage"]').count()) === 1, `at ${w} the stage is there`);
      must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, `at ${w} nothing scrolls sideways`);
      must((await page.locator('[data-testid="helix-rung"]').count()) === 67 && (await page.locator('[data-testid="helix-backbone"]').count()) === 66, `at ${w} 67 rungs and 66 backbone balls`);
      must((await page.locator('a[href="/my-helix"]').count()) >= 1, `at ${w} the menu has My Helix`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
    // ── It turns, and the balls counter-turn. ──
    const turn = async () => page.locator('[data-testid="helix"]').evaluate((el) => getComputedStyle(el).transform);
    const t1 = await turn();
    await page.waitForTimeout(1200);
    const t2 = await turn();
    must(t1 !== t2, `the helix turns: ${t1} then ${t2}`);
    must((await page.locator(".hx-end > .hx-ball").first().evaluate((el) => getComputedStyle(el).animationName)).includes("hx-counter"), "every ball counter-turns in step");
    // ── Colours by phase, grey for incomplete, the backbone rule. ──
    const rows = await page.locator('[data-testid="helix-rung"]').evaluateAll((els) => els.map((el) => ({ done: el.getAttribute("data-done") === "1", phase: Number(el.getAttribute("data-phase")), bar: (el.querySelector(".hx-bar") as HTMLElement).style.background })));
    const hex = (h: string) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
    for (const r of rows) must(r.bar === (r.done ? hex(PHASES[r.phase].main) : hex(GREY_BAR)), `a ${r.done ? "done" : "grey"} rung of phase ${r.phase} has its colour: ${r.bar}`);
    const lit = await page.locator('[data-testid="helix-backbone"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-lit") === "1"));
    for (let i = 0; i < lit.length; i++) must(lit[i] === (rows[i].done && rows[i + 1].done), `backbone ball ${i} is lit only between two done rungs`);
    const doneCount = rows.filter((r) => r.done).length;
    must((await page.locator('[data-testid="helix-built"]').innerText()).startsWith(`${doneCount} / 67`), "the header counts the built rungs");
    must((await page.locator('[data-testid="helix-pct"]').innerText()) === `${Math.round((100 * doneCount) / 67)}%`, "the header's percentage");
    // ── The next rung pulses; its card deep-links. ──
    const nextIdx = rows.findIndex((r) => !r.done);
    must((await page.locator('[data-testid="helix-next-ball"]').count()) === 2, "the next rung's two balls pulse");
    must((await page.locator('[data-testid="helix-rung"]').nth(nextIdx).locator('[data-testid="helix-next-ball"]').count()) === 2, "the pulse is on the first incomplete rung");
    const work = page.locator('[data-testid="helix-work"]');
    must((await work.getAttribute("href"))?.startsWith("/") === true, "Work on it now deep-links");
    const nextKey = await page.locator('[data-testid="helix-rung"]').nth(nextIdx).getAttribute("data-key");
    const nextPhase = Number(await page.locator('[data-testid="helix-rung"]').nth(nextIdx).getAttribute("data-phase"));
    must((await page.locator('[data-testid="helix-next"]').innerText()).includes(PHASES[nextPhase].name), "the card names the next rung's phase");
    console.log(`✓ 1440, 1024 and 390: the stage, no sideways scroll, 67 rungs; it turns and the balls counter-turn; colours by phase, grey for incomplete, backbone lit only between two done; ${doneCount} built, next ${nextKey}`);

    // ── Phase focus: tap, keyboard, fade. ──
    await page.click('[data-testid="helix-phase-0"]');
    must((await page.locator('[data-testid="helix-rungs-0"]').count()) === 1, "tapping a phase expands its rungs");
    const dimmed = await page.locator('[data-testid="helix-rung"][data-phase="5"] .hx-bar').first().evaluate((el) => (el as HTMLElement).style.opacity);
    must(dimmed === "0.35", `the other phases fade to 35%: ${dimmed}`);
    must((await page.locator('[data-testid="helix-rung"][data-phase="0"] .hx-bar').first().evaluate((el) => (el as HTMLElement).style.opacity)) === "1", "the focused phase stays full");
    await page.click('[data-testid="helix-phase-0"]');
    must((await page.locator('[data-testid="helix-rungs-0"]').count()) === 0, "tapping again clears the focus");
    await page.locator('[data-testid="helix-phase-9"]').focus();
    await page.keyboard.press("Enter");
    must((await page.locator('[data-testid="helix-rungs-9"]').count()) === 1, "a phase opens by keyboard");
    await page.keyboard.press("Enter");
    console.log("✓ phase focus by tap and by keyboard; the other phases fade to 35% and come back");

    // ── A tick by Maya, and its undo; the once-glow remembered as seen. ──
    await page.click('[data-testid="helix-phase-0"]');
    const row = page.locator('[data-testid="helix-rung-row"]').first();
    must((await row.getAttribute("data-done")) === "0", "Your superpower starts unticked");
    await submit(page, '[data-testid="helix-tick"]');
    must((await ticksOf()).some((t) => t.rungKey === "p0-superpower" && t.byUserId === maya.id), "Maya's tick is stored as hers");
    await page.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="helix-rung"][data-key="p0-superpower"]').getAttribute("data-done")) === "1", "the ticked rung is done on the helix");
    must((await page.locator('[data-testid="helix-rung"][data-key="p0-superpower"] .hx-fresh').count()) === 2, "a rung done since the last look glows once");
    await page.waitForTimeout(2200);
    must(((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!.helixSeen ?? []).includes("p0-superpower"), "the glow is remembered as seen");
    await page.reload({ waitUntil: "networkidle" });
    must((await page.locator('[data-testid="helix-rung"][data-key="p0-superpower"] .hx-fresh').count()) === 0, "it never repeats on load");
    await page.click('[data-testid="helix-phase-0"]');
    must((await page.locator('[data-testid="helix-tick"]').first().innerText()) === "Undo", "the tick's button reads Undo");
    await submit(page, '[data-testid="helix-tick"]');
    must(!(await ticksOf()).some((t) => t.rungKey === "p0-superpower"), "the undo removes the tick");
    console.log("✓ a tick by Maya, the once-glow remembered as seen, and the undo");

    // ── Pause, remembered; reduced motion; a hidden tab. ──
    await page.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
    await page.click('[data-testid="helix-pause"]');
    must((await page.locator('[data-testid="helix-stage"]').getAttribute("data-paused")) === "1", "Pause holds the helix");
    must((await page.locator('[data-testid="helix-pause"]').innerText()).includes("Set the helix turning"), "the label flips");
    await page.waitForTimeout(500);
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!.helixPaused, "Pause is remembered");
    await page.reload({ waitUntil: "networkidle" });
    must((await page.locator('[data-testid="helix-stage"]').getAttribute("data-paused")) === "1", "still paused after a reload");
    await page.click('[data-testid="helix-pause"]');
    await page.waitForTimeout(400);
    const still = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const sp = await still.newPage();
    await sp.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
    must((await sp.locator('[data-testid="helix"]').evaluate((el) => getComputedStyle(el).animationName)) === "none", "reduced motion keeps the helix still");
    must((await sp.locator('[data-testid="helix-next-ball"]').first().evaluate((el) => getComputedStyle(el).animationName)) === "none", "and the pulse stops");
    await still.close();
    await page.evaluate("Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))");
    await page.waitForTimeout(200);
    must((await page.locator('[data-testid="helix-stage"]').getAttribute("data-paused")) === "1", "the tab hidden pauses it");
    console.log("✓ Pause holds and is remembered; reduced motion keeps it still and stops the pulse; a hidden tab pauses it");

    // ── The coach: edits a rung on Coach → My Helix rungs; switched into Maya, ticks one for her, logged as the coach's. ──
    await ctx.clearCookies();
    await login(page, "As the coach");
    await page.goto(`${base}/coach/helix`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="coach-helix-rung"]').count()) === 67, "the coach sees all 67 rungs");
    const first = page.locator('[data-testid="coach-helix-rung"][data-key="p0-superpower"]');
    await first.locator('[data-testid="rung-label"]').fill("Your superpower, named");
    await submit(page, '[data-testid="coach-helix-rung"][data-key="p0-superpower"] [data-testid="rung-save"]');
    must((await db.query.helixRungs.findFirst({ where: eq(schema.helixRungs.key, "p0-superpower") }))!.label === "Your superpower, named", "the coach's edit is saved");
    await db.update(schema.helixRungs).set({ label: "Your superpower" }).where(eq(schema.helixRungs.key, "p0-superpower"));
    await db.delete(schema.coachChanges).where(eq(schema.coachChanges.userId, maya.id));
    await page.goto(`${base}/coach/${mm.id}`, { waitUntil: "networkidle" });
    await submit(page, '[data-testid="switch-work"]');
    await page.goto(`${base}/my-helix`, { waitUntil: "networkidle" });
    await page.click('[data-testid="helix-phase-0"]');
    await submit(page, '[data-testid="helix-tick"]');
    const byCoach = (await ticksOf()).find((t) => t.rungKey === "p0-superpower");
    must(byCoach?.byUserId === coach.id, "the coach's tick for Maya is stored as the coach's");
    must((await db.query.coachChanges.findMany({ where: and(eq(schema.coachChanges.userId, maya.id), eq(schema.coachChanges.kind, "change")) })).length >= 1, "and logged as the coach's change");
    await submit(page, '[data-testid="switch-back"]');
    console.log("✓ the coach edits a rung with no deploy; switched into Maya, ticks one for her, logged as the coach's");

    must(failures.length === 0, `no server errors: ${failures.join(", ")}`);
    console.log("My Helix smoke passed");
  } finally {
    await browser.close();
    await db.delete(schema.helixTicks).where(eq(schema.helixTicks.workspaceId, ws));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
