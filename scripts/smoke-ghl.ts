/** End-to-end: a member's own Private Integration token → validation with real reasons → channel map → schedule → Social Planner → re-schedule edits in place → status sync → the coach's read-only planner audit finds a leftover duplicate, against scripts/mock-ghl.ts. */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4010;

/** One channel row on the Distribute page shows this state (the word beside the light), and says the reason when given. */
async function expectOutcome(page: Page, channel: string, state: string, label: string, reason?: string) {
  const row = page.locator(`[data-testid="channel-outcomes"] li[data-channel="${channel}"][data-state="${state}"]`).first();
  await row.waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected the ${channel} row to read ${state} on ${page.url()}`);
  });
  if (reason && !(await row.innerText()).includes(reason)) throw new Error(`[${label}] the ${channel} row does not say "${reason}"`);
}
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
  // The card (rev 333): Connect opens the steps; the token and the Location ID are the two boxes; the user id is asked only after.
  if (!(await page.locator('[data-testid="ghl-connected"]').count())) {
    if (!(await page.locator('[data-testid="ghl-steps"][open]').count())) await page.click('[data-testid="ghl-connect-open"]');
    await page.fill('[data-testid="ghl-location"]', locationId);
    if (token) await page.fill('[data-testid="ghl-token"]', token);
    await submit(page, '[data-testid="ghl-steps"] button:has-text("Connect")');
  }
  if (ghlUserId && (await page.locator('[data-testid="ghl-no-user"] input[name="ghlUserId"]').count())) {
    await page.fill('[data-testid="ghl-no-user"] input[name="ghlUserId"]', ghlUserId);
    await submit(page, '[data-testid="ghl-no-user"] button:has-text("Save")');
  } else if ((ghlUserId || token) && (await page.locator('[data-testid="ghl-connected"]').count())) {
    // Already connected with a user: a different user id or a new token goes through Reconnect.
    await page.locator('[data-testid="ghl-reconnect"] > summary').click();
    if (ghlUserId) await page.fill('[data-testid="ghl-reconnect-user"]', ghlUserId);
    if (token) await page.fill('[data-testid="ghl-reconnect-token"]', token);
    await submit(page, '[data-testid="ghl-reconnect"] button:has-text("Reconnect")');
  }
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(mockPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  // A mock left behind by an earlier run keeps its posts and contacts: start from nothing either way.
  await fetch(`http://localhost:${mockPort}/__reset`, { method: "POST", headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } }).catch(() => null);
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
    await ghlForm.waitFor({ timeout: 15000 });
    if ((await ghlForm.locator('input[name="apiKey"], input[name="companyId"]').count()) !== 0) throw new Error("agency token / company ID fields must be gone");
    await ghlForm.locator('input[name="enabled"]').check();
    await ghlForm.locator('input[name="apiUrl"]').fill(`http://localhost:${mockPort}`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), ghlForm.locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle");
    // Danno installs the client's Community Loyalty drip: the webhook URL (a credential, never shown back) and the contact.
    await page.goto(`${base}/coach`);
    const mayaRow = page.locator('form:has(input[name="eoPassUrl"][value*="maya-torres"])').first();
    await mayaRow.locator('input[name="clDripWebhookUrl"]').fill(`http://localhost:${mockPort}/api/iwh/abcdef0123456789abcdef0123456789`);
    await mayaRow.locator('input[name="clUserNs"]').fill("f52594u50757435");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), mayaRow.locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle");
    if (/abcdef0123456789/.test(await page.content())) throw new Error("the drip webhook URL is rendered back on the page");
    if (!/saved \(blank keeps it/.test(await page.locator('form:has(input[name="eoPassUrl"][value*="maya-torres"]) input[name="clDripWebhookUrl"]').first().getAttribute("placeholder") ?? "")) throw new Error("the coach cannot tell the webhook is set");
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
    await expectText(page, "Connect your GoHighLevel account so HelixOS can post for you", "one sentence and a Connect button");
    if (await page.locator('[data-testid="ghl-token"]').isVisible()) throw new Error("the steps are behind Connect");
    await page.click('[data-testid="ghl-connect-open"]');
    await expectText(page, "Settings → Private Integrations", "the steps, one at a time");
    if ((await page.locator('[data-testid="ghl-steps"]').innerText()).includes("socialplanner/post.write")) throw new Error("no scope name on screen until the fold is opened");
    if (!(await page.locator('[data-testid="ghl-steps"] button:has-text("Copy the list")').count())) throw new Error("Copy the list puts the names on the clipboard");
    await page.locator('[data-testid="ghl-steps"] summary:has-text("Read the list instead")').click();
    const listedScopes = await page.locator('[data-testid="ghl-scope-list"] li').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    if (listedScopes.length !== 19 || !listedScopes.includes("locations.readonly") || !listedScopes.includes("contacts.readonly") || !listedScopes.includes("locations/customFields.write") || !listedScopes.includes("locations/customFields.readonly") || !listedScopes.includes("emails/builder.write")) throw new Error(`the page lists the one scope list: ${listedScopes.join(",")}`);
    await saveConnection(page, "loc_maya", "wrong-token");
    await expectText(page, "GoHighLevel didn't accept that token", "bad token reason, in plain words");
    await saveConnection(page, "loc_maya", "pit-noscope");
    await expectText(page, "The token is missing permissions: socialplanner/account.readonly", "the missing permission is named");
    if (!(await page.locator('[data-testid="ghl-error"] button:has-text("Copy the list")').count())) throw new Error("Copy the list sits beside the missing-permissions reason");
    await saveConnection(page, "loc_other", "pit-loc_maya");
    await expectText(page, "That Location ID doesn't match this token", "wrong location reason, in plain words");
    await saveConnection(page, "loc_maya", "pit-loc_maya");
    await page.locator('[data-testid="ghl-connected-badge"]').waitFor({ timeout: 15000 });
    await expectText(page, "6 connected pages and profiles", "valid token connected");
    if ((await page.locator('[data-testid="ghl-location-name"]').innerText()).trim() !== "to Maya Coaching") throw new Error("the green Connected state names the sub-account, read from GET /locations/{id}");
    if ((await page.locator('[data-testid="ghl-token"]').count()) || (await page.locator('[data-testid="ghl-connected"]').innerText()).includes("loc_maya")) throw new Error("connected: no token box and no ID on screen");
    await expectText(page, "0/5 channels will auto-publish", "auto-mapped, but nothing publishes without the user id");
    if (!(await page.locator('[data-testid="ghl-no-user"]').count())) throw new Error("the user id is asked for only now, since GoHighLevel's answer did not carry it");
    await page.locator('[data-testid="ghl-channels"] > summary').click();
    await page.locator('[data-testid="ghl-channels"] details > summary').click();
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
    await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await page.waitForTimeout(1500);
    await page.reload();
    await expectOutcome(page, "fb_page", "failed", "a fixable refusal is a failure, not a hand-pasted channel", "Add your GHL user ID on Settings → Publishing");
    if ((await plannerPosts()).length) throw new Error("nothing is sent to the planner without a user id");
    await page.goto(`${base}/settings`);
    await expectText(page, "nothing publishes until it is filled in", "Settings says the user id is missing");
    await expectText(page, "0/5 channels will auto-publish", "readiness is nothing without the user id");
    // A user id GoHighLevel refuses: a 422 on the post, named as the user id where the post is, never as the location; the connection stays green
    await saveConnection(page, "loc_maya", "", "user_refused");
    await expectText(page, "6 connected pages and profiles", "a refused user id is still a connected token");
    await page.goto(`${base}/content/compose`);
    await page.fill('input[placeholder^="Working title"]', "GHL with a refused user id");
    await page.fill('input[placeholder^="Hook"]', "Refused id.");
    await page.fill('textarea[placeholder^="Type content"]', "This is refused by the planner.");
    await page.click('button[title="Facebook business page"]');
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await page.waitForTimeout(1500);
    await page.reload();
    await expectOutcome(page, "fb_page", "failed", "a 422 names the refused field", "doesn't accept the GHL user ID on Settings → Publishing");
    if (/location ID/i.test(await page.locator("main").innerText())) throw new Error("a 422 on a post is never the location");
    // The failure stands in a plain banner with its Fix it (friction walk C1): here, on the board's card and on Today; no "(422)".
    const failedBanner = page.locator('[data-testid="failed-banner"]').first();
    await failedBanner.waitFor({ timeout: 15000 });
    if (!(await failedBanner.innerText()).includes("didn't send") || /\(4\d\d\)/.test(await failedBanner.innerText())) throw new Error(`the banner says which channel didn't send, with no status code: ${await failedBanner.innerText()}`);
    if ((await failedBanner.locator('[data-testid="failed-fix"]').getAttribute("href")) !== "/settings#publishing") throw new Error("Fix it goes to Publishing for a refused user id");
    await page.goto(`${base}/content`);
    await page.locator('[data-testid="failed-banner"]').first().waitFor({ timeout: 15000 });
    await page.goto(`${base}/today`);
    // Today lists every post with a failed channel from the last two weeks, so find this post's banner by its title.
    const todayBanner = page.locator('[data-testid="failed-banner"]', { hasText: "GHL with a refused user id" }).first();
    await todayBanner.waitFor({ timeout: 15000 }).catch(() => { throw new Error("Today's banner names the post"); });
    console.log("✓ a failed channel shows as a plain banner with Fix it on the post, the board and Today");
    await page.goto(`${base}/settings`);
    if (await page.locator('[data-testid="ghl-error"]').count()) throw new Error("a post's failure does not paint the connection red");
    await expectText(page, "6 connected pages and profiles", "still connected after a refused post");
    await saveConnection(page, "loc_maya", "", "JD8kLxeYM3FqbWLQXC4p");
    await expectText(page, "6 connected pages and profiles", "user id saved, still connected");
    await expectText(page, "4/5 channels will auto-publish", "with the user id, the four mapped channels publish");
    // Threads is mapped from the account the sub-account returned; a Facebook group has no map at all; the client's "don't" survives a re-check
    if (!(await page.locator('select[name="map_threads"]').isVisible())) await page.locator('[data-testid="ghl-channels"] > summary').click();
    if ((await page.inputValue('select[name="map_threads"]')) !== "loc_maya_threads_1_profile") throw new Error("Threads auto-maps to the Threads profile");
    if (await page.locator('select[name="map_fb_group"]').count()) throw new Error("a Facebook group is not offered for publishing");
    if ((await page.inputValue('select[name="map_linkedin"]')) !== "") throw new Error("the client's don't-auto-publish survives a re-check");
    console.log("✓ the GHL user ID is required: refused before the call, said on the Distribute page, saved on Settings");

    // Contacts: a name alone is never pushed; a stage that pushes needs an email or phone and says so; the first push stores
    // GoHighLevel's id and the next push updates by it (no second contact); a client record with an email upserts
    const mockContacts = async () => ((await (await fetch(`http://localhost:${mockPort}/__contacts`, { headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } })).json()) as { contacts: { id: string; email?: string; firstName?: string; updates: number }[] }).contacts;
    const priya = `Priya Natarajan ${Date.now().toString(36).slice(-4)}`;
    await page.goto(`${base}/conversations?new=1`);
    await page.fill('input[name="name"]', priya);
    await submit(page, 'form:has(input[name="name"]) button[type="submit"]');
    const { db: dbc, schema: sc } = await import("@/db");
    const { eq: eqc } = await import("drizzle-orm");
    const priyaRow = await dbc.query.contacts.findFirst({ where: eqc(sc.contacts.name, priya) });
    if (!priyaRow) throw new Error("the contact was created");
    const priyaUrl = `${base}/conversations/${priyaRow.id}`;
    await page.goto(priyaUrl);
    await expectText(page, "Add an email or phone to sync this contact", "a contact with no identity says so on the contact");
    await page.selectOption('select[name="stage"]', "call_booked");
    await submit(page, 'form:has(select[name="stage"]) button[type="submit"]');
    await page.waitForURL(/needsIdentity=call_booked/);
    await expectText(page, "Add an email or phone before marking the call booked", "the stage change is refused with which one is missing");
    if ((await mockContacts()).length) throw new Error("no call is made for a name alone");
    await page.fill('[data-testid="contact-email"]', "priya@example.com");
    await page.selectOption('select[name="stage"]', "call_booked");
    await submit(page, 'form:has(select[name="stage"]) button[type="submit"]');
    await page.waitForTimeout(1500);
    let ghlContacts = await mockContacts();
    if (ghlContacts.length !== 1 || ghlContacts[0].email !== "priya@example.com") throw new Error(`the first push upserts on the email: ${JSON.stringify(ghlContacts)}`);
    await page.goto(priyaUrl);
    await expectText(page, `Linked to GoHighLevel contact ${ghlContacts[0].id}`, "the returned id is stored and shown");
    await page.selectOption('select[name="stage"]', "client");
    await submit(page, 'form:has(select[name="stage"]) button[type="submit"]');
    await page.waitForTimeout(1500);
    ghlContacts = await mockContacts();
    if (ghlContacts.length !== 1 || ghlContacts[0].updates !== 1) throw new Error(`the second push updates by id, never a second contact: ${JSON.stringify(ghlContacts)}`);
    await page.goto(`${base}/integrations`).catch(() => null);
    console.log("✓ contacts: a name alone is never pushed and the contact says why; the first push stores the id; the next push updates it, no duplicate");

    // Publish through the Social Planner
    await page.goto(`${base}/content/compose`);
    await page.fill('input[placeholder^="Working title"]', "GHL end to end");
    await page.fill('input[placeholder^="Hook"]', "Twelve minutes on Tuesday.");
    await page.fill('textarea[placeholder^="Type content"]', "Beats three hours on Sunday.\nEvery single week.");
    await page.fill('[data-testid="first-comment"]', "First comment test.");
    await page.click('button[title="Facebook business page"]');
    // A time still ahead in the member's own zone: a scheduled row whose time has passed with no readback is honestly "sending", then "lost track".
    await page.locator('input[type="date"]').first().fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await page.waitForTimeout(1500);
    await page.reload();
    await expectOutcome(page, "fb_page", "scheduled", "variant pushed to social planner");
    await expectOutcome(page, "fb_personal", "manual", "a channel we cannot publish to is copy and paste, not a failure");
    if (!(await page.locator('[data-testid="outcome-headline"]').first().innerText()).includes("scheduled")) throw new Error("the headline counts the scheduled versions");
    const created = await plannerPosts();
    if (!created.length || created.some((p) => p.edits)) throw new Error(`expected fresh planner posts, got ${JSON.stringify(created.map((p) => [p._id, p.edits]))}`);
    // The first comment reaches the planner as followUpComment on the Facebook page and Instagram posts, and on nothing else
    for (const p of created as unknown as { accountIds: string[]; followUpComment?: string }[]) {
      const ig = p.accountIds.some((a) => a.includes("_ig_"));
      const fb = p.accountIds.some((a) => a.includes("fbpage"));
      if ((fb || ig) && p.followUpComment !== "First comment test.") throw new Error(`the first comment rides on the page and Instagram posts: ${JSON.stringify(p.accountIds)} got ${JSON.stringify(p.followUpComment)}`);
      if (!fb && !ig && p.followUpComment) throw new Error(`no first comment on ${JSON.stringify(p.accountIds)}`);
    }
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
    await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    const edited = await plannerPosts();
    if (edited.length !== created.length || edited.some((p) => p.edits !== 1) || edited.some((p) => !p.summary.includes("edited"))) throw new Error(`expected the same ${created.length} planner post(s) each edited once, got ${JSON.stringify(edited.map((p) => [p._id, p.edits, p.summary.slice(0, 30)]))}`);
    console.log(`✓ re-scheduling edited ${edited.length} planner post(s) in place under the same id`);
    await page.goto(`${itemUrl}/repurpose`);
    await submit(page, 'button:has-text("Check every version with GoHighLevel")');
    await expectOutcome(page, "fb_page", "published", "status synced from the readback");
    await page.screenshot({ path: "screenshots/g02-distribute-ghl.png", fullPage: true });
    console.log("✓ scheduled through the Social Planner with the member's token and synced status");

    // ── rev 567: a schedule that saves nothing says so; a deliberate re-post; an Instagram reconnected in GoHighLevel ──
    const mockHeaders = { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" };
    const itemId = itemUrl.split("/").pop()!;
    const itemRow = async () => (await dbx.query.contentItems.findFirst({ where: eqx(sx.contentItems.id, itemId) }))!;
    const connOf = async () => (await dbx.query.socialConnections.findFirst({ where: eqx(sx.socialConnections.userId, client!.id) }))!;
    type MockPost = { _id: string; status?: string; accountIds?: string[]; summary: string };
    // (a) Every channel of the first post is posted; Schedule again saves nothing, says so by name, and the status stays.
    await dbx.update(sx.contentVariants).set({ status: "posted", postedAt: new Date().toISOString() }).where(eqx(sx.contentVariants.contentItemId, itemId));
    const statusBefore = (await itemRow()).status;
    const countBefore = (await plannerPosts()).length;
    await page.goto(`${itemUrl}/compose`);
    await expectText(page, "Redistribute:", "edit composer, every channel posted");
    await page.click('button:has-text("Schedule")');
    await expectText(page, "Nothing scheduled:", "a schedule that saved nothing says so");
    await expectText(page, "Facebook business page already posted", "a schedule that saved nothing names the channel");
    if ((await page.locator("body").innerText()).includes("Saved 0 versions")) throw new Error('"Saved 0 versions" is gone');
    if ((await plannerPosts()).length !== countBefore) throw new Error("a schedule that saved nothing made no planner post");
    if ((await itemRow()).status !== statusBefore) throw new Error(`the post keeps its status (${statusBefore}) when nothing was scheduled`);
    // The one-click send says the same on the Distribute page: once every channel it reaches is posted, it schedules nothing and names them.
    await page.goto(`${itemUrl}/repurpose`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('button:has-text("Schedule everywhere")')]);
    await page.waitForLoadState("networkidle");
    await dbx.update(sx.contentVariants).set({ status: "posted", postedAt: new Date().toISOString() }).where(eqx(sx.contentVariants.contentItemId, itemId));
    const countBeforeAll = (await plannerPosts()).length;
    await page.goto(`${itemUrl}/repurpose`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('button:has-text("Schedule everywhere")')]);
    await page.waitForLoadState("networkidle");
    await expectText(page, "Nothing scheduled:", "the one-click send says so");
    if ((await plannerPosts()).length !== countBeforeAll) throw new Error("the one-click send that scheduled nothing made no planner post");
    await expectText(page, "Facebook business page already posted", "the one-click send names what was kept");
    // (b) "Post again to this channel": one fresh planner post, published now, under the same account.
    await submit(page, '[data-testid="channel-outcomes"] li[data-channel="fb_page"] [data-testid="repost-channel"]');
    await expectText(page, "Posting again now", "the re-post says so");
    await page.waitForTimeout(1500);
    const afterRepost = (await plannerPosts()) as unknown as MockPost[];
    if (afterRepost.length !== countBeforeAll + 1) throw new Error(`"Post again" makes one fresh planner post (${countBeforeAll} → ${afterRepost.length})`);
    const repost = afterRepost[afterRepost.length - 1];
    if (repost.status !== "published" || !repost.accountIds?.includes("loc_maya_fbpage_1")) throw new Error(`the re-post is published now on the same page: ${JSON.stringify([repost.status, repost.accountIds])}`);
    await page.reload();
    await expectOutcome(page, "fb_page", "sending", "the row follows the new post, not the old one");
    console.log("✓ a schedule that saves nothing says so by name and leaves the status alone; Post again makes one fresh planner post");

    // (c) Instagram reconnected in GoHighLevel: the stored id is stale, the accounts were last read an hour ago. The publish
    // reads them again first, heals the map by origin id, and the post goes out under the new id.
    const rotated = (await (await fetch(`http://localhost:${mockPort}/__rotate-ig`, { method: "POST", headers: mockHeaders })).json()) as { id: string };
    await dbx.update(sx.socialConnections).set({ mapping: { ...(await connOf()).mapping, instagram: "loc_maya_ig_1" }, lastSyncAt: new Date(Date.now() - 3600_000).toISOString() }).where(eqx(sx.socialConnections.userId, client!.id));
    const igPost = async (title: string) => {
      await page.goto(`${base}/content/compose`);
      await page.fill('input[placeholder^="Working title"]', title);
      await page.fill('input[placeholder^="Hook"]', "Instagram after a reconnect.");
      await page.fill('textarea[placeholder^="Type content"]', "The same account, a new id in GoHighLevel.");
      // Instagram is on by default for a fresh post; the chip toggles, so it is pressed only when off.
      const igChip = page.locator('button[title="Instagram caption"]').first();
      if (!((await igChip.getAttribute("class")) ?? "").includes("border-accent")) await igChip.click();
      await page.locator('input[type="date"]').first().fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
      await page.click('button:has-text("Schedule")');
      await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
      await page.click('a:has-text("See every version")');
      await page.waitForURL(/\/repurpose/);
      await page.waitForTimeout(1500);
      await page.reload();
    };
    await igPost("Reconnected Instagram, read first");
    await expectOutcome(page, "instagram", "scheduled", "a stale Instagram id is healed before the publish");
    if ((await connOf()).mapping.instagram !== rotated.id) throw new Error(`the channel map is healed to the reconnected id: ${(await connOf()).mapping.instagram} vs ${rotated.id}`);
    let ig = ((await plannerPosts()) as unknown as MockPost[]).filter((p) => p.accountIds?.some((a) => a.includes("_ig_")));
    if (!ig.length || !ig[ig.length - 1].accountIds?.includes(rotated.id)) throw new Error("the planner post carries the reconnected id");
    const healedNote = await dbx.query.syncEvents.findMany({ where: andx(eqx(sx.syncEvents.userId, client!.id), eqx(sx.syncEvents.event, "social.accounts")) });
    if (!healedNote.some((e) => (e.note ?? "").includes("Channel map healed: instagram"))) throw new Error("the heal is on the sync log");
    // (d) Reconnected again, with the accounts read a moment ago: the planner's 422 is what says the list is wrong. The push
    // names the id it sent, reads the accounts again, heals, and sends once more.
    const rotated2 = (await (await fetch(`http://localhost:${mockPort}/__rotate-ig`, { method: "POST", headers: mockHeaders })).json()) as { id: string };
    await dbx.update(sx.socialConnections).set({ lastSyncAt: new Date().toISOString() }).where(eqx(sx.socialConnections.userId, client!.id));
    await igPost("Reconnected Instagram, refused once");
    await expectOutcome(page, "instagram", "scheduled", "a 422 on the account heals the map and the post is sent once more");
    if ((await connOf()).mapping.instagram !== rotated2.id) throw new Error("the channel map is healed after the 422");
    ig = ((await plannerPosts()) as unknown as MockPost[]).filter((p) => p.accountIds?.some((a) => a.includes("_ig_")));
    if (!ig[ig.length - 1].accountIds?.includes(rotated2.id)) throw new Error("the retried planner post carries the newest id");
    const refused = await dbx.query.syncEvents.findMany({ where: andx(eqx(sx.syncEvents.userId, client!.id), eqx(sx.syncEvents.status, "failed")) });
    if (!refused.some((e) => (e.note ?? "").includes(`Account id sent: …${rotated.id.slice(-20)}`) || (e.note ?? "").includes(`Account id sent: ${rotated.id}`))) throw new Error(`the refusal names the id sent: ${JSON.stringify(refused.map((e) => e.note))}`);
    console.log("✓ a reconnected Instagram: healed by origin id before the publish, and on a 422 with the id named and one retry");

    // A 2xx with no id (seen live 15 Sep): accepted with the id pending, never "didn't send"; the planner's list gives the id back, no second copy
    const before = (await plannerPosts()).length;
    await page.goto(`${base}/content/compose`);
    await page.fill('input[placeholder^="Working title"]', "GHL accepted without an id");
    await page.fill('input[placeholder^="Hook"]', "No id came back.");
    await page.fill('textarea[placeholder^="Type content"]', "The planner took it and said nothing. [noid]");
    for (const t of ["Facebook personal", "Instagram caption", "Threads", "LinkedIn"]) await page.click(`button[title="${t}"]`); // off: only the page
    await page.click('button[title="Facebook business page"]');
    await page.click('button:has-text("Post now")');
    const banner = page.locator("p", { hasText: /Saved \d+ versions/ }).first();
    await banner.waitFor({ timeout: 20000 });
    if (/Posted to/.test(await banner.innerText())) throw new Error("the banner must not count outcomes; the panel does");
    // The row is read as one piece: its state and its words together (the page can re-draw between finding a row and reading it).
    const acceptedRow = page.locator('[data-testid="compose-outcomes"] li[data-channel="fb_page"][data-state="sending"]', { hasText: "Accepted, id pending" });
    await acceptedRow.waitFor({ timeout: 15000 }).catch(async () => {
      const seen = await page.locator('[data-testid="compose-outcomes"] li[data-channel="fb_page"]').allInnerTexts();
      throw new Error(`a 2xx without an id reads accepted with the id pending, got ${JSON.stringify(seen)}`);
    });
    if ((await plannerPosts()).length !== before + 1) throw new Error("the post exists in the planner");
    await page.click('a:has-text("See every version")');
    await page.waitForURL(/\/repurpose/);
    await submit(page, 'button:has-text("Check every version with GoHighLevel")');
    await expectOutcome(page, "fb_page", "published", "the planner's list gave the id back and the readback said published");
    if ((await plannerPosts()).length !== before + 1) throw new Error("reconciling a lost id must never create a second post");
    console.log("✓ a 2xx with no id is accepted, the id is found from the planner's list, no second copy; the banner never counts outcomes");

    // The comment ladder handoff: HelixOS publishes the Facebook page and Instagram posts, Community Loyalty posts Threads and drips the rungs
    await page.goto(`${base}/content/ladders`);
    await page.click('a:has-text("SKIN — Mistakes Ladder")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+$/i);
    const { db: dbl, schema: sl } = await import("@/db");
    const { eq: eql } = await import("drizzle-orm");
    const ladderRow = await dbl.query.ladders.findFirst({ where: eql(sl.ladders.id, page.url().split("/").pop()!.split("?")[0]) });
    await submit(page, '[data-testid="send-to-composer"]');
    await page.waitForURL(/\/content\/[a-z0-9-]+\/compose/i);
    const ladderItemId = page.url().match(/\/content\/([a-z0-9-]+)\/compose/i)![1];
    // Threads is Community Loyalty's while the handoff is on: the chip carries the reason and the preview says it; nothing toggled
    const threadsChip = page.locator('button[title="Threads"] [data-testid="chip-copy-only"]');
    if ((await threadsChip.getAttribute("title")) !== "Threads belongs to Community Loyalty while the comment ladder runs. Untick it here; Community Loyalty handles it.") throw new Error("the Threads chip says why it is copy-only while the handoff is on");
    await expectText(page, "Threads belongs to Community Loyalty while the comment ladder runs", "Threads refused visibly in the composer");
    // The first comment is the drip's rung 1: on a ladder post with the handoff on the field is disabled, with the reason beside it
    if (!(await page.locator('[data-testid="first-comment"]').isDisabled())) throw new Error("the first-comment field is locked on a ladder post while the handoff is on");
    if (!(await page.locator('[data-testid="first-comment-locked"]').innerText()).includes("would repeat rung 1")) throw new Error("the locked first-comment field says why");
    // The chips arrive with the ladder's own selection: set each one rather than toggle it. Facebook page and Instagram on, the rest off.
    const setChip = async (title: string, on: boolean) => {
      const chip = page.locator(`button[title="${title}"]`).first();
      const isOn = /border-accent/.test((await chip.getAttribute("class")) ?? "");
      if (isOn !== on) await chip.click();
    };
    for (const [t, on] of [["Facebook business page", true], ["Instagram caption", true], ["Facebook personal", false], ["LinkedIn", false], ["Stories (FB / IG)", false], ["Email", false], ["Skool community", false]] as const) await setChip(t, on);
    await page.click('button:has-text("Post now")');
    await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
    const threadsRow = await dbl.query.contentVariants.findFirst({ where: eql(sl.contentVariants.contentItemId, ladderItemId) }).then(async () => (await dbl.query.contentVariants.findMany({ where: eql(sl.contentVariants.contentItemId, ladderItemId) })).find((x) => x.channel === "threads"));
    if (threadsRow && threadsRow.status !== "draft") throw new Error("Threads must not be pushed while the handoff is on");
    // The pushes run after the response: wait until both rows carry the planner's answer before reading anything back.
    for (let i = 0; i < 30; i++) {
      const rows = await dbl.query.contentVariants.findMany({ where: eql(sl.contentVariants.contentItemId, ladderItemId) });
      if (["fb_page", "instagram"].every((c) => rows.find((x) => x.channel === c && x.groupId === "")?.externalStatus)) break;
      await page.waitForTimeout(500);
    }
    // Neither of the ladder's planner posts carries a first comment: rung 1 is the drip's to add
    const ladderIds = (await dbl.query.contentVariants.findMany({ where: eql(sl.contentVariants.contentItemId, ladderItemId) })).map((x) => x.externalId).filter(Boolean);
    const ladderPosts = (await plannerPosts() as unknown as { _id: string; followUpComment?: string }[]).filter((p) => ladderIds.includes(p._id));
    if (ladderPosts.length < 2) throw new Error(`expected the ladder's two planner posts, got ${ladderPosts.length}`);
    for (const p of ladderPosts) if (p.followUpComment) throw new Error(`a ladder post must reach the planner with no first comment, got ${JSON.stringify(p.followUpComment)}`);
    await page.goto(`${base}/content/${ladderItemId}/repurpose`);
    const unhanded = page.locator('[data-testid="channel-outcomes"] li[data-channel="comments"][data-state="unhanded"]').first();
    await unhanded.waitFor({ timeout: 15000 });
    if (!(await unhanded.innerText()).includes("confirmed by GoHighLevel first")) throw new Error("the handoff says why it is held: the posts have to be confirmed first");
    if (await page.locator('[data-testid="handoff-form"]').count()) throw new Error("no handoff button while the gate says no");
    await submit(page, 'button:has-text("Check every version with GoHighLevel")');
    await expectOutcome(page, "fb_page", "published", "the ladder's Facebook page post read back as published");
    await expectOutcome(page, "instagram", "published", "the ladder's Instagram post read back as published");
    await submit(page, '[data-testid="handoff-form"] button:has-text("Send comments to Community Loyalty")');
    const handed = page.locator('[data-testid="channel-outcomes"] li[data-channel="comments"][data-state="handed"]').first();
    await handed.waitFor({ timeout: 15000 });
    const handedText = await handed.innerText();
    if (!handedText.includes("Comments: handed to Community Loyalty")) throw new Error(`the handoff row says handed, got "${handedText}"`);
    if (/\b(posted|published|live|sent)\b/i.test(handedText)) throw new Error(`the handoff row must never say posted: "${handedText}"`);
    if (await page.locator('[data-testid="handoff-form"]').count()) throw new Error("no second handoff while one is running");
    const drips = ((await (await fetch(`http://localhost:${mockPort}/__drips`)).json()) as { drips: { path: string; body: Record<string, string> }[] }).drips;
    if (drips.length !== 1) throw new Error(`expected one webhook call, got ${drips.length}`);
    const sent = drips[0].body;
    if (drips[0].path !== "/api/iwh/abcdef0123456789abcdef0123456789" || sent.user_ns !== "f52594u50757435") throw new Error("the webhook call goes to the coach's URL with the coach's contact");
    const rungTexts = sent.rungs.split(/\r?\n\s*-{3,}\s*\r?\n/).map((r) => r.replace(/^\s*\d+\s*\\?\.\s*/, "").trim()).filter(Boolean);
    if (rungTexts.length !== ladderRow!.rungs.length) throw new Error(`rungs start at rung 1 when HelixOS published: expected ${ladderRow!.rungs.length}, got ${rungTexts.length}`);
    if (!sent.first_comment || sent.first_comment !== ladderRow!.rungs[0].body.trim()) throw new Error("first_comment is rung 1 for the Threads post");
    if (sent.schedule_at !== "") throw new Error("Threads posts now when no time is given");
    if (/\\n|\\"/.test(sent.post) === false && !sent.post.includes(ladderRow!.copy.slice(0, 20))) throw new Error("the post is the raw text");
    console.log("✓ comment ladder handed to Community Loyalty only once both posts read Published; rungs from rung 1, first comment for Threads, Threads never pushed by HelixOS; the row never says posted");

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
    if (!tracked.length) throw new Error("the planner holds tracked posts beside the duplicate");
    for (const id of tracked) if (await page.locator(`[data-testid="audit-row"][data-post-id="${id}"]`).count()) throw new Error(`tracked planner post ${id} must not be listed as untracked`);
    if (await page.locator('button:has-text("Delete"), button:has-text("Remove")').count()) throw new Error("the audit must not offer a delete");
    const stillThere = (await plannerPosts()).some((p) => p._id === dupId);
    if (!stillThere) throw new Error("the audit changed the planner");
    await page.screenshot({ path: "screenshots/g03-planner-audit.png", fullPage: true });
    console.log("✓ planner audit: the leftover is named a duplicate with its twin; tracked posts are not listed; nothing deleted");

    // The replay: one record first, stored id, then the coach's disconnect, which also says the token lives on.
    // The demo's client records carry no email, so one gets one here: a record with an identity and no id is what a replay is for.
    {
      const { db: dbr, schema: sr } = await import("@/db");
      const { eq: eqr } = await import("drizzle-orm");
      await dbr.update(sr.clientRecords).set({ email: "sarah.kim@example.com" }).where(eqr(sr.clientRecords.name, "Sarah Kim"));
    }
    await page.goto(`${base}/integrations`);
    const replayRow = page.locator('[data-testid="replay-row"]', { hasText: "Maya Torres" });
    const readyBefore = Number(await replayRow.getAttribute("data-ready"));
    if (readyBefore < 1) throw new Error("the demo client's records with an email and no id are ready to replay");
    await Promise.all([page.waitForURL(/replay=/), replayRow.locator('[data-testid="replay-one"]').click()]);
    await expectText(page, "Ran on one record", "the replay ran on one record");
    await expectText(page, "1 sent, 0 failed", "and stored its id");
    if (Number(await page.locator('[data-testid="replay-row"]', { hasText: "Maya Torres" }).getAttribute("data-ready")) !== readyBefore - 1) throw new Error("the replayed record is no longer ready: its id is stored");
    page.once("dialog", (d) => d.accept());
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('form:has(input[name="userId"]) button:has-text("Disconnect")').first().click()]);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expectText(page, "not connected", "the coach removed the client's connection");
    await expectText(page, "Connection removed by the coach", "and the sync log says who did it and that the token lives on");
    console.log("✓ replay one record and store its id; the coach can disconnect a client, with the token's afterlife said");
  } finally {
    await browser.close();
    try {
      if (mock.pid) process.kill(-mock.pid, "SIGTERM"); // the mock is npx's grandchild: kill the group
    } catch {
      mock.kill();
    }
  }
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("GHL smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
