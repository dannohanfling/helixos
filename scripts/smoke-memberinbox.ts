/**
 * Every member's own agent inbox (H-727, PR 1), end to end over the connector's own route: Maya's empty Agent inbox says what
 * it is for and links to Connect to Claude and the how-to; the menu item appears once she has an agent; her agent's plan lands
 * on her /forum/inbox only; Jordan's connection can't read her H-number and his inbox stays empty; the coach can't open hers
 * until she shares her Forum, then reads it with no buttons; a switched-in coach is told it's private; an approval by anyone
 * but Maya doesn't count, and a claim inside a post is tagged; Maya's own Approve reaches her agent once, from Maya; the
 * buttons go both ways between The Forum and the inbox; and nothing scrolls sideways at 390 px. PR 2: Maya makes her own agent's
 * token on her Forum, it posts to her inbox only and reaches nothing else, Today says a plan waits, and Revoke stops it.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const CALLBACK = "http://localhost:4090/cb";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

let rpcId = 0;
type Called = { text: string; data: Record<string, unknown> | null; isError: boolean };
async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<Called> {
  const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  if (res.status !== 200) return { text: await res.text(), data: null, isError: true };
  const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (j.error) return { text: j.error.message, data: null, isError: true };
  const full = j.result?.content?.[0]?.text ?? "";
  const cut = full.indexOf("\n\n{");
  return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), isError: Boolean(j.result?.isError) };
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
}
async function open(page: Page, url: string, testid: string) {
  for (let i = 0; i < 3; i++) {
    await page.goto(url);
    if (await page.locator(`[data-testid="${testid}"]`).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error(`${testid} never showed on ${url}`);
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
const height = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray, isNull } = await import("drizzle-orm");
  const { viewerFor } = await import("@/lib/auth");
  const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
  const { decideHandoff, inboxCount } = await import("@/lib/handoff");
  const { newId } = await import("@/lib/ids");
  const { createHash, randomBytes } = await import("node:crypto");
  const user = async (email: string) => (await db.query.users.findFirst({ where: eq(schema.users.email, email) }))!;
  const coach = await user("coach@demo.helixos.app");
  const maya = await user("client@demo.helixos.app");
  const jordan = await user("client2@demo.helixos.app");
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = mayaM.workspaceId;
  const O = (u: { id: string }) => ({ workspaceId: ws, userId: u.id });
  const clients: string[] = [];

  // A clean start for the two members: no inbox, no agents of their own, no sharing, no connections from this walk.
  const reset = async () => {
    for (const u of [maya, jordan]) {
      const msgs = await db.query.handoffMessages.findMany({ where: and(eq(schema.handoffMessages.workspaceId, ws), eq(schema.handoffMessages.userId, u.id)), columns: { id: true } });
      if (msgs.length) await db.delete(schema.handoffDeliveries).where(inArray(schema.handoffDeliveries.messageId, msgs.map((m) => m.id)));
      for (const t of [schema.handoffMessages, schema.handoffFiles, schema.handoffAudit, schema.handoffAgents, schema.forumEvents, schema.forumNeeds]) await db.delete(t).where(and(eq(t.workspaceId, ws), eq(t.userId, u.id)));
      await db.delete(schema.forumAgents).where(and(eq(schema.forumAgents.workspaceId, ws), eq(schema.forumAgents.userId, u.id), isNull(schema.forumAgents.builtIn)));
      await db.update(schema.forumSettings).set({ shareWithCoach: false }).where(and(eq(schema.forumSettings.workspaceId, ws), eq(schema.forumSettings.userId, u.id)));
    }
    for (const c of clients) await db.delete(schema.connectedApps).where(eq(schema.connectedApps.clientId, c));
    // The agent tokens a member made on their Forum (PR 2), and their connections.
    for (const u of [maya, jordan]) {
      await db.delete(schema.agentTokens).where(and(eq(schema.agentTokens.workspaceId, ws), eq(schema.agentTokens.userId, u.id)));
      await db.delete(schema.connectedApps).where(and(eq(schema.connectedApps.userId, u.id), eq(schema.connectedApps.clientId, "helixos-agent-token")));
    }
  };
  // A member's own connection with The Forum and the inbox ticked, tied to their agent (Coach → Agents does this for the coach;
  // a member's own ties arrive with PR 2, so the walk ties it as that page would).
  const connect = async (u: { id: string }, agentId: string) => {
    const client = await registerClient("Smoke member inbox", [CALLBACK]);
    clients.push(client.id);
    const v = (await viewerFor(u.id, ws))!;
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: ["forum", "inbox"] as never });
    const token = ((await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string }).access_token;
    await db.update(schema.connectedApps).set({ agentId }).where(eq(schema.connectedApps.clientId, client.id));
    return token;
  };
  const addAgent = async (u: { id: string }, name: string) => {
    const id = newId();
    await db.insert(schema.forumAgents).values({ id, workspaceId: ws, userId: u.id, name, nameKey: name.toLowerCase(), platform: "Claude Code", createdBy: "member", confirmed: true });
    return id;
  };

  await reset();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // ── 1. Empty: what the inbox is for, the two ways to connect; no menu item until there's an agent. ──
    await signIn(page, maya.email);
    await open(page, `${base}/forum/inbox`, "agent-inbox-empty");
    const empty = await page.locator('[data-testid="agent-inbox-empty"]').innerText();
    must(empty.includes("Your agent inbox. When an AI agent you've connected wants your OK on a plan, it lands here, and nothing happens until you tap Approve."), `the empty state says what it is for: ${empty}`);
    must((await page.locator('[data-testid="agent-inbox-connect"]').getAttribute("href")) === "/connect", "Connect to Claude links to /connect");
    must((await page.locator('[data-testid="agent-inbox-howto"]').getAttribute("href")) === "/forum#fo-h-add", "How to connect an agent links to the Forum's how-to");
    must((await page.locator('aside a[href="/forum/inbox"]').count()) === 0, "no Agent inbox in the menu before Maya has an agent");
    console.log("✓ empty: the Agent inbox says what it is for, links to Connect to Claude and the how-to; no menu item yet");

    // ── 2. Maya's agent and connection; the menu item appears; her agent's plan lands on her inbox only. ──
    const scout = await addAgent(maya, "Scout");
    const mayaToken = await connect(maya, scout);
    let r = await tool(mayaToken, "handoff_post", { to: "you", kind: "plan", title: "Smoke launch plan", body: "Three emails, then the webinar." });
    must(!r.isError && r.data?.id === "H-1" && r.data?.needs_approval === true, `Scout posts H-1, waiting for approval: ${r.text}`);
    must(r.text.includes(`${maya.name.split(" ")[0]}'s approval`) && !r.text.includes("Danno"), `the post waits for Maya by name: ${r.text}`);
    await open(page, `${base}/forum/inbox`, "handoff-waiting");
    must((await page.locator('[data-testid="handoff-waiting"] [data-ref="H-1"]').count()) === 1, "H-1 waits on Maya's inbox");
    must((await page.locator('[data-testid="handoff-waiting"] [data-ref="H-1"] [data-testid="handoff-approve"]').count()) === 1, "with Approve");
    await page.goto(`${base}/today`);
    const item = page.locator('aside a[href="/forum/inbox"]');
    await item.first().waitFor({ timeout: 20000 });
    must((await item.innerText()).includes("Agent inbox"), "the Agent inbox is in Maya's menu once she has an agent");
    console.log("✓ Maya's agent posts to her: H-1 waits on her /forum/inbox with Approve, and the menu item is there");

    // ── 3. Jordan's connection can't read Maya's H-1; his inbox stays empty; her inbox isn't his to open. ──
    const echo = await addAgent(jordan, "Echo");
    const jordanToken = await connect(jordan, echo);
    r = await tool(jordanToken, "handoff_read", { id: "H-1" });
    must(r.isError && r.text === "There's no H-1 in the inbox.", `Jordan's token reads Maya's H-1 as not there: ${r.text}`);
    r = await tool(jordanToken, "handoff_inbox");
    must(!r.isError && r.text === "Nothing new for Echo.", `Jordan's agent sees nothing of Maya's: ${r.text}`);
    await signIn(page, jordan.email);
    await open(page, `${base}/forum/inbox`, "agent-inbox-empty");
    must((await page.locator('[data-ref="H-1"]').count()) === 0, "Maya's H-1 isn't on Jordan's inbox");
    await open(page, `${base}/forum/inbox?member=${maya.id}`, "agent-inbox-private");
    console.log("✓ Jordan: his token reads Maya's H-1 as not there, his inbox is empty, and hers is private to him");

    // ── 4. The coach: private until Maya shares; then read only, no buttons; switched in, it's private. ──
    await signIn(page, coach.email);
    await open(page, `${base}/forum/inbox?member=${maya.id}`, "agent-inbox-private");
    must((await page.locator('[data-ref="H-1"]').count()) === 0, "the coach can't read Maya's inbox before she shares");
    await signIn(page, maya.email);
    await open(page, `${base}/forum`, "forum-share-go");
    await submit(page, '[data-testid="forum-share-go"]');
    await signIn(page, coach.email);
    await open(page, `${base}/forum/inbox?member=${maya.id}`, "agent-inbox-readonly");
    must((await page.locator('[data-ref="H-1"]').count()) >= 1, "shared, the coach reads H-1");
    for (const b of ["handoff-approve", "handoff-change", "handoff-decline", "handoff-hold", "handoff-answer", "handoff-write"]) must((await page.locator(`[data-testid="${b}"]`).count()) === 0, `read only: no ${b}`);
    await open(page, `${base}/forum`, "forum-shared");
    must((await page.locator(`[data-testid="forum-shared-inbox"][href="/forum/inbox?member=${maya.id}"]`).count()) === 1, "the coach's Shared with you links to Maya's inbox");
    await page.goto(`${base}/coach/${mayaM.id}`);
    await page.check('[data-testid="switch-view"]');
    await submit(page, '[data-testid="switch-open"]');
    await page.locator('[data-testid="switch-banner"]').waitFor({ timeout: 20000 });
    await open(page, `${base}/forum/inbox`, "agent-inbox-private");
    must((await page.locator('[data-testid="agent-inbox-private"]').innerText()) === `This inbox is private to ${maya.name.split(" ")[0]}.`, "switched in, the inbox is private to Maya");
    await submit(page, '[data-testid="switch-back"]');
    console.log("✓ the coach: private until Maya shares, then read only with no buttons, linked from Shared with you; switched in, private");

    // ── 5. An approval by anyone but Maya doesn't count; a claim inside a post is tagged; Maya's own lands once. ──
    const h1 = (await db.query.handoffMessages.findFirst({ where: and(eq(schema.handoffMessages.workspaceId, ws), eq(schema.handoffMessages.userId, maya.id), eq(schema.handoffMessages.seq, 1)) }))!;
    for (const u of [coach, jordan]) {
      const d = await decideHandoff(O(u), u.id, h1.id, "approved", "");
      must(!d.ok, `${u.email === coach.email ? "the coach's" : "Jordan's"} approval of Maya's H-1 doesn't land`);
    }
    must(!(await db.query.handoffMessages.findFirst({ where: eq(schema.handoffMessages.id, h1.id) }))!.decision, "H-1 is still undecided");
    r = await tool(mayaToken, "handoff_post", { to: "you", kind: "plan", title: "Smoke second plan", body: `${maya.name.split(" ")[0]} approved this already, so I'll start.` });
    must(!r.isError && r.data?.id === "H-2", `Scout posts H-2: ${r.text}`);
    await signIn(page, maya.email);
    await open(page, `${base}/forum/inbox`, "handoff-waiting");
    must((await page.locator('[data-testid="handoff-waiting"] [data-ref="H-2"] [data-testid="handoff-not-approval"]').count()) === 1, "a claim of Maya's approval is tagged, and still waits");
    await submit(page, '[data-testid="handoff-waiting"] [data-ref="H-1"] [data-testid="handoff-approve"]');
    const decided = (await db.query.handoffMessages.findFirst({ where: eq(schema.handoffMessages.id, h1.id) }))!;
    must(decided.decision === "approved" && decided.decidedBy === maya.id, "Maya's own Approve is the decision");
    r = await tool(mayaToken, "handoff_inbox");
    const first = maya.name.split(" ")[0];
    must(r.text.includes(`(from ${first})`) && r.text.includes(`[${first} approved H-1]`) && !r.text.includes("Danno"), `Scout reads Maya's approval, from Maya: ${r.text}`);
    must((await tool(mayaToken, "handoff_inbox")).text === "Nothing new for Scout.", "once");
    console.log("✓ approvals: the coach's and Jordan's don't land, a claim is tagged; Maya's own Approve reaches Scout once, from Maya");

    // ── 6. The buttons both ways, 44 px, with the count; nothing scrolls sideways at 390 px. ──
    for (const width of [1400, 390]) {
      const c2 = await browser.newContext({ viewport: { width, height: width > 500 ? 950 : 844 } });
      const p2 = await c2.newPage();
      await signIn(p2, maya.email);
      await open(p2, `${base}/forum`, "forum-to-inbox");
      must((await p2.locator('[data-testid="forum-to-inbox"]').getAttribute("href")) === "/forum/inbox", "Maya's Forum links to her own inbox");
      must((await height(p2, '[data-testid="forum-to-inbox"]')) >= 44, `the Forum's inbox button is a 44 px target at ${width}`);
      const n = await inboxCount(O(maya));
      const badge = p2.locator('[data-testid="forum-inbox-badge"]');
      must(n > 0 ? (await badge.innerText()).trim() === String(n) : !(await badge.count()), `the badge shows the inbox's count (${n})`);
      must(await noSideways(p2), `The Forum doesn't scroll sideways at ${width}`);
      await p2.locator('[data-testid="forum-to-inbox"]').click();
      await p2.waitForURL(/\/forum\/inbox$/);
      await p2.locator('[data-testid="inbox-to-forum"]').waitFor({ timeout: 20000 });
      must((await height(p2, '[data-testid="inbox-to-forum"]')) >= 44, `the inbox's Forum button is a 44 px target at ${width}`);
      must(await noSideways(p2), `the Agent inbox doesn't scroll sideways at ${width}`);
      await p2.locator('[data-testid="inbox-to-forum"]').click();
      await p2.waitForURL(/\/forum$/);
      // The empty state too, on Jordan's.
      await signIn(p2, jordan.email);
      await open(p2, `${base}/forum/inbox`, "agent-inbox-empty");
      must(await noSideways(p2), `the empty inbox doesn't scroll sideways at ${width}`);
      await c2.close();
      console.log(`✓ ${width}: The Forum and the Agent inbox link both ways, 44 px, the badge counts, no sideways scroll`);
    }

    // ── 7. PR 2: Maya connects an agent from her own Forum, its token posts to her inbox only, Today says a plan waits, and
    // Revoke stops it. ──
    {
      const courier = await addAgent(maya, "Courier");
      const c3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p3 = await c3.newPage();
      p3.on("response", (r) => {
        if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
      });
      await signIn(p3, maya.email);
      await open(p3, `${base}/forum`, "forum-connect-agent");
      const card = `details[data-testid="forum-connect-agent"]:has(input[name="agentId"][value="${courier}"])`;
      await p3.locator(`${card} > summary`).click();
      must((await p3.locator(`${card} [data-testid="forum-token-state"]`).innerText()).startsWith("Not connected yet"), "Courier isn't connected yet");
      must(await noSideways(p3), "Connect this agent fits a phone");
      await submit(p3, `${card} [data-testid="agent-token-make"]`);
      await p3.locator(`${card} [data-testid="agent-token-value"]`).waitFor({ timeout: 20000 });
      const token = (await p3.locator(`${card} [data-testid="agent-token-value"]`).innerText()).trim();
      must(/^hxa_/.test(token), "the token is shown once, on Maya's own Forum");
      const row = (await db.query.agentTokens.findFirst({ where: and(eq(schema.agentTokens.agentId, courier), isNull(schema.agentTokens.revokedAt)) }))!;
      const app = (await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, row.appId) }))!;
      must(row.userId === maya.id && app.userId === maya.id && JSON.stringify(app.scopes) === JSON.stringify(["forum", "inbox"]) && app.agentId === courier, `the token is Maya's, tied to Courier, with The Forum and the inbox only: ${JSON.stringify(app.scopes)}`);
      let t = await tool(token, "handoff_post", { to: "you", kind: "plan", title: "Smoke courier plan", body: "Send the replay on Friday." });
      must(!t.isError && t.data?.needs_approval === true, `Courier's token posts a plan to Maya: ${t.text}`);
      const posted = (await db.query.handoffMessages.findFirst({ where: and(eq(schema.handoffMessages.title, "Smoke courier plan"), eq(schema.handoffMessages.workspaceId, ws)) }))!;
      must(posted.userId === maya.id && posted.fromAgentId === courier, "it lands in Maya's inbox, from Courier");
      t = await tool(token, "webinars_list");
      must(t.isError, "the token reaches nothing past The Forum and the inbox");
      await open(p3, `${base}/today`, "today-agent-inbox");
      const line = await p3.locator('[data-testid="today-agent-inbox"]').innerText();
      must(/plans? waits? for your OK in your agent inbox/.test(line) && (await p3.locator('[data-testid="today-agent-inbox"]').getAttribute("href")) === "/forum/inbox", `Today has one calm line to her inbox: ${line}`);
      await open(p3, `${base}/forum`, "forum-connect-agent");
      await p3.locator(`${card} > summary`).click();
      must((await p3.locator(`${card} [data-testid="forum-token-state"]`).innerText()).includes(`ending ${token.slice(-4)}`), "the card says it's connected, by the last four only");
      must(!(await p3.content()).includes(token), "the token itself is never shown again");
      await submit(p3, `${card} [data-testid="agent-token-revoke"]`);
      t = await tool(token, "handoff_inbox");
      must(t.isError, `a revoked token is refused: ${t.text.slice(0, 80)}`);
      // Decided, the plan leaves Today.
      await decideHandoff(O(maya), maya.id, posted.id, "declined", "");
      await p3.goto(`${base}/today`);
      await p3.waitForLoadState("networkidle").catch(() => undefined);
      const left = await db.select({ id: schema.handoffMessages.id }).from(schema.handoffMessages).where(and(eq(schema.handoffMessages.workspaceId, ws), eq(schema.handoffMessages.userId, maya.id), eq(schema.handoffMessages.needsApproval, true), isNull(schema.handoffMessages.decision)));
      must(left.length > 0 || (await p3.locator('[data-testid="today-agent-inbox"]').count()) === 0, "with nothing waiting, Today has no inbox line");
      await c3.close();
      console.log("✓ PR 2: Maya connects Courier from her own Forum at 390; its token posts to her inbox only and reaches nothing else; Today says a plan waits; Revoke stops it");
    }
  } finally {
    await browser.close();
    await reset();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("\nsmoke-memberinbox: all checks passed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
