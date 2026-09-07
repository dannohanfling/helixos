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
  const startPoints = await totalPoints(ws, maya.id);

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
    const funnel = await row(page, "1-on-1 Funnel Makeover Call").locator('[data-testid="reward-status"]').innerText();
    if (!/Opening soon/.test(funnel)) throw new Error(`reward without a link should read "Opening soon", got "${funnel}"`);
    const chatbot = await row(page, "Custom Chatbot Strategy Blueprint").locator('[data-testid="reward-status"]').innerText();
    if (!/not live yet/.test(chatbot)) throw new Error(`behaviour-trigger reward should be marked not live, got "${chatbot}"`);
    const forms = await page.locator('[data-testid="claim-form"]').count();
    if (forms !== 3) throw new Error(`only the 3 linked, affordable items should have a Claim button; saw ${forms}`);
    if (/your coach will follow up/i.test(await page.locator("main").innerText())) throw new Error("the old 'coach will follow up' promise is still on the page");
    await page.screenshot({ path: "screenshots/rw01-catalogue.png", fullPage: true });
    console.log(`✓ catalogue: ${rewardCount} rewards + ${prizeCount} prizes, unlinked items are "Opening soon", ${forms} claimable`);

    // A claim is an instant unlock: points off, that reward's booking link revealed, and following it is recorded
    const alignment = row(page, "Offer + Messaging Alignment Session");
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

    // Coach sees claims read-only, with the only booking signal we have
    await login(page, "coach");
    await page.goto(`${base}/coach`);
    const claims = page.locator('[data-testid="claims-list"]');
    await claims.waitFor();
    const text = await claims.innerText();
    if (!/Maya[\s\S]*Offer \+ Messaging Alignment Session[\s\S]*opened the booking link/.test(text)) throw new Error(`coach view missing the booked claim:\n${text}`);
    if (!/Onboarding Champion[\s\S]*hasn't opened the booking link yet/.test(text)) throw new Error(`coach view missing the unbooked prize claim:\n${text}`);
    if ((await page.locator('[data-testid="claim-row"]').count()) < 7) throw new Error("coach view should list every claim in the workspace");
    if (await claims.locator("button, form").count()) throw new Error("the claims view must be read-only");
    await page.screenshot({ path: "screenshots/rw03-coach-claims.png", fullPage: true });
    console.log("✓ coach: claims listed read-only with booking status");
  } finally {
    await browser.close();
    rmSync(overridePath, { force: true });
  }
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
