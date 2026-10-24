/**
 * 30 Days in the Arena, PR C (plan H-1563), end to end: with 24 closes inside the window (test rows on 27 Nov to 20 Dec),
 * Maya (Elite) is marked finished; the coach's Finishers card lists her with the Elite prize line; her Arena page says she
 * completed it. The evening nudge is off by default and adds nothing; turned on, her reminder's Arena line reads the day and
 * her closes; turned off again, nothing. Nothing is sent by the walk itself. Everything it adds is removed after.
 */
import { chromium, type Page } from "@playwright/test";

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
async function noSideways(page: Page, where: string) {
  const [sw, cw] = await page.evaluate(() => [document.scrollingElement!.scrollWidth, document.scrollingElement!.clientWidth]);
  must(sw <= cw + 1, `${where} scrolls sideways at 390 (${sw} > ${cw})`);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, gte, lte } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { arenaFor, arenaNudgeFor } = await import("@/lib/arena");
  const { ARENA } = await import("@/lib/engine/arena");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, maya.id), eq(schema.memberships.role, "client")) }))!;
  const W = mm.workspaceId;
  const tierBefore = mm.programTier;
  const c = await arenaFor(W);
  const inWindow = and(eq(schema.dailyLogs.userId, maya.id), gte(schema.dailyLogs.date, ARENA.startDate), lte(schema.dailyLogs.date, ARENA.endDate));
  const clear = async () => {
    await db.delete(schema.dailyLogs).where(inWindow);
    await db.delete(schema.arenaEntries).where(eq(schema.arenaEntries.challengeId, c.id));
    await db.delete(schema.arenaPods).where(eq(schema.arenaPods.challengeId, c.id));
    await db.update(schema.arenaChallenges).set({ nudgeOn: false }).where(eq(schema.arenaChallenges.id, c.id));
  };
  await clear();
  await db.update(schema.memberships).set({ programTier: "Elite" }).where(eq(schema.memberships.id, mm.id));
  await db.insert(schema.arenaEntries).values({ id: newId(), workspaceId: W, userId: maya.id, membershipId: mm.id, challengeId: c.id, joinedAt: "2026-10-20T12:00:00.000Z" });
  // 24 closes inside the window: 27 Nov to 20 Dec.
  for (let i = 0; i < 24; i++) {
    const date = new Date(Date.parse(`${ARENA.startDate}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    await db.insert(schema.dailyLogs).values({ id: newId(), workspaceId: W, userId: maya.id, date, eveningDoneAt: `${date}T23:00:00.000Z` });
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const coach = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await login(coach, "As the coach");
    await coach.goto(`${base}/coach/arena`);
    const fin = coach.getByTestId("coach-arena-finisher").filter({ hasText: maya.name });
    await fin.waitFor({ timeout: 30000 });
    must((await fin.innerText()).includes("A private strategy session with Danno"), "Maya is listed with the Elite prize line");
    const entry = await db.query.arenaEntries.findFirst({ where: and(eq(schema.arenaEntries.challengeId, c.id), eq(schema.arenaEntries.membershipId, mm.id)) });
    must(entry?.finishedAt, "her entry is marked finished");
    await noSideways(coach, "/coach/arena");
    console.log("✓ 24 closes in the window: Maya is marked finished and the coach's Finishers card lists her with the Elite prize");

    const nudge = coach.getByTestId("coach-arena-nudge");
    must((await nudge.getAttribute("data-on")) === "0", "the nudge is off by default");
    must((await arenaNudgeFor(W, maya.id, mm.id, new Date("2026-12-08T20:00:00Z"))) === null, "off: the reminder carries no Arena line");
    await Promise.all([coach.waitForURL(/nudge=on/, { timeout: 30000 }), coach.getByTestId("coach-arena-nudge-toggle").click()]);
    must((await coach.getByTestId("coach-arena-nudge").getAttribute("data-on")) === "1", "turned on");
    const line = await arenaNudgeFor(W, maya.id, mm.id, new Date("2026-12-08T20:00:00Z"));
    must(line === "Arena day 12 of 30: you've completed the challenge. Every close still earns points.", `on: her line reads the day and her closes (${line})`);
    await Promise.all([coach.waitForURL(/nudge=off/, { timeout: 30000 }), coach.getByTestId("coach-arena-nudge-toggle").click()]);
    must((await arenaNudgeFor(W, maya.id, mm.id, new Date("2026-12-08T20:00:00Z"))) === null, "off again: no Arena line");
    console.log("✓ the nudge is off by default; on, her reminder's line reads Arena day 12 and her finish; off again, nothing");

    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await login(page, "As a client");
    await page.goto(`${base}/arena`);
    const done = page.getByTestId("arena-finished");
    await done.waitFor({ timeout: 30000 });
    must((await done.innerText()).includes("You've completed the challenge: 24 days closed."), "her Arena page says she completed it");
    await noSideways(page, "/arena");
    console.log("✓ her Arena page says she completed it, with the Elite line");
  } finally {
    await browser.close();
    await clear();
    await db.update(schema.memberships).set({ programTier: tierBefore }).where(eq(schema.memberships.id, mm.id));
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
