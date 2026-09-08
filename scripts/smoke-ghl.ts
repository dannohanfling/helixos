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
async function saveConnection(page: Page, locationId: string, token: string) {
  await page.fill('input[name="locationId"]', locationId);
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
    await saveConnection(page, "loc_maya", "wrong-token");
    await expectText(page, "rejected the token (401)", "bad token reason");
    await saveConnection(page, "loc_maya", "pit-noscope");
    await expectText(page, "missing Social Planner permissions (403)", "missing scope reason");
    await saveConnection(page, "loc_other", "pit-loc_maya");
    await expectText(page, "doesn't match this token", "wrong location reason");
    await saveConnection(page, "loc_maya", "pit-loc_maya");
    await expectText(page, "connected · 5 accounts", "valid token connected");
    await expectText(page, "5/5 channels will auto-publish", "auto-mapped");
    await page.selectOption('select[name="map_linkedin"]', "");
    await submit(page, 'button:has-text("Save channel map")');
    await expectText(page, "4/5 channels will auto-publish", "map saved");
    await page.screenshot({ path: "screenshots/g01-settings-ghl.png", fullPage: true });
    console.log("✓ member: 401, 403 and wrong-location reasons shown; valid token connects and maps");

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
    const plannerPosts = async () => ((await (await fetch(`http://localhost:${mockPort}/__posts`, { headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } })).json()) as { posts: { _id: string; summary: string; edits?: number }[] }).posts;
    const created = await plannerPosts();
    if (!created.length || created.some((p) => p.edits)) throw new Error(`expected fresh planner posts, got ${JSON.stringify(created.map((p) => [p._id, p.edits]))}`);

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

    // Coach sees it in the sync log and the status list
    // A leftover from the old re-schedule path: a second planner post with the same text and account, logged but tracked by no variant
    const fbPage = (await plannerPosts()).find((p) => (p as { accountIds?: string[] }).accountIds?.includes("loc_maya_fbpage_1"));
    if (!fbPage) throw new Error("no planner post for the Facebook page to duplicate");
    const dupRes = await fetch(`http://localhost:${mockPort}/social-media-posting/loc_maya/posts`, { method: "POST", headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28", "content-type": "application/json" }, body: JSON.stringify({ accountIds: ["loc_maya_fbpage_1"], summary: fbPage.summary, type: "post", status: "scheduled", scheduleDate: new Date(Date.now() + 7 * 86400000).toISOString() }) });
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
