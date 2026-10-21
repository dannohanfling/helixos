/**
 * Claude's drafts of the Essence, lead magnets and posts (H-184, plan H-220 PR D2b). Through the connector: the six tools on
 * their scopes; a field an area doesn't take refused by name (a magnet's keyword and publishing, a post's status and schedule);
 * a held story bank item refused as needing permission first; another workspace's connection finds nothing. In the app: at 1440
 * the Essence section's amber draft and its dot, Approve writing that one section; a new magnet approved from the list, made
 * unpublished. At 390: a new post's draft opened with Edit and saved by the post's own form, and a post already scheduled
 * showing the red line with Approve off.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function login(page: Page) {
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
async function open(page: Page, url: string, testid: string) {
  for (let i = 0; i < 3; i++) {
    await page.goto(url);
    if (await page.locator(`[data-testid="${testid}"]`).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error(`${testid} never showed on ${url}`);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { viewerFor } = await import("@/lib/auth");
  const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
  const { createHash, randomBytes } = await import("node:crypto");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const jordanM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, jordan.id) }))!;
  const ws = mayaM.workspaceId;

  const CALLBACK = "http://localhost:4093/cb";
  let rpcId = 0;
  const rpc = async (token: string, method: string, params: unknown = {}) => {
    const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
    return (await res.json()) as { result?: { tools?: { name: string }[]; content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message: string } };
  };
  const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const j = await rpc(token, "tools/call", { name, arguments: args });
    const full = j.result?.content?.find((c) => c.type === "text")?.text ?? j.error?.message ?? "";
    const cut = full.indexOf("\n\n{");
    return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), isError: Boolean(j.result?.isError || j.error) };
  };
  const apps: string[] = [];
  const connect = async (userId: string, workspaceId: string, scopes: string[]) => {
    const client = await registerClient("Smoke area drafts", [CALLBACK]);
    const v = (await viewerFor(userId, workspaceId))!;
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: scopes as never });
    const token = ((await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string }).access_token;
    const app = await db.query.connectedApps.findFirst({ where: and(eq(schema.connectedApps.userId, userId), eq(schema.connectedApps.clientId, client.id)) });
    if (app) apps.push(app.id);
    return token;
  };

  // Fixtures: a held story bank item, a magnet, and a post already scheduled.
  const storyHeld = newId();
  const magnetId = newId();
  const scheduledId = newId();
  const madeMagnets: string[] = [magnetId];
  const madePosts: string[] = [scheduledId];
  await db.insert(schema.storyItems).values({ id: storyHeld, workspaceId: ws, userId: maya.id, key: `walk-${storyHeld}`, title: "Area drafts walk held story", type: "story", what: "A held story", status: "check", digest: "walk" });
  await db.insert(schema.leadMagnets).values({ id: magnetId, workspaceId: ws, userId: maya.id, title: "Area drafts walk magnet", keyword: `WALK${magnetId.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, "")}`, slug: `area-drafts-walk-${magnetId.slice(0, 8)}` });
  await db.insert(schema.contentItems).values({ id: scheduledId, workspaceId: ws, userId: maya.id, title: "Area drafts walk scheduled post", status: "scheduled", postAt: "2026-12-01T09:00:00" });
  const essenceBefore = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, ws), eq(schema.essences.userId, maya.id)) });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    // ── 1. The connector. ──
    const writer = await connect(maya.id, ws, ["essence", "magnets", "content", "content:write", "bot"]);
    const other = await connect(jordan.id, jordanM.workspaceId, ["essence", "magnets", "content", "content:write"]);
    const listed = ((await rpc(writer, "tools/list")).result?.tools ?? []).map((x) => x.name);
    must(["essence_read", "essence_draft", "magnets_list", "magnet_draft", "content_list", "content_draft"].every((n) => listed.includes(n)), `the six draft tools are listed: ${listed.join(", ")}`);

    let r = await call(writer, "essence_draft", { section: "mission_and_vision", fields: { mission_statement: "x", tone: "warm" } });
    must(/Nothing was saved/.test(r.text) && /tone/.test(r.text), `a field the section doesn't take is refused by name: ${r.text}`);
    r = await call(writer, "essence_draft", { section: "representative_stories", story_ids: [storyHeld], fields: { stories: [{ name: "The empty room", summary: "Nobody came the first night, and I kept going.", when_to_use: "When they doubt" }] } });
    must(!r.isError && r.data?.saved === true && /Needs permission first/.test(r.text), `the held story is refused as needing permission first, the rest saved: ${r.text}`);
    r = await call(writer, "essence_draft", { section: "mission_and_vision", fields: { mission_statement: "Help coaches sell with calm, not hustle." } });
    must(!r.isError && r.data?.saved === true, `the Essence draft is saved: ${r.text}`);

    r = await call(writer, "magnet_draft", { fields: { title: "Walk calm mornings guide", keyword: "CALM", publishedAt: "now" } });
    must(/Nothing was saved/.test(r.text) && /keyword/.test(r.text) && /publishedAt/.test(r.text), `a magnet's keyword and publishing are refused by name: ${r.text}`);
    const magnetsBefore = (await db.query.leadMagnets.findMany({ where: eq(schema.leadMagnets.userId, maya.id) })).length;
    r = await call(writer, "magnet_draft", { fields: { title: "Walk calm mornings guide", promise: "A calmer start.", content: "Start here.\n## The night before\n- Lay out tomorrow's clothes\n---\nWant more? Book a call." } });
    must(!r.isError && r.data?.saved === true && (await db.query.leadMagnets.findMany({ where: eq(schema.leadMagnets.userId, maya.id) })).length === magnetsBefore, `a new magnet's draft is saved, and no magnet is made: ${r.text}`);

    r = await call(writer, "content_draft", { fields: { title: "Walk post", status: "scheduled" } });
    must(/Nothing was saved/.test(r.text) && /status/.test(r.text), `a post's status is refused by name: ${r.text}`);
    r = await call(writer, "content_draft", { fields: { title: "Walk post about calm mornings", hook: "Your mornings aren't broken.", pillar: "Calm", suggestedDate: "2026-11-03" } });
    must(!r.isError && r.data?.saved === true, `a new post's draft is saved: ${r.text}`);
    r = await call(writer, "content_draft", { id: scheduledId, fields: { hook: "A new hook" } });
    must(!r.isError && ((r.data?.red as string[]) ?? []).some((x) => /already scheduled/.test(x)), `a scheduled post's draft says it can't change it: ${r.text}`);

    r = await call(other, "magnet_draft", { id: magnetId, fields: { promise: "Not theirs." } });
    must(r.text === "No lead magnet with that id in your HelixOS.", `another workspace's connection finds nothing: ${r.text}`);
    r = await call(other, "content_draft", { id: scheduledId, fields: { hook: "Not theirs." } });
    must(r.text === "No post with that id in your HelixOS.", "nor the post");
    console.log("✓ the connector: six tools; unlisted fields refused (a magnet's keyword and publishing, a post's status); a held story refused; nothing made before Approve; another workspace finds nothing");

    // ── 2. At 1440: the Essence section's draft, and a new magnet approved from the list. ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    await login(page);
    await open(page, `${base}/essence?step=mission_and_vision`, "claude-draft");
    must((await page.locator('[data-section="mission_and_vision"] [data-testid="essence-draft-dot"]').count()) === 1, "the section with a draft has the amber dot");
    must((await page.locator('[data-testid="claude-draft-value-mission_statement"]').innerText()).includes("sell with calm"), "the draft shows beside the section");
    await submit(page, '[data-testid="claude-draft-approve"]');
    const essence = (await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, ws), eq(schema.essences.userId, maya.id)) }))!;
    must((essence.data.mission_and_vision as Record<string, string>).mission_statement === "Help coaches sell with calm, not hustle.", "Approve writes the section");
    must(JSON.stringify(essence.data.identity ?? {}) === JSON.stringify((essenceBefore?.data as Record<string, unknown> | undefined)?.identity ?? {}), "and leaves the other sections as they were");

    await open(page, `${base}/magnets`, "claude-new-magnets");
    await submit(page, '[data-testid="claude-new-magnets"] [data-testid="claude-draft-approve"]');
    await page.waitForURL(/\/magnets\/[^/?]+/, { timeout: 20000 });
    const newMagnetId = new URL(page.url()).pathname.split("/").pop()!;
    madeMagnets.push(newMagnetId);
    const nm = (await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, newMagnetId) }))!;
    must(nm.title === "Walk calm mornings guide" && nm.publishedAt === null && nm.content.sections[0]?.heading === "The night before", `Approve makes the magnet, unpublished, and opens it: ${nm.title}`);
    console.log("✓ 1440: the Essence draft with its dot, Approve writes that section only; a new magnet approved from the list is made unpublished and opened");

    // ── 3. At 390: a new post's draft opened with Edit; a scheduled post's red line. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `${base}/content`, "claude-new-posts");
    must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the new post's draft fits a phone, no sideways scroll");
    await submit(page, '[data-testid="claude-new-posts"] [data-testid="claude-draft-edit"]');
    await page.locator('[data-testid="claude-draft-editing"]').waitFor({ timeout: 20000 });
    const postId = new URL(page.url()).pathname.split("/").pop()!;
    madePosts.push(postId);
    must((await page.locator('textarea[name="hook"], input[name="hook"]').first().inputValue()) === "Your mornings aren't broken.", "Edit made the post and filled its form with the draft");
    await submit(page, 'form:has(input[name="draftId"]) button[type="submit"]');
    const post = (await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, postId) }))!;
    const pd = (await db.query.drafts.findFirst({ where: and(eq(schema.drafts.targetId, postId), eq(schema.drafts.workspaceId, ws)) }))!;
    must(post.hook === "Your mornings aren't broken." && post.status !== "scheduled" && post.status !== "posted" && pd.status === "edited", `the post's own save writes it, never schedules it, and settles the draft (${post.status}, ${pd.status})`);

    await open(page, `${base}/content/${scheduledId}`, "claude-draft");
    must(await page.locator('[data-testid="claude-draft-red"]').isVisible(), "the scheduled post's draft shows the red line");
    must(await page.locator('[data-testid="claude-draft-approve"]').isDisabled(), "and Approve stays off");
    must((await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, scheduledId) }))!.hook === null, "and the post is untouched");
    console.log("✓ 390: the new post's draft fits; Edit makes the post and fills its form; its save settles the draft; a scheduled post's draft shows red with Approve off");

    // ── 4. Your bot (D2c): its words drafted, the booking link never touched, approved in Settings. ──
    const bookingBefore = mayaM.bookingUrl;
    r = await call(writer, "bot_profile_draft", { fields: { whatIDo: "x", bookingUrl: "https://elsewhere.example" } });
    must(/Nothing was saved/.test(r.text) && /bookingUrl/.test(r.text), `the booking link is refused by name: ${r.text}`);
    r = await call(writer, "bot_profile_draft", { fields: { whatIDo: "I help coaches fill their calendar without the hustle.", botQuestion1: "What are you building right now?" } });
    must(!r.isError && r.data?.saved === true, `the bot draft is saved: ${r.text}`);
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaM.id) }))!.whatIDo === mayaM.whatIDo, "the bot's words are unchanged until Approve");
    await page.setViewportSize({ width: 1440, height: 950 });
    await open(page, `${base}/settings#your-bot`, "claude-draft");
    must((await page.locator('#your-bot [data-testid="claude-draft-value-whatIDo"]').innerText()).includes("without the hustle"), "the draft shows in Settings beside the bot's words");
    await submit(page, '#your-bot [data-testid="claude-draft-approve"]');
    const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaM.id) }))!;
    must(mm.whatIDo === "I help coaches fill their calendar without the hustle." && mm.botQuestion1 === "What are you building right now?" && mm.bookingUrl === bookingBefore, "Approve writes the bot's words and leaves the booking link");
    await db.update(schema.memberships).set({ whatIDo: mayaM.whatIDo, botQuestion1: mayaM.botQuestion1 }).where(eq(schema.memberships.id, mayaM.id));
    console.log("✓ your bot: the booking link refused; the draft waits in Settings; Approve writes the words and leaves the link");
    await ctx.close();
  } finally {
    await browser.close();
    await db.delete(schema.drafts).where(and(eq(schema.drafts.workspaceId, ws), eq(schema.drafts.userId, maya.id)));
    await db.delete(schema.changeHistory).where(and(eq(schema.changeHistory.workspaceId, ws), eq(schema.changeHistory.userId, maya.id)));
    await db.delete(schema.leadMagnets).where(inArray(schema.leadMagnets.id, madeMagnets));
    await db.delete(schema.contentItems).where(inArray(schema.contentItems.id, madePosts));
    await db.delete(schema.storyItems).where(eq(schema.storyItems.id, storyHeld));
    if (essenceBefore) await db.update(schema.essences).set({ data: essenceBefore.data }).where(eq(schema.essences.id, essenceBefore.id));
    if (apps.length) await db.delete(schema.connectedApps).where(inArray(schema.connectedApps.id, apps));
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
