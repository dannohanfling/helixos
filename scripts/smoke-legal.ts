/**
 * The six public pages, the Account deletions and the folding menu (H-331, H-333, H-347). Signed out: /privacy, /terms,
 * /support, /delete-account, /ai-and-the-board and /community-guidelines answer 200 at 390 and 1440 in both looks, with the
 * page's title, canonical address and index-me robots, every cross link and anchor landing, the header marking the current
 * page, no horizontal scroll, and an axe pass (contrast, headings, link names, landmarks). robots.txt allows exactly these.
 * The sign-in screen says you agree to the Terms and Privacy Policy. Signed in: the footer under every page, Settings → Account
 * with its links, Delete my HumanOS data (only the health tables go, counted first; the wrong email deletes nothing), Delete
 * my account (the member is gone and can't sign in; a coach is told to write in), the sidebar groups folding and remembered
 * across a reload and a device, the current group always open, Collapse all / Expand all, the desktop rail with tooltips and
 * the [ key (never while typing), the phone's More page folding, and nothing wider than the screen at 390, 1024 and 1440.
 * Runs against the dev server; reads and sets fixtures in the database.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEGAL_SLUGS, SITE } from "@/lib/engine/legal";
import { LEGAL_PAGES } from "@/content/legal";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const AXE_RULES = ["color-contrast", "heading-order", "link-name", "page-has-heading-one", "html-has-lang", "landmark-one-main", "button-name", "image-alt"];

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) =>
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
  const noWide = async (page: Page, where: string) => must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${where}: nothing wider than the screen`);
  const login = async (page: Page, who: "client" | "coach") => {
    await page.goto(`${base}/login`);
    await page.click(who === "client" ? 'button:has-text("As a client")' : 'button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
  };
  const loginAs = async (page: Page, email: string, password: string) => {
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('form:has(input[name="password"]) button[type="submit"]');
  };
  const logout = async (page: Page) => {
    await page.goto(`${base}/settings`);
    await page.locator('button:has-text("Log out")').first().click();
    await page.waitForURL(/\/login/);
  };
  const axe = async (page: Page, where: string) => {
    await page.addScriptTag({ content: AXE });
    const bad = (await page.evaluate(
      (rules) => (window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe.run(document, { runOnly: { type: "rule", values: rules } }).then((r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length}: ${v.nodes[0]?.target.join(" ")})`)),
      AXE_RULES,
    )) as string[];
    must(!bad.length, `${where}: axe found ${bad.join("; ")}`);
  };
  let blobProc: ReturnType<typeof spawn> | null = null;
  try {
    // ── Signed out: the six pages in both looks and widths. ──
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await anon.newPage();
    watch(page);
    const backgrounds: Record<string, string> = {};
    for (const [width, scheme] of [
      [1440, "light"],
      [390, "dark"],
    ] as const) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: scheme });
      for (const slug of LEGAL_SLUGS) {
        const res = await page.goto(`${base}/${slug}`, { waitUntil: "networkidle" });
        must(res?.status() === 200, `/${slug} answers 200 signed out (got ${res?.status()})`);
        must((await page.locator(`[data-testid="legal-${slug}"]`).count()) === 1, `/${slug}: the article`);
        must((await page.locator("h1").first().innerText()).trim() === LEGAL_PAGES[slug].title, `/${slug}: the h1 is the page's title`);
        must((await page.locator('link[rel="canonical"]').getAttribute("href")) === `${SITE}/${slug}`, `/${slug}: the canonical address`);
        const robots = (await page.locator('meta[name="robots"]').first().getAttribute("content")) ?? "";
        must(!/noindex/.test(robots) && /index/.test(robots), `/${slug}: search engines may index it (robots: ${robots})`);
        must((await page.locator(`[data-testid="legal-nav"] a[aria-current="page"]`).getAttribute("href")) === `/${slug}`, `/${slug}: the header marks the current page`);
        must((await page.locator(".lg footer.site").count()) === 1, `/${slug}: the page footer`);
        await noWide(page, `/${slug} at ${width}`);
        backgrounds[`${slug}:${scheme}`] = await page.locator(".lg").evaluate((el) => getComputedStyle(el).backgroundColor);
        await axe(page, `/${slug} at ${width} ${scheme}`);
        if (slug === "privacy" || slug === "terms") await page.screenshot({ path: `screenshots/lg01-${slug}-${scheme}-${width}.png`, fullPage: false });
      }
    }
    must(backgrounds["privacy:light"] !== backgrounds["privacy:dark"], `golden hour by default, night under prefers-color-scheme: dark (${backgrounds["privacy:light"]} vs ${backgrounds["privacy:dark"]})`);
    // Every cross link lands, and every anchor is on its page.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    const seen = new Set<string>();
    for (const slug of LEGAL_SLUGS) {
      await page.goto(`${base}/${slug}`);
      const hrefs = await page.locator(`[data-testid="legal-${slug}"] a[href^="/"], [data-testid="legal-nav"] a`).evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
      for (const href of hrefs) {
        if (seen.has(href)) continue;
        seen.add(href);
        const [path, anchor] = href.split("#");
        const res = await page.goto(`${base}${path || "/"}`);
        must(res && res.status() < 400, `${slug} → ${href}: answers ${res?.status()}`);
        if (anchor) must(await page.evaluate((id) => Boolean(document.getElementById(id)), anchor), `${slug} → ${href}: the anchor exists`);
      }
    }
    for (const [slug, id] of [
      ["privacy", "humanos"],
      ["privacy", "ai"],
      ["terms", "advice"],
      ["terms", "conduct"],
    ] as const) {
      await page.goto(`${base}/${slug}#${id}`);
      must(await page.evaluate((x) => Boolean(document.getElementById(x)), id), `/${slug}#${id} is on the page`);
    }
    const robotsTxt = await (await page.request.get(`${base}/robots.txt`)).text();
    for (const slug of LEGAL_SLUGS) must(robotsTxt.includes(`Allow: /${slug}`), `robots.txt allows /${slug}`);
    must(/Disallow: \/\s*$/m.test(robotsTxt), "robots.txt still keeps search engines out of the app");
    // The sign-in screen: by continuing you agree.
    await page.goto(`${base}/login`);
    const terms = page.locator('[data-testid="login-terms"]');
    must((await terms.locator('a[href="/terms"]').count()) === 1 && (await terms.locator('a[href="/privacy"]').count()) === 1, "the sign-in screen links the Terms and the Privacy Policy");
    must((await page.locator('[data-testid="legal-footer"]').count()) === 1, "the footer is under the sign-in screen too");
    console.log(`✓ the six pages signed out at 1440 (golden hour) and 390 (night): 200, title, canonical, indexable, the current page marked, ${seen.size} links and every anchor landing, axe clean; robots.txt allows exactly these; the sign-in screen's agree line`);
    await anon.close();

    // ── Signed in: the footer, Settings → Account, the Board link. ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p1 = await ctx.newPage();
    watch(p1);
    await login(p1, "client");
    const footer = p1.locator('[data-testid="legal-footer"]');
    must((await footer.count()) === 1, "the footer under Today");
    for (const href of ["/privacy", "/terms", "/support", "/community-guidelines"]) must((await footer.locator(`a[href="${href}"]`).count()) === 1, `the footer links ${href}`);
    await p1.goto(`${base}/settings`);
    const account = p1.locator("#account");
    for (const href of ["/privacy", "/terms", "/support", "/api/export?format=json", "/settings/delete-humanos", "/settings/delete-account"]) must((await account.locator(`a[href="${href}"]`).count()) === 1, `Settings → Account links ${href}`);
    console.log("✓ signed in: the footer under every page with its four links; Settings → Account with Privacy, Terms, Support, Download my data, Delete my HumanOS data and Delete my account");

    // ── The menu (H-333) at 1440: folding remembered, the current group open, Collapse all, the rail and the [ key. ──
    await p1.goto(`${base}/today`);
    const nav = p1.locator('[data-testid="side-nav"]');
    const daily = p1.locator('[data-testid="nav-group"][data-group="Daily"]');
    const build = p1.locator('[data-testid="nav-group"][data-group="Build"]');
    must((await build.getAttribute("data-open")) === "true", "Build starts open");
    await build.locator('[data-testid="nav-group-toggle"]').click();
    must((await build.getAttribute("data-open")) === "false" && (await build.locator('[data-testid="nav-group-toggle"]').getAttribute("aria-expanded")) === "false", "a tap folds Build");
    await p1.waitForTimeout(700);
    await p1.reload();
    must((await build.getAttribute("data-open")) === "false", "folded Build stays folded after a reload (kept on the membership)");
    const other: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await ctx.storageState() });
    const p2 = await other.newPage();
    await p2.goto(`${base}/today`);
    must((await p2.locator('[data-testid="nav-group"][data-group="Build"]').getAttribute("data-open")) === "false", "another browser sees the same folded group: not a device setting");
    await other.close();
    await p1.goto(`${base}/offers`);
    must((await build.getAttribute("data-open")) === "true", "the group holding the current page (Offers, in Build) always shows open");
    must((await daily.getAttribute("data-open")) === "true", "Daily is still open");
    const collapseAll = nav.locator('[data-testid="nav-collapse-all"]');
    must((await collapseAll.innerText()).trim() === "Collapse all", "the control reads Collapse all");
    await collapseAll.click();
    const groups = p1.locator('[data-testid="nav-group"]');
    const n = await groups.count();
    for (let i = 0; i < n; i++) {
      const g = groups.nth(i);
      const label = await g.getAttribute("data-group");
      must((await g.getAttribute("data-open")) === (label === "Build" ? "true" : "false"), `Collapse all shuts ${label} (the current page's group stays open)`);
    }
    must((await collapseAll.innerText()).trim() === "Expand all", "once everything is shut it reads Expand all");
    await collapseAll.click();
    for (let i = 0; i < n; i++) must((await groups.nth(i).getAttribute("data-open")) === "true", "Expand all opens every group");
    // The rail.
    const sidebar = p1.locator('[data-testid="sidebar"]');
    // The store saves 300 ms after a change; the next page reads the saved state, so wait for the save itself, not a guess.
    const savedRail = async () => {
      const u = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
      return ((await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, u.id) }))!.navState as { rail?: boolean }).rail === true;
    };
    const untilSaved = async (rail: boolean) => {
      for (let i = 0; i < 40 && (await savedRail()) !== rail; i++) await p1.waitForTimeout(100);
      must((await savedRail()) === rail, `the rail state ${rail} is saved within four seconds`);
    };
    const wideBefore = (await sidebar.boundingBox())!.width;
    await p1.locator('[data-testid="nav-rail-toggle"]').click();
    must((await sidebar.getAttribute("data-rail")) === "true" && (await sidebar.boundingBox())!.width < 70 && wideBefore > 200, "the sidebar folds to a slim rail");
    must((await nav.locator('[data-testid="nav-group-toggle"]').count()) === 0 && (await nav.locator('[role="separator"]').count()) === n, "on the rail the group headings are thin dividers");
    const railLinks = nav.locator("a");
    const rn = await railLinks.count();
    for (let i = 0; i < rn; i++) must((await railLinks.nth(i).getAttribute("title")) && (await railLinks.nth(i).getAttribute("aria-label")), "every rail icon carries its name as a tooltip and an accessible name");
    must((await p1.locator('[data-testid="rail-settings"]').getAttribute("aria-label")) === "Settings" && (await p1.locator('[data-testid="rail-logout"]').count()) === 1, "the rail keeps Settings and Log out as icons");
    await noWide(p1, "the rail at 1440");
    await untilSaved(true);
    await p1.reload();
    must((await sidebar.getAttribute("data-rail")) === "true", "the rail stays after a reload");
    await p1.keyboard.press("[");
    must((await sidebar.getAttribute("data-rail")) === "false", "[ brings the full sidebar back");
    await untilSaved(false);
    await p1.goto(`${base}/settings`);
    must((await sidebar.getAttribute("data-rail")) === "false", "Settings opens with the full sidebar, as saved");
    await p1.locator('input[name="name"], input[type="text"]').first().focus();
    await p1.keyboard.press("[");
    must((await sidebar.getAttribute("data-rail")) === "false", "[ typed into a field changes nothing");
    await p1.locator("body").click({ position: { x: 5, y: 5 } });
    await p1.locator('[data-testid="nav-rail-toggle"]').focus();
    await p1.keyboard.press("Enter");
    must((await sidebar.getAttribute("data-rail")) === "true" && (await p1.locator('[data-testid="nav-rail-toggle"]').getAttribute("aria-pressed")) === "true", "the fold button works from the keyboard and says it is pressed");
    await p1.screenshot({ path: "screenshots/lg02-rail-1440.png" });
    await p1.locator('[data-testid="nav-rail-toggle"]').click();
    await p1.setViewportSize({ width: 1024, height: 900 });
    await p1.goto(`${base}/today`);
    await noWide(p1, "Today at 1024");
    console.log("✓ the menu at 1440: a tap folds a group, kept across a reload and another browser; the current page's group always open; Collapse all / Expand all; the rail with tooltips and names, kept, the [ key (not while typing), the fold button by keyboard; nothing wider than the screen at 1024");

    // ── The phone's More page at 390: every group a 44px button that folds, Collapse all, nothing wider than the screen. ──
    await p1.setViewportSize({ width: 390, height: 844 });
    await p1.goto(`${base}/more`);
    const toggles = p1.locator('[data-testid="more-group-toggle"]');
    const tn = await toggles.count();
    must(tn >= 5, `the phone menu shows its groups (${tn})`);
    for (let i = 0; i < tn; i++) must((await toggles.nth(i).boundingBox())!.height >= 44 && (await toggles.nth(i).getAttribute("aria-expanded")) === "true", "each group heading is a 44px button, open");
    await toggles.nth(1).click();
    must((await p1.locator('[data-testid="more-group"]').nth(1).getAttribute("data-open")) === "false" && (await toggles.nth(1).getAttribute("aria-expanded")) === "false", "a tap folds the group on the phone");
    await p1.waitForTimeout(700);
    await p1.reload();
    must((await p1.locator('[data-testid="more-group"]').nth(1).getAttribute("data-open")) === "false", "the folded group stays folded on the phone after a reload");
    await p1.locator('main [data-testid="nav-collapse-all"]').click();
    const cards = p1.locator('[data-testid="more-group"]');
    for (let i = 0; i < (await cards.count()); i++) must((await cards.nth(i).getAttribute("data-open")) === "false", "Collapse all on the phone shuts every group");
    must((await p1.locator('main [data-testid="nav-collapse-all"]').innerText()).trim() === "Expand all", "then it reads Expand all");
    await p1.locator('main [data-testid="nav-collapse-all"]').click();
    for (let i = 0; i < (await cards.count()); i++) must((await cards.nth(i).getAttribute("data-open")) === "true", "Expand all opens them");
    for (const path of ["/more", "/today", "/settings"]) {
      await p1.goto(`${base}${path}`);
      await noWide(p1, `${path} at 390`);
    }
    await p1.screenshot({ path: "screenshots/lg03-more-390.png" });
    console.log("✓ the phone's More page: every group heading a 44px button with aria-expanded, folding kept, Collapse all / Expand all; nothing wider than the screen at 390");
    await ctx.close();

    // ── Delete my HumanOS data, then Delete my account, as the second demo member; a coach is told to write in. ──
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const jm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, jordan.id) }))!;
    const bodyCount = async () => {
      const [e, d, dev, f] = await Promise.all([
        db.query.bodyEntries.findMany({ where: eq(schema.bodyEntries.userId, jordan.id) }),
        db.query.bodyDays.findMany({ where: eq(schema.bodyDays.userId, jordan.id) }),
        db.query.bodyDevices.findMany({ where: eq(schema.bodyDevices.userId, jordan.id) }),
        db.query.bodyFoods.findMany({ where: eq(schema.bodyFoods.userId, jordan.id) }),
      ]);
      return e.length + d.length + dev.length + f.length;
    };
    // A fixture so there is something to delete: HumanOS on, one weigh-in day and one food.
    await db.update(schema.memberships).set({ bodyEnabled: true }).where(eq(schema.memberships.id, jm.id));
    await db.insert(schema.bodyDays).values({ id: `lg-day-${Date.now()}`, workspaceId: jm.workspaceId, userId: jordan.id, date: "2026-10-01" } as typeof schema.bodyDays.$inferInsert).catch(() => undefined);
    const pointsBefore = (await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, jordan.id) })).length;
    const before = await bodyCount();
    // Delete my account lists the member's stored objects through the blob store; the dev server points at scripts/mock-blob.ts
    // on :4050 (dev-server.sh), and without it the store's client retries for a minute. Up here if it is not already.
    const blob = "http://localhost:4050";
    const blobUp = await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false);
    blobProc = blobUp ? null : spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
    for (let i = 0; i < 40 && !(await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p3 = await c3.newPage();
    watch(p3);
    await loginAs(p3, jordan.email, "demo1234");
    await p3.waitForURL(/\/today/);
    await p3.goto(`${base}/settings/delete-humanos`);
    must(/\d+ records across \d+ tables/.test(await p3.locator('[data-testid="delete-humanos-count"]').innerText()), "the HumanOS deletion counts what would go");
    await p3.fill('[data-testid="delete-humanos-email"]', "someone.else@example.com");
    await p3.click('[data-testid="delete-humanos-submit"]');
    await p3.locator('[data-testid="delete-humanos-error"]').waitFor();
    must((await bodyCount()) === before, "the wrong email deletes nothing");
    await p3.fill('[data-testid="delete-humanos-email"]', jordan.email.toUpperCase());
    await p3.click('[data-testid="delete-humanos-submit"]');
    await p3.waitForURL(/\/settings\?humanos=deleted/);
    must((await p3.locator('[data-testid="humanos-deleted"]').count()) === 1, "Settings says the HumanOS data was deleted");
    must((await bodyCount()) === 0, "every HumanOS table is empty for the member");
    must(Boolean(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, jm.id) })), "the membership stays");
    must((await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, jordan.id) })).length === pointsBefore, "points are untouched");
    await p3.goto(`${base}/settings/delete-account`);
    must(/\d+ records across \d+ tables/.test(await p3.locator('[data-testid="delete-account-count"]').innerText()), "the account deletion counts what would go");
    await p3.fill('[data-testid="delete-account-email"]', "someone.else@example.com");
    await p3.click('[data-testid="delete-account-submit"]');
    await p3.locator('[data-testid="delete-account-error"]').waitFor();
    must(Boolean(await db.query.users.findFirst({ where: eq(schema.users.id, jordan.id) })), "the wrong email deletes no account");
    await p3.fill('[data-testid="delete-account-email"]', jordan.email);
    await p3.click('[data-testid="delete-account-submit"]');
    await p3.waitForURL(/\/login\?reason=account-deleted/);
    must((await p3.locator('[data-testid="login-account-deleted"]').count()) === 1, "the sign-in screen says the account was deleted");
    must(!(await db.query.users.findFirst({ where: eq(schema.users.id, jordan.id) })) && !(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, jm.id) })), "the account and the membership are gone");
    must(Boolean(await db.query.deletionAudits.findFirst({ where: and(eq(schema.deletionAudits.workspaceId, jm.workspaceId), eq(schema.deletionAudits.ranByUserId, jordan.id)) })), "the deletion is on the audit record, run by the member");
    await loginAs(p3, jordan.email, "demo1234");
    await p3.locator('[data-testid="login-error"]').waitFor({ timeout: 10000 });
    await login(p3, "coach");
    await p3.goto(`${base}/settings/delete-account`);
    must((await p3.locator('[data-testid="delete-account-coach"]').count()) === 1 && (await p3.locator('[data-testid="delete-account-form"]').count()) === 0, "a coach's own account goes through Support, not this page");
    await logout(p3);
    await c3.close();
    console.log("✓ Delete my HumanOS data: counted first, the wrong email deletes nothing, then every HumanOS table empty and the account, membership and points untouched; Delete my account: the member, their membership and their sign-in gone, the audit row written by them; a coach is sent to Support");
  } finally {
    await browser.close();
    if (blobProc?.pid) try { process.kill(-blobProc.pid); } catch { /* already gone */ }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Legal smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
