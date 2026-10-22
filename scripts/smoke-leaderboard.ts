/**
 * A client's loyalty-pass leaderboard (rev 639, H-29): the coach pastes the client's eLoyalty key on their /coach row, Connect and
 * check says what it found (and asks for the template when there are several), the key is never shown again (its last four
 * only, and nowhere on the client's pages, the feed or the hosted page). The public feed reads with no session and CORS *,
 * carries first names, initials, points and tiers in the shape the page reads, and nothing that reaches a person. The hosted
 * page /lb/<slug> renders the same members server-side, with the client's words, tiers and rewards from /loyalty, and can be
 * framed. A visitor never makes HelixOS call eLoyalty: the cron is the one reader, and a busy eLoyalty leaves the last good
 * board in place. Before a key is in, a pasted export (stripped on save) stands in; with nothing, the feed answers 503 and
 * the page shows the design's samples. The only writes to eLoyalty are the Points desk's moves (H-493), adds and deducts by
 * customer id, never a set. Runs against scripts/mock-eloyalty.ts.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { CL_EXPORT_CSV, CUSTOMERS, ELOYALTY_KEY, TEMPLATES } from "./fixtures/eloyalty";

const base = process.argv[2] ?? "http://localhost:3000";
const port = 4080;
const HOST = `http://localhost:${port}`;
const CRON = { authorization: `Bearer ${process.env.CRON_SECRET ?? "change-me"}` };
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
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
/** A fill into a field the page may re-render under it (after a submit, mid-hydration) is read back and retried, per the walks' conventions. */
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`${selector} wouldn't hold "${value}"`);
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
const mock0 = async () => (await (await fetch(`${HOST}/__calls`)).json()) as { writes: string[]; fields: Record<string, string> };
const mockCalls = async () => ((await (await fetch(`${HOST}/__calls`)).json()) as { calls: number; writes: string[] });
const clean = (text: string) => !text.includes("@") && !/\d{7,}/.test(text) && !text.includes(ELOYALTY_KEY) && !text.includes(ELOYALTY_KEY.slice(-6)) && !text.includes("cus_") && !text.includes("SER-") && !text.includes("Santos");
/** The member's own pages (Settings, /loyalty) show their own email and hide list; what must never be there is the key, whole or its tail. */
const noKey = (html: string) => !html.includes(ELOYALTY_KEY) && !html.includes(ELOYALTY_KEY.slice(-6));
/** A rendered page: its words (scripts, styles and tags stripped; a build hash in a class name has digit runs) pass the clean guard, and its whole HTML names no key, id, serial or last name. */
const cleanPage = (html: string) => clean(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")) && !html.includes(ELOYALTY_KEY) && !html.includes(ELOYALTY_KEY.slice(-6)) && !html.includes("cus_") && !html.includes("SER-") && !html.includes("Santos");

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-eloyalty.ts", String(port)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const { db, schema } = await import("@/db");
    const { and, eq, inArray } = await import("drizzle-orm");
    const { DEFAULT_PAGE, buildFeed, parseExport } = await import("@/lib/engine/leaderboard");
    const { TIERS, rankOf } = await import("@/lib/engine/tiers");
    const { fixFields } = await import("@/lib/engine/pass-fix");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500 && !r.url().includes("/api/public/leaderboard/")) failures.push(`${r.status()} ${r.url()}`);
    });
    const tpl = TEMPLATES[0].id;
    const onPass = CUSTOMERS.filter((c) => c.is_active && c.template_id === tpl);
    const expected = (hidden: string[], showZero = DEFAULT_PAGE.showZero) => buildFeed(onPass, hidden, "x", { tiers: DEFAULT_PAGE.tiers, showZero }).members;
    const row = () => page.locator("li", { has: page.locator('form:has(input[name="eoPassUrl"][value*="maya-torres"])') }).first();

    // The coach connects Maya's key; with several templates the check says so and names them.
    await login(page, "As the coach");
    await page.goto(`${base}/coach?connections=open`);
    await row().waitFor({ timeout: 15000 });
    const box = row().locator('[data-testid="leaderboard-row"]');
    await box.locator("summary").click();
    await box.locator('[data-testid="leaderboard-key"]').fill(ELOYALTY_KEY);
    await box.locator('[data-testid="leaderboard-host"]').fill(HOST);
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-connect"]`);
    let check = await row().locator('[data-testid="leaderboard-check"]').innerText();
    must(check.startsWith(`Connected on localhost:${port}: `) && check.includes("several templates") && check.includes(TEMPLATES[0].name) && !check.includes("Test"), `the check names the templates to choose from: ${check}`);
    // The template pasted, the key left blank (kept): the board is the pass's members (0-point members shown, H-33), the fields named, never a value.
    await fillExact(page, 'li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-template"]', tpl);
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-connect"]`);
    // The page streams after the action: wait for the new note, not the first check's words.
    await row().locator('[data-testid="leaderboard-check"]').filter({ hasNotText: "several templates" }).waitFor({ timeout: 20000 });
    check = await row().locator('[data-testid="leaderboard-check"]').innerText();
    must(check.startsWith(`Connected on localhost:${port}: ${expected([]).length} on the board of ${onPass.length} active; fields seen: email, first_name, id,`), `the check: host, count and field names: ${check}`);
    must(!check.includes("@") && !check.includes("Santos"), "the check note carries field names, never a value");
    const coachHtml = await page.content();
    must(!coachHtml.includes(ELOYALTY_KEY) && coachHtml.includes(`…${ELOYALTY_KEY.slice(-4)}`), "the coach sees the key's last four only");
    must((await row().locator('[data-testid="leaderboard-open-page"]').count()) === 1, "the coach row links to the client's leaderboard page");
    const feedRow = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, m.id) }))!;
    must(feedRow.keyEncrypted?.startsWith("enc:v1:") && !feedRow.keyEncrypted.includes(ELOYALTY_KEY), "the key is sealed at rest");
    must(feedRow.lastCheckOk === true && feedRow.host === HOST, "a passed check keeps the host that answered");
    console.log(`✓ Connect and check: the templates named, then ${expected([]).length} on the board of ${onPass.length}, fields named; the key sealed and shown as its last four`);

    // The public feed: no session, CORS *, the shape the page reads, tiers from the default gates, nothing that reaches a person.
    const url = `${base}/api/public/leaderboard/${feedRow.slug}`;
    let pageUrl = `${base}/lb/${feedRow.slug}`;
    let res = await fetch(url, { redirect: "manual" });
    let body = await res.text();
    must(res.status === 200 && res.headers.get("access-control-allow-origin") === "*", `the feed answers anyone: ${res.status}`);
    let feed = JSON.parse(body) as { updated_at: string; members: { name: string; tier: string; lifetime: number }[] };
    must(JSON.stringify(feed.members) === JSON.stringify(expected([])) && !Number.isNaN(Date.parse(feed.updated_at)), `the members as mapped: ${body}`);
    must(feed.members.some((x) => x.lifetime === 0) && feed.members.every((x) => x.tier === "" || /^Kindness (Starter|Investor|Insider|Multiplier|Compounder)$/.test(x.tier)) && feed.members.some((x) => x.tier === "Kindness Starter"), "0-point members are on by default and every tier is one of the program's five (H-399), none of eLoyalty's");
    must(clean(body), "no email, phone, id, serial, last name or key in the feed");
    must((await fetch(url, { method: "OPTIONS" })).headers.get("access-control-allow-origin") === "*", "the preflight answers too");
    must((await fetch(`${base}/api/public/leaderboard/no-such-feed-1`)).status === 503, "an unknown address is 503");
    console.log(`✓ the feed: no session, CORS *, ${feed.members.length} members as First L. with points and tier, nothing else`);

    // The hosted page: no session, the numbers in the first paint, framable, the design's root; nothing that reaches a person.
    res = await fetch(pageUrl);
    body = await res.text();
    must(res.status === 200 && body.includes('id="ckl-root"') && body.includes('data-source="live"'), `the page renders the live board: ${res.status}`);
    must(!res.headers.get("x-frame-options") && !/frame-ancestors/.test(res.headers.get("content-security-policy") ?? ""), "the page may be framed");
    for (const mem of expected([])) must(body.includes(`>${mem.name}<`), `the page carries ${mem.name}`);
    must(body.includes('data-testid="lb-tiers-list"') && body.includes("Kindness Compounder") && body.includes("A digital badge") && body.includes("Mindpower Success Programming Vault") && body.includes("On the way") && !body.includes("SAMPLE COSTS") && !body.includes("SAMPLE TIERS") && !body.includes("Gate 1") && !body.includes("SAMPLE DATA"), "the program's tiers with what each brings and its rewards, unmarked; a member under 500 reads On the way; the members are real");
    must(cleanPage(body), "no email, phone, id, serial, last name or key on the page");
    must((await fetch(`${base}/lb/no-such-feed-1`)).status === 404, "an unknown page is 404");
    await page.goto(pageUrl);
    await page.locator("#ckl-root .l-row").first().waitFor();
    const widths = await page.evaluate(() => ({ rows: document.querySelectorAll("#ckl-root .l-row:not([hidden])").length, pods: document.querySelectorAll("#ckl-root .l-pod").length }));
    must(widths.rows === expected([]).length && widths.pods === 3, `the page shows every member and a podium of three: ${JSON.stringify(widths)}`);
    await fillExact(page, "#ckl-search", "maria");
    must((await page.locator("#ckl-root .l-row:not([hidden])").count()) === 1, "search narrows the rows on the page, with no request");
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto(pageUrl);
    must((await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) === true, "nothing wider than a 390px screen");
    await phone.context().close();
    console.log("✓ the hosted page: server-rendered, framable, the design at 390px, search works on the page, nothing that reaches a person");

    // A visitor never makes HelixOS read eLoyalty: with the board stale and eLoyalty busy, the feed and the page serve the last good board and the mock sees no call.
    await db.update(schema.leaderboardFeeds).set({ cachedAt: "2000-01-01T00:00:00.000Z" }).where(eq(schema.leaderboardFeeds.id, feedRow.id));
    await fetch(`${HOST}/__mode?status=429`);
    const before = (await mockCalls()).calls;
    res = await fetch(url);
    body = await res.text();
    must(res.status === 200 && JSON.stringify((JSON.parse(body) as { members: unknown[] }).members) === JSON.stringify(expected([])), `a stale board is still served: ${res.status} ${body.slice(0, 120)}`);
    must((await fetch(pageUrl)).status === 200, "the page too");
    must((await mockCalls()).calls === before, "a visitor caused no call to eLoyalty");
    // The cron is the reader: busy, it backs off for a minute and the board stands; answering, it refreshes.
    must((await fetch(`${base}/api/cron/leaderboards`)).status === 401, "the cron needs its secret");
    let cron = (await (await fetch(`${base}/api/cron/leaderboards`, { headers: CRON })).json()) as { results: { slug: string; outcome: string }[] };
    must(cron.results.find((r) => r.slug === feedRow.slug)?.outcome === "busy" && (await mockCalls()).calls === before + 1, `a busy eLoyalty is tried once: ${JSON.stringify(cron)}`);
    cron = (await (await fetch(`${base}/api/cron/leaderboards`, { headers: CRON })).json()) as typeof cron;
    must(cron.results.find((r) => r.slug === feedRow.slug)?.outcome === "waiting" && (await mockCalls()).calls === before + 1, `then left alone for a minute: ${JSON.stringify(cron)}`);
    await fetch(`${HOST}/__mode?status=200`);
    await db.update(schema.leaderboardFeeds).set({ refreshAfter: null }).where(eq(schema.leaderboardFeeds.id, feedRow.id));
    cron = (await (await fetch(`${base}/api/cron/leaderboards`, { headers: CRON })).json()) as typeof cron;
    must(cron.results.find((r) => r.slug === feedRow.slug)?.outcome === "refreshed", `answering, the cron refreshes: ${JSON.stringify(cron)}`);
    const refreshed = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedRow.id) }))!;
    must(Date.now() - Date.parse(refreshed.cachedAt!) < 60_000 && !JSON.stringify(cron).includes(ELOYALTY_KEY), "the board is fresh and the cron's answer names no key");
    console.log("✓ a visitor never reaches eLoyalty; the cron is the one reader, backs off on 429 and refreshes when answered");

    // Maya's Settings: connected, the links, the way to the editor; never the key. On /loyalty she sets words, tiers, rewards and hides one: the page and feed change at once.
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/settings?tab=programs#leaderboard`);
    await page.locator('[data-testid="leaderboard-state"]').waitFor();
    must((await page.locator('[data-testid="leaderboard-state"]').innerText()).includes("connected") && (await page.locator('[data-testid="leaderboard-page-link"]').innerText()).endsWith(`/lb/${feedRow.slug}`), "Settings says connected, with the page link");
    // The menu item (H-140): with a board set up, "Loyalty leaderboard" is in the owner's side menu (the Settings card links there too, so two links at least).
    must((await page.locator('a[href="/loyalty"]').count()) >= 2 && (await page.getByText("Loyalty leaderboard", { exact: true }).count()) >= 1, "the Loyalty leaderboard menu item shows for the owner");
    must(noKey(await page.content()), "the key is nowhere on the client's Settings");
    await page.click('[data-testid="leaderboard-edit-link"]');
    await page.waitForURL(/\/loyalty/);
    await page.locator('[data-testid="leaderboard-page-form"]').waitFor();
    must(noKey(await page.content()), "the key is nowhere on /loyalty");
    await fillExact(page, '[data-testid="lb-headline"]', "Maya's Kindness Board");
    await fillExact(page, '[data-testid="lb-tiers"]', "Seed, 0\nSprout, 500\nTree, 2000");
    await fillExact(page, '[data-testid="lb-rewards"]', "Hug | 10 | A warm one\nCall | 1000 | With Maya");
    await fillExact(page, '[data-testid="lb-pass-url"]', "https://loyalty.example.com/pass-1785444472615");
    await page.uncheck('[data-testid="lb-tiers-sample"]');
    await page.uncheck('[data-testid="lb-show-zero"]');
    await submit(page, '[data-testid="lb-save"]');
    body = await (await fetch(pageUrl)).text();
    must(body.includes("Maya's Kindness Board") && body.includes("Sprout") && body.includes("With Maya") && body.includes('href="https://loyalty.example.com/pass-1785444472615"') && !body.includes("Gate 1"), "the page carries her words, tiers, rewards and link");
    feed = JSON.parse(await (await fetch(url)).text());
    const gates = [{ name: "Seed", min: 0 }, { name: "Sprout", min: 500 }, { name: "Tree", min: 2000 }];
    must(JSON.stringify(feed.members) === JSON.stringify(buildFeed(onPass, [], "x", { tiers: gates, showZero: false }).members) && !feed.members.some((x) => x.lifetime === 0), `the feed's tiers follow her gates and 0-point members are off: ${JSON.stringify(feed.members)}`);
    await fillExact(page, '[data-testid="leaderboard-hidden"]', "cus_001\n");
    await submit(page, '[data-testid="leaderboard-hide-save"]');
    feed = JSON.parse(await (await fetch(url)).text());
    must(JSON.stringify(feed.members) === JSON.stringify(buildFeed(onPass, ["cus_001"], "x", { tiers: gates, showZero: false }).members), "a hidden member is off the board at once");
    must(!(await (await fetch(pageUrl)).text()).includes(">Maria S.<"), "and off the page");
    console.log("✓ the client's Settings and /loyalty: the links, her words, tiers, rewards, link and hide list on the page and feed at once; never the key");

    // The page address (H-109): reserved and taken are refused in words; a new one works at once; the old one redirects 308 and its feed still answers.
    await page.goto(`${base}/loyalty`);
    await page.locator('[data-testid="lb-slug"]').waitFor();
    const oldSlug = feedRow.slug;
    await fillExact(page, '[data-testid="lb-slug"]', "coach");
    await submit(page, '[data-testid="lb-slug-save"]');
    must((await page.locator('[data-testid="lb-slug-error"]').innerText()).includes("reserved"), "a reserved word is refused in words");
    const otherFeed = { id: "walk-other-feed", workspaceId: feedRow.workspaceId, userId: "walk-other-user", membershipId: "walk-other-membership", slug: "passport-diner-walk" };
    await db.insert(schema.leaderboardFeeds).values(otherFeed);
    await fillExact(page, '[data-testid="lb-slug"]', "passport-diner-walk");
    await submit(page, '[data-testid="lb-slug-save"]');
    must((await page.locator('[data-testid="lb-slug-error"]').innerText()).includes("taken"), "another board's address is refused");
    // The field's own pattern keeps the browser from sending capitals; the server's lowercasing is the unit test's to prove.
    // A slug of this run alone (H-171): on a database that ran the walk before the seed cleared aliases, "kindness-walk" stays taken by an orphaned alias row.
    const newSlug = `kindness-walk-${Date.now().toString(36)}`;
    await fillExact(page, '[data-testid="lb-slug"]', newSlug);
    await submit(page, '[data-testid="lb-slug-save"]');
    await page.locator('[data-testid="lb-slug-changed"]').waitFor();
    const moved = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedRow.id) }))!;
    must(moved.slug === newSlug && JSON.stringify(moved.hidden) === JSON.stringify(["cus_001"]), `the address changed and the hide list carried over: ${moved.slug}`);
    must((await page.locator('[data-testid="leaderboard-page-link"]').innerText()).endsWith(`/lb/${newSlug}`), "the page link shows the new address");
    res = await fetch(`${base}/lb/${oldSlug}`, { redirect: "manual" });
    must(res.status === 308 && (res.headers.get("location") ?? "").endsWith(`/lb/${newSlug}`), `the old address is a permanent redirect: ${res.status} ${res.headers.get("location")}`);
    must((await fetch(`${base}/lb/${newSlug}`)).status === 200, "the new address serves the page");
    const feedOld = await (await fetch(url)).text();
    const feedNew = await (await fetch(`${base}/api/public/leaderboard/${newSlug}`)).text();
    must(feedOld === feedNew && (JSON.parse(feedNew) as { members: unknown[] }).members.length > 0, "the feed answers the same on both addresses");
    await db.delete(schema.leaderboardFeeds).where(eq(schema.leaderboardFeeds.id, otherFeed.id));
    console.log("✓ the page address: reserved and taken refused, a new one live at once, the old one a 308 and its feed still answering");

    pageUrl = `${base}/lb/${newSlug}`;

    // The points check (H-102): the coach uploads the CL export once; the table shows First L. and numbers only; the hide list is counted apart; nothing was written.
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach?connections=open`);
    await row().locator('[data-testid="points-check"] summary').click();
    const writesBefore = (await mockCalls()).writes.length;
    await row().locator('[data-testid="points-check-file"]').setInputFiles({ name: "wDn-walk-export.csv", mimeType: "text/csv", buffer: Buffer.from(CL_EXPORT_CSV) });
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="points-check-run"]`);
    await page.locator('[data-testid="points-check-result"]').first().waitFor({ timeout: 20000 });
    const counts = await page.locator('[data-testid="points-check-counts"]').first().innerText();
    // Seven active passes; Maya's hide list holds cus_001 (hidden earlier in this walk), so Maria is counted apart. Ben matches by serial, Ina by customer id; Zero, John Doe, Tess and Rafa have no CL record; Guest has a serial eLoyalty doesn't know; Hannah has no pass field and is read past.
    must(counts.includes("6 passes;") && counts.includes("2 match a CL record") && counts.includes("0 differ") && counts.includes("4 passes with no CL record") && counts.includes("1 CL records with no pass") && counts.includes("1 team tests counted apart"), `the counts line: ${counts}`);
    const table = await page.locator('[data-testid="points-check-table"]').first().innerText();
    must(table.includes("Ben O.") && table.includes("Ina") && table.includes("both agree") && table.includes("team (portal)") && table.includes("API"), `the table: members as First L., the reasons and who made the last change: ${table.slice(0, 200)}`);
    must(table.includes("Maria S. (test)"), "a hidden member is shown as a test");
    const checkHtml = await page.content();
    const leaked = ["example.com", "cus_0", "SER-", "Santos", "f159927"].filter((t) => checkHtml.includes(t));
    must(!leaked.length, `no email, id, serial, last name or bot user ns on the coach page (found: ${leaked.join(", ")}${leaked.length ? ` near "${checkHtml.slice(Math.max(0, checkHtml.indexOf(leaked[0]) - 120), checkHtml.indexOf(leaked[0]) + 40).replace(/\s+/g, " ")}"` : ""})`);
    // The id report (H-402): the same comparison downloaded with customer ids in place of names, never kept, nothing written.
    await row().locator('[data-testid="points-check"] summary').evaluate((el) => ((el.parentElement as HTMLDetailsElement).open = true));
    await row().locator('[data-testid="points-check-file"]').setInputFiles({ name: "wDn-walk-export.csv", mimeType: "text/csv", buffer: Buffer.from(CL_EXPORT_CSV) });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), row().locator('[data-testid="points-check-report"]').click()]);
    must(/^points-check-ids-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), `the report downloads as a dated CSV: ${download.suggestedFilename()}`);
    const report = readFileSync((await download.path())!, "utf8");
    const reportLines = report.trim().split("\n");
    must(reportLines[0].startsWith("eloyalty_customer_id,cl_loyalty_customer_id,matched_by,team_test,lifetime,available"), `the report's columns: ${reportLines[0]}`);
    // Seven active passes (Maria counted as a team test) and the one CL record with no pass.
    must(reportLines.length === 1 + 7 + 1 && report.includes("cus_001,") && /cus_001,[^\n]*,yes,/.test(report) && report.includes("no eLoyalty match"), `the report: one row per pass, the hide list marked, the CL-only record last (${reportLines.length} lines)`);
    must(!/example\.com|SER-|Santos|Okafor|Maria|Ben O|f159927|\+1555/.test(report), "the report carries ids and numbers only: no name, email, phone, serial or bot user ns");
    const sealedRow = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedRow.id) }))!;
    must(sealedRow.pointsCheckSealed?.startsWith("enc:v1:") && !sealedRow.pointsCheckSealed.includes("Ben"), "the snapshot is sealed at rest");
    must((await mockCalls()).writes.length === writesBefore, "the check wrote nothing to eLoyalty");
    console.log("✓ the points check: the export read once, members as First L. with both balances and the reason, the hide list apart, sealed at rest; the id report downloaded with ids and numbers only; nothing written");

    // The Points desk (H-493): closed until the add-and-deduct check passes on a team test pass; then, for the coach working in
    // Maya's HelixOS, one deduct through the outbox (refused above what is available), a move held while paused and sent by the
    // cron after; never for Maya herself.
    const deskBox = () => row().locator('[data-testid="desk-settings"]');
    const openDesk = async () => deskBox().locator("summary").evaluate((el) => ((el.parentElement as HTMLDetailsElement).open = true));
    const deskMoves = () => db.query.loyaltyPointsMoves.findMany({ where: eq(schema.loyaltyPointsMoves.feedId, feedRow.id) });
    await page.goto(`${base}/coach?connections=open`);
    await openDesk();
    must((await deskBox().locator("summary").innerText()).includes("closed until the check passes"), "the desk starts closed");
    const writes0 = (await mockCalls()).writes.length;
    await deskBox().locator('[data-testid="desk-check-pass"]').selectOption({ label: "Maria S. · 900 available" });
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="desk-check-run"]`);
    const checkNote = (await row().locator('[data-testid="desk-check-note"]').textContent()) ?? "";
    must(checkNote.startsWith("Passed: deduct 1: available 900 → 899, lifetime unchanged; add 1 back: available 900"), `the check on the team test pass: ${checkNote}`);
    must(JSON.stringify((await mockCalls()).writes.slice(writes0)) === JSON.stringify(["POST /api/public/admin/points/deduct", "POST /api/public/admin/points/add"]), "the check made exactly one deduct and one add");
    must((await deskMoves()).length === 2 && (await deskMoves()).every((m) => m.status === "sent" && m.eventId && m.customerId === "cus_001"), "both check moves went through the outbox and were sent");
    must((await deskBox().locator("summary").innerText()).includes("open"), "the desk opens once the check has passed");
    const switchIn = async () => {
      await page.goto(`${base}/coach/${feedRow.membershipId}`);
      await page.check('[data-testid="switch-work"]');
      await submit(page, '[data-testid="switch-open"]');
      await page.waitForURL(/\/today/);
      await page.goto(`${base}/loyalty`);
      await page.locator('[data-testid="desk-send"]').waitFor();
    };
    const deskMove = async (customer: string, direction: "add" | "deduct", amount: string, reason: string) => {
      await page.selectOption('[data-testid="desk-member"]', { label: customer });
      await page.check(`[data-testid="desk-${direction}"]`);
      await fillExact(page, '[data-testid="desk-amount"]', amount);
      await fillExact(page, '[data-testid="desk-reason"]', reason);
      await submit(page, '[data-testid="desk-send"]');
    };
    await db.update(schema.memberships).set({ coachCanWork: true }).where(eq(schema.memberships.id, feedRow.membershipId));
    await switchIn();
    const writes1 = (await mockCalls()).writes.length;
    await deskMove("Ben O. · 300 available", "deduct", "301", "Walk: more than they have");
    must((await page.locator('[data-testid="desk-error"]').innerText()).includes("Only 300 are available, so nothing was deducted"), "a deduct above what is available is refused in words");
    must((await mockCalls()).writes.length === writes1, "and nothing was sent");
    await deskMove("Ben O. · 300 available", "deduct", "25", "Redeemed: the vault");
    const deskResult = await page.locator('[data-testid="desk-result"]').innerText();
    must(deskResult === "Deducted 25 KK from Ben O.: 275 available now.", `the desk says what happened: ${deskResult}`);
    must(JSON.stringify((await mockCalls()).writes.slice(writes1)) === JSON.stringify(["POST /api/public/admin/points/deduct"]), "exactly one deduct was sent");
    const benMove = (await deskMoves()).find((m) => m.customerId === "cus_002")!;
    must(benMove.status === "sent" && benMove.delta === -25 && benMove.newBalance === 275 && /\[HX-[0-9a-z]+\]$/i.test(benMove.reason), "the move is a delta, tagged, with eLoyalty's new balance kept");
    const benOnBoard = ((await (await fetch(url)).json()) as { members: { name: string; lifetime: number; available: number }[] }).members.find((x) => x.name === "Ben O.");
    must(benOnBoard?.available === 275 && benOnBoard.lifetime === 1300, `the board shows it at once, lifetime untouched: ${JSON.stringify(benOnBoard)}`);
    must((await page.locator('[data-testid="desk-moves"]').innerText()).includes("Ben O."), "the desk lists the move");
    // The desk's own card (the hide list editor further down the page lists the hidden ids by design, for the owner).
    const deskHtml = await page.locator("#desk").evaluate((el) => el.outerHTML);
    const deskLeak = ["cus_0", "example.com", "SER-"].filter((t) => deskHtml.includes(t));
    must(!deskLeak.length, `no customer id, email or serial in the desk: members are picked by reference (found: ${deskLeak.join(", ")})`);
    // The pause: a move waits in the outbox, nothing is sent; lifted, the cron sends it.
    await submit(page, '[data-testid="switch-back"]');
    await page.goto(`${base}/coach?connections=open`);
    await openDesk();
    await deskBox().locator('[data-testid="desk-pause"]').check();
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="desk-pause-save"]`);
    await switchIn();
    must((await page.locator('[data-testid="desk-paused"]').count()) === 1, "the desk says the moves are paused");
    const writes2 = (await mockCalls()).writes.length;
    await deskMove("Ben O. · 275 available", "add", "10", "Walk: a kind act");
    must((await page.locator('[data-testid="desk-result"]').innerText()).startsWith("Ben O.: waiting"), "a move while paused waits");
    must((await mockCalls()).writes.length === writes2, "nothing is sent while paused");
    await submit(page, '[data-testid="switch-back"]');
    await page.goto(`${base}/coach?connections=open`);
    await openDesk();
    await deskBox().locator('[data-testid="desk-pause"]').uncheck();
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="desk-pause-save"]`);
    const drained = (await (await fetch(`${base}/api/cron/leaderboards`, { headers: CRON })).json()) as { moves: { sent: number }[] };
    must(drained.moves.reduce((n, m) => n + m.sent, 0) === 1 && JSON.stringify((await mockCalls()).writes.slice(writes2)) === JSON.stringify(["POST /api/public/admin/points/add"]), "the cron sends the held move once the pause is lifted");
    must((await deskMoves()).filter((m) => m.status === "sent").length === 4, "four moves, all sent: the check's two, the deduct and the held add");
    // Maya herself, the owner: no desk on her /loyalty (H-429: the community manager and the coach only).
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/loyalty`);
    must((await page.locator('[data-testid="desk-send"]').count()) === 0 && (await page.locator('[data-testid="desk-settings"]').count()) === 0, "the owner sees no desk");
    await logout(page);
    await login(page, "As the coach");
    console.log("✓ the Points desk: closed until the check passed (1 off, 1 back, lifetime unchanged); a deduct above available refused, one deduct sent and shown at once; a move held while paused and sent by the cron; none for the owner");

    // The Evolve Omega pass (H-622): the coach's own program connected on Coach; a client kept out until Issue passes is on;
    // the coach's own pass first, then the client's. Each press is one create by the program's template, nothing else.
    // Maya's coach row is found by her seeded pass link, so her pass fields are cleared here and put back afterwards.
    const coachM = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, feedRow.workspaceId), eq(schema.memberships.role, "coach")) }))!;
    const mayaPass = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, feedRow.membershipId) }))!;
    const noPass = { eoPassUrl: null, eoPassSerial: null, eoPassTypeId: null, eoPassInstalledAt: null, eoCustomerId: null };
    await db.update(schema.memberships).set(noPass).where(eq(schema.memberships.id, coachM.id));
    await db.update(schema.memberships).set(noPass).where(eq(schema.memberships.id, mayaPass.id));
    await page.goto(`${base}/coach`);
    await fillExact(page, '[data-testid="own-key"]', ELOYALTY_KEY);
    await fillExact(page, '[data-testid="own-host"]', HOST);
    await fillExact(page, '[data-testid="own-template"]', TEMPLATES[1].id);
    await submit(page, '[data-testid="own-connect"]');
    await page.locator('[data-testid="own-check"]').filter({ hasText: "Connected" }).waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="own-issue"]').isEnabled()) && !(await page.locator('[data-testid="own-issue"]').isChecked()), "Issue passes is off, and can be switched on once the program is checked");
    must(!(await page.content()).includes(ELOYALTY_KEY), "the key is never shown back");
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/rewards`);
    must((await page.locator('[data-testid="eo-pass-closed"]').innerText()).includes("your coach opens it to members soon") && (await page.locator('[data-testid="eo-pass-get"]').count()) === 0, "a client gets no Get my pass while passes are off");
    await logout(page);
    await login(page, "As the coach");
    const writes3 = (await mockCalls()).writes.length;
    await page.goto(`${base}/rewards`);
    await submit(page, '[data-testid="eo-pass-get"]');
    await page.locator('[data-testid="eo-pass-made"]').waitFor({ timeout: 20000 });
    const coachAfter = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, coachM.id) }))!;
    must(coachAfter.eoCustomerId === "cus_eo_1" && coachAfter.eoPassSerial === "SER-eo-1" && coachAfter.eoPassTypeId === "pass.com.evolveomega" && coachAfter.eoPassUrl === "https://pass.example/eo-1", "the coach's own pass is made and its ids are stored");
    must((await page.locator('[data-testid="eo-pass-add"]').getAttribute("href")) === "https://pass.example/eo-1" && (await page.locator('[data-testid="eo-pass-qr"] svg').count()) === 1, "the card offers Add to wallet and its QR code");
    must((await page.locator('[data-testid="eo-pass-get"]').count()) === 0, "no second Get my pass");
    must(JSON.stringify((await mockCalls()).writes.slice(writes3)) === JSON.stringify([`POST /api/external/v1/templates/${TEMPLATES[1].id}/pass`]), "one create, by the program's template");
    // H-1640: the pass never shows the template's name prompt; with the sync off, no opening points are queued at create.
    const shown = ((await (await fetch(`${HOST}/__calls`)).json()) as { passNamesShown: string[] }).passNamesShown;
    must(shown.length === 1 && shown[0].trim().length > 0 && !/enter your|last name/i.test(shown[0]), `the pass shows a real name, never the template's prompt: "${shown[0]}"`);
    must((await db.query.loyaltyPointsMoves.findMany({ where: eq(schema.loyaltyPointsMoves.source, `sync-open:${coachM.id}`) })).length === 0, "with the sync off, making a pass queues no points");
    // The redirect after Add (H-1641): landing on /rewards/pass-added marks the pass added and shows "Pass added".
    await page.goto(`${base}/rewards/pass-added`);
    await page.locator('[data-testid="eo-pass-added"]').waitFor({ timeout: 15000 });
    must(Boolean((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, coachM.id) }))!.eoPassInstalledAt), "landing after Add marks the pass added");
    must((await page.locator('form:has-text("I added it")').count()) === 0, "no I added it once the pass is marked added");
    console.log("✓ pass: a real name only, nothing queued with the sync off, and landing after Add marks it added");
    // Step D (H-734): one Latest Message on the coach's own pass, only when Send is pressed, into Push_Notification once.
    const writes4 = (await mockCalls()).writes.length;
    await page.goto(`${base}/coach`);
    must((await mockCalls()).writes.length === writes4, "opening Coach sends no message");
    must((await page.locator('[data-testid="own-message-text"]').inputValue()) === "Welcome to Evolve Omega", "the message starts as the welcome");
    await submit(page, '[data-testid="own-message-send"]');
    await page.locator('[data-testid="own-message-result"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="own-message-result"]').innerText()).startsWith("Sent."), "the card says the message was sent");
    const msgWrites = (await mockCalls()).writes.slice(writes4);
    must(JSON.stringify(msgWrites) === JSON.stringify(["PUT /api/external/v1/passes/pass.com.evolveomega/SER-eo-1/values/Push_Notification"]), `one write, to the coach's own pass's Push_Notification: ${msgWrites.join(", ")}`);
    const msgFields = ((await (await fetch(`${HOST}/__calls`)).json()) as { fields: Record<string, string> }).fields;
    must(msgFields["SER-eo-1/Push_Notification"] === "Welcome to Evolve Omega", "the message is on the pass");
    must(Boolean((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, coachM.id) }))!.eoPassLastPushAt), "the time of the last message is kept");
    console.log("✓ step D: one Latest Message on the coach's own pass, only on Send, one write");
    // Step E (H-734): on the coach's own program the desk check offers the coach's own pass, without hiding it. A new pass has
    // 0 available, so the check stops with words and writes nothing.
    const ownDesk = () => page.locator('[data-testid="own-program"] [data-testid="desk-settings"]');
    const ownCheck = async () => {
      await page.goto(`${base}/coach`);
      await ownDesk().locator("summary").evaluate((el) => ((el.parentElement as HTMLDetailsElement).open = true));
      await ownDesk().locator('[data-testid="desk-check-pass"]').selectOption("own");
      await submit(page, '[data-testid="own-program"] [data-testid="desk-check-run"]');
      return (await page.locator('[data-testid="own-program"] [data-testid="desk-check-note"]').textContent()) ?? "";
    };
    const writesE0 = (await mockCalls()).writes.length;
    const zeroNote = await ownCheck();
    must(zeroNote.startsWith("Your pass has 0 available"), `the check on a new own pass says it has nothing to deduct: ${zeroNote}`);
    must((await mockCalls()).writes.length === writesE0, "the check on a 0 pass writes nothing");
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="own-issue"]').check();
    await submit(page, '[data-testid="own-issue-save"]');
    must((await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, coachM.id) }))!.issuePasses, "Issue passes is on");
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/rewards`);
    await submit(page, '[data-testid="eo-pass-get"]');
    await page.locator('[data-testid="eo-pass-made"]').waitFor({ timeout: 20000 });
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaPass.id) }))!.eoCustomerId === "cus_eo_2", "the client's pass is made once passes are on");
    must(!(await page.content()).includes("cus_eo_") && !(await page.content()).includes("SER-eo-"), "no customer id or serial on the member's page");
    must((await mockCalls()).writes.length === writes3 + 2 + msgWrites.length, "two creates in all, one per pass, besides the one message");
    // Fix my pass (H-1699, plan H-1701): the coach's own press writes First_Name and Last_Name from HelixOS onto their own pass;
    // a client's pass waits until the coach ticks "Names update in place"; a name change reaches the pass only when switched on.
    // Never a Points write.
    await logout(page);
    await login(page, "As the coach");
    const fixStart = (await mock0()).writes.length;
    const coachUser = (await db.query.users.findFirst({ where: eq(schema.users.id, coachM.userId) }))!;
    const coachWant = fixFields(coachUser.name);
    await page.goto(`${base}/coach?connections=open`);
    must((await page.locator('[data-testid="member-pass-fix-run"]').first().isDisabled()), "Fix this pass is shut until the coach's own fix is proven");
    await submit(page, '[data-testid="own-pass-fix-run"]');
    await page.locator('[data-testid="own-pass-fix-result"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="own-pass-fix-result"]').innerText()).startsWith("Name sent to the pass."), "the card says the name was sent");
    let fx = await mock0();
    must(JSON.stringify(fx.writes.slice(fixStart)) === JSON.stringify(["First_Name", "Last_Name"].map((f) => `PUT /api/external/v1/passes/pass.com.evolveomega/SER-eo-1/values/${f}`)), `two writes, First_Name then Last_Name, on the coach's own pass: ${fx.writes.slice(fixStart).join(", ")}`);
    must(fx.fields["SER-eo-1/First_Name"] === coachWant[0].value && fx.fields["SER-eo-1/Last_Name"] === coachWant[1].value && !/enter your/i.test(fx.fields["SER-eo-1/Last_Name"]), "the coach's pass carries the HelixOS name, never the prompt");
    const mayaRowFix = page.locator(`[data-testid="member-pass-fix"]:has(input[value="${mayaPass.id}"])`);
    await page.goto(`${base}/coach?connections=open`);
    must(await mayaRowFix.locator('[data-testid="member-pass-fix-run"]').isDisabled(), "the client's Fix this pass is still shut before the tick");
    await page.locator('[data-testid="name-fix-proven"]').check();
    await submit(page, '[data-testid="name-fix-save"]');
    await page.goto(`${base}/coach?connections=open`);
    must((await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, coachM.id) }))!.nameFixProven, "Names update in place is kept");
    const mayaUser = (await db.query.users.findFirst({ where: eq(schema.users.id, mayaPass.userId) }))!;
    const fix2 = (await mock0()).writes.length;
    await submit(page, `[data-testid="member-pass-fix"]:has(input[value="${mayaPass.id}"]) [data-testid="member-pass-fix-run"]`);
    await page.locator('[data-testid="member-pass-fix-result"]').waitFor({ timeout: 20000 });
    fx = await mock0();
    must(fx.writes.slice(fix2).length === 2 && fx.writes.slice(fix2).every((w) => w.includes("/SER-eo-2/values/") && !w.endsWith("/Points")), `Fix this pass writes the client's two name fields only: ${fx.writes.slice(fix2).join(", ")}`);
    must(fx.fields["SER-eo-2/First_Name"] === fixFields(mayaUser.name)[0].value, "the client's pass carries her HelixOS first name");
    // The name change: off, nothing is sent; on, the new name goes to her pass. Her name is put back afterwards.
    const changeName = async (to: string) => {
      await logout(page);
      await login(page, "As a client");
      await page.goto(`${base}/settings`);
      await fillExact(page, '#you input[name="name"]', to);
      await submit(page, '#you form:has(input[name="name"]) button[type="submit"]');
      await page.waitForLoadState("networkidle");
    };
    const fix3 = (await mock0()).writes.length;
    await changeName("Smoke Rename");
    must((await mock0()).writes.length === fix3, "with fix on change off, a new name sends nothing");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach?connections=open`);
    await page.locator('[data-testid="fix-names-on-change"]').check();
    await submit(page, '[data-testid="name-fix-save"]');
    must((await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, coachM.id) }))!.fixNamesOnChange, "Fix on a name change is kept");
    await changeName("Smoke Again");
    fx = await mock0();
    must(fx.writes.slice(fix3).length === 2 && fx.fields["SER-eo-2/First_Name"] === "Smoke" && fx.fields["SER-eo-2/Last_Name"] === "Again", `a new name reaches her pass: ${fx.writes.slice(fix3).join(", ")}`);
    must(!fx.writes.slice(fixStart).some((w) => w.endsWith("/Points") || w.includes("/points/")), "no Points write and no points move from any fix");
    const fixWrites = (await mock0()).writes.slice(fixStart);
    await db.update(schema.users).set({ name: mayaUser.name }).where(eq(schema.users.id, mayaUser.id));
    await db.update(schema.leaderboardFeeds).set({ fixNamesOnChange: false }).where(eq(schema.leaderboardFeeds.membershipId, coachM.id));
    await logout(page);
    await login(page, "As the coach");
    console.log("✓ fix my pass: own press writes the two name fields, clients wait for the tick, a name change follows only when on, never Points");
    // The points sync and the invitations (H-867 parts 3 and 4): off until the coach turns them on; "own" reaches only the
    // coach's pass; each member's first sync is one opening move of their HelixOS total, then one move per new ledger row; the
    // Level and the kept rank (as Tier, H-1098) go to the pass when they change; an invitation is written once, only with a
    // booking link, and follows the kept rank; never Points.
    await logout(page);
    await login(page, "As the coach");
    const syncFeedRow = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, coachM.id) }))!;
    must(syncFeedRow.syncMode === "off" && syncFeedRow.inviteMode === "off", "the sync and the invitations start off");
    const mock = async () => (await (await fetch(`${HOST}/__calls`)).json()) as { writes: string[]; fields: Record<string, string>; balances: Record<string, { balance: number }> };
    const runCron = async () => (await (await fetch(`${base}/api/cron/leaderboards`, { headers: CRON })).json()) as { sync: { queued: number; fields: number; failed: number }[] };
    const syncStart = (await mock()).writes.length;
    const added: string[] = [];
    const award = async (userId: string, points: number) => {
      const id = crypto.randomUUID();
      added.push(id);
      await db.insert(schema.pointsLedger).values({ id, workspaceId: feedRow.workspaceId, userId, type: "bonus", points, reason: "Smoke: sync" });
    };
    const totalOf = async (userId: string) => (await db.select({ p: schema.pointsLedger.points }).from(schema.pointsLedger).where(and(eq(schema.pointsLedger.workspaceId, feedRow.workspaceId), eq(schema.pointsLedger.userId, userId)))).reduce((n, r) => n + r.p, 0);
    await award(coachM.userId, 120);
    let sb = await mock();
    await runCron();
    must((await mock()).writes.length === sb.writes.length, "with the sync off, the cron writes nothing to eLoyalty");
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="own-sync-mode"]').selectOption("own");
    await submit(page, '[data-testid="own-sync-save"]');
    must((await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, syncFeedRow.id) }))!.syncMode === "own", "Sync points saved as your own pass only");
    const coachTotal = await totalOf(coachM.userId);
    sb = await mock();
    await runCron();
    let sa = await mock();
    must(sa.balances["cus_eo_1"]?.balance === coachTotal, `the coach's pass got one opening move of the HelixOS total (${coachTotal}), saw ${sa.balances["cus_eo_1"]?.balance}`);
    must(sa.fields["SER-eo-1/Level"] === "Coach", "the coach's Level is on the pass");
    const coachTier = rankOf((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, coachM.id) }))!, coachTotal).name;
    must(sa.fields["SER-eo-1/Tier"] === coachTier, `the coach's kept rank is the pass's Tier (${coachTier}), saw ${sa.fields["SER-eo-1/Tier"]}`);
    must((sa.balances["cus_eo_2"]?.balance ?? 0) === 0 && !sa.fields["SER-eo-2/Level"], "nothing reaches a client while the sync is on your own pass only");
    must(JSON.stringify(sa.writes.slice(sb.writes.length).sort()) === JSON.stringify(["POST /api/public/admin/points/add", "PUT /api/external/v1/passes/pass.com.evolveomega/SER-eo-1/values/Level", "PUT /api/external/v1/passes/pass.com.evolveomega/SER-eo-1/values/Tier"].sort()), `one add, one Level and one Tier: ${sa.writes.slice(sb.writes.length).join(", ")}`);
    sb = sa;
    await runCron();
    must((await mock()).writes.length === sb.writes.length, "a second run sends nothing again");
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="own-sync-mode"]').selectOption("all");
    await submit(page, '[data-testid="own-sync-save"]');
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaPass.id) }))!;
    const mayaTotal = await totalOf(mayaM.userId);
    await runCron();
    sa = await mock();
    must(sa.balances["cus_eo_2"]?.balance === mayaTotal && sa.fields["SER-eo-2/Level"] === mayaM.programTier, `the client's opening move (${mayaTotal}) and Level (${mayaM.programTier}) once the sync is on for everyone`);
    await award(mayaM.userId, 15);
    await runCron();
    must((await mock()).balances["cus_eo_2"]?.balance === mayaTotal + 15, "a new award goes as one move of its own");
    // The invitation: an Accelerator member at Sentinel gets the Academy call once, only with its link. She reached Sentinel
    // before the 19 Oct table (H-1088): her points are below 5,000, but her kept rank is Sentinel, so the call and the Tier
    // follow the kept rank.
    const sentinel = TIERS.find((t) => t.name === "Sentinel")!.level;
    must(mayaTotal + 15 < 5000, `the client is below the new Sentinel line (${mayaTotal + 15})`);
    await db.update(schema.memberships).set({ programTier: "Accelerator", rankKeptLevel: sentinel }).where(eq(schema.memberships.id, mayaM.id));
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="own-invite-mode"]').selectOption("all");
    await submit(page, '[data-testid="own-invite-save"]');
    sb = await mock();
    await runCron();
    sa = await mock();
    must(!sa.fields["SER-eo-2/Current_Offer"], "with no booking link, no invitation is written");
    must(sa.fields["SER-eo-2/Tier"] === "Sentinel", `the client's kept rank, Sentinel, is the pass's Tier, saw ${sa.fields["SER-eo-2/Tier"]}`);
    const academyLink = "https://book.example/academy";
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="own-invite-academy"]').fill(academyLink);
    await submit(page, '[data-testid="own-invite-save"]');
    await runCron();
    sa = await mock();
    must(sa.fields["SER-eo-2/Offer_Link"] === academyLink && sa.fields["SER-eo-2/Current_Offer"] === "You've earned a call about Academy", "the Academy invitation is on the client's pass, with its link");
    must(!sa.fields["SER-eo-1/Current_Offer"], "the coach gets no invitation");
    sb = sa;
    await runCron();
    must((await mock()).writes.length === sb.writes.length, "the invitation goes once");
    sa = await mock();
    must(!sa.writes.slice(syncStart).some((w) => /\/values\/Points$/.test(w)), "the sync never writes Points");
    const tierWrites = sa.writes.slice(syncStart).filter((w) => /\/values\/Tier$/.test(w));
    must(tierWrites.length === 3, `Tier is written once per change: the coach's, the client's first, then her kept Sentinel (${tierWrites.length})`);
    const syncWrites = sa.writes.slice(syncStart);
    // Step E (H-734) again, once the sync has sent the coach's points: 1 off and 1 back on the coach's own pass, read back.
    const ownBefore = sa.balances["cus_eo_1"]?.balance ?? 0;
    const ownNote = await ownCheck();
    must(ownBefore > 1 && ownNote.startsWith(`Passed: deduct 1: available ${ownBefore} → ${ownBefore - 1}`), `the check on the coach's own pass (${ownBefore}): ${ownNote}`);
    const ownCheckWrites = (await mock()).writes.slice(sa.writes.length);
    must(JSON.stringify(ownCheckWrites) === JSON.stringify(["POST /api/public/admin/points/deduct", "POST /api/public/admin/points/add"]), `one deduct and one add on the coach's own pass: ${ownCheckWrites.join(", ")}`);
    must((await mock()).balances["cus_eo_1"]?.balance === ownBefore, "the coach's balance is back where it was");
    console.log("✓ step E: the desk check on the coach's own pass, without hiding it; stops with words at 0, then 1 off and 1 back");
    // Back as it was: both off, the client's program and links restored, the walk's own awards removed.
    await db.update(schema.leaderboardFeeds).set({ syncMode: "off", inviteMode: "off", inviteLinks: {} }).where(eq(schema.leaderboardFeeds.id, syncFeedRow.id));
    await db.update(schema.memberships).set({ programTier: mayaM.programTier, rankKeptLevel: mayaM.rankKeptLevel, eoLevelSent: null, eoTierSent: null, eoOffersSent: [] }).where(eq(schema.memberships.id, mayaM.id));
    await db.update(schema.memberships).set({ eoLevelSent: null, eoTierSent: null, eoOffersSent: [] }).where(eq(schema.memberships.id, coachM.id));
    await db.delete(schema.pointsLedger).where(inArray(schema.pointsLedger.id, added));
    console.log(`✓ the points sync and invitations: off by default and the cron writes nothing; your own pass first (one opening move of the total, the Level), then everyone; a new award is one move; the Academy invitation once, only with its link, never to the coach; the kept rank as Tier, once per change; never Points (${syncWrites.length} writes)`);

    await db.update(schema.memberships).set({ eoPassUrl: mayaPass.eoPassUrl, eoPassSerial: mayaPass.eoPassSerial, eoPassTypeId: mayaPass.eoPassTypeId, eoPassInstalledAt: mayaPass.eoPassInstalledAt, eoCustomerId: mayaPass.eoCustomerId }).where(eq(schema.memberships.id, mayaPass.id));
    await logout(page);
    await login(page, "As the coach");
    console.log("✓ the Evolve Omega pass: the coach's own program connected (the key never shown back); no Get my pass for a client while off; the coach's own pass made by one create, stored, with Add to wallet and its QR; then the client's once Issue passes is on");

    // Loyalty health (H-622 §2): one card per connected program, the coach's own first; the earlier busy refresh counted; a
    // typed certificate date, flagged on Coach under 30 days; Check all now stops at the first 429 and reads nothing else.
    await page.goto(`${base}/coach`);
    must((await page.locator('[data-testid="loyalty-health-link"]').count()) === 1, "Coach links to Loyalty health once a program is connected");
    must((await page.locator('[data-testid="loyalty-cert-flag"]').count()) === 0, "no certificate line before any date is typed");
    await page.goto(`${base}/coach/loyalty-health`);
    const lhRows = page.locator('[data-testid="lh-row"]');
    must((await lhRows.count()) === 2, `two programs on Loyalty health, saw ${await lhRows.count()}`);
    const lhNames = await page.locator('[data-testid="lh-name"]').allTextContents(); // as written: card titles show in capitals
    must(lhNames[0]?.includes("(your own program)"), `the coach's own program comes first: saw ${lhNames.length} cards, own first ${String(lhNames[0]?.includes("(your own program)"))}, own anywhere ${String(lhNames.some((n) => n.includes("(your own program)")))}`);
    const lhText = await page.locator("main").innerText();
    must(/Busy answers \(429\) in 24 hours: 1\b/.test(lhText), `the earlier busy refresh is counted on the client's program: ${(lhText.match(/Busy answers[^\n]*/g) ?? []).join(" | ")}`);
    must(!lhText.includes(ELOYALTY_KEY) && !(await page.content()).includes(ELOYALTY_KEY), "no key on Loyalty health");
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const ownCard = page.locator('[data-testid="lh-row"]').first();
    await ownCard.locator('[data-testid="lh-pass"]').fill("pass.com.evolveomega");
    await ownCard.locator('[data-testid="lh-expiry"]').fill(soon);
    await submit(page, '[data-testid="lh-row"] >> nth=0 >> [data-testid="lh-cert-save"]');
    await page.locator('[data-testid="lh-saved"]').waitFor({ timeout: 20000 });
    const ownFeed = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, coachM.id) }))!;
    must(ownFeed.passTypeId === "pass.com.evolveomega" && ownFeed.certExpiresAt === soon, "the Pass Type ID and date are saved on the coach's own program");
    must(/20 days left|19 days left/.test(await page.locator('[data-testid="lh-cert"]').first().innerText()), "the certificate shows its days left");
    await page.locator('[data-testid="lh-row"]').first().locator('[data-testid="lh-pass"]').fill("not a pass id");
    await submit(page, '[data-testid="lh-row"] >> nth=0 >> [data-testid="lh-cert-save"]');
    await page.locator('[data-testid="lh-error"]').waitFor({ timeout: 20000 });
    must((await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, ownFeed.id) }))!.passTypeId === "pass.com.evolveomega", "a bad Pass Type ID is refused and nothing changes");
    await page.goto(`${base}/coach`);
    must(/Your own program: certificate (20|19) days left/.test(await page.locator('[data-testid="loyalty-cert-flag"]').innerText()), "Coach names the program with under 30 days left");
    await page.goto(`${base}/coach/loyalty-health`);
    const lhBefore = await mockCalls();
    await fetch(`${HOST}/__mode?status=429`);
    await submit(page, '[data-testid="lh-check-all"]');
    await page.locator('[data-testid="lh-checked"]').waitFor({ timeout: 30000 });
    await fetch(`${HOST}/__mode?status=200`);
    must((await page.locator('[data-testid="lh-checked"]').innerText()).includes("stopped there"), "Check all now stops at a 429 and says so");
    const lhAfter = await mockCalls();
    must(lhAfter.calls === lhBefore.calls + 1 && lhAfter.writes.length === lhBefore.writes.length, `one read and no write before stopping: ${lhAfter.calls - lhBefore.calls} calls`);
    await page.goto(`${base}/coach/loyalty-health`);
    await submit(page, '[data-testid="lh-check-all"]');
    await page.locator('[data-testid="lh-checked"]').waitFor({ timeout: 30000 });
    must((await page.locator('[data-testid="lh-checked"]').innerText()).startsWith("Checked 2 of 2: 2 passed"), `Check all now passes both once eLoyalty answers: ${await page.locator('[data-testid="lh-checked"]').innerText()}`);
    must((await mockCalls()).writes.length === lhBefore.writes.length, "Check all now wrote nothing to eLoyalty");
    await db.update(schema.leaderboardFeeds).set({ passTypeId: null, certExpiresAt: null }).where(eq(schema.leaderboardFeeds.id, ownFeed.id));
    console.log("✓ Loyalty health: both programs listed, the coach's own first, the earlier 429 counted, no key shown; a typed certificate saved, a bad one refused, Coach names it under 30 days; Check all now stops at a 429 after one read, then passes both, writing nothing");

    // Before a key: the coach removes it; the pasted export stands in, stripped on save; with nothing, 503 and the samples.
    await page.goto(`${base}/coach?connections=open`);
    must((await page.locator('li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-row"]').getAttribute("open")) !== null, "a client with a feed shows the block open");
    await submit(page, 'li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-remove"]');
    must((await fetch(url)).status === 503, "with the key removed and no export the feed answers 503");
    body = await (await fetch(pageUrl)).text();
    must(body.includes('data-source="sample"') && body.includes("SAMPLE DATA") && body.includes(">James O.<") && !body.includes(">Rafa D.<"), "the page shows the design's sample people (invented), marked, not the pass's members");
    must(!(await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedRow.id) }))!.keyEncrypted, "the key is gone");
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/loyalty`);
    const csv = "First Name,Last Name,Email,Phone,Customer ID,Lifetime KK,Available KK\nAisha,Patel,aisha@example.com,+1 555 123 4567,cus_901,1105,405\nJohn,Doe,jd@example.com,,cus_902,100,100\nMaria,Santos,maria@example.com,,cus_001,2450,900\nRosa,Garcia,rosa@example.com,,cus_903,40,40";
    await fillExact(page, '[data-testid="lb-export"]', csv);
    await fillExact(page, '[data-testid="lb-export-as-of"]', "13 Oct 2026");
    await submit(page, '[data-testid="lb-export-save"]');
    const stored = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedRow.id) }))!;
    must(stored.exportJson === JSON.stringify(parseExport(csv, ["cus_001"]).rows) && clean(stored.exportJson!) && !stored.exportJson!.includes("Patel"), "only First L., lifetime and available are stored from the paste; the hidden id applied once and gone");
    res = await fetch(url);
    body = await res.text();
    must(res.status === 200 && (JSON.parse(body) as { members: { name: string }[] }).members.map((x) => x.name).join(",") === "Aisha P.,Rosa G." && clean(body), `the feed serves the export: ${body}`);
    body = await (await fetch(pageUrl)).text();
    must(body.includes('data-source="export"') && body.includes("Updated 13 Oct 2026") && body.includes(">Aisha P.<") && !body.includes("SAMPLE DATA") && cleanPage(body), "the page serves the export, dated");
    console.log("✓ before a key: Remove key falls back to the samples; a pasted export is stripped on save and served, dated");

    const writes = (await mockCalls()).writes;
    // The only writes are the Points desk's moves (H-493), each an add or a deduct by customer id: never a set, never anything else.
    const create = `POST /api/external/v1/templates/${TEMPLATES[1].id}/pass`;
    must(JSON.stringify(writes) === JSON.stringify(["POST /api/public/admin/points/deduct", "POST /api/public/admin/points/add", "POST /api/public/admin/points/deduct", "POST /api/public/admin/points/add", create, ...msgWrites, create, ...fixWrites, ...syncWrites, ...ownCheckWrites]), `HelixOS writes to eLoyalty only the desk's four moves, as adds and deducts, the two passes made by template, the one message, the six name writes of Fix my pass, the sync's moves and fields, and the check on the coach's own pass: ${writes.join(", ")}`);
    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\nleaderboard walk passed");
  } finally {
    await browser.close();
    try {
      process.kill(-mock.pid!);
    } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
