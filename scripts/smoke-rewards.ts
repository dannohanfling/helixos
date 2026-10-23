/**
 * Earn Your Way, batch 1: a claim is an instant unlock with a booking link, never a request that evaporates. Every reward is
 * visible; nothing without a link is claimable; the caps count the whole workspace and say when they reopen; the server,
 * not the page, is the boundary; the coach sees claims read-only. Runs against the dev server, which reads the booking
 * links from REWARDS_CONFIG_OVERRIDE (development only) so this walk can hand three items a link.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const overridePath = process.env.REWARDS_CONFIG_OVERRIDE ?? "screenshots/logs/rewards-config.override.json";
mkdirSync("screenshots/logs", { recursive: true });

const LINKS = { "Offer + Messaging Alignment Session": "https://booking.example.test/alignment", "VIP Laser Coaching Call": "https://booking.example.test/vip", "Onboarding Champion": "https://booking.example.test/champion" };

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // The app says when it is still loading a page; wait for that to clear before judging what is on it.
  // Every outline, not one: while React's short reveal queue runs, the outline shown and one inside the content about to be
  // revealed are both in the page, and a single-element wait throws at once on two (read as "still showing").
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-testid="page-loading"]')].every((e) => !e.checkVisibility()), undefined, { timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
async function login(page: Page, who: "client" | "coach") {
  await page.goto(`${base}/settings`).catch(() => null);
  if (await page.locator('button:has-text("Log out")').count()) {
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
  } else await page.goto(`${base}/login`);
  await page.click(who === "client" ? 'button:has-text("As a client")' : 'button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}
const row = (page: Page, name: string) => page.locator(`[data-testid="catalogue-item"][data-reward="${name}"]`);

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { totalPoints } = await import("@/lib/queries/points");
  const { periodWindow, reopenText } = await import("@/lib/engine/rewards");
  const { nowIso, todayInTz } = await import("@/lib/dates");
  const today = todayInTz("America/Los_Angeles");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
  const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!.workspaceId;

  writeFileSync(overridePath, JSON.stringify({ perMonth: "calendar", bookingLinks: LINKS }, null, 2));
  // Maya needs to be Sage with 1,250+ to spend; the seed varies, so top her up.
  await db.insert(schema.pointsLedger).values({ id: crypto.randomUUID(), workspaceId: ws, userId: maya.id, type: "bonus", points: 2000, reason: "Smoke: top-up" });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await login(page, "client");
    await page.goto(`${base}/rewards`);

    // The whole ladder is visible, locked rungs included, and only linked items can be claimed
    const rewardCount = await page.locator('[data-testid="reward-list"] [data-testid="catalogue-item"]').count();
    const prizeCount = await page.locator('[data-testid="prize-list"] [data-testid="catalogue-item"]').count();
    if (rewardCount !== 12 || prizeCount !== 4) throw new Error(`expected 12 rewards and 4 prizes, saw ${rewardCount} and ${prizeCount}`);
    await expectText(page, "Evolve Omega Lux Partnership Conversation", "top of the ladder visible");
    // No link: the demo client has met Sage and 1,500 points for the Funnel Makeover, so it says so; Lux (Olympian) reads Opening soon
    const funnel = await row(page, "1-on-1 Funnel Makeover Call").locator('[data-testid="reward-status"]').innerText();
    if (!/You've earned this\. It opens soon\./.test(funnel)) throw new Error(`an earned reward without a link says it was earned, got "${funnel}"`);
    if (await row(page, "1-on-1 Funnel Makeover Call").locator('[data-testid="claim-form"]').count()) throw new Error("no Claim button without a link, earned or not");
    const lux = await row(page, "Evolve Omega Lux Partnership Conversation").locator('[data-testid="reward-status"]').innerText();
    if (!/Opening soon/.test(lux)) throw new Error(`an unearned reward without a link reads "Opening soon", got "${lux}"`);
    await expectText(page, "Some rungs aren't open yet", "the page says some of the ladder is not open");
    const chatbot = await row(page, "Custom Chatbot Strategy Blueprint").locator('[data-testid="reward-status"]').innerText();
    if (!/not live yet/.test(chatbot)) throw new Error(`behaviour-trigger reward should be marked not live, got "${chatbot}"`);
    // The two 30-day access rewards are claimable with no link once the tier is met (H-1596 A); the seed's points vary, so count them in.
    const { TIERS, rankOf } = await import("@/lib/engine/tiers");
    const mayaRow = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const levelOf = (name: string) => TIERS.find((t) => t.name === name)!.level;
    const mayaLevel = rankOf(mayaRow, await totalPoints(ws, maya.id)).level;
    const accessOpen = (mayaLevel >= levelOf("Sentinel") ? 1 : 0) + (mayaLevel >= levelOf("Centurion") ? 1 : 0);
    const forms = await page.locator('[data-testid="claim-form"]').count();
    if (forms !== 3 + accessOpen) throw new Error(`only the 3 linked, affordable items (and ${accessOpen} access rewards) should have a Claim button; saw ${forms}`);
    if (/your coach will follow up/i.test(await page.locator("main").innerText())) throw new Error("the old 'coach will follow up' promise is still on the page");
    await page.screenshot({ path: "screenshots/rw01-catalogue.png", fullPage: true });
    console.log(`✓ catalogue: ${rewardCount} rewards + ${prizeCount} prizes, unlinked items are "Opening soon" (access rewards aside), ${forms} claimable`);

    // A claim is an instant unlock: points off, that reward's booking link revealed, and following it is recorded
    const alignment = row(page, "Offer + Messaging Alignment Session");
    // Read after the page has loaded (H-746): a visit on a Saturday or Sunday credits "Weekend streak +40" on its way in, and
    // that must not be counted as part of the claim.
    const startPoints = await totalPoints(ws, maya.id);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), alignment.locator('button:has-text("Claim for 500")').click()]);
    await expectText(page, "the slot is yours to book", "claim granted");
    const bookHref = await alignment.locator('[data-testid="book-link"]').getAttribute("href");
    if (!bookHref?.startsWith("/rewards/book/")) throw new Error(`booking link missing after claim: ${bookHref}`);
    const afterClaim = await totalPoints(ws, maya.id);
    if (startPoints - afterClaim !== 500) throw new Error(`claim should cost exactly 500, cost ${startPoints - afterClaim}`);
    const hop = await context.request.get(`${base}${bookHref}`, { maxRedirects: 0 });
    if (hop.status() !== 303 || hop.headers()["location"] !== LINKS["Offer + Messaging Alignment Session"]) throw new Error(`booking hop should 303 to the reward's own link, got ${hop.status()} → ${hop.headers()["location"]}`);
    const claimRow = await db.query.rewardClaims.findFirst({ where: and(eq(schema.rewardClaims.userId, maya.id), eq(schema.rewardClaims.rewardName, "Offer + Messaging Alignment Session")) });
    if (!claimRow?.bookingOpenedAt) throw new Error("following the booking link was not recorded");
    console.log("✓ claim: 500 points off, booking link revealed, hop recorded and sent to the reward's own URL");

    // The server is the boundary: a page that still shows Claim can't get past a cap that filled meanwhile
    const vip = row(page, "VIP Laser Coaching Call");
    if (!(await vip.locator('button:has-text("Claim for 750")').count())) throw new Error("VIP should be claimable before the cap fills");
    for (let i = 0; i < 5; i++) await db.insert(schema.rewardClaims).values({ id: crypto.randomUUID(), workspaceId: ws, userId: jordan.id, rewardName: "VIP Laser Coaching Call", pointsSpent: 750, createdAt: nowIso() });
    const reopens = reopenText(periodWindow("Per Month", today, "calendar")!.reopens!);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), vip.locator('button:has-text("Claim for 750")').click()]);
    await expectText(page, `All 5 taken this month. Opens again ${reopens}.`, "cap refused with reopen date");
    if ((await totalPoints(ws, maya.id)) !== afterClaim) throw new Error("a refused claim moved points");
    await page.reload();
    const vipStatus = await row(page, "VIP Laser Coaching Call").locator('[data-testid="reward-status"]').innerText();
    if (!vipStatus.includes(`Opens again ${reopens}`)) throw new Error(`cap status not shown on reload: "${vipStatus}"`);
    await page.screenshot({ path: "screenshots/rw02-cap.png", fullPage: true });
    console.log(`✓ cap: stale Claim refused server-side ("All 5 taken this month. Opens again ${reopens}."), no points moved`);

    // A prize is a milestone: same guard and link, nothing spent
    const champion = row(page, "Onboarding Champion");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), champion.locator('button:has-text("Claim")').click()]);
    await champion.locator('[data-testid="book-link"]').waitFor({ timeout: 15000 });
    if (!(await champion.locator('[data-testid="book-link"]').count())) throw new Error("prize claim did not reveal its link");
    if ((await totalPoints(ws, maya.id)) !== afterClaim) throw new Error("a prize claim deducted points");
    console.log("✓ prize: claimed at the threshold, link revealed, no points spent");

    // Coach sees every open claim with its booking signal, and closes one once it's delivered
    await login(page, "coach");
    await page.goto(`${base}/coach?connections=open`);
    const claims = page.locator('[data-testid="claims-list"]');
    await claims.waitFor();
    const text = await claims.innerText();
    if (!/Maya[\s\S]*Offer \+ Messaging Alignment Session[\s\S]*opened the booking link/.test(text)) throw new Error(`coach view missing the booked claim:\n${text}`);
    if (!/Onboarding Champion[\s\S]*hasn't opened the booking link yet/.test(text)) throw new Error(`coach view missing the unbooked prize claim:\n${text}`);
    const openRows = await db.query.rewardClaims.findMany({ where: and(eq(schema.rewardClaims.workspaceId, ws), eq(schema.rewardClaims.status, "requested")) });
    if (openRows.length < 7 || (await page.locator('[data-testid="claim-row"]').count()) !== openRows.length) throw new Error(`coach view should list every open claim in the workspace (${openRows.length})`);
    await page.screenshot({ path: "screenshots/rw03-coach-claims.png", fullPage: true });
    console.log("✓ coach: every open claim listed with its booking status");

    // Mark done: off the Open list, onto Done with Reopen; the counts on the card, the Coach menu item and Today drop by one
    const before = openRows.length;
    const counted = async () => {
      await page.goto(`${base}/today`);
      const notice = (await page.locator('[data-testid="coach-new-claims"]').innerText().catch(() => "")).trim();
      return { notice, nav: (await page.locator('nav a[href="/coach"]').first().innerText()).replace(/\D+/g, " ").trim() };
    };
    let shown = await counted();
    if (!shown.notice.startsWith(`${before} reward claims to deliver`) || !shown.nav.split(" ").includes(String(before))) throw new Error(`Today and the Coach item should count ${before} open claims: ${JSON.stringify(shown)}`);
    await page.goto(`${base}/coach?claims=open#claims`);
    const offer = page.locator('[data-testid="claim-row"]').filter({ hasText: "Offer + Messaging Alignment Session" }).filter({ hasText: "Maya" });
    if ((await offer.count()) !== 1) throw new Error("Maya's session claim should be one open row");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), offer.locator('[data-testid="claim-done"]').click()]);
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="claim-row"]').nth(before - 2).waitFor();
    if ((await page.locator('[data-testid="claim-row"]').count()) !== before - 1) throw new Error("a claim marked done should leave the Open list");
    if (!(await page.getByText(`Claimed rewards · ${before - 1} open`).count())) throw new Error("the card's open count should drop by one");
    const done = await db.query.rewardClaims.findFirst({ where: eq(schema.rewardClaims.id, claimRow.id) });
    if (done?.status !== "fulfilled") throw new Error("Mark done should set the claim fulfilled");
    await page.click('[data-testid="claims-done"]');
    await page.waitForURL(/claims=done/);
    const doneRows = page.locator('[data-testid="claim-row"]');
    if ((await doneRows.count()) !== 1 || !(await doneRows.first().locator('[data-testid="claim-reopen"]').count())) throw new Error("the Done list should hold the one claim, with Reopen");
    shown = await counted();
    if (!shown.notice.startsWith(`${before - 1} reward claim`) || !shown.nav.split(" ").includes(String(before - 1))) throw new Error(`Today and the Coach item should now count ${before - 1}: ${JSON.stringify(shown)}`);
    console.log(`✓ coach: Mark done moves a claim to Done (Reopen there); the card, the Coach item and Today count ${before - 1} open`);

    // The client sees Done on Rewards, with the booking link and its nudge gone
    await login(page, "client");
    await page.goto(`${base}/rewards`);
    const mine = row(page, "Offer + Messaging Alignment Session");
    if (!(await mine.locator('[data-testid="claim-done-badge"]').count()) || (await mine.locator('[data-testid="book-link"]').count())) throw new Error("a claim marked done should say Done on Rewards, with no booking link");
    console.log("✓ client: the delivered claim says Done on Rewards");

    // H-1586 / H-1596 A: a Sentinel client claims 30 Days Access to Academy with no link. The row says the coach
    // acts next, never "booking link"; Coach says it's delivered by hand and flags it once it has waited a day; Mark done turns it Done.
    const ACADEMY = "30 Days Access to Evolve Omega Academy";
    const sentinelAt = TIERS.find((t) => t.name === "Sentinel")!.minPoints;
    const short = sentinelAt - (await totalPoints(ws, maya.id));
    if (short > 0) await db.insert(schema.pointsLedger).values({ id: crypto.randomUUID(), workspaceId: ws, userId: maya.id, type: "bonus", points: short + 100, reason: "Smoke: to Sentinel" });
    await page.goto(`${base}/rewards`);
    const academy = row(page, ACADEMY);
    if (!(await academy.locator('[data-testid="claim-form"]').count())) throw new Error("a Sentinel client should see Claim on the Academy access reward, link or not");
    const beforeAcademy = await totalPoints(ws, maya.id);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), academy.locator('button:has-text("Claim")').click()]);
    // A grant re-renders the row (the action's ok words are not shown), so the row is what the client reads.
    await academy.locator('[data-testid="claim-waiting"]').waitFor({ timeout: 15000 });
    if (/booking link/i.test(await academy.innerText())) throw new Error("a claim with no link must not mention a booking link");
    const line = await academy.locator('[data-testid="claim-waiting-line"]').innerText();
    if (!/opens your 30 days/.test(line) || (await academy.locator('[data-testid="book-link"]').count())) throw new Error(`the access claim should wait on the coach, with no booking link: "${line}"`);
    if ((await totalPoints(ws, maya.id)) !== beforeAcademy) throw new Error("the access reward costs no points");
    await page.screenshot({ path: "screenshots/rw04-access-claim.png", fullPage: true });
    console.log("✓ access: a Sentinel client claims Academy with no link; the row says the coach opens it, no points move");

    const academyClaim = (await db.query.rewardClaims.findFirst({ where: and(eq(schema.rewardClaims.userId, maya.id), eq(schema.rewardClaims.rewardName, ACADEMY)) }))!;
    await login(page, "coach");
    await page.goto(`${base}/coach?claims=open#claims`);
    const academyRow = page.locator('[data-testid="claim-row"]').filter({ hasText: ACADEMY }).filter({ hasText: "Maya" });
    if (!/you deliver this by hand/.test(await academyRow.innerText())) throw new Error("Coach should say the access claim is delivered by hand");
    if (await page.locator('[data-testid="claims-overdue"]').count()) throw new Error("a fresh claim should not be flagged as waiting over a day");
    await db.update(schema.rewardClaims).set({ createdAt: new Date(Date.now() - 2 * 86400_000).toISOString() }).where(eq(schema.rewardClaims.id, academyClaim.id));
    await page.reload();
    const overdue = await page.locator('[data-testid="claims-overdue"]').innerText();
    if (!/^1 reward claim waiting on you over a day/.test(overdue)) throw new Error(`Coach should flag the day-old claim at the top: "${overdue}"`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="claim-row"]').filter({ hasText: ACADEMY }).locator('[data-testid="claim-done"]').click()]);
    await page.waitForLoadState("networkidle");
    await page.reload();
    if (await page.locator('[data-testid="claims-overdue"]').count()) throw new Error("Mark done should clear the waiting line");
    await login(page, "client");
    await page.goto(`${base}/rewards`);
    if (!(await row(page, ACADEMY).locator('[data-testid="claim-done-badge"]').count())) throw new Error("the access claim marked done should say Done on Rewards");
    console.log("✓ access: Coach says delivered by hand, flags it after a day, Mark done turns the client's row Done");
  } finally {
    await browser.close();
    rmSync(overridePath, { force: true });
  }
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Rewards smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    rmSync(overridePath, { force: true });
    process.exit(1);
  });
