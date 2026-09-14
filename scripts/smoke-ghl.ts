/** End-to-end: a member's own Private Integration token → validation with real reasons → channel map → schedule → Social Planner → re-schedule edits in place → status sync → the coach's read-only planner audit finds a leftover duplicate, against scripts/mock-ghl.ts. */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4010;

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // The app says when it is still loading a page; wait for that to clear before judging what is on it.
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "hidden", timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
async function saveConnection(page: Page, locationId: string, token: string, ghlUserId = "") {
  await page.fill('input[name="locationId"]', locationId);
  await page.fill('input[name="ghlUserId"]', ghlUserId);
  await page.fill('input[name="manualToken"]', token);
  await submit(page, 'button:has-text("Connect and check"), button:has-text("Save and check")');
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(mockPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // Coach: enable GoHighLevel and point it at the mock (no agency token anywhere)
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/integrations`);
    const ghlForm = page.locator('form:has(input[name="provider"][value="gohighlevel"])').first();
    if ((await ghlForm.locator('input[name="apiKey"], input[name="companyId"]').count()) !== 0) throw new Error("agency token / company ID fields must be gone");
    await ghlForm.locator('input[name="enabled"]').check();
    await ghlForm.locator('input[name="apiUrl"]').fill(`http://localhost:${mockPort}`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), ghlForm.locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle");
    // The setup is closed to clients until the coach opens it: scopes are granted once. The demo client starts with no connection.
    {
      const { db: db0, schema: s0 } = await import("@/db");
      const { eq: eq0 } = await import("drizzle-orm");
      const maya0 = await db0.query.users.findFirst({ where: eq0(s0.users.email, "client@demo.helixos.app") });
      await db0.delete(s0.socialConnections).where(eq0(s0.socialConnections.userId, maya0!.id));
    }
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/settings`);
    await expectText(page, "Publishing setup isn't open yet", "a client is not walked through the setup before the list is final");
    if (await page.locator('input[name="manualToken"]').count()) throw new Error("no token field while the setup is closed");
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/integrations`);
    await page.locator('[data-testid="integration-onboardingOpen"]').check();
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('form:has(input[name="provider"][value="gohighlevel"])').first().locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle");
    await page.reload();
    if (!(await page.locator('[data-testid="integration-onboardingOpen"]').isChecked())) throw new Error("the switch is saved");
    await expectText(page, "Client sub-accounts", "coach sees connection status list");
    console.log("✓ coach: GoHighLevel enabled without any agency credential");

    // Member: token validation with real reasons
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/settings`);
    await expectText(page, "Private Integrations → Create new integration", "guidance shown");
    await expectText(page, "socialplanner/post.write", "scopes listed");
    const listedScopes = await page.locator('[data-testid="ghl-scope-list"] li').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    if (listedScopes.length !== 15 || !listedScopes.includes("medias.write") || !listedScopes.includes("emails/builder.write")) throw new Error(`the page lists the one scope list: ${listedScopes.join(",")}`);
    await saveConnection(page, "loc_maya", "wrong-token");
    await expectText(page, "rejected the token (401)", "bad token reason");
    await saveConnection(page, "loc_maya", "pit-noscope");
    await expectText(page, "socialplanner/account.readonly was not granted (403)", "the missing scope is named");
    await saveConnection(page, "loc_other", "pit-loc_maya");
    await expectText(page, "doesn't match this token", "wrong location reason");
    await saveConnection(page, "loc_maya", "pit-loc_maya");
    await expectText(page, "connected · 6 accounts", "valid token connected");
    await expectText(page, "0/5 channels will auto-publish", "auto-mapped, but nothing publishes without the user id");
    // Every account GoHighLevel returned is on the screen, id and all, so what an id is can be read off it
    const listed = await page.locator('[data-testid="ghl-accounts"] li').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-platform")}/${e.getAttribute("data-type")}`));
    if (listed.join(",") !== "facebook/page,facebook/group,instagram/business,linkedin/profile,linkedin/page,threads/profile") throw new Error(`the returned accounts are listed verbatim: ${listed.join(",")}`);
    if (!((await page.locator('[data-testid="ghl-accounts"]').textContent()) ?? "").includes("loc_maya_fbgroup_1")) throw new Error("each account's id is shown byte for byte");
    await page.selectOption('select[name="map_linkedin"]', "");
    await submit(page, 'button:has-text("Save channel map")');
    await expectText(page, "0/5 channels will auto-publish", "map saved; still nothing without the user id");
    await page.screenshot({ path: "screenshots/g01-settings-ghl.png", fullPage: true });
    console.log("✓ member: 401, 403 and wrong-location reasons shown; valid token connects and maps");

    // Without a GHL user ID nothing is sent: the Social Planner requires one, and the Distribute page says where to add it
    const plannerPosts = async () => ((await (await fetch(`http://localhost:${mockPort}/__posts`, { headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } })).json()) as { posts: { _id: string; summary: string; edits?: number; scheduleDate?: string; userId?: string }[] }).posts;
    await page.goto(`${base}/content/compose`);
    await page.fill('input[placeholder^="Working title"]', "GHL without a user id");
    await page.fill('input[placeholder^="Hook"]', "No user id yet.");
    await page.fill('textarea[placeholder^="Type content"]', "This must not reach the planner.");
    await page.click('button[title="Facebook business page"]');
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Scheduled \d+ posts/).waitFor({ timeout: 20000 });
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await page.waitForTimeout(1500);
    await page.reload();
    await expectText(page, "Add your GHL user ID on Settings → Publishing", "the missing user id is named where the post is");
    await expectText(page, "Social Planner: failed", "a fixable refusal is a failure, not a hand-pasted channel");
    if ((await plannerPosts()).length) throw new Error("nothing is sent to the planner without a user id");
    await page.goto(`${base}/settings`);
    await expectText(page, "nothing publishes until it is filled in", "Settings says the user id is missing");
    await expectText(page, "0/5 channels will auto-publish", "readiness is nothing without the user id");
    // A user id GoHighLevel refuses: a 422 on the post, named as the user id where the post is, never as the location; the connection stays green
    await saveConnection(page, "loc_maya", "", "user_refused");
    await expectText(page, "connected · 6 accounts", "a refused user id is still a connected token");
    await page.goto(`${base}/content/compose`);
    await page.fill('input[placeholder^="Working title"]', "GHL with a refused user id");
    await page.fill('input[placeholder^="Hook"]', "Refused id.");
    await page.fill('textarea[placeholder^="Type content"]', "This is refused by the planner.");
    await page.click('button[title="Facebook business page"]');
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Scheduled \d+ posts/).waitFor({ timeout: 20000 });
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await page.waitForTimeout(1500);
    await page.reload();
    await expectText(page, "doesn't accept the GHL user ID on Settings → Publishing", "a 422 names the refused field");
    await expectText(page, "Social Planner: failed", "the post is marked failed");
    if (/location ID/i.test(await page.locator("main").innerText())) throw new Error("a 422 on a post is never the location");
    await page.goto(`${base}/settings`);
    if (await page.locator('[data-testid="ghl-error"]').count()) throw new Error("a post's failure does not paint the connection red");
    await expectText(page, "connected · 6 accounts", "still connected after a refused post");
    await saveConnection(page, "loc_maya", "", "JD8kLxeYM3FqbWLQXC4p");
    await expectText(page, "connected · 6 accounts", "user id saved, still connected");
    await expectText(page, "4/5 channels will auto-publish", "with the user id, the four mapped channels publish");
    // Threads is mapped from the account the sub-account returned; a Facebook group has no map at all; the client's "don't" survives a re-check
    if ((await page.inputValue('select[name="map_threads"]')) !== "loc_maya_threads_1_profile") throw new Error("Threads auto-maps to the Threads profile");
    if (await page.locator('select[name="map_fb_group"]').count()) throw new Error("a Facebook group is not offered for publishing");
    if ((await page.inputValue('select[name="map_linkedin"]')) !== "") throw new Error("the client's don't-auto-publish survives a re-check");
    console.log("✓ the GHL user ID is required: refused before the call, said on the Distribute page, saved on Settings");

    // Publish through the Social Planner
    await page.goto(`${base}/content/compose`);
    await page.fill('input[placeholder^="Working title"]', "GHL end to end");
    await page.fill('input[placeholder^="Hook"]', "Twelve minutes on Tuesday.");
    await page.fill('textarea[placeholder^="Type content"]', "Beats three hours on Sunday.\nEvery single week.");
    await page.click('button[title="Facebook business page"]');
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Scheduled \d+ posts/).waitFor({ timeout: 20000 });
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await page.waitForTimeout(1500);
    await page.reload();
    await expectText(page, "Social Planner: scheduled", "variant pushed to social planner");
    await expectText(page, "paste by hand", "manual channels marked");
    const created = await plannerPosts();
    if (!created.length || created.some((p) => p.edits)) throw new Error(`expected fresh planner posts, got ${JSON.stringify(created.map((p) => [p._id, p.edits]))}`);
    // The planner holds the member's wall time as the UTC instant it names (milliseconds and a Z), and the user id
    const { db: dbx, schema: sx } = await import("@/db");
    const { and: andx, eq: eqx, isNotNull } = await import("drizzle-orm");
    const { wallTimeToUtc } = await import("@/lib/dates");
    const client = await dbx.query.users.findFirst({ where: eqx(sx.users.email, "client@demo.helixos.app") });
    const pushedVariant = await dbx.query.contentVariants.findFirst({ where: andx(eqx(sx.contentVariants.userId, client!.id), eqx(sx.contentVariants.channel, "fb_page"), isNotNull(sx.contentVariants.externalId)) });
    const expectedInstant = wallTimeToUtc(pushedVariant!.postAt!, "America/Los_Angeles");
    const held = created.find((p) => p._id === pushedVariant!.externalId);
    if (!held || held.scheduleDate !== expectedInstant || !/\.\d{3}Z$/.test(String(held.scheduleDate))) throw new Error(`scheduleDate is the member's wall time ${pushedVariant!.postAt} as a UTC instant: expected ${expectedInstant}, planner holds ${held?.scheduleDate}`);
    if (held.userId !== "JD8kLxeYM3FqbWLQXC4p") throw new Error("the post carries the member's GHL user id");
    // The server runs in UTC (scripts/dev-server.sh): a wall time parsed in the server's zone would come out with no offset at all.
    const parts = pushedVariant!.postAt!.match(/\d+/g)!.map(Number);
    const offsetHours = (new Date(expectedInstant).getTime() - Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] ?? 0)) / 3600000;
    if (offsetHours !== 7 && offsetHours !== 8) throw new Error(`the planner's instant is the Los Angeles wall time shifted by its offset, got ${offsetHours}h`);
    console.log(`✓ the planner holds ${pushedVariant!.postAt} (Los Angeles) as ${held.scheduleDate}`);

    // Re-scheduling edits the planner's posts in place: the same ids, no second copy
    const itemUrl = page.url().replace(/\/repurpose.*$/, "");
    await page.goto(`${itemUrl}/compose`);
    await expectText(page, "Redistribute:", "edit composer");
    await page.click('label:has-text("Customize for each channel") input'); // one source for every version again
    await page.fill('input[placeholder^="Hook"]', "Twelve minutes on Tuesday, edited.");
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Scheduled \d+ posts/).waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    const edited = await plannerPosts();
    if (edited.length !== created.length || edited.some((p) => p.edits !== 1) || edited.some((p) => !p.summary.includes("edited"))) throw new Error(`expected the same ${created.length} planner post(s) each edited once, got ${JSON.stringify(edited.map((p) => [p._id, p.edits, p.summary.slice(0, 30)]))}`);
    console.log(`✓ re-scheduling edited ${edited.length} planner post(s) in place under the same id`);
    await page.goto(`${itemUrl}/repurpose`);
    await submit(page, 'button:has-text("Check status")');
    await expectText(page, "Social Planner: published", "status synced");
    await page.screenshot({ path: "screenshots/g02-distribute-ghl.png", fullPage: true });
    console.log("✓ scheduled through the Social Planner with the member's token and synced status");

    // The push went through after(): the server never fell back to a detached promise (under next dev either completes; on Vercel only after() does)
    const { readFileSync: readLog } = await import("node:fs");
    if (/after\(\) unavailable/.test(readLog("screenshots/logs/dev.log", "utf8"))) throw new Error("after() was unavailable: the push ran detached");
    // Coach sees it in the sync log and the status list
    // A leftover from the old re-schedule path: a second planner post with the same text and account, logged but tracked by no variant
    const fbPage = (await plannerPosts()).find((p) => (p as { accountIds?: string[] }).accountIds?.includes("loc_maya_fbpage_1"));
    if (!fbPage) throw new Error("no planner post for the Facebook page to duplicate");
    const dupRes = await fetch(`http://localhost:${mockPort}/social-media-posting/loc_maya/posts`, { method: "POST", headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28", "content-type": "application/json" }, body: JSON.stringify({ userId: "JD8kLxeYM3FqbWLQXC4p", accountIds: ["loc_maya_fbpage_1"], summary: fbPage.summary, type: "post", status: "scheduled", scheduleDate: new Date(Date.now() + 7 * 86400000).toISOString() }) });
    const dupId = String(((await dupRes.json()) as { results: { post: { _id: string } } }).results.post._id);
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const maya = await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") });
    const ws = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya!.id) });
    await db.insert(schema.syncEvents).values({ id: `walk-dup-${Date.now()}`, workspaceId: ws!.workspaceId, userId: maya!.id, provider: "gohighlevel", direction: "out", event: "social.schedule", payload: { channel: "fb_page", postAt: null, accountId: "loc_maya_fbpage_1", ghlPostId: dupId }, status: "sent", note: `Scheduled via Social Planner · ${dupId}` });

    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/integrations`);
    await expectText(page, "Scheduled via Social Planner", "sync log sent");
    await expectText(page, "Updated in Social Planner", "sync log update");
    await expectText(page, "4/5 channels", "coach status list");
    console.log("✓ sync log and status list");

    // The planner audit names the duplicate, and nothing on the page can delete it
    await page.click('[data-testid="planner-audit-link"]');
    await page.waitForURL(/\/integrations\/planner-audit/);
    await expectText(page, "1 duplicate", "audit totals");
    const dupRow = page.locator(`[data-testid="audit-row"][data-post-id="${dupId}"]`);
    if ((await dupRow.getAttribute("data-verdict")) !== "duplicate") throw new Error(`the leftover ${dupId} should be a duplicate, got ${await dupRow.getAttribute("data-verdict")}`);
    await expectText(page, "same text", "twin named");
    const tracked = (await plannerPosts()).filter((p) => p._id !== dupId).map((p) => p._id);
    for (const id of tracked) if (await page.locator(`[data-testid="audit-row"][data-post-id="${id}"]`).count()) throw new Error(`tracked planner post ${id} must not be listed as untracked`);
    if (await page.locator('button:has-text("Delete"), button:has-text("Remove")').count()) throw new Error("the audit must not offer a delete");
    const stillThere = (await plannerPosts()).some((p) => p._id === dupId);
    if (!stillThere) throw new Error("the audit changed the planner");
    await page.screenshot({ path: "screenshots/g03-planner-audit.png", fullPage: true });
    console.log("✓ planner audit: the leftover is named a duplicate with its twin; tracked posts are not listed; nothing deleted");
  } finally {
    await browser.close();
    try {
      if (mock.pid) process.kill(-mock.pid, "SIGTERM"); // the mock is npx's grandchild: kill the group
    } catch {
      mock.kill();
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("GHL smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
