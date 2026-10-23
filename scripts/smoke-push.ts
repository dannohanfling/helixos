/**
 * Push notifications for the HelixOS apps (H-877, PR B1), against the real database and a fake Apple and Google:
 *  1. The app records the phone (POST /api/app/device): once per install, the token added later, bad input refused.
 *  2. The HelixOS card (GET and POST /api/app/push-ask) asks after the first close, then follows the H-767 rules.
 *  3. Settings → Notifications saves the switches and times; a Coming soon kind keeps its default.
 *  4. The sender: once per occasion, at most 3 a day with call reminders outside the cap, quiet hours except the evening
 *     close, a phone Apple says is gone switched off, and no push ever names anything from HumanOS.
 *  5. The push cron answers only with the cron secret.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, isNotNull } = await import("drizzle-orm");
  const { todayInTz, wallTimeToUtc } = await import("@/lib/dates");
  const { shouldAsk } = await import("@/lib/engine/push");
  const { sendPush, sendTestPush } = await import("@/lib/push/send");
  const { runDailyPushes } = await import("@/lib/push/daily");
  const { runCallPushes } = await import("@/lib/push/calls");
  const { runEventPushes } = await import("@/lib/push/events");
  const { totalPoints } = await import("@/lib/queries/points");
  const { tierFor } = await import("@/lib/engine/tiers");
  const { callsBetween } = await import("@/lib/calls");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, m.workspaceId) }))!;
  const tz = m.timezone || ws.timezone;
  const clean = async () => {
    await db.delete(schema.pushDevices).where(eq(schema.pushDevices.membershipId, m.id));
    await db.delete(schema.pushPrefs).where(eq(schema.pushPrefs.membershipId, m.id));
    await db.delete(schema.pushSends).where(eq(schema.pushSends.membershipId, m.id));
  };
  await clean();

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await login(page, "As a client");

    // ── 0. Get the app (H-655, H-731): Coming soon while no store link is set, on More, its own page and Settings. ──
    await page.goto(`${base}/more`);
    // Wait for it rather than counting at once: on a cold dev server the first page can still be rendering.
    const soonItem = page.locator('main [data-testid="nav-coming-soon"][data-href="/get-the-app"]');
    await soonItem.first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    must((await soonItem.count()) === 1, "More shows Get the app as Coming soon");
    await page.goto(`${base}/get-the-app`);
    await page.getByTestId("get-app-soon").waitFor();
    await page.goto(`${base}/settings?tab=data`);
    await page.getByTestId("account-app-soon").waitFor();
    console.log("✓ Get the app: Coming soon on More, on its page and in Settings while no store link is set");

    const post = (data: unknown) => page.request.post(`${base}/api/app/device`, { data });
    must((await post({ installId: "smoke-install-0001", platform: "ios", appVersion: "1.0 (1)" })).ok(), "the app records the phone");
    must((await post({ installId: "smoke-install-0001", platform: "ios", token: "a1b2c3d4e5f60718293a4b5c6d7e8f90" })).ok(), "the token is added on a later open");
    must((await post({ installId: "x", platform: "ios" })).status() === 400, "a bad install id is refused");
    must((await post({ installId: "smoke-install-0002", platform: "windows" })).status() === 400, "an unknown platform is refused");
    const rows = await db.query.pushDevices.findMany({ where: eq(schema.pushDevices.membershipId, m.id) });
    must(rows.length === 1 && rows[0].token === "a1b2c3d4e5f60718293a4b5c6d7e8f90" && rows[0].appVersion === "1.0 (1)" && rows[0].platform === "ios", `one row per install, token added: ${JSON.stringify(rows.map((r) => ({ t: r.token, v: r.appVersion })))}`);
    console.log("✓ the app records the phone once per install; the token comes later; bad input is refused");
    await page.goto(`${base}/more`);
    must((await page.locator('[data-href="/get-the-app"], a[href="/get-the-app"]').count()) === 0, "Get the app is gone from More once the app was opened");
    await page.goto(`${base}/settings?tab=data`);
    must((await page.getByTestId("account-app-have").innerText()).includes("iPhone"), "Settings says which phone has the app");
    console.log("✓ Get the app: gone from More once the app was opened; Settings says it's on iPhone");

    // ── 2. The HelixOS card. ──
    const closes = (await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.workspaceId, ws.id), isNotNull(schema.dailyLogs.eveningDoneAt)) })).length;
    const ask1 = (await (await page.request.get(`${base}/api/app/push-ask`)).json()) as { ask: boolean; hour: number };
    must(ask1.ask === shouldAsk({ closes, askedCount: 0, answer: null }) && ask1.hour === m.reminderHour, `the card asks after the first close (closes ${closes}): ${JSON.stringify(ask1)}`);
    must((await page.request.post(`${base}/api/app/push-ask`, { data: { answer: "not_now" } })).ok(), "Not now is recorded");
    const ask2 = (await (await page.request.get(`${base}/api/app/push-ask`)).json()) as { ask: boolean };
    must(ask2.ask === shouldAsk({ closes, askedCount: 1, answer: "not_now" }), `after Not now it waits for the 7th close: ${JSON.stringify(ask2)}`);
    must((await page.request.post(`${base}/api/app/push-ask`, { data: { answer: "maybe" } })).status() === 400, "only yes or not_now");
    console.log(`✓ the card: asks after the first close (${closes} closes), Not now waits for the 7th, nothing else accepted`);

    // ── 3. Settings → Notifications. ──
    await page.goto(`${base}/settings/notifications`, { waitUntil: "networkidle" });
    must(await page.locator('[data-testid="notifications-devices"]').innerText().then((t) => /iPhone/.test(t) && /Notifications on/.test(t)), "the phone is listed with notifications on");
    must((await page.locator('input[data-testid^="notifications-type-"]:disabled').count()) === 0, "every kind can be switched now (H-1151)");
    must(!(await page.locator('[data-testid="notifications-type-call"]').isDisabled()) && (await page.locator('[data-testid="notifications-type-call"]').isChecked()), "live call reminders are ready: on by default, and can be switched");
    await page.uncheck('[data-testid="notifications-type-morning"]');
    await page.selectOption('[data-testid="notifications-quiet-start"]', "22");
    await Promise.all([page.waitForURL(/saved=1/), page.click('[data-testid="notifications-save"]')]);
    const prefs = (await db.query.pushPrefs.findFirst({ where: eq(schema.pushPrefs.membershipId, m.id) }))!;
    must(prefs.types.morning === false && !("call" in prefs.types) && !("bot_call" in prefs.types) && prefs.quietStart === 22 && prefs.enabled, `saved: morning off, call untouched, quiet from 10 PM: ${JSON.stringify(prefs)}`);
    await page.goto(`${base}/settings/notifications`, { waitUntil: "networkidle" });
    await page.check('[data-testid="notifications-type-morning"]');
    await page.selectOption('[data-testid="notifications-quiet-start"]', "21");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/settings/notifications")), page.click('[data-testid="notifications-save"]')]);
    await page.waitForLoadState("networkidle");
    must(!("morning" in (await db.query.pushPrefs.findFirst({ where: eq(schema.pushPrefs.membershipId, m.id) }))!.types), "back to the default stores nothing");
    console.log("✓ Settings → Notifications: the phone listed, every kind switchable, switches and quiet hours saved");

    // ── 4. The sender, with a fake Apple and Google. ──
    const sent: { token: string; body: string; path: string }[] = [];
    let gone = false;
    const fake = {
      ios: async (token: string, msg: { title: string; body: string; path: string }) => (gone ? { ok: false as const, gone: true, reason: "Unregistered" } : (sent.push({ token, ...msg }), { ok: true as const })),
      android: async (token: string, msg: { title: string; body: string; path: string }) => (sent.push({ token, ...msg }), { ok: true as const }),
    };
    const today = todayInTz(tz);
    const at = (h: number) => new Date(wallTimeToUtc(`${today}T${String(h).padStart(2, "0")}:10`, tz)!);
    const who = { id: m.id, userId: maya.id, tz };
    const morning = await sendPush(who, "morning", today, {}, { now: at(m.reminderHour), transport: fake });
    must(morning.sent && sent.at(-1)?.body === "Your three moves for today are ready." && sent.at(-1)?.path === "/today#checkin", `the morning push goes: ${JSON.stringify(morning)}`);
    must((await sendPush(who, "morning", today, {}, { now: at(m.reminderHour), transport: fake })).why === "one of each a day", "never twice a day");
    must((await sendPush(who, "streak", `${today}-b`, { streak: 9 }, { now: at(12), transport: fake })).sent, "a second kind goes");
    must((await sendPush(who, "bot_call", `${today}-c`, { day: "Tuesday", time: "2:00 PM" }, { now: at(12), transport: fake })).sent, "a third kind goes");
    must((await sendPush(who, "evening", `${today}-d`, {}, { now: at(12), transport: fake })).why === "daily cap", "the fourth is held: 3 a day");
    must((await sendPush(who, "call", `${today}-call-1`, { step: "soon" }, { now: at(12), transport: fake })).sent, "call reminders sit outside the cap");
    await db.delete(schema.pushSends).where(eq(schema.pushSends.membershipId, m.id));
    must((await sendPush(who, "streak", `${today}-q`, { streak: 9 }, { now: at(23), transport: fake })).why === "quiet hours", "quiet hours hold the rest");
    must((await sendPush(who, "evening", `${today}-e`, {}, { now: at(23), transport: fake })).sent, "the evening close is the exception");
    for (const s of sent) must(!/weigh|weight|calorie|meal|sleep|medication|HumanOS|workout|habit/i.test(s.body) && !/[—!]/.test(s.body), `no health words, no em dash or exclamation: "${s.body}"`);
    gone = true;
    await db.delete(schema.pushSends).where(eq(schema.pushSends.membershipId, m.id));
    const lost = await sendPush(who, "morning", `${today}-g`, {}, { now: at(m.reminderHour), transport: fake });
    const dev = (await db.query.pushDevices.findFirst({ where: eq(schema.pushDevices.membershipId, m.id) }))!;
    must(!lost.sent && dev.disabledAt, `a phone Apple says is gone is switched off: ${JSON.stringify(lost)}`);
    must((await sendTestPush(m.id, fake)).phones === 0, "a switched-off phone gets no test");
    console.log(`✓ the sender: once per occasion, 3 a day with calls outside, quiet hours but the evening close, a gone phone switched off, ${sent.length} pushes and no health words`);

    // The daily run the cron calls: at the member's own lock-in hour, the morning push goes only if she hasn't locked in.
    gone = false;
    await db.update(schema.pushDevices).set({ disabledAt: null }).where(eq(schema.pushDevices.membershipId, m.id));
    await db.delete(schema.pushSends).where(eq(schema.pushSends.membershipId, m.id));
    const log = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, today)) });
    const run = await runDailyPushes(at(m.reminderHour), fake);
    const mine = run.filter((r) => r.type === "morning");
    must(log?.morningDoneAt ? mine.length === 0 : mine.length === 1 && mine[0].outcome.sent, `the daily run: morning ${log?.morningDoneAt ? "skipped, already locked in" : "sent"}: ${JSON.stringify(run)}`);
    must((await runDailyPushes(at(m.reminderHour), fake)).filter((r) => r.type === "morning" && r.outcome.sent).length === 0, "a second run the same hour sends nothing new");
    console.log(`✓ the daily run: the morning push ${log?.morningDoneAt ? "held (already locked in)" : "sent once"}, and a second run sends nothing new`);

    // ── 4b. The live call reminders (H-771): 15 minutes before a call she can join, once; "We're live" at the start. ──
    await db.update(schema.pushDevices).set({ disabledAt: null }).where(eq(schema.pushDevices.membershipId, m.id));
    const nextCall = (await callsBetween(ws.id, new Date(), new Date(Date.now() + 8 * 86_400_000), { role: "client", programTier: m.programTier }))[0];
    must(nextCall, "the seeded calls give her a call to join this week");
    const before = new Date(Date.parse(nextCall.startIso) - 14 * 60_000);
    sent.length = 0;
    const soon = await runCallPushes(before, fake);
    must(soon.some((r) => r.step === "soon" && r.outcome.sent) && sent.some((x) => x.body === "We start in 15 minutes. Tap to join." && x.path === "/calls"), `15 minutes before: ${JSON.stringify(soon)}`);
    must((await runCallPushes(new Date(before.getTime() + 5 * 60_000), fake)).every((r) => !r.outcome.sent), "the next run sends nothing new");
    const live = await runCallPushes(new Date(Date.parse(nextCall.startIso) + 60_000), fake);
    must(live.some((r) => r.step === "live" && r.outcome.sent) && sent.some((x) => x.body === "We're live now. Tap to join."), `at the start: ${JSON.stringify(live)}`);
    console.log("✓ live call reminders: 15 minutes before and at the start, each once, for a call she can join");

    // ── 4c. The event pushes: rank up (once per rank, only when switched on) and her webinar 15 minutes before. ──
    await db.delete(schema.pushSends).where(eq(schema.pushSends.membershipId, m.id));
    const noon = new Date(wallTimeToUtc(`${today}T12:00`, tz)!);
    const level = tierFor(await totalPoints(ws.id, maya.id)).level;
    const celebrated = m.celebratedTierLevel;
    await db.update(schema.memberships).set({ celebratedTierLevel: Math.max(0, level - 1) }).where(eq(schema.memberships.id, m.id));
    sent.length = 0;
    must(!(await runEventPushes(noon, fake)).some((r) => r.type === "rank_up" && r.outcome.sent), "rank up is off until she switches it on");
    await db.update(schema.pushPrefs).set({ types: { rank_up: true, webinar: true } }).where(eq(schema.pushPrefs.membershipId, m.id));
    const ranked = await runEventPushes(noon, fake);
    if (level > 1) {
      must(ranked.some((r) => r.type === "rank_up" && r.outcome.sent) && sent.some((x) => /You've risen to .+\. Come see your seat\./.test(x.body) && x.path === "/rewards"), `rank up once switched on: ${JSON.stringify(ranked)}`);
      must(!(await runEventPushes(noon, fake)).some((r) => r.type === "rank_up" && r.outcome.sent), "the same rank never twice");
    }
    await db.update(schema.memberships).set({ celebratedTierLevel: celebrated }).where(eq(schema.memberships.id, m.id));
    const [wb] = await db.insert(schema.webinars).values({ id: `push-walk-${Date.now()}`, workspaceId: ws.id, userId: maya.id, title: "Push walk webinar", scheduledAt: `${today}T12:14` }).returning();
    try {
      const web = await runEventPushes(noon, fake);
      must(web.some((r) => r.type === "webinar" && r.outcome.sent) && sent.some((x) => x.body === "Your webinar starts in 15 minutes." && x.path === "/webinars"), `her webinar 15 minutes before: ${JSON.stringify(web)}`);
    } finally {
      await db.delete(schema.webinars).where(eq(schema.webinars.id, wb.id));
    }
    // A call booked with one of her contacts, and her Office Hours request marked covered (H-1151).
    await db.update(schema.pushPrefs).set({ types: { coach_answer: true } }).where(eq(schema.pushPrefs.membershipId, m.id));
    await db.delete(schema.pushSends).where(eq(schema.pushSends.membershipId, m.id));
    const callAt = new Date(noon.getTime() + 2 * 86_400_000);
    const [ct] = await db.insert(schema.contacts).values({ id: `push-walk-c-${Date.now()}`, workspaceId: ws.id, userId: maya.id, name: "Walk contact", platform: "Chatbot", stage: "call_booked", callAt: callAt.toISOString(), callBookedAt: new Date(noon.getTime() - 5 * 60_000).toISOString() }).returning();
    const [oh] = await db.insert(schema.officeHoursRequests).values({ id: `push-walk-oh-${Date.now()}`, workspaceId: ws.id, userId: maya.id, friday: today, description: "Walk question", triedSelf: "Tried", goal: "Goal", category: "Other", outcome: "covered", updatedAt: new Date(noon.getTime() - 60 * 60_000).toISOString().slice(0, 19).replace("T", " ") }).returning();
    try {
      sent.length = 0;
      const ev = await runEventPushes(noon, fake);
      must(ev.some((r) => r.type === "bot_call" && r.outcome.sent) && sent.some((x) => /^A call was booked for \w+day at \d/.test(x.body) && x.path === "/conversations"), `a booked call: ${JSON.stringify(ev)}`);
      must(ev.some((r) => r.type === "coach_answer" && r.outcome.sent) && sent.some((x) => / covered your Office Hours question\.$/.test(x.body) && x.path === "/office-hours"), `Office Hours covered: ${JSON.stringify(ev)}`);
      must(!(await runEventPushes(noon, fake)).some((r) => r.outcome.sent), "each only once");
    } finally {
      await db.delete(schema.contacts).where(eq(schema.contacts.id, ct.id));
      await db.delete(schema.officeHoursRequests).where(eq(schema.officeHoursRequests.id, oh.id));
    }
    console.log(`✓ event pushes: rank up only when switched on, once per rank${level > 1 ? "" : " (seed at the first rank: not sent)"}; her webinar 15 minutes before; a booked call and a covered Office Hours question, each once`);

    // ── 4d. Settings → Notifications in the app: "Allow on this phone" (H-1612), with a fake Capacitor bridge. ──
    await page.goto(`${base}/settings/notifications`);
    await page.getByTestId("notifications-page").waitFor();
    must((await page.getByTestId("phone-push").count()) === 0, "the website shows no Allow row");
    // Let the page's own writes (a rank ceremony marking itself seen) finish before this walk writes to the same SQLite file.
    await page.waitForLoadState("networkidle");
    const fakeApp = async (receive: string) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      // A plain script string: tsx's helpers (__name) don't exist inside the browser page.
      await ctx.addInitScript({
        content: `(() => {
          const listeners = {};
          let state = ${JSON.stringify(receive)};
          window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => "ios",
            Plugins: { PushNotifications: {
              checkPermissions: async () => ({ receive: state }),
              requestPermissions: async () => { if (state !== "denied") state = "granted"; return { receive: state }; },
              register: async () => { for (const cb of listeners.registration || []) cb({ value: "fedcba9876543210fedcba9876543210" }); },
              addListener: async (event, cb) => { (listeners[event] = listeners[event] || []).push(cb); return { remove: () => undefined }; },
            } },
          };
        })();`,
      });
      const p = await ctx.newPage();
      await login(p, "As a client");
      await p.goto(`${base}/settings/notifications`);
      await p.getByTestId("phone-push").waitFor();
      await p.waitForLoadState("networkidle");
      return { ctx, p };
    };
    await db.delete(schema.pushPrefs).where(eq(schema.pushPrefs.membershipId, m.id));
    {
      const { ctx, p } = await fakeApp("prompt");
      must((await p.getByTestId("phone-push").getAttribute("data-state")) === "off", "in the app, a phone not yet asked reads Off");
      await p.getByTestId("phone-push-allow").click();
      await p.locator('[data-testid="phone-push"][data-state="on"]').waitFor();
      let got = false;
      for (let i = 0; i < 20 && !got; i++) {
        got = Boolean(await db.query.pushDevices.findFirst({ where: and(eq(schema.pushDevices.membershipId, m.id), eq(schema.pushDevices.token, "fedcba9876543210fedcba9876543210")) }));
        if (!got) await p.waitForTimeout(250);
      }
      must(got, "Allow registers the phone and its token reaches HelixOS");
      must(!((await (await p.request.get(`${base}/api/app/push-ask`)).json()) as { ask: boolean }).ask, "Allow counts as yes, so the HelixOS card never asks again");
      await ctx.close();
    }
    {
      const { ctx, p } = await fakeApp("denied");
      must((await p.getByTestId("phone-push").getAttribute("data-state")) === "blocked", "a phone that said no reads Off with the way to its settings");
      must((await p.getByTestId("phone-push-allow").count()) === 0 && (await p.getByTestId("phone-push-open-settings").count()) === 1, "no Allow once the phone said no; iPhone gets Open Settings");
      await ctx.close();
    }
    console.log("✓ Settings → Notifications: no Allow row on the website; in the app Off → Allow → On, the token recorded and the card answered; a phone that said no is sent to its settings");

    // ── 4e. The app's start and pull to refresh (H-1759, H-1761, plan H-1768), with a fake bridge that records calls. ──
    const appCtx = async (opts: { reducedMotion?: "reduce" | "no-preference" } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: opts.reducedMotion ?? "no-preference" });
      await ctx.addInitScript({
        content: `(() => {
          window.__calls = [];
          const rec = (n) => async (o) => { window.__calls.push(n); return {}; };
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: {
            SplashScreen: { hide: rec("splash.hide") },
            Haptics: { impact: rec("haptic") },
            PushNotifications: { checkPermissions: async () => ({ receive: "granted" }), requestPermissions: async () => ({ receive: "granted" }),
              register: async () => {}, addListener: async () => ({ remove: () => undefined }) },
          } };
        })();`,
      });
      const p = await ctx.newPage();
      await login(p, "As a client");
      return { ctx, p };
    };
    const calls = (p: Page) => p.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
    // A pull: touches from the top of the page, as a finger would make them.
    // A plain script string again: tsx's __name helper doesn't exist inside the page.
    const pullDown = (p: Page, from: { x: number; y: number }, by: number) =>
      p
        .evaluate(
          `(async () => {
            const from = ${JSON.stringify(from)}, by = ${by};
            const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const target = document.elementFromPoint(from.x, from.y) || document.body;
            const t = (y) => new Touch({ identifier: 1, target, clientX: from.x, clientY: y });
            target.dispatchEvent(new TouchEvent("touchstart", { touches: [t(from.y)], bubbles: true, cancelable: true }));
            for (let y = from.y; y <= from.y + by; y += 20) {
              target.dispatchEvent(new TouchEvent("touchmove", { touches: [t(y)], bubbles: true, cancelable: true }));
              await frame();
            }
            const el = document.querySelector('[data-testid="pull-refresh"]');
            const ready = !!el && el.getAttribute("data-ready") === "true";
            target.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true, cancelable: true }));
            return { ready, at: target.tagName + "." + String(target.className).slice(0, 40) };
          })()`,
        )
        .then((r) => {
          const res = r as { ready: boolean; at: string };
          if (!res.ready) console.log(`  (pull from ${res.at} did not reach the refresh point)`);
          return res.ready;
        });
    {
      // Cold start: the opening plays once and the native splash hides under its first frame; a reload doesn't replay it.
      const { ctx, p } = await appCtx();
      // Signing in already played it once; a cold start is a fresh web view with nothing in sessionStorage.
      await p.evaluate(() => sessionStorage.clear());
      await p.goto(`${base}/today`);
      await p.getByTestId("app-opening").waitFor({ timeout: 10_000 });
      must((await calls(p)).includes("splash.hide"), "the native splash hides once HelixOS has drawn");
      await p.getByTestId("app-opening").waitFor({ state: "detached", timeout: 5_000 });
      await p.reload();
      await p.waitForTimeout(1500);
      must((await p.getByTestId("app-opening").count()) === 0 && (await calls(p)).includes("splash.hide"), "no replay in the same run of the app; the splash still hides");
      // Pull at the very top: past the threshold it ticks, and letting go refreshes in place (a router refresh, not a reload).
      await p.evaluate(() => window.scrollTo(0, 0));
      const rsc = p.waitForRequest((r) => r.headers()["rsc"] === "1" || r.url().includes("_rsc="), { timeout: 10_000 }).catch(() => null);
      const before = await p.evaluate(() => performance.getEntriesByType("navigation").length && performance.timeOrigin);
      must(await pullDown(p, { x: 195, y: 200 }, 260), "a long pull from the top reaches the refresh point");
      must(await rsc, "letting go asks the server for fresh page data");
      must((await calls(p)).includes("haptic"), "the phone ticks at the refresh point");
      must((await p.evaluate(() => performance.timeOrigin)) === before, "the refresh stays in place, no full reload");
      // Off with a dialog open, and kept when there's unsaved typing.
      await p.evaluate(() => {
        const d = document.createElement("div");
        d.setAttribute("role", "dialog");
        d.id = "walk-dialog";
        document.body.appendChild(d);
      });
      must(!(await pullDown(p, { x: 195, y: 200 }, 260)), "no pull while a dialog is open");
      await p.evaluate(() => {
        document.getElementById("walk-dialog")?.remove();
        const i = document.createElement("input");
        i.id = "walk-input";
        document.querySelector("main")?.prepend(i);
        i.value = "half a thought";
      });
      await pullDown(p, { x: 195, y: 400 }, 260);
      await p.getByTestId("pull-refresh-unsaved").waitFor({ timeout: 5_000 });
      must((await p.locator("#walk-input").inputValue()) === "half a thought", "unsaved typing is kept");
      await ctx.close();
    }
    {
      // Reduced motion: a plain fade, no sweep or settle.
      const { ctx, p } = await appCtx({ reducedMotion: "reduce" });
      await p.evaluate(() => sessionStorage.clear());
      await p.goto(`${base}/today`);
      await p.getByTestId("app-opening").waitFor({ timeout: 10_000 });
      const anim = await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="app-opening"] .m')!).animationName);
      must(anim === "none", `reduced motion: no sweep or settle (${anim})`);
      await ctx.close();
    }
    // The website never shows either.
    await page.goto(`${base}/today`);
    must((await page.getByTestId("app-opening").count()) === 0 && (await page.getByTestId("pull-refresh").count()) === 0, "the website has no opening and no pull");
    console.log("✓ the app's start: the splash hides when HelixOS has drawn, the opening plays once per cold start (a fade with reduced motion); pull to refresh ticks and refreshes in place, stays off under a dialog and keeps unsaved typing; none of it on the website");

    // ── 5. The cron needs its secret. ──
    must((await page.request.get(`${base}/api/cron/push`)).status() === 401, "the push cron answers only with the cron secret");
    console.log("✓ the push cron refuses a call without the secret");
  } finally {
    await browser.close();
    await clean();
  }
  if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
  console.log("The push walk passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
