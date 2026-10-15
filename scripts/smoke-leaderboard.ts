/**
 * A client's loyalty-pass leaderboard (rev 639, H-29): the coach pastes the client's eLoyalty key on their /coach row, Connect and
 * check says what it found (and asks for the template when there are several), the key is never shown again (its last four
 * only, and nowhere on the client's pages, the feed or the hosted page). The public feed reads with no session and CORS *,
 * carries first names, initials, points and tiers in the shape the page reads, and nothing that reaches a person. The hosted
 * page /lb/<slug> renders the same members server-side, with the client's words, tiers and rewards from /loyalty, and can be
 * framed. A visitor never makes HelixOS call eLoyalty: the cron is the one reader, and a busy eLoyalty leaves the last good
 * board in place. Before a key is in, a pasted export (stripped on save) stands in; with nothing, the feed answers 503 and
 * the page shows the design's samples. HelixOS never writes to eLoyalty. Runs against scripts/mock-eloyalty.ts.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import { CUSTOMERS, ELOYALTY_KEY, TEMPLATES } from "./fixtures/eloyalty";

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
    const { eq } = await import("drizzle-orm");
    const { DEFAULT_PAGE, buildFeed, parseExport } = await import("@/lib/engine/leaderboard");
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
    must(feed.members.some((x) => x.lifetime === 0) && feed.members.every((x) => /^Gate \d$/.test(x.tier)), "0-point members are on by default and every tier is a configured gate, not eLoyalty's");
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
    must(body.includes("SAMPLE COSTS · TO CONFIRM") && body.includes("Gate 1") && !body.includes("SAMPLE DATA"), "sample rewards and tiers are marked, the members are real");
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
    await page.goto(`${base}/settings#leaderboard`);
    await page.locator('[data-testid="leaderboard-state"]').waitFor();
    must((await page.locator('[data-testid="leaderboard-state"]').innerText()).includes("connected") && (await page.locator('[data-testid="leaderboard-page-link"]').innerText()).endsWith(`/lb/${feedRow.slug}`), "Settings says connected, with the page link");
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
    await fillExact(page, '[data-testid="lb-slug"]', "kindness-walk");
    await submit(page, '[data-testid="lb-slug-save"]');
    await page.locator('[data-testid="lb-slug-changed"]').waitFor();
    const moved = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedRow.id) }))!;
    must(moved.slug === "kindness-walk" && JSON.stringify(moved.hidden) === JSON.stringify(["cus_001"]), `the address changed and the hide list carried over: ${moved.slug}`);
    must((await page.locator('[data-testid="leaderboard-page-link"]').innerText()).endsWith("/lb/kindness-walk"), "the page link shows the new address");
    res = await fetch(`${base}/lb/${oldSlug}`, { redirect: "manual" });
    must(res.status === 308 && (res.headers.get("location") ?? "").endsWith("/lb/kindness-walk"), `the old address is a permanent redirect: ${res.status} ${res.headers.get("location")}`);
    must((await fetch(`${base}/lb/kindness-walk`)).status === 200, "the new address serves the page");
    const feedOld = await (await fetch(url)).text();
    const feedNew = await (await fetch(`${base}/api/public/leaderboard/kindness-walk`)).text();
    must(feedOld === feedNew && (JSON.parse(feedNew) as { members: unknown[] }).members.length > 0, "the feed answers the same on both addresses");
    await db.delete(schema.leaderboardFeeds).where(eq(schema.leaderboardFeeds.id, otherFeed.id));
    console.log("✓ the page address: reserved and taken refused, a new one live at once, the old one a 308 and its feed still answering");

    pageUrl = `${base}/lb/kindness-walk`;
    // Before a key: the coach removes it; the pasted export stands in, stripped on save; with nothing, 503 and the samples.
    await logout(page);
    await login(page, "As the coach");
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
    must(writes.length === 0, `HelixOS never writes to eLoyalty: ${writes.join(", ")}`);
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
