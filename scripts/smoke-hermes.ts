/**
 * Hermes: the HelixOS-hosted Magic funnel pages (/mf/<code>, /mf/w/<webinar>), against the coach's own webinar.
 *  1. No hermes_pages table (a database migration 0153 hasn't reached): the switch reads off; mf_prepare keeps the GoHighLevel link; the pages
 *     are the quiet "no call open" page; the settings page says it can't save yet. Nothing breaks.
 *  2. The table arrives; the coach turns "Host pages in HelixOS" on with a YouTube video and a Meta Pixel.
 *  3. Personal: mf_prepare hands out <HelixOS>/mf/<43-character code> with nothing personal in it; once the engine has written
 *     the page, the whole page is theirs (header, why it fits, pillars in their order with "for you" lines, the example, their
 *     doubt answered), the form filled on the server, noindex, no pixel. At 390 and 360: nothing wider than the screen, every
 *     tap target 44px or more.
 *  4. Opened before the engine is done: about five seconds' wait, then the default copy with their name; the personal copy on
 *     the next open.
 *  5. Registering: the confirmation (their name, ticket, PT and ET, the join link, the nocookie video, Google Calendar and the
 *     .ics, the CompleteRegistration beacon); the Magic funnel row registered "helixos" and counted; GoHighLevel has the
 *     contact, ic-registered, ic-<date> and the event date; the page now goes straight to the confirmation.
 *  6. "Not you? Clear the form": a new sign-up; the bot's prospect stays unregistered.
 *  7. Cold: the empty form, the PageView beacon; a sign-up that GoHighLevel refuses still reaches its confirmation, and counts.
 *  8. An unknown code is the cold page; a past call is the quiet page; switched off, mf_prepare goes back to GoHighLevel.
 *  9. The preview on the settings page. And the server log holds no name, email or phone from this walk.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ||= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const GHL_PORT = 4081;
const must = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function login(page: Page) {
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}
let rpcId = 0;
async function call(token: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/api/bot-mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  const json = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  return { text: json.result?.content?.[0]?.text ?? "", isError: Boolean(json.result?.isError) };
}
const up = (port: number) => fetch(`http://localhost:${port}/`).then(() => true).catch(() => false);
async function ensure(script: string, port: number) {
  if (await up(port)) return null;
  const child = spawn("npx", ["tsx", script, String(port)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60 && !(await up(port)); i++) await sleep(250);
  must(await up(port), `${script} answers on ${port}`);
  return child;
}

/** Phones: nothing wider than the screen, and every visible control in the page 44px tall or more. */
async function phoneChecks(page: Page, label: string) {
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const root = document.querySelector(".hm-root");
      const small: string[] = [];
      let controls = 0;
      for (const el of Array.from(root?.querySelectorAll("a, button, input:not([type=hidden]), summary") ?? [])) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || getComputedStyle(el).visibility === "hidden") continue;
        controls++;
        if (b.height < 44) small.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(b.height)}px`);
      }
      return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, controls, small };
    });
    must(r.scroll <= r.inner, `${label} at ${width}: nothing wider than the screen (${r.scroll} > ${r.inner})`);
    must(r.controls >= 2, `${label} at ${width}: the controls were found (${r.controls})`);
    must(!r.small.length, `${label} at ${width}: tap targets under 44px: ${r.small.join("; ")}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like, sql } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { addDays, todayInTz } = await import("@/lib/dates");
  const { seal } = await import("@/lib/crypto");
  const { makeBotKey } = await import("@/lib/bot-mcp/data");
  const { factsFor } = await import("@/lib/mf/data");
  const { callWhen } = await import("@/lib/hermes/when");
  const { hermesPages } = await import("@/db/schema-hermes");

  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const mem = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const ws = mem.workspaceId;
  const tz = "America/Los_Angeles";
  await db.update(schema.memberships).set({ timezone: tz, mfDailyCap: 300 }).where(eq(schema.memberships.id, mem.id));
  const m = { workspaceId: ws, userId: coach.id };
  for (const p of ["hermes:%", "mf:%", "botmcp:%"]) await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, p));

  // The coach's own call next week, on its GoHighLevel registration page, with its Magic funnel live; nothing else upcoming.
  await db.update(schema.webinars).set({ status: "delivered", scheduledAt: null }).where(and(eq(schema.webinars.workspaceId, ws), eq(schema.webinars.userId, coach.id)));
  const webinarId = newId();
  const day = addDays(todayInTz(tz), 7);
  await db.insert(schema.webinars).values({ id: webinarId, workspaceId: ws, userId: coach.id, title: "Inner Circle Call with Danno", status: "scheduled", scheduledAt: `${day}T10:00`, registrationUrl: "https://go.example.com/ic", joinUrl: "https://zoom.us/j/1234567890", promise: "Turn the conversations you already have into booked clients", outcomes: [], audience: "Coaches" });
  const w = (await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!;
  const when = callWhen(factsFor(w, tz).startsAt!, tz);
  await db.insert(schema.mfSetups).values({
    id: newId(),
    workspaceId: ws,
    userId: coach.id,
    webinarId,
    live: true,
    pillars: [
      { id: "p1", title: "Stop chasing the system. Start building yours.", copy: "Right message, right channel, right time." },
      { id: "p2", title: "Forget the fear. Focus on the formula.", copy: "Six simple steps to your first bot." },
      { id: "p3", title: "Connection over competition. Every time.", copy: "Go where your people are and talk to them like people." },
    ],
    agenda: [{ id: "a1", line: "The 5-step lead campaign" }],
    defaults: { header: "", subheader: "", ctaLabel: "Save my seat, {first name}", whyYou: [], exampleTitle: "", example: "", objection: { objection: "", answer: "" }, urgency: "", emotional: "Default emotional.", logical: "Default logical.", ticketTitle: "", bring: [] },
  });
  const key = await makeBotKey(m, coach.id);

  // GoHighLevel: the coach's own connection, pointed at the walk's stand-in.
  const ghl = await ensure("scripts/mock-ghl-hermes.ts", GHL_PORT);
  const ai = await ensure("scripts/mock-ai.ts", 4020);
  await fetch(`http://localhost:${GHL_PORT}/__reset`);
  const integ = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.provider, "gohighlevel")) });
  if (integ) await db.update(schema.integrations).set({ enabled: true, config: { ...integ.config, apiUrl: `http://localhost:${GHL_PORT}` } }).where(eq(schema.integrations.id, integ.id));
  else await db.insert(schema.integrations).values({ id: newId(), workspaceId: ws, provider: "gohighlevel", enabled: true, config: { apiUrl: `http://localhost:${GHL_PORT}` } });
  await db.delete(schema.socialConnections).where(and(eq(schema.socialConnections.userId, coach.id), eq(schema.socialConnections.provider, "gohighlevel")));
  await db.insert(schema.socialConnections).values({ id: newId(), workspaceId: ws, userId: coach.id, provider: "gohighlevel", locationId: "loc_hermes", manualToken: seal("pit-loc_hermes") });
  const ghlContacts = async () => ((await (await fetch(`http://localhost:${GHL_PORT}/__contacts`)).json()) as { contacts: { email?: string; tags: string[]; customFields: Record<string, string>; source?: string }[] }).contacts;

  const logFile = "screenshots/logs/dev.log";
  const logStart = existsSync(logFile) ? statSync(logFile).size : 0;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  const beacons: string[] = [];
  await ctx.route("https://www.facebook.com/tr**", (route) => {
    beacons.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACwAAAAAAQABAAA=", "base64") });
  });
  await ctx.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>video</p>" }));
  const signup = (email: string) => db.query.webinarSignups.findFirst({ where: and(eq(schema.webinarSignups.webinarId, webinarId), eq(schema.webinarSignups.email, email)) });

  try {
    // 1. No table yet.
    await db.run(sql`drop table if exists hermes_pages`);
    let r = await call(key, "mf_prepare", { contact_id: "cl_h1", first_name: "Sam", last_name: "Lee", email: "sam.hermes@example.com", phone: "+1 555 0101", pain: "reels get likes but no consults", industry: "pilates studio" });
    must(!r.isError, `mf_prepare answers: ${r.text}`);
    let url = new URL((JSON.parse(r.text) as { personal_url: string }).personal_url);
    must(url.origin === "https://go.example.com" && url.searchParams.get("mf"), `no table: the GoHighLevel link, as before: ${url}`);
    const samCode = url.searchParams.get("mf")!;
    await page.goto(`${base}/mf/${samCode}`);
    await page.locator('[data-testid="hm-closed"]').waitFor({ timeout: 60000 });
    await page.goto(`${base}/mf/w/${webinarId}`);
    await page.locator('[data-testid="hm-closed"]').waitFor({ timeout: 60000 });
    const coachPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    coachPage.on("response", (x) => {
      if (x.status() >= 500) failures.push(`${x.status()} ${x.url()}`);
    });
    await login(coachPage);
    await coachPage.goto(`${base}/webinars/${webinarId}/magic-funnel`);
    await coachPage.locator('[data-testid="mf-helixos-pages"]').click();
    await coachPage.waitForURL(/helixos-pages/);
    await coachPage.locator('[data-testid="hm-no-table"]').waitFor({ timeout: 30000 });
    console.log("✓ no table: switch off, mf_prepare keeps the GoHighLevel link, the pages are the quiet page, settings say they can't save yet");

    // 2. The table arrives (from its migration in drizzle/); the coach switches it on.
    const migration = readdirSync("drizzle").find((f) => /^\d{4}_hermes_pages\.sql$/.test(f));
    must(migration, "the hermes_pages migration is in drizzle/");
    const ddl = readFileSync(`drizzle/${migration}`, "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    must(ddl.length === 3, `the migration has its three statements (${ddl.length})`);
    for (const s of ddl) await db.run(sql.raw(s));
    await coachPage.reload();
    must(!(await coachPage.locator('[data-testid="hm-no-table"]').count()), "the table is there now");
    await coachPage.check('[data-testid="hm-host-on"]');
    await coachPage.fill('input[name="videoUrl"]', "https://youtu.be/dQw4w9WgXcQ");
    await coachPage.fill('input[name="pixelId"]', "1234567890123456");
    await coachPage.check('input[name="pixelOn"]');
    await Promise.all([coachPage.waitForURL(/saved=1/, { timeout: 60000 }), coachPage.locator('[data-testid="hm-settings"] button[type="submit"]').click()]);
    const row = (await db.select().from(hermesPages).where(eq(hermesPages.webinarId, webinarId)))[0];
    must(row?.hostOn && row.pixelOn && row.pixelId === "1234567890123456" && row.videoUrl === "https://youtu.be/dQw4w9WgXcQ", `the settings saved: ${JSON.stringify(row)}`);
    must((await coachPage.locator('[data-testid="hm-cold-url"]').innerText()).endsWith(`/mf/w/${webinarId}`), "the cold address is shown");
    console.log("✓ the coach switched HelixOS pages on, with the video and the Pixel");

    // 3. Personal.
    r = await call(key, "mf_prepare", { contact_id: "cl_h1", first_name: "Sam", last_name: "Lee", email: "sam.hermes@example.com", phone: "+1 555 0101", pain: "reels get likes but no consults", industry: "pilates studio" });
    const personalUrl = (JSON.parse(r.text) as { personal_url: string }).personal_url;
    url = new URL(personalUrl);
    must(url.pathname === `/mf/${samCode}` && !url.search, `the HelixOS address with the same code, nothing else: ${personalUrl}`);
    must(!/sam|lee|example|555|pilates/i.test(personalUrl), "nothing personal in the link");
    let sam = (await signup("sam.hermes@example.com"))!;
    for (let i = 0; i < 60 && (sam.pitchStatus === "writing" || !sam.pitch); i++) {
      await sleep(500);
      sam = (await signup("sam.hermes@example.com"))!;
    }
    must(sam.pitch && sam.pitchStatus !== "default", `the engine wrote their page: ${sam.pitchStatus} ${sam.pitchNote}`);
    const res = await page.goto(personalUrl.replace(/^https?:\/\/[^/]+/, base));
    must(res && res.status() === 200, "the personal page answers");
    const landing = page.locator('[data-testid="hm-landing"]');
    await landing.waitFor({ timeout: 60000 });
    must((await landing.getAttribute("data-page")) === "personal" && (await landing.getAttribute("data-copy")) === "personal", "their page, their copy");
    must((await page.locator('[data-testid="hm-header"]').innerText()) === sam.pitch!.hero.header, "the header is the engine's");
    must((await page.locator(".hm-eyebrow").innerText()).toLowerCase().startsWith("sam, this one is for you"), "the eyebrow names them");
    must((await page.locator('[data-testid="hm-why-you"] .hm-why').count()) === 3, "why this call fits them: three points");
    const titles = await page.locator('[data-testid="hm-part"] h3').allInnerTexts();
    const wantOrder = sam.pitch!.pillars.order.map((id) => ({ p1: "Stop chasing", p2: "Forget the fear", p3: "Connection over" })[id as "p1"]);
    must(titles.length === 3 && titles.every((t, i) => t.startsWith(wantOrder[i])), `the pillars in their order: ${titles.join(" | ")}`);
    must((await page.locator('[data-testid="hm-for-you"]').count()) === 3, "a for-you line on each pillar");
    must((await page.locator('[data-testid="hm-example"]').innerText()).startsWith("EXAMPLE"), "the example, labelled");
    must((await page.locator('[data-testid="hm-objection"] summary').innerText()) === sam.pitch!.objection.objection, "their likely doubt, answered first");
    must((await page.locator('input[name="firstName"]').inputValue()) === "Sam" && (await page.locator('input[name="email"]').inputValue()) === "sam.hermes@example.com", "the form filled on the server");
    must((await page.locator('[data-testid="hm-when"]').innerText()).includes(when.day) && (await page.locator('[data-testid="hm-when-card"]').innerText()).includes(`${when.full} · 60 minutes`), `the date named: ${when.line}`);
    const html = await page.content();
    must(!/this friday|weekly|replay/i.test(await page.locator(".hm-root").innerText()), "never 'this Friday', 'weekly' or a replay");
    must(/<meta name="robots" content="[^"]*noindex/.test(html), "noindex");
    must(!(await page.locator('[data-testid^="hm-pixel"]').count()), "no pixel on a personal page");
    must(await page.locator('[data-testid="hm-countdown"]').count(), "the countdown");
    await phoneChecks(page, "the personal page");
    must((await signup("sam.hermes@example.com"))!.openedAt, "the first open recorded");
    console.log("✓ personal: <HelixOS>/mf/<code>, the engine's sections in the gold page, the form filled server-side, noindex, no pixel, fine at 390 and 360");

    // 4. Opened before the engine is done.
    const jo = { id: newId(), code: randomBytes(32).toString("base64url") };
    await db.insert(schema.webinarSignups).values({ id: jo.id, workspaceId: ws, userId: coach.id, webinarId, firstName: "Jo", email: "jo.hermes@example.com", pageCode: jo.code, source: "mf", pitchStatus: "writing" });
    const t0 = Date.now();
    await page.goto(`${base}/mf/${jo.code}`);
    await landing.waitFor({ timeout: 60000 });
    const waited = Date.now() - t0;
    must(waited >= 4500 && waited < 20000, `it waited about five seconds for the engine (${waited} ms)`);
    must((await landing.getAttribute("data-copy")) === "default" && (await page.locator('[data-testid="hm-header"]').innerText()).startsWith("If you are posting every day"), "then the default copy");
    must((await page.locator('[data-testid="hm-hero-cta"]').innerText()).toUpperCase().includes("SAVE MY SEAT, JO"), "with their name on the button");
    await db.update(schema.webinarSignups).set({ pitch: { ...sam.pitch!, hero: { ...sam.pitch!.hero, header: "Ready now: your page, Jo" } }, pitchStatus: "personal" }).where(eq(schema.webinarSignups.id, jo.id));
    await page.goto(`${base}/mf/${jo.code}`);
    must((await page.locator('[data-testid="hm-header"]').innerText()) === "Ready now: your page, Jo", "the personal copy on the next open");
    console.log(`✓ opened before the engine finished: waited ${waited} ms, then the default copy; the personal copy on the next open`);

    // 5. Registering on Sam's page.
    await page.goto(`${base}/mf/${samCode}`);
    await page.fill('input[name="phone"]', "+1 555 0199");
    await Promise.all([page.waitForURL(new RegExp(`/mf/${samCode}/confirmed$`), { timeout: 60000 }), page.locator('[data-testid="hm-submit"]').click()]);
    must((await page.locator('[data-testid="hm-youre-in"]').innerText()).replace(/\s+/g, " ") === "You're in, Sam.", "You're in, Sam.");
    must((await page.locator('[data-testid="hm-ticket"]').innerText()).toUpperCase() === (sam.pitch!.confirmation.ticket_title || w.title).toUpperCase(), "their ticket title");
    must((await page.locator('[data-testid="hm-ticket-time"]').innerText()) === `${when.time} · ${when.timeEt}`, "PT and ET");
    must((await page.locator('[data-testid="hm-join"] a').getAttribute("href")) === "https://zoom.us/j/1234567890", "the webinar entry's join link");
    must((await page.locator('[data-testid="hm-video"]').getAttribute("src"))?.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "the thank-you video from youtube-nocookie.com");
    const google = new URL((await page.locator('[data-testid="hm-google"]').getAttribute("href"))!);
    must(google.hostname === "calendar.google.com" && google.searchParams.get("dates")?.startsWith(when.startsAt.replace(/[-:]/g, "").replace(/\.\d{3}/, "")), "Google Calendar at the call's time");
    const ics = await fetch(`${base}/mf/${samCode}/ics`);
    const icsText = await ics.text();
    must(ics.status === 200 && (ics.headers.get("content-type") ?? "").startsWith("text/calendar") && icsText.includes("TRIGGER:-PT15M") && !/sam|lee|555/i.test(icsText), "the .ics, nothing personal in it");
    must((await page.locator('[data-testid="hm-asks"] .hm-ask').count()) === 3 && (await page.locator('[data-testid="hm-asks"]').innerText()).includes(`Set an alarm for ${when.alarm}`), "the three asks");
    must((await page.locator('[data-testid="hm-bring"] li').count()) >= 2, "bring these: two or three lines");
    await phoneChecks(page, "the confirmation page");
    sam = (await signup("sam.hermes@example.com"))!;
    must(sam.registeredAt && sam.registeredVia === "helixos" && sam.phone === "+1 555 0199", `registered on the Magic funnel row as "helixos": ${sam.registeredVia}`);
    must((await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!.registered === 1, "counted once in Registered");
    let contacts: Awaited<ReturnType<typeof ghlContacts>> = [];
    for (let i = 0; i < 40 && !(contacts = await ghlContacts()).some((c) => c.email === "sam.hermes@example.com" && c.tags.includes("ic-registered")); i++) await sleep(250);
    const c = contacts.find((x) => x.email === "sam.hermes@example.com");
    must(c && c.tags.includes("ic-registered") && c.tags.includes(`ic-${when.isoDay}`) && c.customFields.cf_ic_date === when.isoDay, `GoHighLevel has the contact, both tags and the event date: ${JSON.stringify(c)}`);
    must(beacons.some((b) => b.includes("ev=CompleteRegistration") && b.includes("id=1234567890123456")) && !beacons.some((b) => /sam|example|555/i.test(b)), "CompleteRegistration, nothing personal in it");
    await page.goto(`${base}/mf/${samCode}`);
    await page.waitForURL(new RegExp(`/mf/${samCode}/confirmed$`));
    console.log("✓ registered: the confirmation with their ticket, PT and ET, the join link, the video, both calendars; 'helixos' on the row; GoHighLevel tagged with the date field; the page goes straight to the confirmation");

    // 6. Not you?
    await page.goto(`${base}/mf/${jo.code}`);
    await page.locator('[data-testid="hm-clear"]').click();
    must((await page.locator('input[name="email"]').inputValue()) === "", "the form is cleared");
    await page.fill('input[name="firstName"]', "Alex");
    await page.fill('input[name="email"]', "alex.hermes@example.com");
    await Promise.all([page.waitForURL(/\/mf\/[A-Za-z0-9_-]{43}\/confirmed$/, { timeout: 60000 }), page.locator('[data-testid="hm-submit"]').click()]);
    must(!page.url().includes(jo.code), "a different code: their own");
    must(!(await signup("jo.hermes@example.com"))!.registeredAt, "the bot's prospect isn't registered for someone else");
    const alex = (await signup("alex.hermes@example.com"))!;
    must(alex.registeredVia === "helixos" && alex.source === "mf" && (await page.locator('[data-testid="hm-youre-in"]').innerText()).includes("Alex"), "Alex is a new sign-up");
    console.log("✓ 'Not you? Clear the form': a new sign-up; the prospect stays unregistered");

    // 7. Cold.
    beacons.length = 0;
    await page.goto(`${base}/mf/w/${webinarId}`);
    await landing.waitFor({ timeout: 60000 });
    must((await landing.getAttribute("data-page")) === "cold" && (await page.locator('input[name="email"]').inputValue()) === "", "the cold page, an empty form");
    must(beacons.some((b) => b.includes("ev=PageView")), "the PageView beacon");
    await phoneChecks(page, "the cold page");
    await fetch(`http://localhost:${GHL_PORT}/__fail/on`);
    await page.fill('input[name="firstName"]', "Riley");
    await page.fill('input[name="email"]', "riley.hermes@example.com");
    await Promise.all([page.waitForURL(/\/confirmed$/, { timeout: 60000 }), page.locator('[data-testid="hm-submit"]').click()]);
    must((await page.locator('[data-testid="hm-youre-in"]').innerText()).includes("Riley"), "GoHighLevel down: still their confirmation");
    let failed = 0;
    for (let i = 0; i < 40 && !(failed = (await db.select().from(hermesPages).where(eq(hermesPages.webinarId, webinarId)))[0]!.ghlFailed); i++) await sleep(250);
    must(failed === 1, `the failed push is counted (${failed})`);
    await fetch(`http://localhost:${GHL_PORT}/__fail/off`);
    await page.goto(`${base}/mf/w/${webinarId}?error=check`);
    must(await page.locator('[data-testid="hm-form-error"]').count(), "a form that can't register says why");
    console.log("✓ cold: empty form and PageView; GoHighLevel refusing still confirms the person and counts the failure");

    // 8. Unknown codes, a past call, the switch off.
    await page.goto(`${base}/mf/${"Q".repeat(43)}`);
    must((await landing.getAttribute("data-page")) === "cold", "an unknown code is the cold page");
    await page.goto(`${base}/mf/abc`);
    must((await landing.getAttribute("data-page")) === "cold", "a code of the wrong shape too");
    await db.update(schema.webinars).set({ scheduledAt: `${addDays(todayInTz(tz), -1)}T10:00` }).where(eq(schema.webinars.id, webinarId));
    await page.goto(`${base}/mf/${jo.code}`);
    await page.locator('[data-testid="hm-closed"]').waitFor({ timeout: 30000 });
    must(!(await page.content()).includes("jo.hermes@example.com"), "a past call: no prefill");
    await db.update(schema.webinars).set({ scheduledAt: `${day}T10:00` }).where(eq(schema.webinars.id, webinarId));
    await coachPage.goto(`${base}/webinars/${webinarId}/helixos-pages`);
    await coachPage.uncheck('[data-testid="hm-host-on"]');
    await Promise.all([coachPage.waitForURL(/saved=1/, { timeout: 60000 }), coachPage.locator('[data-testid="hm-settings"] button[type="submit"]').click()]);
    r = await call(key, "mf_prepare", { contact_id: "cl_h9", first_name: "Kim", email: "kim.hermes@example.com", pain: "no leads", industry: "plumbing" });
    must(new URL((JSON.parse(r.text) as { personal_url: string }).personal_url).origin === "https://go.example.com", "switched off: mf_prepare sends the GoHighLevel page again");
    await page.goto(`${base}/mf/w/${webinarId}`);
    await page.locator('[data-testid="hm-closed"]').waitFor({ timeout: 30000 });
    console.log("✓ unknown codes are the cold page; a past call is the quiet page; switched off, the GoHighLevel link is back");

    // 9. The preview, and the log.
    await coachPage.fill('[data-testid="hm-preview-form"] input[name="industry"]', "pilates studio");
    await coachPage.fill('[data-testid="hm-preview-form"] input[name="pain"]', "reels get likes but no consults");
    await coachPage.locator('[data-testid="hm-preview-run"]').click();
    await coachPage.locator('[data-testid="hm-preview"] [data-copy="personal"]').waitFor({ timeout: 60000 });
    must(await coachPage.locator('[data-testid="hm-preview"] .hm-personal').count(), "the preview outlines the personal sections");
    await coachPage.locator('[role="tab"]:has-text("Confirmation page")').click();
    await coachPage.locator('[data-testid="hm-preview"] [data-testid="hm-confirmed"]').waitFor();
    console.log("✓ the preview writes both pages for a made-up prospect");

    must(!failures.length, `no server errors: ${failures.join(", ")}`);
    if (existsSync(logFile)) {
      const log = readFileSync(logFile, "utf8").slice(logStart);
      for (const s of ["sam.hermes@example.com", "alex.hermes@example.com", "riley.hermes@example.com", "555 0101", "555 0199"]) must(!log.includes(s), `the server log never holds "${s}"`);
      console.log("✓ the server log holds no email or phone from this walk");
    }
    console.log("\nhermes walk: all checks passed");
  } finally {
    await browser.close();
    for (const ch of [ghl, ai]) if (ch?.pid) try { process.kill(-ch.pid); } catch { /* gone */ }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
