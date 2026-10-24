/**
 * 30 Days in the Arena, PR B (plan H-1563), end to end: Maya (an Elite client) joins and lands in a pod (five to a pod, in
 * join order, with other members already in); the leaderboard on /arena lists everyone in and marks her own row; the coach's
 * /coach/arena shows the pods, names Maya captain and she then sees her pod's days closed and last close; moving her to
 * another pod ends her captaincy; with a Huddle live (a test Huddle starting in ten minutes), "I'm here" checks her in once
 * for 10 points and the coach's Huddles card counts it; nothing scrolls sideways at 390. Everything it adds is removed after.
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
  const { and, eq, inArray, isNull, ne } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { arenaFor } = await import("@/lib/arena");
  const { HUDDLE_POINTS } = await import("@/lib/engine/arena");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, maya.id), eq(schema.memberships.role, "client")) }))!;
  const W = mm.workspaceId;
  const tierBefore = mm.programTier;
  const c = await arenaFor(W);
  const others = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, W), eq(schema.memberships.role, "client"), ne(schema.memberships.id, mm.id), isNull(schema.memberships.removedAt)), limit: 6 });
  const testHuddle = newId();
  const clear = async () => {
    const huddles = await db.query.arenaHuddles.findMany({ where: eq(schema.arenaHuddles.challengeId, c.id), columns: { id: true } });
    const ids = huddles.map((h) => h.id);
    if (ids.length) {
      await db.delete(schema.arenaHuddleCheckins).where(inArray(schema.arenaHuddleCheckins.huddleId, ids));
      await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.workspaceId, W), eq(schema.pointsLedger.type, "huddle"), inArray(schema.pointsLedger.refId, ids.map((id) => `arena-huddle:${id}`))));
    }
    await db.delete(schema.arenaHuddles).where(eq(schema.arenaHuddles.id, testHuddle));
    await db.delete(schema.arenaEntries).where(eq(schema.arenaEntries.challengeId, c.id));
    await db.delete(schema.arenaPods).where(eq(schema.arenaPods.challengeId, c.id));
  };
  await clear();
  await db.update(schema.memberships).set({ programTier: "Elite" }).where(eq(schema.memberships.id, mm.id));
  // Others in first, a day apart and before Maya, so the pods fill in join order around her.
  for (const [i, o] of others.entries()) {
    await db.insert(schema.arenaEntries).values({ id: newId(), workspaceId: W, userId: o.userId, membershipId: o.id, challengeId: c.id, joinedAt: `2026-10-0${i + 1}T12:00:00.000Z` });
  }
  const mine = async () => db.query.arenaEntries.findFirst({ where: and(eq(schema.arenaEntries.challengeId, c.id), eq(schema.arenaEntries.membershipId, mm.id)) });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await login(page, "As a client");
    await page.goto(`${base}/arena`);
    await page.getByTestId("arena-page").waitFor({ timeout: 30000 });
    must((await page.getByTestId("arena-huddle").count()) === 0, "no Huddle check-in before Maya is in");
    if (await page.getByTestId("arena-join").count()) {
      await Promise.all([page.waitForURL(/arena=in/, { timeout: 30000 }), page.locator('[data-testid="arena-join"]:visible').first().click()]);
    } else {
      // After Thu 26 Nov joining is closed: the walk puts Maya in directly.
      await db.insert(schema.arenaEntries).values({ id: newId(), workspaceId: W, userId: maya.id, membershipId: mm.id, challengeId: c.id, joinedAt: new Date().toISOString() });
      await page.goto(`${base}/arena`);
    }
    const entry = await mine();
    must(entry?.podId, "joining puts Maya in a pod");
    const pods = await db.query.arenaPods.findMany({ where: eq(schema.arenaPods.challengeId, c.id) });
    const sizes = await Promise.all(pods.map(async (p) => (await db.query.arenaEntries.findMany({ where: eq(schema.arenaEntries.podId, p.id) })).length));
    must(sizes.every((n) => n <= 5), `no pod has more than five (${sizes.join(", ")})`);
    must(pods.length === Math.ceil((others.length + 1) / 5), `${others.length + 1} members make ${Math.ceil((others.length + 1) / 5)} pods (${pods.length})`);
    console.log(`✓ Maya joins and lands in a pod: ${others.length + 1} in, ${pods.length} pods of ${sizes.join(" and ")}`);

    const board = page.getByTestId("arena-board");
    await board.waitFor({ timeout: 20000 });
    const rows = page.getByTestId("arena-board-row");
    must((await rows.count()) === others.length + 1, `the leaderboard lists everyone in (${await rows.count()})`);
    const you = page.locator('[data-testid="arena-board-row"][data-you="1"]');
    must((await you.count()) === 1 && (await you.innerText()).includes("(you)"), "Maya's own row is marked");
    must(!(await board.innerText()).includes("@"), "no email on the leaderboard");
    must((await page.getByTestId("arena-my-pod").count()) === 1 && !(await page.getByTestId("arena-my-pod").getAttribute("data-captain")), "Maya sees her pod, not as captain");
    await noSideways(page, "/arena with the leaderboard");
    console.log("✓ /arena: the leaderboard lists everyone in with Maya's row marked, and her pod card shows");

    const coach = await (await browser.newContext({ viewport: { width: 1350, height: 940 } })).newPage();
    await login(coach, "As the coach");
    await coach.goto(`${base}/coach/arena`);
    const podCards = coach.getByTestId("coach-arena-pod");
    await podCards.first().waitFor({ timeout: 20000 });
    must((await podCards.count()) === pods.length, "the coach sees every pod");
    const mayaRow = coach.getByTestId("coach-arena-pod-member").filter({ hasText: maya.name });
    await Promise.all([coach.waitForURL(/pods=captain/, { timeout: 30000 }), mayaRow.getByTestId("coach-arena-captain").click()]);
    must((await coach.getByTestId("coach-arena-pod-member").filter({ hasText: maya.name }).getAttribute("data-captain")) === "1", "Maya is marked Captain");
    console.log("✓ the coach sees the pods and names Maya captain");

    await page.goto(`${base}/arena?look=pod#pods`);
    const myPod = page.getByTestId("arena-my-pod");
    await myPod.waitFor({ timeout: 20000 });
    must((await myPod.getAttribute("data-captain")) === "1", "Maya's pod card is the captain's view");
    must((await page.getByTestId("arena-pod-member").count()) >= 1, "the captain sees her pod's members");
    must((await page.getByTestId("arena-pod-member").first().innerText()).match(/days closed/), "with their days closed and last close");
    console.log("✓ as captain, Maya sees her pod's days closed and last close");

    {
      if (pods.length === 1) {
        // A small database fills one pod: the coach adds a second, as they would to split one.
        await Promise.all([coach.waitForURL(/pods=new/, { timeout: 30000 }), coach.getByTestId("coach-arena-newpod").click()]);
        must((await coach.getByTestId("coach-arena-pod").count()) === 2, "New pod adds an empty pod");
      }
      const all = await db.query.arenaPods.findMany({ where: eq(schema.arenaPods.challengeId, c.id) });
      const row = coach.getByTestId("coach-arena-pod-member").filter({ hasText: maya.name });
      const other = all.find((p) => p.id !== entry!.podId)!;
      await row.getByTestId("coach-arena-move-to").selectOption(other.id);
      await Promise.all([coach.waitForURL(/pods=moved/, { timeout: 30000 }), row.getByTestId("coach-arena-move").click()]);
      must((await mine())?.podId === other.id, "Maya is in the other pod");
      const was = await db.query.arenaPods.findFirst({ where: eq(schema.arenaPods.id, entry!.podId!) });
      must(was?.captainMembershipId !== mm.id, "moving her ends her captaincy of the old pod");
      console.log("✓ the coach moves Maya to another pod, and she stops being the old pod's captain");
    }

    // A test Huddle that starts in ten minutes: its check-in is live now.
    await db.insert(schema.arenaHuddles).values({ id: testHuddle, workspaceId: W, challengeId: c.id, startsAt: new Date(Date.now() + 10 * 60_000).toISOString(), label: "Walk test" });
    await page.goto(`${base}/arena?look=huddle#huddles`);
    const here = page.getByTestId("arena-huddle-here");
    await here.waitFor({ timeout: 20000 });
    await Promise.all([page.waitForURL(/huddle=here/, { timeout: 30000 }), here.click()]);
    must((await page.getByTestId("arena-huddle-note").innerText()).includes(`+${HUDDLE_POINTS} points`), "the page says she's checked in, +10 points");
    must((await page.getByTestId("arena-huddle-in").count()) === 1, "the button now reads You're here");
    const ledger = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "huddle"), eq(schema.pointsLedger.refId, `arena-huddle:${testHuddle}`)) });
    must(ledger.length === 1 && ledger[0].points === HUDDLE_POINTS, "one huddle row of 10 points in the ledger");
    const checks = await db.query.arenaHuddleCheckins.findMany({ where: and(eq(schema.arenaHuddleCheckins.huddleId, testHuddle), eq(schema.arenaHuddleCheckins.membershipId, mm.id)) });
    must(checks.length === 1, "one check-in");
    await noSideways(page, "/arena with the Huddle check-in");
    console.log("✓ with a Huddle live, I'm here checks Maya in once for 10 points");

    await coach.goto(`${base}/coach/arena`);
    const hud = coach.getByTestId("coach-arena-huddle").filter({ hasText: "Walk test" });
    await hud.waitFor({ timeout: 20000 });
    must((await hud.innerText()).includes("1 checked in"), "the coach's Huddles card counts her");
    must((await coach.getByTestId("coach-arena-row").filter({ hasText: maya.name }).getByTestId("coach-arena-huddles").innerText()).trim() === "1", "and her row shows 1 Huddle");
    await coach.setViewportSize({ width: 390, height: 844 });
    await noSideways(coach, "/coach/arena");
    console.log("✓ the coach's Huddles card and Maya's row count her check-in; /coach/arena fits at 390");
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
