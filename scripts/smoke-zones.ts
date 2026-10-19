/**
 * Every date in the member's own zone (H-457, PR 2). Maya has no zone of her own and opens HelixOS in a browser in Sydney:
 * her zone is saved as Australia/Sydney, and the one-time line says "We're showing times in Australia/Sydney (AEDT). Change
 * it in Settings." A post that went out at 7:32 PM UTC on 12 Oct shows as Oct 13 on Content. Got it puts the line away for
 * good. On Settings the zone is a searchable list of every zone; she picks Europe/London and the post reads Oct 12; a typo
 * keeps London. At 390, nothing scrolls sideways. Her own zone and seen stamp are put back after.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
const noSideways = async (page: Page, where: string) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  must(over <= 1, `${where}: nothing scrolls sideways at this width (${over}px over)`);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const before = { timezone: mm.timezone, tzPromptSeenAt: mm.tzPromptSeenAt, welcomeShownOn: mm.welcomeShownOn };
  const member = async () => (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!;
  const postId = newId();
  const title = `Walk zone post ${postId.slice(0, 6)}`;
  await db.insert(schema.contentItems).values({ id: postId, workspaceId: mm.workspaceId, userId: maya.id, title, status: "posted", postedAt: "2026-10-12T19:32:00.000Z" });
  // A member who never had a zone, and no daily welcome in the way of the line.
  await db.update(schema.memberships).set({ timezone: null, tzPromptSeenAt: null, welcomeShownOn: "9999-12-31" }).where(eq(schema.memberships.id, mm.id));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, timezoneId: "Australia/Sydney" });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const horizon = page.locator('[data-testid="horizon-notice-dismiss"]');
    if (await horizon.isVisible().catch(() => false)) await horizon.click();
    await page.goto(`${base}/content`);
    const line = page.locator('[data-testid="zone-notice"]');
    await line.waitFor({ timeout: 20000 });
    let saved: string | null = null;
    for (let i = 0; i < 40 && !saved; i++) {
      saved = (await member()).timezone;
      if (!saved) await page.waitForTimeout(250);
    }
    must(saved === "Australia/Sydney", `the browser's zone is saved for a member who had none: ${saved}`);
    await page.goto(`${base}/content`);
    await line.waitFor({ timeout: 20000 });
    must((await line.getAttribute("data-zone")) === "Australia/Sydney", "the line names her zone");
    const words = await line.innerText();
    must(words.includes("We're showing times in Australia/Sydney (AEDT). Change it in Settings."), `the line says the zone and where to change it: ${words}`);
    const row = page.locator("tr", { hasText: title });
    await row.waitFor({ timeout: 20000 });
    must((await row.innerText()).includes("Oct 13"), `a post at 7:32 PM UTC on 12 Oct is the 13th in Sydney: ${await row.innerText()}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/today`);
    await line.waitFor({ timeout: 20000 });
    await noSideways(page, "Today with the line");
    await page.setViewportSize({ width: 1440, height: 950 });

    await page.locator('[data-testid="zone-notice-dismiss"]').click();
    await page.waitForTimeout(800);
    must(!(await line.isVisible().catch(() => false)), "Got it puts the line away");
    must(Boolean((await member()).tzPromptSeenAt), "and stamps it seen");
    await page.goto(`${base}/today`);
    await page.waitForTimeout(600);
    must((await line.count()) === 0, "it never comes back");

    await page.goto(`${base}/settings`);
    const picker = page.locator('[data-testid="zone-picker"]');
    await picker.waitFor({ timeout: 20000 });
    must((await picker.inputValue()) === "Australia/Sydney", "Settings shows her zone");
    const options = await page.locator("#zone-list option").count();
    must(options > 300, `the list holds every zone (${options})`);
    await picker.fill("europe/london");
    await submit(page, 'form:has([data-testid="zone-picker"]) button[type="submit"]');
    must((await member()).timezone === "Europe/London", `a typed zone is saved as the zone database writes it: ${(await member()).timezone}`);
    await page.goto(`${base}/settings`);
    await picker.waitFor({ timeout: 20000 });
    await picker.fill("Mars/Olympus_Mons");
    await submit(page, 'form:has([data-testid="zone-picker"]) button[type="submit"]');
    must((await member()).timezone === "Europe/London", "a typo keeps the zone she had");
    await page.goto(`${base}/content`);
    await row.waitFor({ timeout: 20000 });
    must((await row.innerText()).includes("Oct 12"), `in London the same post is the 12th: ${await row.innerText()}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/settings`);
    await picker.waitFor({ timeout: 20000 });
    await noSideways(page, "Settings");
    await page.goto(`${base}/content`);
    await page.waitForTimeout(400);
    await noSideways(page, "Content");
    must(!failures.length, `no server errors: ${failures.join(", ")}`);
  } finally {
    await browser.close();
    await db.update(schema.memberships).set(before).where(eq(schema.memberships.id, mm.id));
    await db.delete(schema.contentItems).where(eq(schema.contentItems.id, postId));
  }
  console.log("Zones smoke passed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
