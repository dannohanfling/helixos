/**
 * The agent inbox and The Forum, one tap apart (H-719, plan H-726): the coach's inbox links to The Forum and The Forum back to
 * the inbox, with the menu's new count as a badge; a member's Forum opens their own agent inbox (H-727); both
 * buttons are full 44 px targets and nothing scrolls sideways at 390 px.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  // At phone width the sidebar's Log out is hidden, so take whichever Log out is on screen.
  await page.locator('button:has-text("Log out"):visible').first().click();
  await page.waitForURL(/\/login/);
}
async function open(page: Page, url: string, testid: string) {
  for (let i = 0; i < 3; i++) {
    await page.goto(url);
    if (await page.locator(`[data-testid="${testid}"]`).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error(`${testid} never showed on ${url}`);
}
const height = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { inboxCount } = await import("@/lib/handoff");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const coachM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 950 : 844 } });
      const page = await ctx.newPage();
      await login(page, "As the coach");
      await open(page, `${base}/coach/inbox`, "inbox-to-forum");
      must((await height(page, '[data-testid="inbox-to-forum"]')) >= 44, `the inbox's Forum button is a 44 px target at ${width}`);
      must(await noSideways(page), `the inbox doesn't scroll sideways at ${width}`);
      await page.locator('[data-testid="inbox-to-forum"]').click();
      await page.waitForURL(/\/forum$/);
      await page.locator('[data-testid="forum-to-inbox"]').waitFor({ timeout: 20000 });
      must((await height(page, '[data-testid="forum-to-inbox"]')) >= 44, `the Forum's inbox button is a 44 px target at ${width}`);
      must(await noSideways(page), `The Forum doesn't scroll sideways at ${width}`);
      const n = await inboxCount({ workspaceId: coachM.workspaceId, userId: coach.id });
      const badge = page.locator('[data-testid="forum-inbox-badge"]');
      must(n > 0 ? (await badge.innerText()).trim() === String(n) : !(await badge.count()), `the badge shows the inbox's count (${n})`);
      await page.locator('[data-testid="forum-to-inbox"]').click();
      await page.waitForURL(/\/coach\/inbox$/);
      await logout(page);

      // Every member has their own agent inbox since H-727: their Forum's button opens it, and it links back to their Forum.
      await login(page, "As a client");
      await open(page, `${base}/forum`, "forum-to-inbox");
      must((await page.locator('[data-testid="forum-to-inbox"]').first().getAttribute("href")) === "/forum/inbox", `a member's Forum button opens their own agent inbox at ${width}`);
      must((await height(page, '[data-testid="forum-to-inbox"]')) >= 44, `the member's inbox button is a 44 px target at ${width}`);
      await page.locator('[data-testid="forum-to-inbox"]').click();
      await page.waitForURL(/\/forum\/inbox$/);
      await page.locator('[data-testid="inbox-to-forum"]').waitFor({ timeout: 20000 });
      must((await page.locator('[data-testid="inbox-to-forum"]').first().getAttribute("href")) === "/forum", `the member's agent inbox links back to their Forum at ${width}`);
      must(await noSideways(page), `the member's agent inbox doesn't scroll sideways at ${width}`);
      await logout(page);
      await ctx.close();
      console.log(`✓ ${width}: the inbox and The Forum link both ways for the coach, 44 px, the badge counts, no sideways scroll; a member's Forum and agent inbox link both ways too`);
    }
  } finally {
    await browser.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
