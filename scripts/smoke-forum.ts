/**
 * The Forum (rev 765), end to end as Maya: a report through the connector (forum_report) and one through her webhook land as the
 * same event; the webhook refuses a missing or wrong secret and a secret in the address (nothing saved); a fake sk- value is
 * removed and logged without the value; the 61st report in a minute is refused; a booking and a shipped post show up as
 * built-in agents with no setup. On Danno's 12-plot forum, at 1440, 1024 and 390 with fourteen agents: free plots dimmed with no
 * plate while there are some, then twelve buildings and two agents in the Outer districts, no name plates overlapping and no sideways scroll; a tap-swap and a drag-swap are saved; reduced motion keeps the
 * messengers still; a glossary word on a card opens by keyboard; ticking a need says nothing goes back. Privacy: another client
 * and the coach can't read Maya's Forum until she shares it, then the coach reads it without moving anything. The coach's own
 * Forum starts with the build team, and Settings shows the webhook secret once.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const CALLBACK = "http://localhost:4090/cb";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
let rpcId = 0;
const rpc = (token: string, method: string, params: unknown = {}) =>
  fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = (await (await rpc(token, "tools/call", { name, arguments: args })).json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  return { text: res.error?.message ?? res.result?.content?.[0]?.text ?? "", isError: Boolean(res.error || res.result?.isError) };
}
const hook = (body: unknown, headers: Record<string, string> = {}, query = "") => fetch(`${base}/api/forum/report${query}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { viewerFor } = await import("@/lib/auth");
  const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
  const { makeForumWebhook, forumStateFor } = await import("@/lib/forum");
  const { createHash, randomBytes } = await import("node:crypto");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!.workspaceId;
  const M = { workspaceId: ws, userId: maya.id };
  const reset = async (userId: string) => {
    for (const t of [schema.forumAgents, schema.forumEvents, schema.forumNeeds, schema.forumSettings]) await db.delete(t).where(and(eq(t.workspaceId, ws), eq(t.userId, userId)));
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, `forum:report:${ws}:${userId}`));
  };
  await reset(maya.id);
  await reset(coach.id);
  const events = () => db.query.forumEvents.findMany({ where: and(eq(schema.forumEvents.workspaceId, ws), eq(schema.forumEvents.userId, maya.id)) });

  // ── The connector: forum_report and forum_read under The Forum's own tick. ──
  const client = await registerClient("Walk forum", [CALLBACK]);
  const v = (await viewerFor(maya.id, ws))!;
  const tokenFor = async (scopes: string[]) => {
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: scopes as never });
    const pair = await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` });
    return (pair as { access_token: string }).access_token;
  };
  const token = await tokenFor(["forum"]);
  const other = await tokenFor(["today"]);
  const listed = ((await (await rpc(token, "tools/list")).json()) as { result?: { tools?: { name: string }[] } }).result?.tools?.map((t) => t.name) ?? [];
  const otherListed = ((await (await rpc(other, "tools/list")).json()) as { result?: { tools?: { name: string }[] } }).result?.tools?.map((t) => t.name) ?? [];
  must(listed.includes("forum_report") && listed.includes("forum_read") && !otherListed.includes("forum_report"), `the Forum tools come with The Forum's tick only: ${listed} / ${otherListed}`);
  const report = { status: "working", now: "Reading the brief", last: "Pushed the plan", next: "Build the map", flow: { to: "you", label: "question" } };
  let r = await tool(token, "forum_report", { agent: "Researcher", ...report });
  must(!r.isError && r.text.includes("a new agent"), `forum_report saves and names a new agent: ${r.text}`);

  // ── The webhook: header only, constant-time, never the address. ──
  const secret = await makeForumWebhook(M);
  const before = (await events()).length;
  must((await hook({ agent: "Scout", ...report })).status === 401, "no header is refused");
  must((await hook({ agent: "Scout", ...report }, { "x-forum-secret": `hxf_${"x".repeat(32)}` })).status === 401, "a wrong secret is refused");
  must((await hook({ agent: "Scout", ...report }, { "x-forum-secret": secret }, `?secret=${encodeURIComponent(secret)}`)).status === 400, "a secret in the address is refused even with the right header");
  must((await hook({ agent: "Scout", ...report }, {}, `?key=${encodeURIComponent(secret)}`)).status === 400, "a secret in the address alone is refused");
  must((await events()).length === before, "nothing was saved by a refused post");
  const ok = await hook({ agent: "Scout", ...report }, { "x-forum-secret": secret });
  must(ok.status === 200, `the right secret in the header is taken: ${ok.status} ${await ok.text()}`);
  const all = await events();
  const agents = await db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, ws), eq(schema.forumAgents.userId, maya.id)) });
  const idOf = (n: string) => agents.find((a) => a.name === n)!.id;
  const shape = (agentId: string) => all.filter((e) => e.agentId === agentId).map((e) => ({ kind: e.kind, payload: e.payload })).sort((a, b) => a.kind.localeCompare(b.kind));
  must(JSON.stringify(shape(idOf("Researcher"))) === JSON.stringify(shape(idOf("Scout"))) && shape(idOf("Scout")).length === 2, `a connector report and a webhook report make the same events: ${JSON.stringify(shape(idOf("Researcher")))} vs ${JSON.stringify(shape(idOf("Scout")))}`);
  must(agents.find((a) => a.name === "Scout")!.createdBy === "webhook" && !agents.find((a) => a.name === "Scout")!.confirmed, "an agent a report made is new until confirmed");
  console.log("✓ forum_report and the webhook make the same events; the webhook refuses no secret, a wrong one, and any secret in the address, saving nothing");

  // ── The scrub. ──
  r = await tool(token, "forum_report", { agent: "Researcher", now: "Testing with sk-live-abcdefghijklmnop123", last: "Still going" });
  must(r.text.includes("removed"), `the reply says a value was removed: ${r.text}`);
  const researcher = (await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, idOf("Researcher")) }))!;
  must(researcher.now === null && researcher.last === "Still going", "the field with the key is dropped whole, the rest kept");
  const dump = JSON.stringify([await events(), await db.query.forumAgents.findMany({ where: eq(schema.forumAgents.userId, maya.id) })]);
  must(!dump.includes("sk-live") && (await events()).some((e) => e.kind === "removed"), "the value is nowhere, and the news says a value was removed");
  console.log("✓ a fake sk- value is removed before saving and logged as 'a value was removed'");

  // ── 60 reports a minute per member, across every path. ──
  await db.insert(schema.rateLimits).values({ key: `forum:report:${ws}:${maya.id}`, count: 60, windowStart: Date.now() }).onConflictDoUpdate({ target: schema.rateLimits.key, set: { count: 60, windowStart: Date.now() } });
  must((await hook({ agent: "Scout", status: "idle" }, { "x-forum-secret": secret })).status === 429, "the 61st report in a minute is refused");
  must((await tool(token, "forum_report", { agent: "Researcher", status: "idle" })).isError, "and through the connector too");
  await db.delete(schema.rateLimits).where(eq(schema.rateLimits.key, `forum:report:${ws}:${maya.id}`));
  console.log("✓ the rate limit: 60 reports a minute per member, webhook and connector together");

  // ── Built-ins: a booking and a shipped post, from what HelixOS records. ──
  const nowIso = new Date().toISOString();
  const leadId = newId();
  const postId = newId();
  await db.insert(schema.contacts).values({ id: leadId, workspaceId: ws, userId: maya.id, name: "Forum walk lead", callBookedAt: nowIso });
  await db.insert(schema.contentItems).values({ id: postId, workspaceId: ws, userId: maya.id, title: "Forum walk post", status: "posted", postedAt: nowIso.slice(0, 10) });
  try {
    const s = await forumStateFor(M);
    must(s.agents.some((a) => a.builtIn === "booking" && a.last === "A call was booked") && s.agents.some((a) => a.builtIn === "ship" && a.last?.includes("Forum walk post")), `built-in agents appear: ${JSON.stringify(s.agents.map((a) => [a.name, a.last]))}`);
    const read = await tool(token, "forum_read");
    must(read.text.includes("Booking bot") && read.text.includes("Researcher"), `forum_read returns the state: ${read.text.slice(0, 200)}`);
    console.log("✓ built-in agents: a booking and a shipped post show up with no setup; forum_read returns them");

    // Twelve agents in all: the two built-ins, Researcher and Scout, and eight more by hand; one carries a glossary word and a need.
    for (let i = 1; i <= 10; i++) await tool(token, "forum_report", { agent: `Helper ${i}`, status: i % 2 ? "working" : "done", now: i === 1 ? "Waiting out a rate limit before the next push" : `Task ${i}` });
    await tool(token, "forum_report", { agent: "Helper 2", needs_you: { what: "Approve the copy", when: "today" } });

    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
    const failures: string[] = [];
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.on("response", (res) => {
        if (res.status() >= 500) failures.push(`${res.status()} ${res.url()}`);
      });
      const signIn = async (email: string) => {
        await page.context().clearCookies();
        await page.goto(`${base}/login`);
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', "demo1234");
        await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
      };
      await signIn("client@demo.helixos.app");
      // Before the helpers fill it: a new agent takes the lowest free plot, and free plots show dimmed with no plate.
      {
        const s0 = await forumStateFor(M);
        must(s0.agents.find((a) => a.name === "Researcher")?.plot === "p01" && s0.agents.find((a) => a.name === "Scout")?.plot === "p02", `new agents take the lowest free plots: ${JSON.stringify(s0.agents.map((a) => [a.name, a.plot]))}`);
      }
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/forum`, { waitUntil: "networkidle" });
        await page.locator('[data-testid="forum-map"]').waitFor({ timeout: 20000 });
        const filled = await page.locator('[data-testid^="forum-bld-"]:not(.fo-free)').count();
        const outer = await page.locator('[data-testid="forum-outer-agent"]').count();
        must(filled === 12 && outer === 2 && (await page.locator('[data-testid="forum-plate"]').count()) === 13, `fourteen agents: twelve plots and two in the Outer districts at ${width}: ${filled} + ${outer}`);
        must((await page.locator('[data-testid="forum-photo-day"]').evaluate((i) => (i as HTMLImageElement).naturalWidth)) === 1680, "the forum photo loads");
        // Golden hour, filmed (H-1253): the plaza's loop plays over the photo, started by the page, exactly over it, and never takes a tap.
        if ((await page.locator('[data-testid="forum-map"]').getAttribute("data-look")) === "day") {
          must((await page.locator('[data-testid="forum-map"]').getAttribute("data-loop")) === "1", `the Forum lists its golden-hour loop at ${width}`);
          await page.waitForFunction(() => document.querySelector('[data-testid="forum-loop"]')?.getAttribute("data-loop-mode") === "video", null, { timeout: 15000 });
          const lp = await page.locator('[data-testid="forum-loop"]').evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc, paused: v.paused, opacity: getComputedStyle(v).opacity, auto: v.autoplay, pe: getComputedStyle(v).pointerEvents }));
          must(/\/forum\/forum-day-loop\.(mp4|webm)\?v=\d+$/.test(lp.src) && !lp.paused && lp.opacity === "1" && !lp.auto && lp.pe === "none", `the plaza's loop plays over the photo at ${width}: ${JSON.stringify(lp)}`);
          const lb = (await page.locator('[data-testid="forum-loop"]').boundingBox())!;
          const pb = (await page.locator('[data-testid="forum-photo-day"]').boundingBox())!;
          must(Math.abs(lb.x - pb.x) < 1 && Math.abs(lb.width - pb.width) < 1 && Math.abs(lb.height - pb.height) < 1, `the loop sits exactly over the photo at ${width}`);
        }
        const boxes = await page.locator('[data-testid="forum-plate"] rect').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((b) => ({ l: b.left, r: b.right, t: b.top, b: b.bottom })));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const c = boxes[j];
          must(a.r <= c.l + 1 || c.r <= a.l + 1 || a.b <= c.t + 1 || c.b <= a.t + 1, `plates ${i} and ${j} overlap at ${width}`);
        }
        must((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, `no sideways scroll at ${width}`);
        must(/[A-Z]{3,4}|GMT/.test(await page.locator('[data-testid="forum-stamp"] b').innerText()), "the Updated stamp carries a zone");
      }
      console.log("✓ the 12-plot map at 1440, 1024 and 390: new agents take the lowest free plot, twelve on plots and the rest in the Outer districts, no plates overlapping, no sideways scroll, times with a zone");

      // Tap two to swap, then drag one onto another; both saved.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${base}/forum`, { waitUntil: "networkidle" });
      const placeOf = async (name: string) => (await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.userId, maya.id), eq(schema.forumAgents.name, name)) }))?.plotId ?? null;
      const inCowork = await page.locator('[data-testid="forum-bld-p01"]').getAttribute("aria-label");
      const inMain = await page.locator('[data-testid="forum-bld-p06"]').getAttribute("aria-label");
      const nameIn = (label: string | null) => (label ?? "").split(",")[0];
      await page.click('[data-testid="forum-move"]');
      await page.locator('[data-testid="forum-bld-p01"]').click({ force: true });
      await Promise.all([page.waitForResponse((res) => res.request().method() === "POST"), page.locator('[data-testid="forum-bld-p06"]').click({ force: true })]);
      await page.waitForLoadState("networkidle");
      must((await placeOf(nameIn(inCowork))) === "p06" && (await placeOf(nameIn(inMain))) === "p01", `tapping two buildings swaps them, saved: ${nameIn(inCowork)} → ${await placeOf(nameIn(inCowork))}`);
      await page.click('[data-testid="forum-move"]');
      // The whole map in view: a mouse outside the window reaches nothing.
      await page.locator('[data-testid="forum-map"]').evaluate((e) => e.scrollIntoView({ block: "start" }));
      const centre = async (sel: string) => {
        const b = (await page.locator(`${sel} .fo-hit`).boundingBox())!;
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      };
      const from = await centre('[data-testid="forum-bld-p11"]');
      const to = await centre('[data-testid="forum-bld-p03"]');
      const inGithub = nameIn(await page.locator('[data-testid="forum-bld-p11"]').getAttribute("aria-label"));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await Promise.all([page.waitForResponse((res) => res.request().method() === "POST"), page.mouse.up()]);
      await page.waitForLoadState("networkidle");
      must((await placeOf(inGithub)) === "p03", `dragging one building onto another moves it, saved: ${inGithub} → ${await placeOf(inGithub)}`);
      // An agent from the Outer districts swaps onto a plot: tap it, then the plot.
      await page.click('[data-testid="forum-move"]');
      const outerName = (await page.locator('[data-testid="forum-outer-agent"]').first().innerText()).trim();
      const onP05 = nameIn(await page.locator('[data-testid="forum-bld-p05"]').getAttribute("aria-label"));
      await page.locator('[data-testid="forum-outer-agent"]').first().click();
      await Promise.all([page.waitForResponse((res) => res.request().method() === "POST"), page.locator('[data-testid="forum-bld-p05"]').click({ force: true })]);
      await page.waitForLoadState("networkidle");
      const after = await forumStateFor(M);
      must(after.agents.find((a) => a.name === outerName)?.plot === "p05" && after.agents.find((a) => a.name === onP05)?.plot === null, `an Outer districts agent swaps onto a plot: ${outerName} and ${onP05}`);
      await page.click('[data-testid="forum-move"]');
      console.log("✓ tap two plots to swap, drag one onto another, or bring an agent in from the Outer districts: saved at once");

      // A glossary word on a card opens by keyboard; ticking a need says nothing goes back.
      const mark = page.locator('[data-testid="forum-card"] [data-testid="glossary-mark"]', { hasText: /rate limit/i }).first();
      await mark.focus();
      await page.keyboard.press("Enter");
      await page.locator('[data-testid="glossary-pop"] a:has-text("More")').waitFor({ timeout: 5000 });
      must((await page.locator('[data-testid="glossary-pop"]').innerText()).toLowerCase().includes("rate limit"), "the popover gives the word's meaning");
      must((await page.locator(".fo-fine", { hasText: "Nothing is sent back to the agent" }).count()) === 1, "the page says ticking sends nothing back");
      await submit(page, '[data-testid="forum-need-tick"]');
      must((await db.query.forumNeeds.findFirst({ where: and(eq(schema.forumNeeds.userId, maya.id), eq(schema.forumNeeds.what, "Approve the copy")) }))?.doneBy === "member", "ticked done by the member");
      await submit(page, '[data-testid="forum-confirm"]');
      console.log("✓ a glossary word on a card opens by keyboard with a More link; a need ticked done; a new agent confirmed");

      // Reduced motion: messengers rest mid-street and nothing breathes.
      const still = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
      const sp = await still.newPage();
      await sp.goto(`${base}/forum`, { waitUntil: "networkidle" });
      const dot = sp.locator('[data-testid="forum-messenger"] .fo-msg').first();
      await dot.waitFor({ state: "attached", timeout: 10000 });
      const a1 = await dot.getAttribute("cx");
      await sp.waitForTimeout(700);
      must(a1 && a1 === (await dot.getAttribute("cx")), "with reduced motion a messenger stays put");
      must((await sp.locator(".fo-bld.fo-working .fo-halo").first().evaluate((e) => getComputedStyle(e).animationName)) === "none", "and nothing breathes");
      await still.close();
      const moving = page.locator('[data-testid="forum-messenger"] .fo-msg').first();
      const b1 = await moving.getAttribute("cx");
      await page.waitForTimeout(700);
      must(b1 !== (await moving.getAttribute("cx")), "without it, a messenger walks");
      // H-52: each light carries its own pace and fade, and the hover line names who sent what to whom.
      const runner = page.locator('[data-testid="forum-messenger"]').first();
      const dur = Number(await runner.getAttribute("data-dur"));
      must(dur >= 4000 && dur <= 20000 && Number(await runner.getAttribute("data-fade")) > 0, `a light has its own pace and fade: ${dur}`);
      must(/ → .* · /.test((await runner.locator("title").textContent()) ?? ""), "the hover line reads who → whom · what");
      console.log("✓ reduced motion: messengers rest mid-street, no breathing; otherwise they walk");

      // Settings: the secret is shown once.
      await page.goto(`${base}/settings#forum`, { waitUntil: "networkidle" });
      await submit(page, '[data-testid="forum-webhook-make"]');
      const shown = await page.locator('[data-testid="forum-webhook-secret-value"]').innerText();
      must(/^hxf_/.test(shown), "a new secret is shown");
      await page.reload({ waitUntil: "networkidle" });
      must((await page.locator('[data-testid="forum-webhook-secret-value"]').count()) === 0 && (await page.content()).indexOf(shown) < 0, "and never again");
      must((await hook({ agent: "Scout", status: "idle" }, { "x-forum-secret": secret })).status === 401, "rotating stops the old secret");
      await submit(page, '[data-testid="forum-webhook-revoke"]');
      must((await hook({ agent: "Scout", status: "idle" }, { "x-forum-secret": shown })).status === 401, "revoking stops the new one");
      console.log("✓ Settings → The Forum: a secret shown once, rotate stops the old one, revoke stops it");

      // Privacy: another client and the coach see nothing until Maya shares.
      await signIn("client2@demo.helixos.app");
      await page.goto(`${base}/forum?member=${maya.id}`, { waitUntil: "networkidle" });
      must((await page.locator('[data-testid="forum-private"]').count()) === 1 && !(await page.content()).includes("Researcher"), "another client can't read Maya's Forum");
      await signIn("coach@demo.helixos.app");
      await page.goto(`${base}/forum?member=${maya.id}`, { waitUntil: "networkidle" });
      must((await page.locator('[data-testid="forum-private"]').count()) === 1 && !(await page.content()).includes("Researcher"), "the coach can't read it while it isn't shared");
      await page.goto(`${base}/forum`, { waitUntil: "networkidle" });
      const seeded = await db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, ws), eq(schema.forumAgents.userId, coach.id)) });
      must(seeded.length === 9 && seeded.find((a) => a.name === "Hermes")?.plotId === "p08" && (await page.locator('[data-testid^="forum-bld-"]:not(.fo-free)').count()) === 9 && (await page.locator('[data-testid="forum-bld-p09"]').getAttribute("data-status")) === "free", `the coach's Forum starts with the build team in their buildings: ${seeded.map((a) => a.name)}`);
      await signIn("client@demo.helixos.app");
      await page.goto(`${base}/forum`, { waitUntil: "networkidle" });
      await submit(page, '[data-testid="forum-share-go"]');
      await signIn("coach@demo.helixos.app");
      await page.goto(`${base}/forum`, { waitUntil: "networkidle" });
      await Promise.all([page.waitForURL(/member=/), page.locator(`[data-testid="forum-shared"] a[href^="/forum?member=${maya.id}"]`).click()]);
      await page.locator('[data-testid="forum-page"]').waitFor({ timeout: 20000 });
      must((await page.content()).includes("Researcher") && (await page.locator('[data-testid="forum-move"]').count()) === 0 && (await page.locator('[data-testid="forum-add"]').count()) === 0, "shared: the coach reads Maya's Forum, and can't move or add anything");
      console.log("✓ privacy: another client and the coach can't read a Forum that isn't shared; shared, the coach reads it only; the coach's own starts with the build team");
    } finally {
      await browser.close();
    }
    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
  } finally {
    await db.delete(schema.contacts).where(eq(schema.contacts.id, leadId));
    await db.delete(schema.contentItems).where(eq(schema.contentItems.id, postId));
    await reset(maya.id);
    await reset(coach.id);
  }
  console.log("The Forum walk passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
