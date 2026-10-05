/**
 * Recordings from Fathom, R1 (handoff revs 254 to 265): the coach's own key on Integrations with the switch-on date, Register
 * webhook (registered at the mock with no transcript asked for), Sync now (the last thirty days as drafts, no transcript read),
 * a signed webhook delivery that publishes a series title ("Automation Accelerator") on its own and refuses a tampered or stale
 * one, Publishing rules edited (a refused row, a new slot) and a call with no useful title published by its slot under HelixOS's
 * clear title (rev 491), a call with only the coach on it held, a one-to-one published to the member on the call, the member's
 * Recordings tab (hidden until something is published), the summary, one tap to make an action item a task (source fathom),
 * View transcript fetched once and opened from HelixOS for the next member, Hide transcript, Unpublish, and nothing fetched
 * while the coach is switched in. Runs against scripts/mock-fathom.ts; the dev server must have FATHOM_BASE_URL=http://localhost:4030.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const fathomPort = 4030;
const mock = `http://localhost:${fathomPort}`;

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector}`);
}
async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function loginAs(page: Page, email: string) {
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
const reads = async () => ((await (await fetch(`${mock}/__reads`)).json()) as { reads: string[] }).reads;
const hooks = async () => ((await (await fetch(`${mock}/__webhooks`)).json()) as { webhooks: { id: string; secret: string; destination_url: string; triggered_for: string[]; include_transcript: boolean }[] }).webhooks;
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  const fathom = spawn("npx", ["tsx", "scripts/mock-fathom.ts", String(fathomPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { signStandardWebhook } = await import("@/lib/engine/recordings");
  const { readRules, ruleMatch, wallOf, DAY_LONG } = await import("@/lib/engine/recording-rules");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    // What the coach's key lists, read from the mock itself: the expected counts come from the source, never typed here.
    const everything = ((await (await fetch(`${mock}/external/v1/meetings?include_summary=true&include_action_items=true`, { headers: { "x-api-key": "fathom-coach" } })).json()) as { items: { recording_id: number; title: string; created_at: string }[] }).items;
    // The first Sync now reaches back thirty days before switch-on (src/lib/recordings.ts): the older member-key calls stay out.
    const listed = everything.filter((m) => m.created_at >= new Date(Date.now() - 30 * 86400000).toISOString());
    must(listed.length >= 4 && listed.length < everything.length, "the mock's coach key lists the group calls inside the window and older calls outside it");
    const titleOf = (id: number) => listed.find((m) => m.recording_id === id)!.title;

    // ── 1. The coach connects: a bad key says why, the right one connects with its last four and the switch-on date. ──
    await login(page, "As the coach");
    await page.goto(`${base}/integrations`);
    await page.locator('[data-testid="fathom-ws-form"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="fathom-ws-connected"]').count()), "not connected to begin with");
    await page.goto(`${base}/coach/recordings`);
    await page.locator('[data-testid="recordings-not-connected"]').waitFor({ timeout: 20000 });
    await page.goto(`${base}/integrations`);
    await fillExact(page, '[data-testid="fathom-ws-key"]', "not-a-key");
    await submit(page, '[data-testid="fathom-ws-connect"]');
    await page.locator('[data-testid="fathom-ws-error"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="fathom-ws-error"]').innerText()).includes("Fathom rejected the key"), "a bad key says Fathom rejected it");
    await fillExact(page, '[data-testid="fathom-ws-key"]', "fathom-coach");
    await submit(page, '[data-testid="fathom-ws-connect"]');
    await page.locator('[data-testid="fathom-ws-connected"]').waitFor({ timeout: 20000 });
    await expectText(page, "connected · ····oach", "last four");
    must((await page.locator('[data-testid="fathom-ws-enabled"]').innerText()).includes("Switched on"), "the switch-on date is shown");
    must(!(await page.locator('[data-testid="fathom-ws-error"]').count()), "no error once connected");
    const conn = (await db.query.fathomWorkspaceConnections.findFirst({ where: eq(schema.fathomWorkspaceConnections.workspaceId, mayaM.workspaceId) }))!;
    must(conn.keyEncrypted.startsWith("enc:v1:") && conn.last4 === "oach", "the key is sealed and only its last four kept");
    console.log("✓ Integrations: a bad key refused in plain words; the coach's key connected, sealed, with the switch-on date");

    // ── 2. Register webhook: created at Fathom for the coach's recordings, without the transcript; the URL carries the connection id, never a secret. ──
    await submit(page, '[data-testid="fathom-ws-register"]');
    await page.locator('[data-testid="fathom-ws-notice"]').waitFor({ timeout: 20000 });
    const registered = await hooks();
    must(registered.length === 1, `one webhook registered at Fathom, got ${registered.length}`);
    must(registered[0].destination_url.endsWith(`/api/webhooks/fathom/${conn.id}`), `the destination is this connection's URL: ${registered[0].destination_url}`);
    must(registered[0].include_transcript === false && registered[0].triggered_for.includes("my_recordings"), "the webhook carries summaries and items for the coach's own recordings, never the transcript");
    await expectText(page, "webhook registered", "webhook badge");
    const stored = (await db.query.fathomWorkspaceConnections.findFirst({ where: eq(schema.fathomWorkspaceConnections.id, conn.id) }))!;
    must(stored.webhookId === registered[0].id && stored.webhookSecretEncrypted?.startsWith("enc:v1:"), "the webhook id is kept and its secret sealed");
    console.log("✓ Register webhook: created at Fathom with no transcript, the secret sealed, the URL carrying only the connection id");

    // ── 3. Sync now: every call of the last thirty days comes in as a draft (all before switch-on), and no transcript is read. ──
    await submit(page, '[data-testid="fathom-ws-sync"]');
    await page.locator('[data-testid="fathom-ws-synced"]').waitFor({ timeout: 30000 });
    const syncLine = await page.locator('[data-testid="fathom-ws-synced"]').innerText();
    must(syncLine.includes(`${listed.length} listed, ${listed.length} new, 0 published by your rules`), `the sync line counts what the mock lists: ${syncLine}`);
    must((await reads()).length === 0, `sync must read no transcript, read: ${(await reads()).join(",")}`);
    await page.goto(`${base}/coach/recordings`);
    await page.locator('[data-testid="recordings-drafts"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="recording-draft"]').count()) === listed.length, "every synced call is a draft");
    must(!(await page.locator('[data-testid="recording-published"]').count()), "nothing published by a sync before switch-on");
    // Rev 491: what was recorded before stays a draft, with Danno's rules as the suggestion: the series by its title, the call with
    // no useful title by its Friday 1 PM slot, renamed clearly with Fathom's title under it.
    const seriesRow = page.locator('[data-testid="recording-draft"]').filter({ hasText: titleOf(9101) });
    must((await seriesRow.getAttribute("data-suggested")) === "accelerator_academy" && (await seriesRow.getAttribute("data-title-match")) === "exact", "a series title suggests its program");
    const slotRow = page.locator('[data-testid="recording-draft"]').filter({ hasText: "In Fathom: Impromptu Zoom Meeting" });
    must((await slotRow.count()) === 1 && (await slotRow.locator('[data-testid="recording-draft-title"]').innerText()) === "Evolve Omega Academy · Fri 1 PM" && (await slotRow.getAttribute("data-suggested")) === "academy", "the call with no useful title is named by its slot and suggests Academy");
    console.log(`✓ Sync now: ${listed.length} calls in as drafts, a series title and a Friday slot suggested by Danno's rules with the clear title, no transcript read`);
    // Rev 488: a list to scan, not a wall. Grouped by series with counts; the call with nobody but the coach folded under Just
    // you; one compact row each with a Review button; no member picker on the list; no guest's email anywhere on the page.
    const listText = (await page.locator('[data-testid="recordings-drafts"]').textContent()) ?? "";
    must(!listText.includes("@"), "no email address on the drafts list");
    must(!(await page.locator('[data-testid="recording-member-picks"]').count()) && !(await page.locator('[data-testid="recording-publish-form"]').count()), "the list has no publish form or member picker: Review opens one call");
    const groupSeries = await page.locator('[data-testid="recording-group"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-series")}:${(e as HTMLDetailsElement).open ? "open" : "folded"}`));
    must(groupSeries.includes("just_you:folded") && groupSeries.includes("series-automation-accelerator:open") && groupSeries.includes("slot-evolve-omega-academy:open") && groupSeries.includes("one_to_one:open"), `grouped by series and slot, Just you folded: ${groupSeries.join(", ")}`);
    must((await page.locator('[data-testid="recording-review"]').count()) === listed.length, "one Review button per call");
    const oneRowMeta = await page.locator('[data-testid="recording-draft"]').filter({ hasText: titleOf(9104) }).locator('[data-testid="recording-draft-meta"]').innerText();
    must(/30 min · 2 on the call · Maya Torres · sync/.test(oneRowMeta), `a row says when, how long, how many, which members and where from: ${oneRowMeta}`);
    must((await page.locator('[data-testid="recording-draft"]').filter({ hasText: titleOf(9104) }).getAttribute("data-suggested")) === "members", "the one-to-one suggests its member");
    await page.goto(`${base}/coach/recordings?series=one_to_one`);
    must((await page.locator('[data-testid="recording-draft"]').count()) === 1, "the series filter leaves only that series");
    await page.goto(`${base}/coach/recordings?members=1`);
    must((await page.locator('[data-testid="recording-group"][data-series="just_you"]').count()) === 0, "Has members on it leaves out the calls with no member");
    console.log("✓ rev 488: drafts grouped by series with counts, Just you folded, one compact row each with Review, filters by series and members, no email on the page");

    // ── 4. A webhook delivery, signed the way Fathom signs: a series title after switch-on publishes itself; tampered or stale calls are refused. ──
    const now = new Date();
    const payload = {
      recording_id: 9201,
      title: "Evolve Omega: Automation Accelerator – Week 4",
      url: "https://fathom.video/calls/815301900",
      share_url: "https://fathom.video/share/acc-9201",
      created_at: now.toISOString(),
      recording_start_time: now.toISOString(),
      recording_end_time: new Date(now.getTime() + 50 * 60000).toISOString(),
      calendar_invitees: [{ name: "Maya Torres", email: "client@demo.helixos.app", is_external: false }, { name: "Jordan Lee", email: "client2@demo.helixos.app", is_external: false }],
      default_summary: { template_name: "general", markdown_formatted: "## Purpose\nWeek 4: the offer, said the same way every time.\n\n## Key takeaways\n- **One offer** per person.\n- Say it in one sentence." },
      action_items: [
        { description: "Record the offer in one sentence", completed: false, recording_timestamp: "00:09:12", recording_playback_url: "https://fathom.video/share/acc-9201?timestamp=552", assignee: { name: "Maya Torres", email: "client@demo.helixos.app" } },
        { description: "Book three calls this week", completed: false, recording_timestamp: "00:20:00", recording_playback_url: null, assignee: { name: "Jordan Lee", email: "client2@demo.helixos.app" } },
      ],
    };
    const hookUrl = registered[0].destination_url.replace(/^https?:\/\/[^/]+/, base);
    const deliver = async (body: string, opts: { timestamp?: string; tamper?: boolean } = {}) => {
      const ts = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
      const id = `msg_${Math.random().toString(36).slice(2)}`;
      const sig = signStandardWebhook(registered[0].secret, id, ts, body);
      return page.request.post(hookUrl, { headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig }, data: opts.tamper ? body.replace("Week 4", "Week 44") : body });
    };
    const body = JSON.stringify(payload);
    const tampered = await deliver(body, { tamper: true });
    must(tampered.status() === 401, `a tampered body is refused (got ${tampered.status()})`);
    const stale = await deliver(body, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) });
    must(stale.status() === 401, `a stale timestamp is refused (got ${stale.status()})`);
    const unsigned = await page.request.post(hookUrl, { headers: { "content-type": "application/json" }, data: body });
    must(unsigned.status() === 401, `an unsigned call is refused (got ${unsigned.status()})`);
    const ok = await deliver(body);
    must(ok.status() === 200, `a signed delivery lands (got ${ok.status()}: ${await ok.text()})`);
    const again = await deliver(body);
    must(again.status() === 200 && ((await again.json()) as { note: string }).note.startsWith("Known"), "the same recording delivered twice is one row");
    const week4 = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9201")) }))!;
    must(week4.status === "published" && week4.audience === "accelerator_academy" && week4.publishedBy === "rules" && week4.source === "webhook" && week4.clearTitle === null, "the series title after switch-on published itself to Accelerator and Academy");
    const refused = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, mayaM.workspaceId), eq(schema.syncEvents.event, "recordings.webhook"), eq(schema.syncEvents.status, "failed")) });
    must(refused.length === 3, `every refused call is logged (${refused.length})`);
    must((await reads()).length === 0, "a webhook delivery reads no transcript");
    await page.goto(`${base}/coach/recordings?tab=published`);
    await page.locator('[data-testid="recordings-published"]').waitFor({ timeout: 20000 });
    const pub = page.locator('[data-testid="recording-published"]');
    must((await pub.count()) === 1 && (await pub.first().getAttribute("data-audience")) === "accelerator_academy", "the coach's Published list has the week 4 call for Accelerator and Academy");
    must((await pub.first().innerText()).includes("by your rules"), "it says the rules published it");
    must((await pub.first().locator('[data-testid="recording-published-reach"]').innerText()).includes("reaches 2 members"), "it reaches both demo clients");
    console.log("✓ Webhook: tampered, stale and unsigned calls refused and logged; the series title published itself; delivered twice is one row");

    // ── 4b. Publishing rules (rev 491): a refused row keeps the typing and marks the box; a new slot at this very minute; then a call
    //    with no useful title, delivered now, publishes by that slot under its clear title, and one with only the coach stays a draft. ──
    await page.goto(`${base}/coach/recordings`);
    await page.locator('[data-testid="recordings-rules"]').click();
    await page.waitForURL(/\/coach\/recordings\/rules$/);
    must((await page.locator('[data-testid="series-name-0"]').inputValue()) === "Automation Accelerator" && (await page.locator('[data-testid="rules-timezone"]').inputValue()) === "America/Los_Angeles", "the defaults are Danno's series, in Los Angeles time");
    must((await page.locator('[data-testid="rules-slot-row"]').count()) === 9, "seven slots and two empty rows");
    await fillExact(page, '[data-testid="series-name-4"]', "ok");
    await submit(page, '[data-testid="rules-save"]');
    await page.locator('[data-testid="rules-error"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="rules-error"]').innerText()).includes("too short"), "a two-letter series name is refused in plain words");
    must((await page.locator('[data-testid="series-name-4"]').inputValue()) === "ok" && (await page.locator('[data-testid="series-name-4"]').getAttribute("aria-invalid")) === "true", "the typing is kept and the box marked");
    const startNow = new Date();
    const wall = wallOf(startNow.toISOString(), "America/Los_Angeles")!;
    const hhmm = `${String(Math.floor(wall.minute / 60)).padStart(2, "0")}:${String(wall.minute % 60).padStart(2, "0")}`;
    await fillExact(page, '[data-testid="series-name-4"]', "Hot Seat");
    await fillExact(page, '[data-testid="slot-name-7"]', "Walk slot");
    await page.selectOption('[data-testid="slot-day-7"]', String(wall.day));
    await fillExact(page, '[data-testid="slot-time-7"]', hhmm);
    await page.selectOption('select[name="slot_audience_7"]', "academy");
    await submit(page, '[data-testid="rules-save"]');
    await page.locator('[data-testid="rules-saved"]').waitFor({ timeout: 20000 });
    const savedRules = readRules((await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mayaM.workspaceId) }))!.recordingRules);
    must(savedRules.series.length === 5 && savedRules.series.some((x) => x.name === "Hot Seat") && savedRules.slots.some((x) => x.name === "Walk slot" && x.day === wall.day && x.time === hhmm), `the new series and slot are saved (${DAY_LONG[wall.day]} ${hhmm})`);
    const zoom = { ...payload, title: "Impromptu Zoom Meeting", recording_start_time: startNow.toISOString(), created_at: startNow.toISOString(), action_items: [] };
    must((await deliver(JSON.stringify({ ...zoom, recording_id: 9202, url: "https://fathom.video/calls/815301901", share_url: "https://fathom.video/share/zoom-9202" }))).status() === 200, "the slot call lands");
    must((await deliver(JSON.stringify({ ...zoom, recording_id: 9203, url: "https://fathom.video/calls/815301902", share_url: "https://fathom.video/share/zoom-9203", calendar_invitees: [{ name: "Danno Hanfling", email: "coach@demo.helixos.app" }] }))).status() === 200, "the call with only the coach lands");
    const bySlot = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9202")) }))!;
    const expected = ruleMatch("Impromptu Zoom Meeting", startNow.toISOString(), savedRules)!;
    must(expected.by === "slot" && bySlot.status === "published" && bySlot.titleMatch === "slot" && bySlot.audience === expected.audience && bySlot.clearTitle === expected.clearTitle, `the call with no useful title published by its slot, clearly named: ${bySlot.status} ${bySlot.clearTitle}`);
    if (expected.rule.name !== "Walk slot") console.log(`  (the walk runs near one of Danno's own slots, so ${expected.rule.name} placed it)`);
    const lone = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9203")) }))!;
    must(lone.status === "draft" && lone.clearTitle === null, "only the coach on it: a draft, even inside the slot");
    await page.goto(`${base}/coach/recordings?tab=published`);
    const slotPub = page.locator(`[data-testid="recording-published"]#r-${bySlot.id}`);
    must((await slotPub.locator('[data-testid="recording-published-title"]').innerText()) === expected.clearTitle && (await slotPub.innerText()).includes("In Fathom: Impromptu Zoom Meeting"), "Published shows the clear title with Fathom's under it");
    // Tidy for the member checks below: unpublish it, then Skip it from Review.
    page.once("dialog", (d) => d.accept());
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), slotPub.locator('button:has-text("Unpublish")').click()]);
    await page.locator('[data-testid="recordings-unpublished-notice"]').waitFor({ timeout: 20000 });
    await page.goto(`${base}/coach/recordings/${bySlot.id}`);
    must((await page.locator("h1").first().innerText()).includes(expected.clearTitle ?? "—"), "Review keeps the clear title");
    await submit(page, '[data-testid="review-skip"]');
    must((await db.query.recordings.findFirst({ where: eq(schema.recordings.id, bySlot.id) }))!.status === "skipped", "skipped");
    await page.goto(`${base}/coach/recordings`);
    must((await page.locator('[data-testid="recording-draft"]').count()) === listed.length + 1, "the call with only the coach joined the drafts");
    console.log("✓ Publishing rules: a refused row kept and marked, a new series and slot saved; a call with no useful title published by its slot under the clear title, one with only the coach held");

    // ── 5. Review opens one call: the summary, who was on it folded away without emails, and Publish as suggested to its member. ──
    const oneToOne = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9104")) }))!;
    must(oneToOne.title === titleOf(9104), "the one-to-one is here under its Fathom title");
    await page.locator('[data-testid="recording-draft"]').filter({ hasText: titleOf(9104) }).locator('[data-testid="recording-review"]').click();
    await page.waitForURL(new RegExp(`/coach/recordings/${oneToOne.id}$`));
    await expectText(page, "launch plan", "the summary on Review");
    must((await page.locator('[data-testid="review-attendees-line"]').innerText()).trim() === "2 people: 1 member, 0 guests, and you", `who was on it, folded: ${await page.locator('[data-testid="review-attendees-line"]').innerText()}`);
    must(!(await page.locator('[data-testid="review-attendees"]').evaluate((d) => (d as HTMLDetailsElement).open)), "the attendee list starts folded");
    must(!((await page.locator("main").textContent()) ?? "").includes("@"), "no email address on Review");
    must((await page.locator('[data-testid="review-suggested-who"]').innerText()).trim() === "Maya Torres", "suggested: the member on the call");
    must(!(await page.locator('[data-testid="review-change"]').evaluate((d) => (d as HTMLDetailsElement).open)), "the full choice stays folded under Change");
    await page.locator('[data-testid="review-change"] > summary').click();
    await page.fill('[data-testid="member-search"]', "jord");
    const visibleNames = await page.locator('[data-testid="recording-member-picks"] label:visible').allInnerTexts();
    must(visibleNames.length === 1 && visibleNames[0].includes("Jordan Lee"), `the member search narrows the list: ${visibleNames.join(" | ")}`);
    must((await page.locator(`[data-testid="recording-member"][value="${maya.id}"]`).isChecked()) && !(await page.locator(`[data-testid="recording-member"][value="${jordan.id}"]`).isChecked()), "a tick is kept when the search hides it; only the member on the call is ticked");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="review-publish-suggested"]').click()]);
    await page.locator('[data-testid="recordings-published-notice"]').waitFor({ timeout: 20000 });
    await page.goto(`${base}/coach/recordings?tab=published`);
    must((await page.locator('[data-testid="recording-published"]').count()) === 2, "two published now");
    const oneRow = page.locator(`[data-testid="recording-published"]#r-${oneToOne.id}`);
    must((await oneRow.getAttribute("data-audience")) === "members" && (await oneRow.locator('[data-testid="recording-published-reach"]').innerText()).includes("reaches 1 member: Maya Torres"), "the one-to-one reaches Maya alone");
    await logout(page);
    console.log("✓ Review: the summary, who was on it folded and without emails, the member search, and Publish as suggested to the member on the call");

    // ── 6. Maya: the Recordings item appears, both calls listed, the summary, one tap to a task, the transcript fetched once. ──
    await login(page, "As a client");
    must((await page.locator('aside a[href="/recordings"]').count()) === 1, "Recordings is in Maya's menu once something is published for her");
    await page.goto(`${base}/recordings`);
    await page.locator('[data-testid="recordings-list"]').waitFor({ timeout: 20000 });
    const mayaTitles = await page.locator('[data-testid="recording-title"]').allInnerTexts();
    must(mayaTitles.length === 2 && mayaTitles.includes(payload.title) && mayaTitles.includes(titleOf(9104)), `Maya sees the week 4 call and her one-to-one: ${mayaTitles.join(" | ")}`);
    // Revs 496 to 498 from her side: newest first under "This week", both new (a yellow dot each, the count on the menu), and
    // Today's Then panel naming each call with an action item still for her, and the new ones to watch.
    must(mayaTitles[0] === payload.title && (await page.locator('[data-testid="recordings-week"] h2').first().innerText()).trim().toLowerCase() === "this week", "newest first, under This week");
    must((await page.locator('[data-testid="recording-row"][data-new="yes"] [data-testid="recording-new"]').count()) === 2, "both calls carry the yellow dot until she opens them");
    must((await page.locator('aside a[href="/recordings"] [data-testid="due-badge"]').innerText()).trim() === "2", "the menu counts the two new calls");
    await page.goto(`${base}/today`);
    const thenLines = (await page.locator('[data-testid="then-recording"]').allInnerTexts()).map((t) => t.trim());
    must(thenLines.filter((t) => / 1 action item for you →$/.test(t)).length === 2 && thenLines.some((t) => t.startsWith("2 new recordings to watch")), `Today's Then names each call with an item for her, and the new ones: ${thenLines.join(" | ")}`);
    must(thenLines.some((t) => t.includes("Accelerator call")) && thenLines.some((t) => t.includes("one-to-one")), "each line says which call");
    await page.goto(`${base}/recordings/${week4.id}`);
    await page.locator('[data-testid="recording-steps"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="recording-program"]').first().innerText()) === "Accelerator", "the program line");
    await expectText(page, "One offer", "summary rendered");
    // Watch in Fathom goes through HelixOS, which marks the call seen and sends her on to the share link (rev 498).
    must((await page.locator('[data-testid="recording-watch"]').getAttribute("href")) === `/recordings/${week4.id}/watch`, "Watch in Fathom goes through HelixOS first");
    const watched = await page.request.get(`${base}/recordings/${oneToOne.id}/watch`, { maxRedirects: 0 });
    must(watched.status() === 303 && watched.headers().location === oneToOne.shareUrl, `the tap sends her on to the call's share link (${watched.status()} ${watched.headers().location})`);
    const seenRows = await db.query.recordingViews.findMany({ where: eq(schema.recordingViews.userId, maya.id) });
    must(seenRows.length === 2 && seenRows.some((r) => r.recordingId === week4.id) && seenRows.some((r) => r.recordingId === oneToOne.id), "opening one and pressing Watch on the other marks both seen");
    // The action items under the person each is for (rev 496): hers first as "Yours", the others folded; each with its ▶ moment.
    const groupHeads = await page.locator('[data-testid="recording-group-items"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-own")}:${(e.querySelector("span") as HTMLElement).textContent?.trim()}:${e.tagName === "DETAILS" ? ((e as HTMLDetailsElement).open ? "open" : "folded") : "shown"}`));
    must(groupHeads[0] === "yes:Yours (1):shown" && groupHeads.slice(1).every((g) => g.startsWith("no:") && g.endsWith(":folded")) && groupHeads.some((g) => g.includes("Jordan Lee (1)")), `her items first as Yours, the others folded under their names: ${groupHeads.join(" | ")}`);
    must(!((await page.locator('[data-testid="recording-steps"]').textContent()) ?? "").includes("@"), "no email address among the action items");
    const moment = page.locator('[data-testid="recording-group-items"][data-own="yes"] [data-testid="recording-step-moment"]').first();
    must((await moment.innerText()).trim() === "▶ 9:12" && (await moment.getAttribute("href")) === payload.action_items[0].recording_playback_url, "the item's timestamp is a ▶ link to that moment in Fathom");
    const steps = page.locator('[data-testid="recording-step"]');
    must((await steps.count()) === payload.action_items.length, "every action item shown");
    const mine = steps.filter({ hasText: "Record the offer in one sentence" });
    must((await mine.getAttribute("data-state")) === "suggested", "Fathom's assignee match is a suggested step for Maya, not a task");
    must((await page.locator('[data-testid="recording-view-transcript"]').count()) === 1, "View transcript is offered");
    const tasksBefore = (await db.query.tasks.findMany({ where: eq(schema.tasks.userId, maya.id) })).length;
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), mine.locator('[data-testid="recording-step-make-task"]').click()]);
    await page.locator('[data-testid="recording-task-made"]').waitFor({ timeout: 20000 });
    const tasksAfter = await db.query.tasks.findMany({ where: eq(schema.tasks.userId, maya.id) });
    must(tasksAfter.length === tasksBefore + 1, "one task made");
    const made = tasksAfter.find((t) => t.title === "Record the offer in one sentence")!;
    must(made.source === "fathom" && made.sourceRef === week4.id && made.status === "today", "the task carries source fathom and points at the recording");
    must((await page.locator('[data-testid="recording-step"]').filter({ hasText: "Record the offer" }).locator('[data-testid="recording-step-done"]').count()) === 1, "the step now says it is in her tasks");
    await page.goto(`${base}/tasks`);
    await expectText(page, "Record the offer in one sentence", "task on Tasks");
    must((await page.locator('[data-testid="task-origin"]').filter({ hasText: "From the recording on" }).count()) >= 1, "the task shows where it came from");
    await page.goto(`${base}/recordings/${week4.id}`);
    await submit(page, '[data-testid="recording-view-transcript"]');
    await page.locator('[data-testid="recording-transcript"]').waitFor({ timeout: 20000 });
    must((await reads()).filter((r) => r === "9201").length === 1, `the transcript was fetched from Fathom once, reads: ${(await reads()).join(",")}`);
    await expectText(page, "Mine is the 90-Day Reset", "transcript line");
    const fetchedRows = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, mayaM.workspaceId), eq(schema.syncEvents.event, "recordings.transcript")) });
    must(fetchedRows.length === 1 && fetchedRows[0].userId === maya.id && fetchedRows[0].status === "received", "the fetch is one sync_events row naming who asked");
    await page.goto(`${base}/recordings`);
    must(!(await page.locator('[data-testid="recording-new"]').count()) && !(await page.locator('aside a[href="/recordings"] [data-testid="due-badge"]').count()), "seen, the dots and the menu count are gone");
    await page.goto(`${base}/today`);
    const thenAfter = (await page.locator('[data-testid="then-recording"]').allInnerTexts()).map((t) => t.trim());
    must(thenAfter.length === 1 && thenAfter[0].includes("one-to-one"), `the call whose item she made a task leaves Then; the one-to-one's item is still hers to decide: ${thenAfter.join(" | ")}`);
    await logout(page);
    console.log("✓ Maya: the menu item and its count, newest first with the yellow dot, Today's Then lines, Watch in Fathom through HelixOS, her items first with ▶ moments, one tap to a task, the transcript fetched once and logged");

    // ── 7. Jordan: only the week 4 call, the one-to-one not reachable, the transcript opened from HelixOS with no second fetch, a step let go. ──
    await loginAs(page, jordan.email);
    await page.goto(`${base}/recordings`);
    await page.locator('[data-testid="recordings-list"]').waitFor({ timeout: 20000 });
    const jordanTitles = await page.locator('[data-testid="recording-title"]').allInnerTexts();
    must(jordanTitles.length === 1 && jordanTitles[0] === payload.title, `Jordan sees the week 4 call only: ${jordanTitles.join(" | ")}`);
    await page.goto(`${base}/recordings/${oneToOne.id}`);
    await page.locator('[data-testid="item-gone"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="recording-steps"]').count()), "Maya's one-to-one is not Jordan's to open");
    await page.goto(`${base}/recordings/${week4.id}`);
    await submit(page, '[data-testid="recording-view-transcript"]');
    await page.locator('[data-testid="recording-transcript"]').waitFor({ timeout: 20000 });
    must((await reads()).filter((r) => r === "9201").length === 1, "the second member opens the kept transcript: no second fetch");
    const jordanStep = page.locator('[data-testid="recording-step"]').filter({ hasText: "Book three calls this week" });
    must((await jordanStep.getAttribute("data-state")) === "suggested", "Jordan's item is suggested to Jordan");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), jordanStep.locator('[data-testid="recording-step-dismiss"]').click()]);
    await page.waitForTimeout(600);
    must((await page.locator('[data-testid="recording-step"]').filter({ hasText: "Book three calls this week" }).getAttribute("data-state")) === "dismissed", "Not mine lets the step go");
    await logout(page);
    console.log("✓ Jordan: the program call only, the one-to-one a 404, the kept transcript with no second fetch, a step let go");

    // ── 8. The coach hides the transcript, then a switched view fetches nothing; Unpublish takes the call away and the menu item with it. ──
    await login(page, "As the coach");
    await page.goto(`${base}/coach/recordings?tab=published`);
    const w4row = page.locator(`[data-testid="recording-published"]#r-${week4.id}`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), w4row.locator('[data-testid="recording-toggle-transcript"]').click()]);
    await page.waitForTimeout(600);
    must((await page.locator(`[data-testid="recording-published"]#r-${week4.id}`).innerText()).includes("transcript hidden"), "Hide transcript marks the row");
    // Rev 498: who has caught up, a count with the names behind a tap. Maya and Jordan both opened the week 4 call.
    must((await page.locator(`[data-testid="recording-published"]#r-${week4.id} [data-testid="recording-seen-line"]`).innerText()).trim() === "Seen by 2 of 2", "Seen by 2 of 2 on the week 4 call");
    // Rev 497: the coach's line on Today and the Action items tab, grouped by person with his own first, drafts included.
    await page.goto(`${base}/today`);
    must((await page.locator('[data-testid="then-recording"]').allInnerTexts()).some((t) => /^Action items from your calls: \d+ →$/.test(t.trim())), "the coach's Then names the action items from his calls");
    await page.goto(`${base}/coach/recordings?tab=items`);
    const itemCalls = page.locator('[data-testid="recordings-items-call"]');
    must((await itemCalls.count()) >= 2 && (await itemCalls.filter({ hasText: "draft" }).count()) >= 1, "the Action items tab lists the calls with items, drafts among them");
    const w4items = itemCalls.filter({ hasText: payload.title });
    const w4groups = await w4items.locator('[data-testid="coach-item-group"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-own")}:${e.querySelector("p")?.textContent?.trim()}`));
    must(w4groups.includes("no:Maya Torres (1)") && w4groups.includes("no:Jordan Lee (1)"), `the week 4 items under each member by name: ${w4groups.join(" | ")}`);
    must(((await w4items.textContent()) ?? "").includes("made a task") && ((await w4items.textContent()) ?? "").includes("let go") && !((await w4items.textContent()) ?? "").includes("@"), "what each member did with theirs, and no email address");
    await page.goto(`${base}/coach/recordings?tab=published`);
    await page.goto(`${base}/coach/${mayaM.id}`);
    await submit(page, '[data-testid="switch-view"]');
    await page.locator('[data-testid="switch-banner"]').waitFor({ timeout: 20000 });
    await page.goto(`${base}/recordings/${week4.id}`);
    await page.locator('[data-testid="recording-transcript-hidden"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="recording-view-transcript"]').count()) && !(await page.locator('[data-testid="recording-step-make-task"]').count()), "switched in, nothing to fetch and no step to take");
    await page.goto(`${base}/recordings/${oneToOne.id}`);
    await page.locator('[data-testid="recording-transcript-switched"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="recording-view-transcript"]').count()), "a switched coach can't fetch a transcript under the client's name");
    await submit(page, '[data-testid="switch-back"]');
    await page.goto(`${base}/coach/recordings?tab=published`);
    page.once("dialog", (d) => d.accept());
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(`[data-testid="recording-published"]#r-${week4.id} button:has-text("Unpublish")`).click()]);
    await page.locator('[data-testid="recordings-unpublished-notice"]').waitFor({ timeout: 20000 });
    must((await db.query.recordings.findFirst({ where: eq(schema.recordings.id, week4.id) }))!.status === "draft", "unpublished is a draft again");
    must((await db.query.tasks.findFirst({ where: eq(schema.tasks.id, made.id) })) !== undefined, "the task Maya made stays hers");
    await logout(page);
    await loginAs(page, jordan.email);
    must(!(await page.locator('aside a[href="/recordings"]').count()), "with nothing published for Jordan, Recordings leaves the menu");
    await page.goto(`${base}/recordings`);
    await expectText(page, "No recordings yet", "Jordan's empty page");
    await logout(page);
    console.log("✓ Hide transcript honoured, nothing fetched or taken while switched, Unpublish takes the call and the menu item away and leaves the task");

    // ── 9. Rev 488 in bulk: tick the two program calls, Publish as suggested; tick the call with nobody else on it, Skip; a sync leaves
    //    it skipped; Back to review restores it. On a phone the list fits the screen. ──
    await login(page, "As the coach");
    await page.goto(`${base}/coach/recordings`);
    const acc = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9101")) }))!;
    const aca = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9102")) }))!;
    const alone = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9103")) }))!;
    await page.locator(`#r-${acc.id} [data-testid="recording-tick"]`).check();
    await page.locator(`#r-${aca.id} [data-testid="recording-tick"]`).check();
    const fri = (await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, mayaM.workspaceId), eq(schema.recordings.fathomRecordingId, "9105")) }))!;
    await page.locator(`#r-${fri.id} [data-testid="recording-tick"]`).check();
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="bulk-publish"]').click()]);
    await page.locator('[data-testid="recordings-bulk-notice"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="recordings-bulk-notice"]').innerText()).startsWith("Published 3 as suggested."), `the bulk line counts what it published: ${await page.locator('[data-testid="recordings-bulk-notice"]').innerText()}`);
    const [accAfter, acaAfter] = await Promise.all([acc.id, aca.id].map((id) => db.query.recordings.findFirst({ where: eq(schema.recordings.id, id) })));
    must(accAfter!.status === "published" && accAfter!.audience === "accelerator_academy" && acaAfter!.status === "published" && acaAfter!.audience === "academy", "each went to the audience its series names");
    const friAfter = (await db.query.recordings.findFirst({ where: eq(schema.recordings.id, fri.id) }))!;
    must(friAfter.status === "published" && friAfter.audience === "academy" && friAfter.clearTitle === "Evolve Omega Academy · Fri 1 PM", `the Friday call went to Academy and keeps its clear title once published: ${friAfter.clearTitle}`);
    await page.locator('[data-testid="recording-group"][data-series="just_you"] > summary').click();
    await page.locator(`#r-${alone.id} [data-testid="recording-tick"]`).check();
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="bulk-skip"]').click()]);
    await page.locator('[data-testid="recordings-bulk-notice"]').waitFor({ timeout: 20000 });
    must((await db.query.recordings.findFirst({ where: eq(schema.recordings.id, alone.id) }))!.status === "skipped", "skipped, not deleted");
    await submit(page, '[data-testid="recordings-sync"]');
    must((await db.query.recordings.findFirst({ where: eq(schema.recordings.id, alone.id) }))!.status === "skipped", "a sync leaves a skipped call skipped");
    await page.goto(`${base}/coach/recordings?tab=skipped`);
    must((await page.locator('[data-testid="recording-skipped"]').count()) === 2, "Skipped lists it, with the slot call skipped earlier");
    await submit(page, `#r-${alone.id} [data-testid="recording-restore"]`);
    must((await db.query.recordings.findFirst({ where: eq(schema.recordings.id, alone.id) }))!.status === "draft", "Back to review restores it");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/coach/recordings`);
    await page.locator('[data-testid="recordings-drafts"]').waitFor({ timeout: 20000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    must(overflow <= 1, `the list fits a phone, no sideways scroll (${overflow}px over)`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await logout(page);
    console.log("✓ rev 488 in bulk: three calls published as suggested to their programs (the Friday one under its clear title), the lone call skipped and kept through a sync, restored; the list fits a phone");

    console.log("\nsmoke-recordings: all checks passed");
  } finally {
    await browser.close();
    try {
      process.kill(-fathom.pid!);
    } catch {
      /* already gone */
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
