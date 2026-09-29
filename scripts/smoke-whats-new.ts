/**
 * What's new and the version (rev 193):
 *  1. The version line in the menu and on Settings is "HelixOS <date> · <commit>", the commit a real one in this repository.
 *  2. A member who hasn't opened What's new sees the menu's dot (and on the phone's More page); the page shows everyone's
 *     entries and no coach entry; opening it clears the dot, for good.
 *  3. A coach sees the coach entries too; with only coach entries unseen, the dot is theirs alone.
 */
import { execSync } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { WHATS_NEW } = await import("@/content/whats-new");
  const { newestSeenable, visibleEntries } = await import("@/lib/engine/whats-new");

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    await db.update(schema.memberships).set({ whatsNewSeen: null }).where(eq(schema.memberships.userId, maya.id));
    // The coach last opened the page two entries ago: one coach entry and one everyone entry are new to them.
    const coachSeen = newestSeenable(WHATS_NEW, "coach") - 2;
    const coachNew = WHATS_NEW.filter((e) => e.n > coachSeen).map((e) => e.n).sort();
    if (!WHATS_NEW.some((e) => e.n > coachSeen && e.audience === "coach")) throw new Error("the walk needs a coach entry among the newest two");
    await db.update(schema.memberships).set({ whatsNewSeen: coachSeen }).where(eq(schema.memberships.userId, coach.id));

    const context = await browser.newContext({ viewport: { width: 1300, height: 950 } });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));

    // ── 1. The version. ──
    await login(page, "As a client");
    const version = (await page.locator('aside [data-testid="app-version"]').innerText()).trim();
    const m = /^HelixOS (\d{4})\.(\d{2})\.(\d{2}) · ([0-9a-f]{7})$/.exec(version);
    if (!m) throw new Error(`the menu shows "HelixOS <date> · <commit>": ${version}`);
    execSync(`git cat-file -e ${m[4]}^{commit}`);
    if ((await page.locator('aside [data-testid="app-version"]').getAttribute("href")) !== "/whats-new") throw new Error("the version line opens What's new");
    await page.goto(`${base}/settings`);
    if ((await page.locator('[data-testid="settings-version"]').innerText()).trim() !== version) throw new Error("Settings shows the same version at the bottom");
    console.log(`✓ the version in the menu and on Settings: ${version}, a real commit of this repository`);

    // ── 2. A member: the dot, the page without coach entries, and the dot gone after opening it. ──
    await page.goto(`${base}/today`);
    await page.locator('aside [data-testid="whats-new-dot"]').waitFor({ timeout: 15000 });
    await page.goto(`${base}/whats-new`);
    const entries = page.locator('[data-testid="whats-new-entry"]');
    await entries.first().waitFor({ timeout: 15000 });
    const shown = await entries.count();
    if (shown !== visibleEntries(WHATS_NEW, "client").length || (await page.locator('[data-testid="whats-new-entry"][data-audience="coach"]').count())) throw new Error(`a member sees every everyone-entry and no coach entry (${shown} shown)`);
    if ((await page.locator('[data-testid="whats-new-entry"][data-new="1"]').count()) !== shown) throw new Error("never opened before: every entry is marked New");
    await page.locator('aside [data-testid="whats-new-dot"]').waitFor({ state: "detached", timeout: 15000 });
    const seen = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!.whatsNewSeen;
    if (seen !== newestSeenable(WHATS_NEW, "client")) throw new Error(`opening the page marks the newest entry seen (${seen})`);
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="app-version"]').first().waitFor({ timeout: 15000 });
    if (await page.locator('[data-testid="whats-new-dot"]').count()) throw new Error("the dot stays gone after a visit");
    console.log(`✓ a member: the dot until they open What's new; ${shown} entries, none for coaches; the dot gone after`);

    // On a phone, the dot is on the More page's What's new row.
    await db.update(schema.memberships).set({ whatsNewSeen: 1 }).where(eq(schema.memberships.userId, maya.id));
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pp = await phone.newPage();
    await login(pp, "As a client");
    await pp.goto(`${base}/more`);
    await pp.locator('main [data-testid="whats-new-dot"]').waitFor({ timeout: 15000 });
    if (!(await pp.locator('[data-testid="more-due-dot"]').count())) throw new Error("the phone's More tab shows a dot while What's new has something unseen");
    if (await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("the More page scrolls sideways on a phone");
    await pp.goto(`${base}/whats-new`);
    await pp.locator('[data-testid="whats-new-entry"]').first().waitFor({ timeout: 15000 });
    if (await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("What's new scrolls sideways on a phone");
    await phone.close();
    console.log("✓ on a phone: the dot on More's What's new row and the More tab; What's new fits the width");

    // ── 3. The coach: coach entries shown, and a dot of their own. ──
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await login(page, "As the coach");
    await page.locator('aside [data-testid="whats-new-dot"]').waitFor({ timeout: 15000 });
    await page.goto(`${base}/whats-new`);
    await page.locator('[data-testid="whats-new-entry"]').first().waitFor({ timeout: 15000 });
    const coachEntries = await page.locator('[data-testid="whats-new-entry"][data-audience="coach"]').count();
    const shownNew = (await page.locator('[data-testid="whats-new-entry"][data-new="1"]').evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-n"))))).sort();
    if (!coachEntries || JSON.stringify(shownNew) !== JSON.stringify(coachNew)) throw new Error(`a coach sees the coach entries, and only those since their last visit are New (${shownNew} vs ${coachNew})`);
    await page.locator('aside [data-testid="whats-new-dot"]').waitFor({ state: "detached", timeout: 15000 });
    console.log(`✓ the coach: ${coachEntries} coach entries shown, New only on those since their last visit, and the dot gone after opening the page`);

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("What's new smoke passed");
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
