/**
 * 30 Days in the Arena, PR A (H-1563), end to end: Maya (an Elite client) opens /arena and sees the approved page with its
 * countdown; "I'm in" enrolls her once and every join button then says "You're in"; Today shows her Arena card; the coach's
 * /coach/arena lists her with 0 of 24; a member at a level outside the Arena reads the short "for members" line and gets no
 * card; joining from the Today invite keeps her on Today; nothing scrolls sideways at 390. The walk follows the calendar: after
 * Thu 26 Nov it checks that joining is closed instead.
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
  const { and, eq } = await import("drizzle-orm");
  const { ARENA, arenaPhase, dateIn, joinOpen } = await import("@/lib/engine/arena");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, maya.id), eq(schema.memberships.role, "client")) }))!;
  const W = mm.workspaceId;
  const tierBefore = mm.programTier;
  const clear = async () => {
    const c = await db.query.arenaChallenges.findFirst({ where: and(eq(schema.arenaChallenges.workspaceId, W), eq(schema.arenaChallenges.slug, ARENA.slug)) });
    if (c) await db.delete(schema.arenaEntries).where(eq(schema.arenaEntries.challengeId, c.id));
  };
  const entries = async () => {
    const c = await db.query.arenaChallenges.findFirst({ where: and(eq(schema.arenaChallenges.workspaceId, W), eq(schema.arenaChallenges.slug, ARENA.slug)) });
    return c ? db.query.arenaEntries.findMany({ where: and(eq(schema.arenaEntries.challengeId, c.id), eq(schema.arenaEntries.membershipId, mm.id)) }) : [];
  };
  await clear();
  await db.update(schema.memberships).set({ programTier: "Elite" }).where(eq(schema.memberships.id, mm.id));
  const today = dateIn(ARENA.timezone, new Date());
  const open = joinOpen(ARENA, today);
  const phase = arenaPhase(ARENA, today);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await login(page, "As a client");
    await page.goto(`${base}/arena`);
    await page.getByTestId("arena-page").waitFor({ timeout: 30000 });
    const text = (await page.getByTestId("arena-page").textContent()) ?? "";
    for (const words of ["Thirty Days in the", "Show up 24 days.", "Everyone who finishes", "Live with me", "Put these in", "A note from Danno", "Before you"]) must(text.includes(words), `the page keeps its copy: "${words}"`);
    must(!/\$\s?\d|price/i.test(text), "no prices on the Arena page");
    const count = page.getByTestId("arena-count");
    if (phase !== "closed") must((await count.getAttribute("data-state")) === phase, `the countdown is in its ${phase} state`);
    await noSideways(page, "/arena");
    console.log(`✓ /arena: the approved page with its copy, no prices, the countdown ${phase}, nothing sideways at 390`);

    if (open) {
      must((await page.getByTestId("arena-join").count()) >= 2, "every join button is I'm in");
      await Promise.all([page.waitForURL(/arena=in/, { timeout: 30000 }), page.getByTestId("arena-join").nth(1).click()]);
      must((await page.getByTestId("arena-note").innerText()).includes("You're in"), "the page says you're in");
      must((await page.getByTestId("arena-join").count()) === 0 && (await page.getByTestId("arena-in").count()) >= 2, "after joining, every join button says You're in");
      must((await entries()).length === 1, "one entry for Maya");
      await page.goto(`${base}/arena`);
      must((await entries()).length === 1, "still one entry after a reload");
      console.log("✓ I'm in enrolls Maya once, and every button then says You're in");

      await page.goto(`${base}/today`);
      const card = page.getByTestId("today-arena");
      await card.waitFor({ timeout: 20000 });
      const kind = await card.getAttribute("data-kind");
      must(kind === (phase === "before" ? "waiting" : phase === "open" ? "day" : "after"), `Today shows the Arena card for where we are (${kind})`);
      console.log(`✓ Today shows Maya's Arena card (${kind}): ${await page.getByTestId("today-arena-line").innerText()}`);

      const coach = await (await browser.newContext({ viewport: { width: 1350, height: 940 } })).newPage();
      await login(coach, "As the coach");
      await coach.goto(`${base}/arena`);
      must(await coach.getByTestId("arena-coach-link").count(), "the coach sees the link to who's in");
      await coach.goto(`${base}/coach/arena`);
      const row = coach.getByTestId("coach-arena-row").filter({ hasText: maya.name.split(" ")[0] });
      await row.waitFor({ timeout: 20000 });
      must((await row.innerText()).includes("of 24"), "the coach's list shows days closed out of 24");
      console.log("✓ the coach's /coach/arena lists Maya with her days closed out of 24");

      await clear();
      await page.goto(`${base}/today`);
      await page.getByTestId("today-arena-join").waitFor({ timeout: 20000 });
      await Promise.all([page.waitForURL(/\/today\?arena=in/, { timeout: 30000 }), page.getByTestId("today-arena-join").click()]);
      must((await entries()).length === 1, "joining from the Today invite enrolls her");
      must((await page.getByTestId("today-arena").getAttribute("data-kind")) !== "invite", "and the card is no longer the invite");
      console.log("✓ joining from the Today invite keeps Maya on Today with her card");
    } else {
      must((await page.getByTestId("arena-join").count()) === 0 && (await page.getByTestId("arena-join-closed").count()) >= 1, "after Thu 26 Nov joining is closed");
      console.log("✓ joining is closed after Thu 26 Nov");
    }

    await db.update(schema.memberships).set({ programTier: "Book 'Em Danno" }).where(eq(schema.memberships.id, mm.id));
    await page.goto(`${base}/arena`);
    await page.getByTestId("arena-not-yours").waitFor({ timeout: 20000 });
    await page.goto(`${base}/today`);
    must((await page.getByTestId("today-arena").count()) === 0, "no Arena card for a level outside it");
    console.log("✓ a level outside the Arena reads the short line on /arena and gets no card on Today");
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
