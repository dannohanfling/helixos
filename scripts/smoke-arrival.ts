/**
 * The first arrival (H-472): a fresh client's first sign-in opens with the ceremony (the client face, the three tablets), it
 * ends and the stamp lands, the daily welcome stays away that day, Take my seat lands on Today, a reload shows nothing more;
 * Replay from Settings plays it again without a stamp, Skip jumps to the finished screen, reduced motion shows the finished
 * screen with no gate; a fresh team member gets the team face with the owner's name and initial and the tiles open to them
 * (Office Hours only with the owner's access, H-470); existing members (the seed's) never see it; a coach switched into the
 * fresh client never sees it; nothing wider than 390 px. Runs against the dev server; fixtures go straight to the database.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "arrival-pass-123";
mkdirSync("screenshots", { recursive: true });
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { arrivalCard } = await import("@/lib/engine/first-arrival");
  const run = randomUUID().slice(0, 8);
  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  };
  const fa = (page: Page) => page.locator('[data-testid="first-arrival"]');
  const state = (page: Page) => fa(page).getAttribute("data-state");
  try {
    // ── 1. A fresh client: the ceremony on the first sign-in, at 390. ──
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    watch(page);
    const email = `priya.arrival.${run}@example.com`;
    await page.goto(`${base}/join/ACADEMY1`);
    await page.fill('input[name="firstName"]', "Priya");
    await page.fill('input[name="lastName"]', "Natarajan");
    await page.fill('input[name="businessName"]', "Natarajan Wellness");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.fill('input[name="confirm"]', PASSWORD);
    await Promise.all([page.waitForURL(/\/today/, { timeout: 30000 }), page.click('button[type="submit"]')]);
    await fa(page).waitFor({ timeout: 20000 });
    const card = arrivalCard({ kind: "client", first: "Priya" });
    must((await fa(page).getAttribute("data-kind")) === "client" && (await state(page)) === "playing", "a fresh client's first open plays the client face");
    must((await page.locator('[data-testid="arrival-title"]').innerText()).trim() === card.title, `the title: ${card.title}`);
    must((await page.locator('[data-testid="arrival-eyebrow"]').textContent())?.trim() === card.eyebrow && (await page.locator('[data-testid="arrival-chip"]').innerText()).includes("Your first ember"), "the eyebrow and the chip");
    must((await page.locator('[data-testid="arrival-initial"]').innerText()).trim() === "P", "the aureus carries the initial");
    must((await page.locator('[data-testid="arrival-tile"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-href")))).join() === card.tiles.map((t) => t.href).join(), "the three tablets in order");
    must((await page.locator('[data-testid="arrival-gate"]').count()) === 1 && (await page.locator('[data-testid="daily-welcome"]').count()) === 0, "the gate is up and the daily welcome stays away");
    must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390 px: nothing wider than the screen");
    const joined = (await db.query.users.findFirst({ where: eq(schema.users.email, email) }))!;
    const joinedM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, joined.id) }))!;
    must(!joinedM.firstArrivalSeenAt, "not stamped while it plays");
    await page.screenshot({ path: "screenshots/fa00-client-gate.png" });
    // The sequence ends on its own: the finished screen, focus on the button, the stamp.
    await page.waitForFunction(() => document.querySelector('[data-testid="first-arrival"]')?.getAttribute("data-state") === "done", null, { timeout: 12000 });
    await page.screenshot({ path: "screenshots/fa01-client-done.png" });
    must(await page.locator('[data-testid="arrival-cta"]').evaluate((el) => el === document.activeElement), "the finished screen puts focus on the button");
    for (let i = 0; i < 20 && !(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, joinedM.id) }))!.firstArrivalSeenAt; i++) await page.waitForTimeout(300);
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, joinedM.id) }))!.firstArrivalSeenAt, "the end stamps first_arrival_seen_at");
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, joinedM.id) }))!.welcomeShownOn, "the day is marked welcome-shown, so the daily welcome starts the next day");
    await page.locator('[data-testid="arrival-cta"]').click();
    await page.waitForURL(/\/today/);
    must((await fa(page).count()) === 0, "Take my seat closes it on Today");
    await page.reload();
    await page.locator("h1").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    must((await fa(page).count()) === 0 && (await page.locator('[data-testid="daily-welcome"]').count()) === 0, "once per person: a reload shows nothing, and no daily welcome either");
    console.log("✓ a fresh client: the client face with the tablets, the gate, 390 px, the end stamps it, Take my seat, nothing on a reload");

    // ── 2. Replay from Settings: plays again, Skip jumps to the end, nothing restamped; reduced motion shows the finished screen with no gate. ──
    const stampAt = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, joinedM.id) }))!.firstArrivalSeenAt;
    await page.goto(`${base}/settings`);
    await page.locator('[data-testid="arrival-replay-form"]').click();
    await page.waitForURL(/arrival=replay/, { timeout: 20000 });
    await fa(page).waitFor({ timeout: 20000 });
    must((await fa(page).getAttribute("data-replay")) === "1" && (await state(page)) === "playing", "Play my welcome again plays it on Today");
    await page.locator('[data-testid="arrival-skip"]').click();
    must((await state(page)) === "done" && (await page.locator('[data-testid="arrival-gate"]').isHidden()), "Skip jumps to the finished screen, the gate gone");
    await page.locator('[data-testid="arrival-replay"]').click();
    await page.waitForTimeout(200);
    must((await state(page)) === "playing" && (await page.locator('[data-testid="arrival-gate"]').isVisible()), "Replay plays it again");
    await page.keyboard.press("Escape");
    must((await state(page)) === "done", "Escape is Skip");
    await page.locator('[data-testid="arrival-cta"]').click();
    await page.waitForURL((u) => u.pathname === "/today" && !u.search.includes("arrival"));
    must((await fa(page).count()) === 0, "Take my seat leaves the replay");
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, joinedM.id) }))!.firstArrivalSeenAt === stampAt, "a replay stamps nothing");
    const quiet = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
    const q = await quiet.newPage();
    watch(q);
    await q.goto(`${base}/settings`);
    await q.locator('[data-testid="arrival-replay-form"]').click();
    await q.waitForURL(/arrival=replay/, { timeout: 20000 });
    await fa(q).waitFor({ timeout: 20000 });
    await q.waitForFunction(() => document.querySelector('[data-testid="first-arrival"]')?.getAttribute("data-state") === "done", null, { timeout: 3000 });
    must(await q.locator('[data-testid="arrival-gate"]').isHidden(), "reduced motion: the finished screen with no gate");
    await q.screenshot({ path: "screenshots/fa02-client-quiet.png" });
    await quiet.close();
    console.log("✓ Replay from Settings, Skip, Replay, Escape; a replay stamps nothing; reduced motion shows the finished screen with no gate");

    // ── 3. Existing members never see it; a coach switched into the fresh client never sees it. ──
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    must(mayaM.firstArrivalSeenAt, "the seed's members are stamped, as the migration's backfill stamps everyone before it");
    const owner = await browser.newPage();
    watch(owner);
    await owner.goto(`${base}/login`);
    await owner.click('button:has-text("As a client")');
    await owner.waitForURL(/\/today/);
    await owner.locator("h1").first().waitFor({ timeout: 20000 });
    await owner.waitForTimeout(400);
    must((await fa(owner).count()) === 0, "an existing member never sees it");
    await db.update(schema.memberships).set({ firstArrivalSeenAt: null }).where(eq(schema.memberships.id, joinedM.id));
    const coach = await browser.newPage();
    watch(coach);
    await coach.goto(`${base}/login`);
    await coach.click('button:has-text("As the coach")');
    await coach.waitForURL(/\/today/);
    await coach.goto(`${base}/coach/${joinedM.id}`);
    await coach.locator('[data-testid="switch-view"]').waitFor({ timeout: 20000 });
    await coach.check('[data-testid="switch-view"]');
    await submit(coach, '[data-testid="switch-open"]');
    await coach.locator("h1").first().waitFor({ timeout: 20000 });
    await coach.waitForTimeout(400);
    must((await fa(coach).count()) === 0, "a coach switched into the fresh client never sees it");
    must(!(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, joinedM.id) }))!.firstArrivalSeenAt, "and stamps nothing for them");
    await submit(coach, '[data-testid="switch-back"]');
    await coach.goto(`${base}/today`);
    await coach.locator("h1").first().waitFor({ timeout: 20000 });
    await coach.waitForTimeout(400);
    must((await fa(coach).count()) === 0, "the coach's own Today has no ceremony");
    await coach.close();
    await db.update(schema.memberships).set({ firstArrivalSeenAt: new Date().toISOString() }).where(eq(schema.memberships.id, joinedM.id));
    console.log("✓ existing members never see it; a coach switched in never sees it and stamps nothing; the coach's own Today has none");

    // ── 4. A fresh team member: the team face, the owner's name and initial, the tiles open to them; Office Hours follows the owner. ──
    const invite = async (): Promise<string> => {
      await owner.goto(`${base}/settings`);
      await owner.locator('[data-testid="team-invite-form"]').waitFor({ timeout: 20000 });
      await owner.fill('[data-testid="team-invite-form"] input[name="label"]', `Arrival ${run}`);
      await submit(owner, '[data-testid="team-invite"]');
      await owner.locator('[data-testid="team-invite-url"]').waitFor({ timeout: 20000 });
      return (await owner.locator('[data-testid="team-invite-url"]').innerText()).trim();
    };
    const join = async (link: string, first: string, mail: string): Promise<Page> => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await c.newPage();
      watch(p);
      await p.goto(link);
      await p.locator('[data-testid="team-join"]').waitFor({ timeout: 20000 });
      await p.fill('input[name="firstName"]', first);
      await p.fill('input[name="lastName"]', "Vale");
      await p.fill('input[name="email"]', mail);
      await p.fill('input[name="password"]', PASSWORD);
      await p.fill('input[name="confirm"]', PASSWORD);
      await Promise.all([p.waitForURL(/\/today/, { timeout: 30000 }), p.click('button:has-text("Join the team")')]);
      return p;
    };
    const samEmail = `sam.arrival.${run}@demo.helixos.app`;
    const sam = await join(await invite(), "Sam", samEmail);
    await fa(sam).waitFor({ timeout: 20000 });
    const team = arrivalCard({ kind: "team", first: "Sam", owner: maya.name.split(" ")[0], oohOn: true });
    must((await fa(sam).getAttribute("data-kind")) === "team", "a fresh team member gets the team face");
    must((await sam.locator('[data-testid="arrival-title"]').innerText()).trim() === team.title, `the title names the owner and the team member: ${team.title}`);
    must((await sam.locator('[data-testid="arrival-chip"]').innerText()).includes(team.chip) && (await sam.locator('[data-testid="arrival-initial"]').innerText()).trim() === team.initial, "the chip and the owner's initial on the aureus");
    must((await sam.locator(".fa-tlab").innerText()).trim() === "TEAM", "the TEAM tag");
    const tiles = await sam.locator('[data-testid="arrival-tile"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-href")));
    must(tiles.join() === "/content,/conversations,/tasks,/webinars,/office-hours", `the tiles open to a team member, Office Hours with the owner's access: ${tiles.join()}`);
    must(!(await fa(sam).innerText()).match(/Artisan|ember|points|streak/i), "no ranks, streaks or points on the team face");
    must(await sam.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390 px: nothing wider than the screen");
    await sam.screenshot({ path: "screenshots/fa03-team.png" });
    await sam.locator('[data-testid="arrival-skip"]').click();
    const samUser = (await db.query.users.findFirst({ where: eq(schema.users.email, samEmail) }))!;
    const samRow = (await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.teamUserId, samUser.id), isNull(schema.teamMembers.removedAt)) }))!;
    for (let i = 0; i < 20 && !(await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, samRow.id) }))!.firstArrivalSeenAt; i++) await sam.waitForTimeout(300);
    must((await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, samRow.id) }))!.firstArrivalSeenAt, "Skip stamps the team member's own row");
    await sam.locator('[data-testid="arrival-cta"]').click();
    await sam.waitForURL(/\/today/);
    await sam.locator('[data-testid="team-home"]').waitFor({ timeout: 20000 });
    must((await fa(sam).count()) === 0, "Start helping lands on the team member's Today");
    await sam.reload();
    await sam.locator('[data-testid="team-home"]').waitFor({ timeout: 20000 });
    await sam.waitForTimeout(400);
    must((await fa(sam).count()) === 0, "once per person: not on a reload");
    // The owner without Office Hours (H-470): a second team member's tiles leave it out.
    await db.update(schema.memberships).set({ officeHoursOverride: "off" }).where(eq(schema.memberships.id, mayaM.id));
    const lee = await join(await invite(), "Lee", `lee.arrival.${run}@demo.helixos.app`);
    await fa(lee).waitFor({ timeout: 20000 });
    const leeTiles = await lee.locator('[data-testid="arrival-tile"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-href")));
    must(leeTiles.join() === "/content,/conversations,/tasks,/webinars", `with the owner's Office Hours off the tile is gone: ${leeTiles.join()}`);
    await lee.locator('[data-testid="arrival-skip"]').click();
    await lee.locator('[data-testid="arrival-cta"]').click();
    await lee.waitForURL(/\/today/);
    await db.update(schema.memberships).set({ officeHoursOverride: null }).where(eq(schema.memberships.id, mayaM.id));
    // The seed's shape for the walks after this one: the two team members off the team.
    for (const u of [samUser.id, (await db.query.users.findFirst({ where: eq(schema.users.email, `lee.arrival.${run}@demo.helixos.app`) }))!.id]) await db.update(schema.teamMembers).set({ removedAt: new Date().toISOString(), removedBy: maya.id }).where(eq(schema.teamMembers.teamUserId, u));
    await sam.context().close();
    await lee.context().close();
    await owner.close();
    await ctx.close();
    console.log("✓ a fresh team member: the team face with the owner's name, initial and TEAM tag, the tiles open to them, Office Hours only with the owner's access, Skip stamps their own row, Start helping, nothing on a reload");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("First arrival smoke passed");
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
