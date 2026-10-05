/**
 * The community connection, piece 1 (handoff revs 150 to 154), against scripts/mock-ghl.ts:
 *  1. The coach's page before and after connecting GoHighLevel; a token missing scopes is named on the page.
 *  2. The channel comes from the accounts list; the Monday post can't be turned on without one.
 *  3. A test post goes out as the team user, with its title; Check again shows it published, who it shows as, its id and link.
 *  4. An account on hold stops posting with no retry, even from the hourly job, until Resume.
 *  5. Next Monday's post: its own text for that week, skipped, and back on.
 *  6. A week that failed is posted with Post now, once: the hourly job and a second press never send it again. The week's
 *     3-1-3 count is on its row, and the link is built from the coach's pattern. On a Monday, the job posts this week's itself.
 *  7. Share to the thread: this week's post only, copied, opened, 15 points once per week; the coach's counts.
 *  8. The first of the month (1 Oct): its own switch, time and text; next month's own text; a month posted by hand takes its
 *     link; a failed month is posted once with Post now; the member's share from the month card; the coach's counts.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4012;
const mock = `http://localhost:${mockPort}`;
/** The file store stand-in (scripts/mock-blob.ts), for the graphic a post carries (rev 328): the dev server points both stores at it. */
const blobPort = 4050;
const PROOF_TOKEN = process.env.PROOF_BLOB_READ_WRITE_TOKEN ?? "vercel_blob_rw_PROOFSTORE_testsecret";
const LOC = "loc_community";

/** A fill checked after typing (the walk conventions): one that lands mid-hydration inserts at the caret instead of replacing. */
async function fillChecked(page: Page, selector: string, value: string) {
  for (let i = 0; i < 6; i++) {
    await page.locator(selector).fill(value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector}`);
}
async function submit(page: Page, selector: string) {
  await page
    .locator(selector)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(async () => {
      await page.screenshot({ path: "screenshots/fail-community.png", fullPage: true });
      throw new Error(`nothing to press for ${selector} on ${page.url()}`);
    });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
async function mockPosts(): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${mock}/__posts`, { headers: { Authorization: `Bearer pit-${LOC}`, Version: "2021-07-28" } });
  return ((await r.json()) as { posts: Record<string, unknown>[] }).posts;
}
/**
 * Lets the page's own requests on load (the tier celebration) finish before the walk writes to the same database file. Best
 * effort: under a loaded gate "network idle" can take longer than the wait (29 Sep), and the database's busy timeout covers any
 * overlap, so a slow page is not a failure here; every check after this still waits for what it reads.
 */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}
async function cron(page: Page) {
  const r = await page.request.get(`${base}/api/cron/reminders`, { headers: { Authorization: "Bearer change-me" } });
  if (!r.ok()) throw new Error(`the hourly job answered ${r.status()}`);
  return (await r.json()) as { community: { action: string; ok: boolean; note?: string }[] };
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, desc, eq } = await import("drizzle-orm");
  const { addDays, nowWallInTz, startOfWeek, todayInTz } = await import("@/lib/dates");
  const { HOLD_REASON, TEST_TITLE, mondayDue, mondayTitle, upcomingWeek, DEFAULT_MONDAY_TEXT, communityHtml } = await import("@/lib/engine/community");
  const { newId } = await import("@/lib/ids");

  const child = spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(mockPort)], { stdio: "ignore", detached: true });
  const blob = spawn("npx", ["tsx", "scripts/mock-blob.ts", String(blobPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  await fetch(`http://localhost:${blobPort}/__reset`).catch(() => null);
  await fetch(`${mock}/__reset`, { method: "POST", headers: { Authorization: `Bearer pit-${LOC}`, Version: "2021-07-28" } }).catch(() => null);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const coachM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
    const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, coachM.workspaceId) }))!;
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    await db.delete(schema.socialConnections).where(eq(schema.socialConnections.userId, coach.id));
    await db.delete(schema.communitySettings).where(eq(schema.communitySettings.workspaceId, ws.id));
    await db.delete(schema.communityPosts).where(eq(schema.communityPosts.workspaceId, ws.id));
    const tz = coachM.timezone || ws.timezone;
    const today = todayInTz(tz);

    const context = await browser.newContext({ viewport: { width: 1300, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
    // The community itself: a post link opens this stand-in page, so the walk can see which post "Share to the thread" opened.
    await context.route("https://academy.example.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>community post</p>" }));
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    // GoHighLevel on, pointed at the mock.
    await page.goto(`${base}/integrations`);
    const ghlForm = page.locator('form:has(input[name="provider"][value="gohighlevel"])').first();
    await ghlForm.waitFor({ timeout: 20000 });
    await ghlForm.locator('input[name="enabled"]').check();
    await ghlForm.locator('input[name="apiUrl"]').fill(mock);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), ghlForm.locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle");

    // ── 1. Before connecting, the page says where to connect. A token without the scopes is named. ──
    await page.goto(`${base}/coach/community`);
    await page.locator('[data-testid="community-no-connection"]').waitFor({ timeout: 20000 });
    // The card (rev 333): Connect opens the steps with the token and the Location ID; the user id is asked once connected, or
    // changed through Reconnect, which also takes a new token.
    const connect = async (token: string, ghlUserId: string) => {
      await page.goto(`${base}/settings`);
      if (await page.locator('[data-testid="ghl-connected"]').count()) {
        await page.locator('[data-testid="ghl-reconnect"] > summary').click();
        await page.fill('[data-testid="ghl-reconnect-user"]', ghlUserId);
        await page.fill('[data-testid="ghl-reconnect-token"]', token);
        await submit(page, '[data-testid="ghl-reconnect"] button:has-text("Reconnect")');
      } else {
        if (!(await page.locator('[data-testid="ghl-steps"][open]').count())) await page.click('[data-testid="ghl-connect-open"]');
        await page.fill('[data-testid="ghl-location"]', LOC);
        await page.fill('[data-testid="ghl-token"]', token);
        await submit(page, '[data-testid="ghl-steps"] button:has-text("Connect")');
      }
      if (await page.locator('[data-testid="ghl-no-user"] input[name="ghlUserId"]').count()) {
        await page.fill('[data-testid="ghl-no-user"] input[name="ghlUserId"]', ghlUserId);
        await submit(page, '[data-testid="ghl-no-user"] button:has-text("Save")');
      }
    };
    await connect("pit-noscope", "user_danno");
    await page.goto(`${base}/coach/community`);
    await page.locator('[data-testid="community-scopes-missing"]').waitFor({ timeout: 20000 });
    if (!(await page.locator('[data-testid="community-scopes-missing"]').innerText()).includes("socialplanner/account.readonly")) throw new Error("the missing scope is named");
    await connect(`pit-${LOC}`, "user_danno");
    await page.goto(`${base}/coach/community`);
    const scopeStates = await page.locator('[data-testid="community-scopes"] li').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-scope")}=${e.getAttribute("data-state")}`));
    if (scopeStates.join(",") !== "socialplanner/account.readonly=ok,socialplanner/post.readonly=ok,socialplanner/post.write=unknown" || (await page.locator('[data-testid="community-scopes-missing"]').count())) throw new Error(`the scopes read ok, and posting is left to the test post: ${scopeStates.join(",")}`);
    console.log("✓ the page sends a coach with no connection to Publishing, names a missing scope, and reads the two it can check");

    // ── 2. The channel is picked from the accounts list, and the Monday post needs one. ──
    const options = await page.locator('[data-testid="community-channel"] option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    if (options[1] !== `${LOC}_community_intentions` || !options.includes(`${LOC}_community_test`)) throw new Error(`the community channels come first in the list: ${options.join(",")}`);
    await page.locator('[data-testid="community-monday-on"]').check();
    await submit(page, '[data-testid="community-save"]');
    if ((await page.locator('[data-testid="community-error"]').innerText()).trim() !== "Pick the channel before turning the Monday post on.") throw new Error("the Monday post can't be on without a channel");
    await page.locator('[data-testid="community-channel"]').selectOption(`${LOC}_community_test`);
    await page.locator('[data-testid="community-monday-on"]').check();
    await page.locator('[data-testid="community-post-as-name"]').fill("HelixOS");
    await page.locator('[data-testid="community-link-pattern"]').fill("https://academy.example.com/post?id={postId}");
    await submit(page, '[data-testid="community-save"]');
    await page.locator('[data-testid="community-saved"]').waitFor({ timeout: 20000 });
    const saved = (await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!;
    if (saved.channelAccountId !== `${LOC}_community_test` || saved.channelName !== "HelixOS test" || !saved.mondayOn || saved.mondayText !== null || saved.postTime !== "08:00") throw new Error(`the setup is saved, with Danno's text kept as the default: ${JSON.stringify({ ...saved, id: undefined })}`);
    // Rev 499: the Monday post on with no graphic says so, since it goes out without an image.
    if ((await page.locator('[data-testid="community-monday-no-graphic"]').innerText()).trim() !== "No graphic set: the post goes out without an image.") throw new Error("the Monday post on with no graphic warns that it goes out without an image");
    console.log("✓ the channel is picked from the accounts list (community ones first); the Monday post can't be on without one; on with no graphic, it says so");

    // ── 3. The test post. With no "Posted as", nothing falls back to the staff user on Publishing (28 Sep: it never works). ──
    await submit(page, '[data-testid="community-test"]');
    if (!(await page.locator('[data-testid="community-error"]').innerText()).includes("Posted as")) throw new Error("with no Posted as, the test post says what's missing and sends nothing");
    await page.locator('[data-testid="community-post-as-id"]').fill("contact_danno");
    await submit(page, '[data-testid="community-save"]');
    await submit(page, '[data-testid="community-test"]');
    await page.locator('[data-testid="community-test-result"][data-state="sent"]').waitFor({ timeout: 20000 });
    const testSent = (await mockPosts()).find((p) => (p.communityPostDetails as { title?: string } | undefined)?.title === TEST_TITLE);
    const as = (testSent?.communityPostDetails as { postAsUser?: Record<string, { id: string; name: string }> } | undefined)?.postAsUser?.[`${LOC}_community_test`];
    if (!testSent || as?.id !== "contact_danno" || as.name !== "HelixOS" || String(testSent.status) !== "published") throw new Error("the test post goes out now, from the team user, with its title");
    await submit(page, '[data-testid="community-test-result"] [data-testid="community-check"]');
    const result = page.locator('[data-testid="community-test-result"]').first();
    await page.locator('[data-testid="community-test-result"][data-state="posted"]').waitFor({ timeout: 20000 });
    const resultText = await result.innerText();
    if (!resultText.includes("Shown as HelixOS") || !/Community id cm_post_\d+/.test(resultText) || !(await result.locator('[data-testid="community-post-link"]').getAttribute("href"))?.startsWith("https://academy.example.com/post?id=cm_post_")) throw new Error(`the test result shows who it's from, the community's id and the link: ${resultText}`);
    console.log("✓ a test post goes out as the team user with its title; Check again shows it published, who it shows as, its id and link");
    type Details = { title?: string; notifyAllGroupMembers?: boolean };
    if ((testSent.communityPostDetails as Details).notifyAllGroupMembers !== false) throw new Error("a test post never notifies (rev 187)");
    if (!(await page.locator('[data-testid="community-monday-notify"]').isChecked())) throw new Error("Notify all members is on by default for the Monday post");

    // Rev 169: the Monday text as a test, with its layout kept (a blank line a new paragraph, a return a line break), escaped,
    // under next Monday's title, and never notifying anyone even with Notify all members on.
    const LAID_OUT = "Set your intention.\n\nONE word\nTHREE key results & ONE initiative\n\nShare below @everyone";
    await db.update(schema.communitySettings).set({ mondayText: LAID_OUT }).where(eq(schema.communitySettings.workspaceId, ws.id));
    await submit(page, '[data-testid="community-test-monday"]');
    const mondayTest = (await mockPosts()).find((p) => (p.communityPostDetails as Details | undefined)?.title?.startsWith("Test: Set Your Intentions "));
    if (!mondayTest || !String(mondayTest.summary).startsWith(communityHtml(LAID_OUT)) || !String(mondayTest.summary).includes("<p>ONE word<br>THREE key results &amp; ONE initiative</p>")) throw new Error(`the Monday text goes out as a test with its paragraphs and line breaks: ${String(mondayTest?.summary)}`);
    if ((mondayTest.communityPostDetails as Details).notifyAllGroupMembers !== false || !(mondayTest.accountIds as string[]).includes(`${LOC}_community_test`)) throw new Error("the Monday-text test goes to the test channel and never notifies");
    // Rev 203: a test keeps @everyone as words, never the broadcast mention that could ping every member.
    if (String(mondayTest.summary).includes("data-mention-type") || !String(mondayTest.summary).includes("Share below @everyone")) throw new Error("the Monday-text test keeps @everyone as plain words");
    await db.update(schema.communitySettings).set({ mondayText: null }).where(eq(schema.communitySettings.workspaceId, ws.id));
    // A fresh page, so the setup form's next Save carries the default text again, not the walk's.
    await page.goto(`${base}/coach/community?view=reset#setup`);
    console.log("✓ Send the Monday text as a test: next Monday's title, paragraphs and line breaks kept as HTML, escaped, to the test channel, never notifying");

    // ── 4. An account on hold stops everything, with no retry, until Resume. ──
    await page.locator('[data-testid="community-post-as-id"]').fill("user_onhold");
    await submit(page, '[data-testid="community-save"]');
    await submit(page, '[data-testid="community-test"]');
    await page.locator('[data-testid="community-paused"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="community-error"]').innerText()).trim() !== HOLD_REASON) throw new Error("the hold is said in plain words");
    const before = (await mockPosts()).length;
    await cron(page);
    if ((await mockPosts()).length !== before) throw new Error("nothing posts while the account is on hold");
    await page.locator('[data-testid="community-post-as-id"]').fill("contact_danno");
    await submit(page, '[data-testid="community-save"]');
    await submit(page, '[data-testid="community-resume"]');
    // The refreshed page lands a beat after the action's response (1 Oct, under a loaded gate): wait for the banner to go.
    for (let i = 0; i < 50 && (await page.locator('[data-testid="community-paused"]').count()); i++) await page.waitForTimeout(100);
    if (await page.locator('[data-testid="community-paused"]').count()) throw new Error("Resume clears the hold");
    console.log("✓ an account on hold stops posting, says why, and the hourly job doesn't retry; Resume clears it");

    // ── 5. Next Monday: its own text, skipped, and back on. The Intentions channel gets its own link pattern. ──
    await page.locator('[data-testid="community-channel"]').selectOption(`${LOC}_community_intentions`);
    if (await page.locator('[data-testid="community-link-pattern"]').inputValue()) throw new Error("picking another channel shows its own link pattern (none yet), not the test channel's");
    await page.locator('[data-testid="community-channel"]').selectOption(`${LOC}_community_test`);
    if ((await page.locator('[data-testid="community-link-pattern"]').inputValue()) !== "https://academy.example.com/post?id={postId}") throw new Error("picking the test channel again shows its saved pattern");
    await page.locator('[data-testid="community-channel"]').selectOption(`${LOC}_community_intentions`);
    await page.locator('[data-testid="community-link-pattern"]').fill("https://academy.example.com/channels/intentions/posts/{postId}");
    await submit(page, '[data-testid="community-save"]');
    const patterns = (await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!.linkPatterns;
    if (patterns[`${LOC}_community_test`] !== "https://academy.example.com/post?id={postId}" || patterns[`${LOC}_community_intentions`] !== "https://academy.example.com/channels/intentions/posts/{postId}") throw new Error(`each channel keeps its own link pattern: ${JSON.stringify(patterns)}`);
    const next = upcomingWeek(today, nowWallInTz(tz).slice(11, 16), "08:00");
    const nextCard = page.locator('[data-testid="community-next"]');
    if ((await nextCard.getAttribute("data-week")) !== next || (await page.locator('[data-testid="community-next-title"]').innerText()).trim() !== mondayTitle(next)) throw new Error(`next Monday is ${next}, titled with its week`);
    const WEEK_TEXT = `This week's own words [walk ${Date.now()}]`;
    await fillChecked(page, '[data-testid="community-next-body"]', WEEK_TEXT);
    await submit(page, '[data-testid="community-next-save"]');
    const nextRow = () => db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, next)) });
    if ((await nextRow())?.body !== WEEK_TEXT || (await nextRow())?.status !== "scheduled") throw new Error("that Monday keeps its own text");
    await submit(page, '[data-testid="community-next-skip"]');
    // The refreshed card lands a beat after the action's response: wait for its state rather than reading it once.
    for (let i = 0; i < 50 && (await nextCard.getAttribute("data-state")) !== "skipped"; i++) await page.waitForTimeout(100);
    if ((await nextRow())?.status !== "skipped" || (await nextCard.getAttribute("data-state")) !== "skipped") throw new Error("the week is skipped");
    await submit(page, '[data-testid="community-next-unskip"]');
    if ((await nextRow())?.status !== "scheduled") throw new Error("and back on");
    console.log(`✓ next Monday (${next}): its own text for that week, skipped, and back on`);

    // ── 6. A failed week, posted once with Post now; the job reads it back and never sends it again. ──
    const lastWeek = addDays(startOfWeek(today), -7);
    await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday", weekOf: lastWeek, title: mondayTitle(lastWeek), status: "failed", error: "GoHighLevel didn't answer." });
    await db.delete(schema.weeklyIntentions).where(and(eq(schema.weeklyIntentions.userId, maya.id), eq(schema.weeklyIntentions.weekOf, lastWeek)));
    await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId: ws.id, userId: maya.id, weekOf: lastWeek, word: "Steady", keyResults: [{ text: "One", done: null }, { text: "Two", done: null }], initiative: "Plan", tasks: [{ title: "A", taskId: null }, { title: "B", taskId: null }] });
    await page.goto(`${base}/coach/community#log`);
    const failedRow = page.locator(`[data-testid="community-log-row"][data-week="${lastWeek}"]`);
    await failedRow.waitFor({ timeout: 20000 });
    if ((await failedRow.getAttribute("data-state")) !== "failed" || !(await failedRow.innerText()).includes("GoHighLevel didn't answer.") || !/3-1-3s set that week: 1 of \d+/.test(await failedRow.locator('[data-testid="community-week-counts"]').innerText())) throw new Error("a failed week shows its reason and that week's 3-1-3 count");
    await submit(page, `[data-testid="community-log-row"][data-week="${lastWeek}"] [data-testid="community-retry"]`);
    const titled = async (t: string) => (await mockPosts()).filter((p) => (p.communityPostDetails as { title?: string } | undefined)?.title === t);
    const sentOnce = await titled(mondayTitle(lastWeek));
    if (sentOnce.length !== 1 || sentOnce[0].summary !== communityHtml(DEFAULT_MONDAY_TEXT) || String(sentOnce[0].summary).includes("data-mention-type") || !String(sentOnce[0].summary).includes("Share below @everyone") || !(sentOnce[0].accountIds as string[]).includes(`${LOC}_community_intentions`)) throw new Error("Post now sends that week once, with the Monday text (@everyone as words, where it was written: rev 499), to the Intentions channel");
    if ((sentOnce[0].communityPostDetails as { notifyAllGroupMembers?: boolean }).notifyAllGroupMembers !== true) throw new Error("the Monday post notifies all members, as the setting says by default (rev 187)");
    await cron(page);
    await cron(page);
    const row = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.weekOf, lastWeek)) });
    if ((await titled(mondayTitle(lastWeek))).length !== 1 || row?.status !== "posted" || row.link !== `https://academy.example.com/channels/intentions/posts/${row.platformPostId}`) throw new Error("the job reads it back as posted, with the link, and never sends it again");
    await page.goto(`${base}/coach/community#log`);
    if (await page.locator(`[data-testid="community-log-row"][data-week="${lastWeek}"] [data-testid="community-retry"]`).count()) throw new Error("a posted week has no Post now");
    if (!(await page.locator(`[data-testid="community-log-row"][data-week="${lastWeek}"] [data-testid="community-notified"]`).count())) throw new Error("the log says the Monday post asked to notify all members");
    console.log(`✓ a failed week (${lastWeek}) is posted once with Post now, notifying all members; the job reads it back as posted with its link, and never sends it twice`);

    // With Notify all members off, the Monday posts that follow don't notify.
    await page.goto(`${base}/coach/community?view=quiet#setup`);
    await page.locator('[data-testid="community-monday-notify"]').uncheck();
    await submit(page, '[data-testid="community-save"]');
    if ((await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!.mondayNotify) throw new Error("Notify all members can be turned off");

    // Seen live on 28 Sep: a create reply with no id (the post is found in the planner's list and read back), and a post the
    // planner fails (GoHighLevel's own words, and Post now offered again: the week isn't used up).
    const noIdWeek = addDays(startOfWeek(today), -14);
    const failWeek = addDays(startOfWeek(today), -21);
    await db.insert(schema.communityPosts).values([
      { id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday", weekOf: noIdWeek, title: mondayTitle(noIdWeek), body: "The week's post [noid]", status: "failed", error: "earlier" },
      { id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday", weekOf: failWeek, title: mondayTitle(failWeek), body: "The week's post [fail]", status: "failed", error: "earlier" },
    ]);
    // A fresh load: the page is already at this address, and going to the same address only moves to #log.
    await page.goto(`${base}/coach/community?view=log#log`);
    for (const w of [noIdWeek, failWeek]) await submit(page, `[data-testid="community-log-row"][data-week="${w}"] [data-testid="community-retry"]`);
    if ((await titled(mondayTitle(failWeek))).some((p) => (p.communityPostDetails as { notifyAllGroupMembers?: boolean }).notifyAllGroupMembers !== false)) throw new Error("with Notify all members off, a Monday post doesn't notify");
    const rowFor = (w: string) => db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, w)) });
    if ((await rowFor(noIdWeek))?.ghlPostId) throw new Error("the walk's hook sends no id back on create");
    await submit(page, `[data-testid="community-log-row"][data-week="${noIdWeek}"] [data-testid="community-check"]`);
    await submit(page, `[data-testid="community-log-row"][data-week="${failWeek}"] [data-testid="community-check"]`);
    const noIdRow = (await rowFor(noIdWeek))!;
    const failRow = (await rowFor(failWeek))!;
    if (noIdRow.status !== "posted" || !noIdRow.ghlPostId || noIdRow.link !== `https://academy.example.com/channels/intentions/posts/${noIdRow.platformPostId}`) throw new Error(`a post created with no id is found in the planner's list and read back as posted, with its link: ${JSON.stringify(noIdRow)}`);
    if (failRow.status !== "failed" || !failRow.error?.startsWith("GoHighLevel says: The channel or group is either deleted or inactive")) throw new Error(`a post the planner failed shows as failed, in GoHighLevel's words: ${JSON.stringify(failRow)}`);
    await page.goto(`${base}/coach/community?view=again#log`);
    if (!(await page.locator(`[data-testid="community-log-row"][data-week="${failWeek}"] [data-testid="community-retry"]`).count())) throw new Error("after a failure, Post now is offered again");
    console.log("✓ a create reply with no id: found in the planner's list, read back as posted with its link; a post the planner failed: Failed in GoHighLevel's words, with Post now offered again");

    // Rev 499 (5 Oct, live): the first automatic Monday post was linked on the planner's id and opened "Post not available".
    // GoHighLevel's first read hands back the planner's id; HelixOS waits for the community's own, and links on that alone.
    const lateWeek = addDays(startOfWeek(today), -77);
    await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday", weekOf: lateWeek, title: mondayTitle(lateWeek), body: "The week's post [late-id]", status: "failed", error: "earlier" });
    await page.goto(`${base}/coach/community?view=late#log`);
    await submit(page, `[data-testid="community-log-row"][data-week="${lateWeek}"] [data-testid="community-retry"]`);
    await submit(page, `[data-testid="community-log-row"][data-week="${lateWeek}"] [data-testid="community-check"]`);
    const lateFirst = (await rowFor(lateWeek))!;
    if (lateFirst.status !== "sent" || lateFirst.link || lateFirst.platformPostId || !lateFirst.checkNote?.includes("waiting for the community's own post id")) throw new Error(`the planner's own id is never taken for the community's: still on its way, no link: ${JSON.stringify(lateFirst)}`);
    await submit(page, `[data-testid="community-log-row"][data-week="${lateWeek}"] [data-testid="community-check"]`);
    const lateRow = (await rowFor(lateWeek))!;
    const linkedId = lateRow.link?.split("/posts/")[1];
    if (lateRow.status !== "posted" || !lateRow.platformPostId || lateRow.platformPostId === lateRow.ghlPostId || linkedId !== lateRow.platformPostId) throw new Error(`the link is built on the community's own id, the one shown on the row: ${JSON.stringify(lateRow)}`);
    if (!(await page.locator(`[data-testid="community-log-row"][data-week="${lateWeek}"]`).innerText()).includes(`Community id ${lateRow.platformPostId}`)) throw new Error("the row shows the community id the link uses");
    console.log("✓ rev 499: a read that hands back the planner's id waits, with no link; the link is then built on the community's own id, the one the row shows");

    // 28 Sep, 11:40: a post HelixOS can't find is never Failed on that alone (it may be live: Post now would post it twice). It
    // reads "unknown" with no Post now, until the coach says whether it went out.
    const lostWeeks = [addDays(startOfWeek(today), -28), addDays(startOfWeek(today), -35)];
    const longAgo = new Date(Date.now() - 20 * 60000).toISOString();
    await db.insert(schema.communityPosts).values(lostWeeks.map((w) => ({ id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday" as const, weekOf: w, title: mondayTitle(w), body: `Never seen by the planner ${w}`, accountId: `${LOC}_community_intentions`, status: "sent" as const, sentAt: longAgo })));
    await page.goto(`${base}/coach/community?view=lost#log`);
    for (const w of lostWeeks) await submit(page, `[data-testid="community-log-row"][data-week="${w}"] [data-testid="community-check"]`);
    for (const w of lostWeeks) {
      const r = (await rowFor(w))!;
      if (r.status !== "unknown" || !r.checkNote) throw new Error(`a post not found ten minutes on is unknown, with what the last check found: ${JSON.stringify(r)}`);
      if (await page.locator(`[data-testid="community-log-row"][data-week="${w}"] [data-testid="community-retry"]`).count()) throw new Error("an unknown post never offers Post now");
    }
    await submit(page, `[data-testid="community-log-row"][data-week="${lostWeeks[0]}"] [data-testid="community-resolve-live"]`);
    await submit(page, `[data-testid="community-log-row"][data-week="${lostWeeks[1]}"] [data-testid="community-resolve-not"]`);
    // The refreshed log lands a beat after the second action's response (2 Oct, under a loaded gate): wait for Post now to be back.
    const retryBack = page.locator(`[data-testid="community-log-row"][data-week="${lostWeeks[1]}"] [data-testid="community-retry"]`);
    for (let i = 0; i < 50 && !(await retryBack.count()); i++) await page.waitForTimeout(100);
    if ((await rowFor(lostWeeks[0]))!.status !== "posted" || (await rowFor(lostWeeks[1]))!.status !== "failed" || !(await retryBack.count())) throw new Error("It's live marks it posted; It didn't go out marks it failed and brings Post now back");
    console.log("✓ a post HelixOS can't find: unknown with the last check shown, never Failed and no Post now; It's live / It didn't go out settle it (only the second brings Post now back)");

    // 28 Sep, 12:30: this week's post was live while HelixOS said failed, with nowhere to put its link. Every row takes a link;
    // saving one marks it published with the community's post id, Post now goes, and a channel with no pattern learns it.
    const handWeek = addDays(startOfWeek(today), -42);
    const handChannel = `${LOC}_community_wins`;
    await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday", weekOf: handWeek, title: mondayTitle(handWeek), body: "Posted by hand", accountId: handChannel, status: "failed", error: "earlier" });
    const patternsBefore = (await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!.linkPatterns;
    if (patternsBefore[handChannel]) throw new Error("the walk's hand-posted channel starts with no pattern");
    await page.goto(`${base}/coach/community?view=hand#log`);
    // An empty Save link on a row with no link says what's missing (rev 174), and changes nothing.
    await submit(page, `[data-testid="community-log-row"][data-week="${handWeek}"] [data-testid="community-link-save"]`);
    await page.getByText("Paste the post's link first.").first().waitFor({ timeout: 15000 });
    if ((await rowFor(handWeek))!.status !== "failed") throw new Error("an empty Save link changes nothing");
    await page.goto(`${base}/coach/community?view=hand1#log`);
    const pasted: [string, string][] = [
      [lostWeeks[1], "https://academy.example.com/channels/intentions/posts/aaaaaaaaaaaaaaaaaaaaaaaa"],
      [handWeek, "https://academy.example.com/channels/Old-Slug-2sIZH/posts/6aba9e02b152d012a960d2f9?from=feed"],
    ];
    for (const [w, link] of pasted) {
      const row = page.locator(`[data-testid="community-log-row"][data-week="${w}"]`);
      if (!(await row.locator('[data-testid="community-retry"]').count())) throw new Error("a failed row offers Post now before its link is saved");
      await row.locator('[data-testid="community-link"]').fill(link);
      await submit(page, `[data-testid="community-log-row"][data-week="${w}"] [data-testid="community-link-save"]`);
    }
    const handRow = (await rowFor(handWeek))!;
    const lostRow = (await rowFor(lostWeeks[1]))!;
    if (handRow.status !== "posted" || handRow.platformPostId !== "6aba9e02b152d012a960d2f9" || handRow.error || !handRow.postedAt) throw new Error(`a saved link marks a failed row published with the community's post id: ${JSON.stringify(handRow)}`);
    if (lostRow.status !== "posted" || lostRow.platformPostId !== "aaaaaaaaaaaaaaaaaaaaaaaa") throw new Error(`the same for a row the coach had marked not sent: ${JSON.stringify(lostRow)}`);
    await page.goto(`${base}/coach/community?view=hand2#log`);
    for (const [w] of pasted) {
      if (await page.locator(`[data-testid="community-log-row"][data-week="${w}"] [data-testid="community-retry"]`).count()) throw new Error("a published row never offers Post now");
      if ((await page.locator(`[data-testid="community-log-row"][data-week="${w}"]`).getAttribute("data-state")) !== "posted") throw new Error("the log shows a row with a saved link as published");
    }
    const patternsAfter = (await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!.linkPatterns;
    if (patternsAfter[handChannel] !== "https://academy.example.com/channels/Old-Slug-2sIZH/posts/{postId}") throw new Error(`a channel with no pattern takes one from the saved link: ${JSON.stringify(patternsAfter)}`);
    if (patternsAfter[`${LOC}_community_intentions`] !== patternsBefore[`${LOC}_community_intentions`]) throw new Error("a channel's saved pattern is never replaced by a pasted link");
    // A post HelixOS never sent has no channel of its own: its link marks it published but teaches no pattern (rev 174: never
    // the channel picked in the setup, which may be the test channel).
    const missedWeek = addDays(startOfWeek(today), -49);
    await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday", weekOf: missedWeek, title: mondayTitle(missedWeek), status: "scheduled" });
    await page.goto(`${base}/coach/community?view=hand3#log`);
    await page.locator(`[data-testid="community-log-row"][data-week="${missedWeek}"] [data-testid="community-link"]`).fill("https://academy.example.com/channels/Somewhere-Else/posts/bbbbbbbbbbbbbbbbbbbbbbbb");
    await submit(page, `[data-testid="community-log-row"][data-week="${missedWeek}"] [data-testid="community-link-save"]`);
    const patternsLast = (await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!.linkPatterns;
    if ((await rowFor(missedWeek))!.status !== "posted" || JSON.stringify(patternsLast) !== JSON.stringify(patternsAfter)) throw new Error(`a post with no channel of its own is published by its link and teaches no pattern: ${JSON.stringify(patternsLast)}`);
    const savedFor = await page.locator('[data-testid="community-patterns-saved"]').innerText();
    if (!savedFor.includes("Intentions") || !savedFor.includes("a channel no longer connected")) throw new Error(`the setup names the channels with a saved pattern: ${savedFor}`);
    console.log("✓ Save link on every row: empty says paste first; a failed row with a pasted link is published with the community's post id and no Post now; the channel it went to learns the pattern (one with a pattern keeps its own, a post with no channel teaches none); the setup names the channels with one");

    // On a Monday after the coach's time, the job posts this week's by itself, once; any other day it posts nothing new.
    const thisWeek = startOfWeek(today);
    await db.update(schema.communitySettings).set({ postTime: "00:00" }).where(eq(schema.communitySettings.workspaceId, ws.id));
    const due = mondayDue(today, nowWallInTz(tz).slice(11, 16), "00:00");
    const count0 = (await mockPosts()).length;
    await cron(page);
    await cron(page);
    const mine = await titled(mondayTitle(thisWeek));
    if (due ? mine.length !== 1 : (await mockPosts()).length !== count0) throw new Error(due ? "on Monday the job posts this week's, once" : "on any other day the job posts nothing new");
    console.log(due ? `✓ ${today} is a Monday: the hourly job posted this week's by itself, once` : `✓ ${today} isn't a Monday: the hourly job posted nothing new (the unit tests cover Monday)`);

    // ── 7. Share to the thread (piece 2): this week's post only, copied, opened, 15 points once per week. ──
    const { weekOf } = await import("@/lib/engine/intentions");
    const { SHARE_POINTS, shareText } = await import("@/lib/engine/community");
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const mayaWeek = weekOf(todayInTz(mayaM.timezone || ws.timezone));
    await db.delete(schema.weeklyIntentions).where(and(eq(schema.weeklyIntentions.userId, maya.id), eq(schema.weeklyIntentions.weekOf, mayaWeek)));
    const week = { word: "Consistent", keyResults: [{ text: "Follow up with 12 leads", done: null }, { text: "Book 3 calls", done: null }], initiative: "Build my webinar", tasks: [{ title: "Write the hook", taskId: null }, { title: "Record the intro", taskId: null }] };
    await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId: ws.id, userId: maya.id, weekOf: mayaWeek, ...week });
    const { monthOf } = await import("@/lib/engine/month-intentions");
    const mayaMonth = monthOf(todayInTz(mayaM.timezone || ws.timezone));
    await db.delete(schema.monthlyIntentions).where(and(eq(schema.monthlyIntentions.userId, maya.id), eq(schema.monthlyIntentions.month, mayaMonth)));
    await db.insert(schema.monthlyIntentions).values({ id: newId(), workspaceId: ws.id, userId: maya.id, month: mayaMonth, word: "Rooted", personalSeason: "wealth", fear: "f", habit: "h", skill: "s", impact: "i", businessSeason: "sales", revenueGoal: 10000, revenueWhy: "To hire help.", plan: "p", proudLast: "l", proudEnd: "e" });
    await db.delete(schema.communityShares).where(eq(schema.communityShares.userId, maya.id));
    await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "community")));
    await db.delete(schema.communityPosts).where(and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, mayaWeek)));
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/intentions`);
    await page.locator('[data-testid="week-share"]').waitFor({ timeout: 20000 });
    if (!(await page.locator('[data-testid="week-share"] [data-testid="share-unavailable"]').innerText()).includes("isn't up yet") || (await page.locator('[data-testid="share-to-thread"]').count())) throw new Error("before this week's post is out, the button says so and opens nothing");
    // The month's share (1 Oct) says the same until this month's post is out (step 8 brings it out).
    if (!(await page.locator('[data-testid="month-share"] [data-testid="share-unavailable"]').innerText()).includes("Check back after the 1st") || (await page.locator('[data-testid="month-thread"]').count())) throw new Error("before this month's post is out, the month's button says so, and there is no month thread link");
    if (await page.locator('[data-testid="week-thread"]').count()) throw new Error("no thread link before this week's post is published");
    await settle(page);
    const LINK = "https://academy.example.com/post?id=cm_share";
    await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "monday", weekOf: mayaWeek, title: mondayTitle(mayaWeek), status: "posted", link: LINK, platformPostId: "cm_share" });
    await page.reload();
    const shareBtn = page.locator('[data-testid="week-share"] [data-testid="share-to-thread"]');
    await shareBtn.waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="week-thread"]').getAttribute("href")) !== LINK) throw new Error("once the post is published, This week's thread links to it");
    if (!(await shareBtn.getAttribute("class"))?.includes("w-full") || (await shareBtn.innerText()).trim() !== "Share to the thread") throw new Error("Share to the thread is the full-width main button under the set week");
    const [popup] = await Promise.all([page.waitForEvent("popup"), shareBtn.click()]);
    await popup.waitForLoadState();
    if (popup.url() !== LINK) throw new Error(`the tap opens this week's post: ${popup.url()}`);
    await popup.close();
    const note = page.locator('[data-testid="week-share"] [data-testid="share-note"]');
    await note.waitFor({ timeout: 20000 });
    if (!(await note.innerText()).includes("Copied! On the post, tap Add a comment, paste, and press Post.") || !(await note.innerText()).includes(`+${SHARE_POINTS} points`)) throw new Error(`the member is told it's copied and what to do: ${await note.innerText()}`);
    if ((await shareBtn.innerText()).trim() !== "Shared ✓, open the thread") throw new Error("after sharing, the button says so and opens the thread again");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    if (clip !== shareText(week) || /10,?000|Rooted|hire help/.test(clip)) throw new Error(`the comment is the 3-1-3 only, with nothing monthly and no revenue: ${clip}`);
    const scored = async () => db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.type, "community")) });
    if ((await scored()).length !== 1 || (await scored())[0].points !== SHARE_POINTS) throw new Error("the first tap scores 15");
    await page.reload();
    const again = page.locator('[data-testid="week-share"] [data-testid="share-to-thread"][data-shared="yes"]');
    await again.waitFor({ timeout: 20000 });
    const [popup2] = await Promise.all([page.waitForEvent("popup"), again.click()]);
    await popup2.close();
    await page.locator('[data-testid="week-share"] [data-testid="share-note"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="week-share"] [data-testid="share-note"]').innerText()).includes("points") || (await scored()).length !== 1) throw new Error("a second tap in the same week scores nothing");
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="intentions-summary"] [data-testid="share-to-thread"]').waitFor({ timeout: 20000 });
    // A member who hasn't set the week still sees where the thread is (rev 175).
    await settle(page);
    await db.delete(schema.weeklyIntentions).where(and(eq(schema.weeklyIntentions.userId, maya.id), eq(schema.weeklyIntentions.weekOf, mayaWeek)));
    await page.goto(`${base}/intentions`);
    await page.locator('[data-testid="week-card"][data-state="set"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="week-thread"]').getAttribute("href")) !== LINK) throw new Error("before the week is set, This week's thread is still there");
    await settle(page);
    await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId: ws.id, userId: maya.id, weekOf: mayaWeek, ...week });
    console.log(`✓ Share to the thread: says so before this week's post is out; then copies the 3-1-3 only (no revenue, nothing monthly), opens this week's post, and scores ${SHARE_POINTS} once for the week, then reads Shared ✓; on Today too; This week's thread shows once the post is published, set week or not`);
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/coach/community#log`);
    const shareRow = page.locator(`[data-testid="community-log-row"][data-week="${mayaWeek}"]`);
    await shareRow.waitFor({ timeout: 20000 });
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const notSharedText = (await shareRow.locator('[data-testid="community-not-shared"]').textContent()) ?? "";
    if ((await shareRow.locator('[data-testid="community-week-shares"]').innerText()).trim() !== "1" || notSharedText.includes(maya.name) || !notSharedText.includes(jordan.name)) throw new Error(`the coach sees the week's shares and who hasn't shared: ${notSharedText}`);
    console.log("✓ the coach's log shows the week's shares and who hasn't shared yet");

    // ── 8. The first of the month (1 Oct): its own switch, time and text; the month text as a test; next month's own text,
    //       skipped and back on; a month posted by hand takes its link; a failed month is posted once with Post now; the
    //       member's share from the month card copies the eleven answers; the coach's counts. ──
    const { DEFAULT_MONTH_TEXT, emojiNumeral, monthShareText, monthTitle, upcomingMonth } = await import("@/lib/engine/community");
    const thisMonth = today.slice(0, 7);
    const lastMonth = thisMonth.slice(5, 7) === "01" ? `${Number(thisMonth.slice(0, 4)) - 1}-12` : `${thisMonth.slice(0, 4)}-${String(Number(thisMonth.slice(5, 7)) - 1).padStart(2, "0")}`;
    await page.goto(`${base}/coach/community?view=month#setup`);
    if (await page.locator('[data-testid="community-month-on"]').isChecked()) throw new Error("the month post starts off");
    if (!(await page.locator('[data-testid="community-month-notify"]').isChecked())) throw new Error("Notify all members is on by default for the month post");
    await page.locator('[data-testid="community-month-on"]').check();
    await page.locator('[data-testid="community-month-time"]').fill("00:00");
    await submit(page, '[data-testid="community-save"]');
    await page.locator('[data-testid="community-saved"]').waitFor({ timeout: 20000 });
    const sMonth = (await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!;
    if (!sMonth.monthOn || sMonth.monthTime !== "00:00" || sMonth.monthText !== null || !sMonth.monthNotify) throw new Error(`the month post's own switch and time are saved, the default text kept as the default: ${JSON.stringify({ monthOn: sMonth.monthOn, monthTime: sMonth.monthTime, monthText: sMonth.monthText })}`);
    const nextM = upcomingMonth(today, nowWallInTz(tz).slice(11, 16), "00:00");
    await submit(page, '[data-testid="community-test-month"]');
    const monthTest = (await mockPosts()).find((p) => (p.communityPostDetails as Details | undefined)?.title === `Test: ${monthTitle(nextM)}`);
    if (!monthTest || !String(monthTest.summary).startsWith(communityHtml(DEFAULT_MONTH_TEXT)) || !String(monthTest.summary).includes(`${emojiNumeral(1)} What is one word`) || !String(monthTest.summary).includes("(self, wealth, relationships, or spirituality)")) throw new Error(`the month text goes out as a test under next month's title, with the eleven questions in the October post's shape: ${String(monthTest?.summary).slice(0, 200)}`);
    if ((monthTest.communityPostDetails as Details).notifyAllGroupMembers !== false || String(monthTest.summary).includes("data-mention-type")) throw new Error("the month-text test never notifies and keeps @everyone as words");
    if (!/^Set Your Intentions [A-Z][a-z]+ \d{4}$/.test(monthTitle(nextM))) throw new Error(`the month title is Danno's pattern, month and year: ${monthTitle(nextM)}`);
    console.log(`✓ the first of the month: its own switch, time and text under Setup, on by the coach; the month text as a test under "${monthTitle(nextM)}", never notifying`);

    // The graphic (rev 328): a square image from the coach's Images library, picked beside the month text; the planner gets a
    // public copy of it with the post (the library is the private store, which GoHighLevel can't read).
    const { default: sharp } = await import("sharp");
    const square = await sharp({ create: { width: 540, height: 540, channels: 3, background: { r: 200, g: 170, b: 60 } } }).png().toBuffer();
    const graphicKey = `deck/${ws.id}/${coach.id}/${newId()}.png`;
    const put = await fetch(`http://localhost:${blobPort}/?pathname=${encodeURIComponent(graphicKey)}`, { method: "PUT", headers: { authorization: `Bearer ${PROOF_TOKEN}`, "x-vercel-blob-access": "private", "x-content-type": "image/png" }, body: square });
    if (!put.ok) throw new Error(`the walk's graphic lands in the private store: ${put.status}`);
    const graphicUrl = ((await put.json()) as { url: string }).url;
    const graphicId = newId();
    await db.delete(schema.deckImages).where(eq(schema.deckImages.userId, coach.id));
    await db.insert(schema.deckImages).values({ id: graphicId, workspaceId: ws.id, userId: coach.id, kind: "photo", blobKey: graphicKey, blobUrl: graphicUrl, mime: "image/png", width: 540, height: 540, caption: "October graphic" });
    await page.goto(`${base}/coach/community?view=graphic#setup`);
    const imageOptions = await page.locator('[data-testid="community-month-image"] option').evaluateAll((els) => els.map((e) => `${(e as HTMLOptionElement).value}:${e.textContent}`));
    if (!imageOptions.some((o) => o.startsWith(`${graphicId}:`) && o.includes("October graphic") && o.includes("540×540"))) throw new Error(`the picker lists the coach's library with caption, kind and size: ${imageOptions.join(" | ")}`);
    await page.locator('[data-testid="community-month-image"]').selectOption(graphicId);
    await submit(page, '[data-testid="community-save"]');
    if ((await db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, ws.id) }))!.monthImageId !== graphicId) throw new Error("the month's graphic is saved");
    await submit(page, '[data-testid="community-test-month"]');
    const tests = (await mockPosts()).filter((p) => (p.communityPostDetails as Details | undefined)?.title === `Test: ${monthTitle(nextM)}`);
    const withGraphic = tests[tests.length - 1];
    const media = (withGraphic?.media ?? []) as { url: string; type: string }[];
    if (media.length !== 1 || media[0].type !== "image/png" || !media[0].url.startsWith(`http://localhost:${blobPort}/public/magnets/community/`)) throw new Error(`the test post carries the graphic as the planner's media, a public copy under community/: ${JSON.stringify(media)}`);
    const served = await fetch(media[0].url);
    if (!served.ok || (await served.arrayBuffer()).byteLength !== square.length) throw new Error("the public copy serves the graphic's bytes without a token");
    const testRow = (await db.query.communityPosts.findMany({ where: and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.kind, "test")), orderBy: [desc(schema.communityPosts.createdAt)], limit: 1 }))[0];
    if (testRow.imageId !== graphicId || testRow.imageUrl !== media[0].url || !testRow.imageKey?.startsWith("public/magnets/community/")) throw new Error(`the row keeps the graphic, its public key and URL: ${JSON.stringify({ imageId: testRow.imageId, imageKey: testRow.imageKey, imageUrl: testRow.imageUrl })}`);
    console.log("✓ the month's graphic: picked from the coach's Images library beside the month text, copied once to the public store and sent as the planner's media; the row keeps the key and URL");

    const monthCard = page.locator('[data-testid="community-month-next"]');
    if ((await monthCard.getAttribute("data-month")) !== nextM || (await page.locator('[data-testid="community-month-next-title"]').innerText()).trim() !== monthTitle(nextM)) throw new Error(`next month is ${nextM}, titled with its month`);
    const MONTH_TEXT = `That month's own words [walk ${Date.now()}]`;
    await fillChecked(page, '[data-testid="community-month-next-body"]', MONTH_TEXT);
    await submit(page, '[data-testid="community-month-next-save"]');
    const monthRow = (m: string) => db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.kind, "month"), eq(schema.communityPosts.monthOf, m)) });
    if ((await monthRow(nextM))?.body !== MONTH_TEXT || (await monthRow(nextM))?.status !== "scheduled") throw new Error("that month keeps its own text");
    await submit(page, '[data-testid="community-month-next-skip"]');
    for (let i = 0; i < 50 && (await monthCard.getAttribute("data-state")) !== "skipped"; i++) await page.waitForTimeout(100);
    if ((await monthRow(nextM))?.status !== "skipped" || (await monthCard.getAttribute("data-state")) !== "skipped") throw new Error("the month is skipped");
    await submit(page, '[data-testid="community-month-next-unskip"]');
    if ((await monthRow(nextM))?.status !== "scheduled") throw new Error("and back on");
    console.log(`✓ next month (${nextM}): its own text for that 1st, skipped, and back on`);

    // October's is Claude's hand post: this month's link, pasted, makes the row, published, so the members' share points at it.
    const byHand = page.locator('[data-testid="community-month-by-hand"]');
    if ((await byHand.getAttribute("data-month")) !== thisMonth) throw new Error("a month HelixOS didn't post offers to take its link");
    const LINK_M = "https://academy.example.com/channels/intentions/posts/cccccccccccccccccccccccc";
    await fillChecked(page, '[data-testid="community-month-link"]', LINK_M);
    await submit(page, '[data-testid="community-month-link-save"]');
    const handMonth = (await monthRow(thisMonth))!;
    if (handMonth.status !== "posted" || handMonth.link !== LINK_M || handMonth.platformPostId !== "cccccccccccccccccccccccc" || handMonth.title !== monthTitle(thisMonth)) throw new Error(`a pasted link makes this month's row, published: ${JSON.stringify(handMonth)}`);
    await page.goto(`${base}/coach/community?view=month2#month`);
    if (await page.locator('[data-testid="community-month-by-hand"]').count()) throw new Error("once this month's post is published, the paste box goes");
    const handRowM = page.locator(`[data-testid="community-month-row"][data-month="${thisMonth}"]`);
    if ((await handRowM.getAttribute("data-state")) !== "posted" || !/months set: 1 of \d+ · shared to the thread: 0/.test(await handRowM.locator('[data-testid="community-month-counts"]').innerText())) throw new Error("the month's row shows published with the month's counts");
    // The job never posts a month that is already published, even on the 1st from the month's time.
    const countM = (await mockPosts()).length;
    await cron(page);
    if ((await mockPosts()).length !== countM || (await monthRow(thisMonth))!.link !== LINK_M) throw new Error("the job leaves a month posted by hand alone");
    console.log(`✓ a month posted by hand (${thisMonth}): its pasted link makes the row, published, with the month's counts; the job leaves it alone`);

    // A failed month, posted once with Post now: the month text with @everyone as the tag, notifying, to the Intentions channel; read back as posted with its link.
    await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: ws.id, coachUserId: coach.id, kind: "month", monthOf: lastMonth, title: monthTitle(lastMonth), status: "failed", error: "GoHighLevel didn't answer." });
    await page.goto(`${base}/coach/community?view=month3#month`);
    await submit(page, `[data-testid="community-month-row"][data-month="${lastMonth}"] [data-testid="community-month-retry"]`);
    const sentMonth = await titled(monthTitle(lastMonth));
    if (sentMonth.length !== 1 || sentMonth[0].summary !== communityHtml(DEFAULT_MONTH_TEXT) || String(sentMonth[0].summary).includes("data-mention-type") || !(sentMonth[0].accountIds as string[]).includes(`${LOC}_community_intentions`)) throw new Error("Post now sends that month once, with the month text (@everyone as words), to the Intentions channel");
    if (((sentMonth[0].media ?? []) as { url: string }[]).length !== 1 || !(await monthRow(lastMonth))!.imageUrl) throw new Error("the real month post goes out with its graphic, and the row keeps the URL");
    if ((sentMonth[0].communityPostDetails as Details).notifyAllGroupMembers !== true) throw new Error("the month post notifies all members, as its setting says by default");
    await cron(page);
    const lastRowM = (await monthRow(lastMonth))!;
    if ((await titled(monthTitle(lastMonth))).length !== 1 || lastRowM.status !== "posted" || lastRowM.link !== `https://academy.example.com/channels/intentions/posts/${lastRowM.platformPostId}`) throw new Error("the job reads the month back as posted, with the link, and never sends it again");
    console.log(`✓ a failed month (${lastMonth}) is posted once with Post now, notifying, with the tag; the job reads it back as posted with its link`);

    // The member: the month card's share copies the eleven answers, revenue included (Danno, 1 Oct), opens this month's post, scores once.
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/intentions`);
    const monthShareBtn = page.locator('[data-testid="month-share"] [data-testid="share-to-thread"]');
    await monthShareBtn.waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="month-thread"]').getAttribute("href")) !== LINK_M) throw new Error("once the month's post is published, This month's thread links to it");
    if (!(await monthShareBtn.getAttribute("class"))?.includes("w-full") || (await monthShareBtn.innerText()).trim() !== "Share to the thread") throw new Error("the month's share is the full-width main button under the set month");
    const [popupM] = await Promise.all([page.waitForEvent("popup"), monthShareBtn.click()]);
    await popupM.waitForLoadState();
    if (popupM.url() !== LINK_M) throw new Error(`the tap opens this month's post: ${popupM.url()}`);
    await popupM.close();
    const noteM = page.locator('[data-testid="month-share"] [data-testid="share-note"]');
    await noteM.waitFor({ timeout: 20000 });
    if (!(await noteM.innerText()).includes("Copied! On the post, tap Add a comment, paste, and press Post.") || !(await noteM.innerText()).includes(`+${SHARE_POINTS} points`)) throw new Error(`the member is told it's copied and what to do: ${await noteM.innerText()}`);
    const mayaMonthRow = (await db.query.monthlyIntentions.findFirst({ where: and(eq(schema.monthlyIntentions.userId, maya.id), eq(schema.monthlyIntentions.month, mayaMonth)) }))!;
    const clipM = await page.evaluate(() => navigator.clipboard.readText());
    if (clipM !== monthShareText(mayaMonthRow) || !clipM.startsWith(`${emojiNumeral(1)} My word: Rooted`) || !clipM.includes(`${emojiNumeral(8)} Revenue goal: $10,000. To hire help.`) || clipM.includes("Consistent")) throw new Error(`the comment is the month's eleven answers in the post's numbered shape, revenue included, nothing weekly: ${clipM}`);
    if ((await scored()).length !== 2 || (await scored()).every((r) => r.refId !== `share:month:${mayaMonth}`)) throw new Error("the first month tap scores 15, under its own reference");
    await page.reload();
    const againM = page.locator('[data-testid="month-share"] [data-testid="share-to-thread"][data-shared="yes"]');
    await againM.waitFor({ timeout: 20000 });
    const [popupM2] = await Promise.all([page.waitForEvent("popup"), againM.click()]);
    await popupM2.close();
    await page.locator('[data-testid="month-share"] [data-testid="share-note"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="month-share"] [data-testid="share-note"]').innerText()).includes("points") || (await scored()).length !== 2) throw new Error("a second tap in the same month scores nothing");
    console.log(`✓ Share to this month's thread: copies the eleven answers (revenue included, nothing weekly), opens this month's post, scores ${SHARE_POINTS} once for the month, then reads Shared ✓; This month's thread shows once the post is published`);

    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/coach/community?view=month4#month`);
    const sharedRowM = page.locator(`[data-testid="community-month-row"][data-month="${thisMonth}"]`);
    await sharedRowM.waitFor({ timeout: 20000 });
    const notSharedM = (await sharedRowM.locator('[data-testid="community-month-not-shared"]').textContent()) ?? "";
    if ((await sharedRowM.locator('[data-testid="community-month-shares"]').innerText()).trim() !== "1" || notSharedM.includes(maya.name) || !notSharedM.includes(jordan.name)) throw new Error(`the coach sees the month's shares and who hasn't shared: ${notSharedM}`);
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="month-coach-shares"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="month-coach-shares"]').innerText()).trim() !== "1") throw new Error("the coach view's month card counts who has shared to the thread");
    console.log("✓ the coach's month log and the coach view's month card show the month's shares and who hasn't shared yet");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Community smoke passed");
  } finally {
    await browser.close();
    for (const p of [child, blob]) {
      try {
        process.kill(-p.pid!);
      } catch {
        /* already gone */
      }
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
