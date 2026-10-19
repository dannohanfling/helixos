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
    must((await page.locator('main [data-testid="nav-coming-soon"][data-href="/get-the-app"]').count()) === 1, "More shows Get the app as Coming soon");
    await page.goto(`${base}/get-the-app`);
    await page.getByTestId("get-app-soon").waitFor();
    await page.goto(`${base}/settings`);
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
    await page.goto(`${base}/settings`);
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
    must(await page.locator('[data-testid="notifications-type-bot_call"]').isDisabled(), "a Coming soon kind can't be changed yet");
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
    console.log("✓ Settings → Notifications: the phone listed, switches and quiet hours saved, Coming soon kinds untouched");

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
