/**
 * A client's loyalty-pass leaderboard (rev 639): the coach pastes the client's eLoyalty key on their /coach row, Connect and
 * check says what it found (and asks for the template when there are several), the key is never shown again (its last four
 * only, and nowhere on the client's Settings or in the feed). The public feed reads with no session and CORS *, carries first
 * names, initials, points and tiers in the shape the page reads, and nothing that reaches a person. The client's hide list
 * applies at once; a busy eLoyalty serves the last good board; Remove key answers 503. HelixOS never writes to eLoyalty.
 * Runs against scripts/mock-eloyalty.ts.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import { CUSTOMERS, ELOYALTY_KEY, TEMPLATES } from "./fixtures/eloyalty";

const base = process.argv[2] ?? "http://localhost:3000";
const port = 4080;
const HOST = `http://localhost:${port}`;
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
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-eloyalty.ts", String(port)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { buildFeed } = await import("@/lib/engine/leaderboard");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500 && !r.url().includes("/api/public/leaderboard/")) failures.push(`${r.status()} ${r.url()}`);
    });
    const tpl = TEMPLATES[0].id;
    const expected = (hidden: string[]) => buildFeed(CUSTOMERS.filter((c) => c.is_active && c.template_id === tpl), hidden, "x").members;

    // The coach connects Maya's key; with several templates the check says so and names them.
    await login(page, "As the coach");
    await page.goto(`${base}/coach`);
    const row = page.locator("li", { has: page.locator('form:has(input[name="eoPassUrl"][value*="maya-torres"])') }).first();
    await row.waitFor({ timeout: 15000 });
    const box = row.locator('[data-testid="leaderboard-row"]');
    await box.locator("summary").click();
    await box.locator('[data-testid="leaderboard-key"]').fill(ELOYALTY_KEY);
    await box.locator('[data-testid="leaderboard-host"]').fill(HOST);
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-connect"]`);
    let check = await row.locator('[data-testid="leaderboard-check"]').innerText();
    must(check.startsWith(`Connected on localhost:${port}: `) && check.includes("several templates") && check.includes(TEMPLATES[0].name) && !check.includes("Test"), `the check names the templates to choose from: ${check}`);
    // The template pasted, the key left blank (kept): the board is the pass's members, the fields named, never a value.
    await row.locator('[data-testid="leaderboard-template"]').fill(tpl);
    await submit(page, `li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-connect"]`);
    check = await row.locator('[data-testid="leaderboard-check"]').innerText();
    const active = CUSTOMERS.filter((c) => c.is_active && c.template_id === tpl).length;
    must(check.startsWith(`Connected on localhost:${port}: ${expected([]).length} on the board of ${active} active; fields seen: email, first_name, id,`), `the check: host, count and field names: ${check}`);
    must(!check.includes("@") && !check.includes("Santos"), "the check note carries field names, never a value");
    const coachHtml = await page.content();
    must(!coachHtml.includes(ELOYALTY_KEY) && coachHtml.includes(`…${ELOYALTY_KEY.slice(-4)}`), "the coach sees the key's last four only");
    const feedRow = (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, m.id) }))!;
    must(feedRow.keyEncrypted?.startsWith("enc:v1:") && !feedRow.keyEncrypted.includes(ELOYALTY_KEY), "the key is sealed at rest");
    console.log(`✓ Connect and check: the templates named, then ${expected([]).length} on the board, fields named; the key sealed and shown as its last four`);

    // The public feed: no session, CORS *, the shape the page reads, nothing that reaches a person.
    const url = `${base}/api/public/leaderboard/${feedRow.slug}`;
    let res = await fetch(url, { redirect: "manual" });
    let body = await res.text();
    must(res.status === 200 && res.headers.get("access-control-allow-origin") === "*", `the feed answers anyone: ${res.status}`);
    let feed = JSON.parse(body) as { updated_at: string; members: unknown[] };
    must(JSON.stringify(feed.members) === JSON.stringify(expected([])) && !Number.isNaN(Date.parse(feed.updated_at)), `the members as mapped: ${body}`);
    must(!body.includes("@") && !/\d{7,}/.test(body) && !body.includes(ELOYALTY_KEY) && !body.includes("cus_") && !body.includes("SER-") && !body.includes("Santos"), "no email, phone, id, serial, last name or key in the feed");
    must((await fetch(url, { method: "OPTIONS" })).headers.get("access-control-allow-origin") === "*", "the preflight answers too");
    must((await fetch(`${base}/api/public/leaderboard/no-such-feed-1`)).status === 503, "an unknown address is 503");
    console.log(`✓ the feed: no session, CORS *, ${feed.members.length} members as First L. with points and tier, nothing else`);

    // Maya's Settings: connected, the link, her hide list; never the key. She hides one: gone at once.
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/settings#leaderboard`);
    await page.locator('[data-testid="leaderboard-state"]').waitFor();
    must((await page.locator('[data-testid="leaderboard-state"]').innerText()).includes("connected") && (await page.locator('[data-testid="leaderboard-feed-link"]').innerText()).endsWith(`/api/public/leaderboard/${feedRow.slug}`), "Settings says connected, with the feed link");
    const settingsHtml = await page.content();
    must(!settingsHtml.includes(ELOYALTY_KEY) && !settingsHtml.includes(ELOYALTY_KEY.slice(-6)), "the key is nowhere on the client's Settings");
    await page.fill('[data-testid="leaderboard-hidden"]', "cus_001\n");
    await submit(page, '[data-testid="leaderboard-hide-save"]');
    feed = JSON.parse(await (await fetch(url)).text());
    must(JSON.stringify(feed.members) === JSON.stringify(expected(["cus_001"])), "a hidden member is off the board at once");
    console.log("✓ the client's Settings: connected, the link, the hide list (never the key); a hidden member off the board at once");

    // eLoyalty busy: the last good board is served. Remove key: 503.
    await fetch(`${HOST}/__mode?status=429`);
    await db.update(schema.leaderboardFeeds).set({ cachedAt: "2000-01-01T00:00:00.000Z" }).where(eq(schema.leaderboardFeeds.id, feedRow.id));
    res = await fetch(url);
    body = await res.text();
    must(res.status === 200 && JSON.stringify((JSON.parse(body) as { members: unknown[] }).members) === JSON.stringify(expected(["cus_001"])), `a 429 serves the last good board: ${res.status} ${body.slice(0, 120)}`);
    await fetch(`${HOST}/__mode?status=200`);
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach`);
    // The block opens by itself once a client has a feed.
    must(await page.locator('li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-row"]').getAttribute("open") !== null, "a client with a feed shows the block open");
    await submit(page, 'li:has(input[name="eoPassUrl"][value*="maya-torres"]) [data-testid="leaderboard-remove"]');
    must((await fetch(url)).status === 503, "with the key removed the feed answers 503");
    must(!(await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedRow.id) }))!.keyEncrypted, "the key is gone");
    const writes = ((await (await fetch(`${HOST}/__calls`)).json()) as { writes: string[] }).writes;
    must(writes.length === 0, `HelixOS never writes to eLoyalty: ${writes.join(", ")}`);
    console.log("✓ a busy eLoyalty serves the last good board; Remove key answers 503; nothing was ever written to eLoyalty");

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
