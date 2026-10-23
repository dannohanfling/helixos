/**
 * Colosseum → Challenges (H-1840, plan H-1844): the workspace's challenge shows in its own section with its plan's words and
 * no prices; "I'm in" there enrolls the member once and brings them back to the tab with "You're in ✓"; the coach sees the card
 * and the Arena page link but no join; a member at a level outside the Arena gets no button; nothing scrolls sideways at 390.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const TAB = "/rewards?tab=colosseum&section=challenges";
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
  const { ARENA, challengeView, dateIn, joinOpen } = await import("@/lib/engine/arena");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, maya.id), eq(schema.memberships.role, "client")) }))!;
  const W = mm.workspaceId;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, W) }))!;
  const tierBefore = mm.programTier;
  const challenge = () => db.query.arenaChallenges.findFirst({ where: and(eq(schema.arenaChallenges.workspaceId, W), eq(schema.arenaChallenges.slug, ARENA.slug)) });
  const entries = async () => {
    const c = await challenge();
    return c ? db.query.arenaEntries.findMany({ where: and(eq(schema.arenaEntries.challengeId, c.id), eq(schema.arenaEntries.membershipId, mm.id)) }) : [];
  };
  const clear = async () => {
    const c = await challenge();
    if (c) await db.delete(schema.arenaEntries).where(eq(schema.arenaEntries.challengeId, c.id));
  };
  await clear();
  await db.update(schema.workspaces).set({ colosseumOn: true }).where(eq(schema.workspaces.id, W));
  await db.update(schema.memberships).set({ programTier: "Elite" }).where(eq(schema.memberships.id, mm.id));
  const today = dateIn(ARENA.timezone, new Date());
  const view = challengeView(ARENA, today);
  const open = joinOpen(ARENA, today);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await login(page, "As a client");
    await page.goto(`${base}${TAB}`);
    const card = page.getByTestId("challenge-card");
    await card.waitFor({ timeout: 30000 });
    must((await card.getAttribute("data-section")) === view.section, `the card sits under ${view.section}`);
    must((await page.getByTestId(`challenges-${view.section}`).getByTestId("challenge-card").count()) === 1, "the card is in its own section");
    const text = (await card.innerText()) ?? "";
    for (const words of [ARENA.name, "Close your day on 24 of the 30 days.", view.countdown, "Fri 27 Nov to Sat 26 Dec"]) must(text.includes(words), `the card says "${words}"`);
    must(!/\$\s?\d|price|Elite|private session/i.test(text), `no price and no Elite reward on the card: ${text}`);
    await noSideways(page, "Challenges");
    console.log(`✓ Challenges: the Arena card under ${view.section} with its words (${view.countdown}), no prices, nothing sideways at 390`);

    if (open) {
      const join = page.getByTestId("challenge-join");
      const box = await join.boundingBox();
      must(box && box.height >= 44, `I'm in is at least 44 px tall, got ${box?.height}`);
      await Promise.all([page.waitForURL(/section=challenges&arena=in/, { timeout: 30000 }), join.click()]);
      await page.getByTestId("challenge-in").waitFor({ timeout: 20000 });
      must((await page.getByTestId("challenge-join").count()) === 0, "after joining there is no I'm in");
      must((await entries()).length === 1, "one entry for Maya");
      await page.goto(`${base}${TAB}`);
      must((await page.getByTestId("challenge-in").innerText()).startsWith("You're in ✓"), "a reload still says You're in");
      must((await entries()).length === 1, "still one entry after a reload");
      console.log("✓ I'm in from Challenges enrolls Maya once and brings her back to the tab: You're in ✓");
    } else {
      must((await page.getByTestId("challenge-join").count()) === 0, "joining has closed, so no I'm in");
      console.log("✓ joining has closed: no I'm in on the card");
    }

    // A level outside the Arena: the card, no button.
    await clear();
    await db.update(schema.memberships).set({ programTier: "Starter" }).where(eq(schema.memberships.id, mm.id));
    await page.goto(`${base}${TAB}`);
    await page.getByTestId("challenge-card").waitFor({ timeout: 20000 });
    must((await page.getByTestId("challenge-join").count()) === 0, "no I'm in for a level outside the Arena");
    console.log("✓ a member at a level outside the Arena sees the card with no button");

    // The coach: the card and the Arena page, never a join of their own.
    await login(page, "As the coach");
    await page.goto(`${base}${TAB}`);
    await page.getByTestId("challenge-card").waitFor({ timeout: 20000 });
    must((await page.getByTestId("challenge-join").count()) === 0, "the coach has no I'm in");
    must((await page.getByTestId("challenge-arena").getAttribute("href")) === "/arena", "the coach has the Arena page link");
    console.log("✓ the coach sees the card and the Arena page link, with no join");
    console.log("\nchallenges walk passed");
  } finally {
    await browser.close();
    await clear();
    await db.update(schema.memberships).set({ programTier: tierBefore }).where(eq(schema.memberships.id, mm.id));
    await db.update(schema.workspaces).set({ colosseumOn: ws.colosseumOn }).where(eq(schema.workspaces.id, W));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
