/**
 * The phone menu's counts (H-844, plan H-858): at 390 px, a coach with an unread agent message sees the Inbox count on More,
 * the same number the sidebar works out (inboxCount); the More tab in the bottom bar shows the total of every count on the
 * page as a number, named "More, N waiting"; once the message is gone the count drops with it; nothing scrolls sideways.
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
async function open(page: Page, url: string, selector: string) {
  for (let i = 0; i < 3; i++) {
    await page.goto(url);
    if (await page.locator(selector).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error(`${selector} never showed on ${url}`);
}
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const INBOX_BADGE = 'main a[href="/coach/inbox"] [data-testid="due-badge"]';
const TAB_COUNT = '[data-testid="bottom-nav"] [data-testid="more-due-count"]';

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const { inboxCount } = await import("@/lib/handoff");
  const { DANNO } = await import("@/lib/engine/handoff");
  const { newId } = await import("@/lib/ids");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const coachM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const o = { workspaceId: coachM.workspaceId, userId: coach.id };
  const mine = and(eq(schema.handoffMessages.workspaceId, o.workspaceId), eq(schema.handoffMessages.userId, o.userId));

  // One unread agent message for the coach: a report from one of their agents, delivered to them and not yet read.
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId)), columns: { id: true } });
  const [top] = await db.select({ max: sql<number>`coalesce(max(${schema.handoffMessages.seq}), 0)` }).from(schema.handoffMessages).where(mine);
  const messageId = newId();
  await db.insert(schema.handoffMessages).values({ id: messageId, ...o, seq: Number(top?.max ?? 0) + 1, fromAgentId: agent?.id ?? null, toIds: [DANNO], kind: "report", title: "Walk: the phone menu's counts", threadId: messageId });
  await db.insert(schema.handoffDeliveries).values({ id: newId(), messageId, recipient: DANNO });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const n = await inboxCount(o);
    must(n >= 1, `the coach's inbox counts the unread message (${n})`);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, "As the coach");
    await open(page, `${base}/more`, INBOX_BADGE);
    must((await page.locator(INBOX_BADGE).first().innerText()).trim() === String(n), `More's Inbox row shows the inbox's count (${n})`);

    // The More tab: the total of every count on the page, as a number (9+ past nine), with its count in its name.
    const shown = (await page.locator('main [data-testid="due-badge"]').allInnerTexts()).reduce((a, t) => a + Number(t.trim()), 0);
    const tab = page.locator(TAB_COUNT);
    await tab.waitFor({ timeout: 20000 });
    must(Number(await tab.getAttribute("data-count")) === shown, `the More tab's total is every count on More added up (${shown})`);
    must((await tab.innerText()).trim() === (shown > 9 ? "9+" : String(shown)), `the More tab shows ${shown > 9 ? "9+" : shown}`);
    must((await page.locator('[data-testid="bottom-nav"] a[href="/more"]').getAttribute("aria-label")) === `More, ${shown} waiting`, "the More tab is named with its count");
    must(!(await page.locator('[data-testid="bottom-nav"] [data-testid="more-due-dot"]').count()), "a number, not the plain dot, while counts wait");
    must(await noSideways(page), "More doesn't scroll sideways at 390 px");

    // Once the message is gone, its count goes with it.
    await db.delete(schema.handoffDeliveries).where(eq(schema.handoffDeliveries.messageId, messageId));
    await db.delete(schema.handoffMessages).where(eq(schema.handoffMessages.id, messageId));
    const after = await inboxCount(o);
    await open(page, `${base}/more`, 'main a[href="/coach/inbox"]');
    const badge = page.locator(INBOX_BADGE);
    must(after > 0 ? (await badge.innerText()).trim() === String(after) : !(await badge.count()), `the Inbox count drops with the message (${after})`);
    await ctx.close();
    console.log(`✓ 390 px: More's Inbox row shows ${n}, the More tab shows the total (${shown}) named "More, ${shown} waiting", and the count drops once the message is gone; no sideways scroll`);
  } finally {
    await db.delete(schema.handoffDeliveries).where(eq(schema.handoffDeliveries.messageId, messageId));
    await db.delete(schema.handoffMessages).where(eq(schema.handoffMessages.id, messageId));
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
