/**
 * The community connection, piece 1 (handoff revs 150 to 154), against scripts/mock-ghl.ts:
 *  1. The coach's page before and after connecting GoHighLevel; a token missing scopes is named on the page.
 *  2. The channel comes from the accounts list; the Monday post can't be turned on without one.
 *  3. A test post goes out as the team user, with its title; Check again shows it published, who it shows as, its id and link.
 *  4. An account on hold stops posting with no retry, even from the hourly job, until Resume.
 *  5. Next Monday's post: its own text for that week, skipped, and back on.
 *  6. A week that failed is posted with Post now, once: the hourly job and a second press never send it again. The week's
 *     3-1-3 count is on its row, and the link is built from the coach's pattern. On a Monday, the job posts this week's itself.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4012;
const mock = `http://localhost:${mockPort}`;
const LOC = "loc_community";

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
async function mockPosts(): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${mock}/__posts`, { headers: { Authorization: `Bearer pit-${LOC}`, Version: "2021-07-28" } });
  return ((await r.json()) as { posts: Record<string, unknown>[] }).posts;
}
async function cron(page: Page) {
  const r = await page.request.get(`${base}/api/cron/reminders`, { headers: { Authorization: "Bearer change-me" } });
  if (!r.ok()) throw new Error(`the hourly job answered ${r.status()}`);
  return (await r.json()) as { community: { action: string; ok: boolean; note?: string }[] };
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { addDays, nowWallInTz, startOfWeek, todayInTz } = await import("@/lib/dates");
  const { HOLD_REASON, TEST_TITLE, mondayDue, mondayTitle, upcomingWeek, DEFAULT_MONDAY_TEXT } = await import("@/lib/engine/community");
  const { newId } = await import("@/lib/ids");

  const child = spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(mockPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
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

    const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
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
    const connect = async (token: string, ghlUserId: string) => {
      await page.goto(`${base}/settings`);
      await page.fill('input[name="locationId"]', LOC);
      await page.fill('input[name="ghlUserId"]', ghlUserId);
      await page.fill('input[name="manualToken"]', token);
      await submit(page, 'button:has-text("Connect and check"), button:has-text("Save and check")');
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
    console.log("✓ the channel is picked from the accounts list (community ones first); the Monday post can't be on without one");

    // ── 3. The test post, as the team user; Check again shows it published. ──
    await submit(page, '[data-testid="community-test"]');
    await page.locator('[data-testid="community-test-result"][data-state="sent"]').waitFor({ timeout: 20000 });
    const testSent = (await mockPosts()).find((p) => (p.communityPostDetails as { title?: string } | undefined)?.title === TEST_TITLE);
    const as = (testSent?.communityPostDetails as { postAsUser?: Record<string, { id: string; name: string }> } | undefined)?.postAsUser?.[`${LOC}_community_test`];
    if (!testSent || testSent.userId !== "user_danno" || as?.id !== "user_danno" || as.name !== "HelixOS" || String(testSent.status) !== "published") throw new Error("the test post goes out now, from the team user, with its title");
    await submit(page, '[data-testid="community-test-result"] [data-testid="community-check"]');
    const result = page.locator('[data-testid="community-test-result"]').first();
    await page.locator('[data-testid="community-test-result"][data-state="posted"]').waitFor({ timeout: 20000 });
    const resultText = await result.innerText();
    if (!resultText.includes("Shown as HelixOS") || !/Community id cm_post_\d+/.test(resultText) || !(await result.locator('[data-testid="community-post-link"]').getAttribute("href"))?.startsWith("https://academy.example.com/post?id=cm_post_")) throw new Error(`the test result shows who it's from, the community's id and the link: ${resultText}`);
    console.log("✓ a test post goes out as the team user with its title; Check again shows it published, who it shows as, its id and link");

    // ── 4. An account on hold stops everything, with no retry, until Resume. ──
    await page.locator('[data-testid="community-post-as-id"]').fill("user_onhold");
    await submit(page, '[data-testid="community-save"]');
    await submit(page, '[data-testid="community-test"]');
    await page.locator('[data-testid="community-paused"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="community-error"]').innerText()).trim() !== HOLD_REASON) throw new Error("the hold is said in plain words");
    const before = (await mockPosts()).length;
    await cron(page);
    if ((await mockPosts()).length !== before) throw new Error("nothing posts while the account is on hold");
    await page.locator('[data-testid="community-post-as-id"]').fill("");
    await submit(page, '[data-testid="community-save"]');
    await submit(page, '[data-testid="community-resume"]');
    if (await page.locator('[data-testid="community-paused"]').count()) throw new Error("Resume clears the hold");
    console.log("✓ an account on hold stops posting, says why, and the hourly job doesn't retry; Resume clears it");

    // ── 5. Next Monday: its own text, skipped, and back on. ──
    await page.locator('[data-testid="community-channel"]').selectOption(`${LOC}_community_intentions`);
    await submit(page, '[data-testid="community-save"]');
    const next = upcomingWeek(today, nowWallInTz(tz).slice(11, 16), "08:00");
    const nextCard = page.locator('[data-testid="community-next"]');
    if ((await nextCard.getAttribute("data-week")) !== next || (await page.locator('[data-testid="community-next-title"]').innerText()).trim() !== mondayTitle(next)) throw new Error(`next Monday is ${next}, titled with its week`);
    const WEEK_TEXT = `This week's own words [walk ${Date.now()}]`;
    await page.locator('[data-testid="community-next-body"]').fill(WEEK_TEXT);
    await submit(page, '[data-testid="community-next-save"]');
    const nextRow = () => db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, next)) });
    if ((await nextRow())?.body !== WEEK_TEXT || (await nextRow())?.status !== "scheduled") throw new Error("that Monday keeps its own text");
    await submit(page, '[data-testid="community-next-skip"]');
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
    if (sentOnce.length !== 1 || sentOnce[0].summary !== DEFAULT_MONDAY_TEXT || !(sentOnce[0].accountIds as string[]).includes(`${LOC}_community_intentions`)) throw new Error("Post now sends that week once, with the Monday text, to the Intentions channel");
    await cron(page);
    await cron(page);
    const row = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, ws.id), eq(schema.communityPosts.weekOf, lastWeek)) });
    if ((await titled(mondayTitle(lastWeek))).length !== 1 || row?.status !== "posted" || row.link !== `https://academy.example.com/post?id=${row.platformPostId}`) throw new Error("the job reads it back as posted, with the link, and never sends it again");
    await page.goto(`${base}/coach/community#log`);
    if (await page.locator(`[data-testid="community-log-row"][data-week="${lastWeek}"] [data-testid="community-retry"]`).count()) throw new Error("a posted week has no Post now");
    console.log(`✓ a failed week (${lastWeek}) is posted once with Post now; the job reads it back as posted with its link, and never sends it twice`);

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

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Community smoke passed");
  } finally {
    await browser.close();
    try {
      process.kill(-child.pid!);
    } catch {
      /* already gone */
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
