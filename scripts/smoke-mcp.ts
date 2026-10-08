/**
 * The MCP server's OAuth core (rev 224, M1):
 *  1. A client registers itself (https only; localhost in development), the metadata documents say where everything is, and
 *     the MCP route without a token answers 401 with the pointer to them.
 *  2. The member sees the consent screen (the app's name and its domain, the scopes, Body never pre-ticked), ticks one scope
 *     and connects; the code goes back to the app's registered address, once, and only with the right PKCE verifier.
 *  3. Over the MCP route: the tools listed are the grant's, `whoami` answers as the member, the call is in the audit log,
 *     and Settings lists the app.
 *  4. Refresh rotates; a refresh token used twice ends the grant. Disconnect in Settings ends it at once.
 *  5. The coach's "open to clients" switch cuts a client's connection and refuses new consent; a coach switched into a client
 *     can't connect for them.
 */
import { createHash, randomBytes } from "node:crypto";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const CALLBACK = "http://localhost:4090/cb";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
// A hash-only change is no navigation to the browser, so Settings is always asked for afresh with a new query.
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
const form = (body: Record<string, string>) => fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
let rpcId = 0;
const rpc = (token: string, method: string, params: unknown = {}) =>
  fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
const initialize = (token: string) => rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "walk", version: "1" } });

/** The full consent round for the signed-in member: the code comes back on the return page's link. */
async function consent(page: Page, clientId: string, scope: string, tick: string[], challenge: string): Promise<{ code: string; state: string }> {
  const state = randomBytes(8).toString("hex");
  const u = new URL(`${base}/oauth/authorize`);
  for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: CALLBACK, response_type: "code", scope, state, code_challenge: challenge, code_challenge_method: "S256", resource: `${base}/api/mcp` })) u.searchParams.set(k, v);
  await page.goto(u.toString());
  await page.locator('[data-testid="consent"]').waitFor({ timeout: 20000 });
  for (const s of scope.split(" ")) {
    const box = page.locator(`[data-testid="consent-scope-${s}"] input`);
    if (!(await box.count())) continue;
    if (tick.includes(s)) await box.check();
    else await box.uncheck();
  }
  await submit(page, '[data-testid="consent-approve"]');
  // The return page sends the browser on by script to the app's address, which this walk answers itself (page.route below).
  await page.waitForURL(/localhost:4090\/cb/, { timeout: 15000 });
  const href = page.url();
  const r = new URL(href);
  if (!href.startsWith(CALLBACK) || r.searchParams.get("state") !== state) throw new Error(`the code goes back to the registered address with the state untouched: ${href}`);
  return { code: r.searchParams.get("code") ?? "", state };
}

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await browser.newPage();
    // The registered app: nothing listens on 4090, so the walk answers its callback with a blank page and reads the address.
    await page.route("http://localhost:4090/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>app</title>ok" }));
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const client = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const clientM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, client.id) }))!;

    // ── 1. Registration and metadata. ──
    let r = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Walk connector", redirect_uris: ["http://evil.example/cb"] }) });
    if (r.status !== 400) throw new Error(`a plain-http redirect elsewhere is refused: ${r.status}`);
    r = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Walk connector", redirect_uris: [CALLBACK] }) });
    if (r.status !== 201) throw new Error(`registration answers 201: ${r.status} ${await r.text()}`);
    const reg = (await r.json()) as { client_id: string; token_endpoint_auth_method: string };
    if (!reg.client_id.startsWith("mcpc_") || reg.token_endpoint_auth_method !== "none") throw new Error("a public client with an id");
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    if (as.token_endpoint !== `${base}/oauth/token` || !(as.code_challenge_methods_supported as string[]).includes("S256") || (as.code_challenge_methods_supported as string[]).includes("plain")) throw new Error(`the server metadata: ${JSON.stringify(as)}`);
    const pr = (await (await fetch(`${base}/.well-known/oauth-protected-resource/api/mcp`)).json()) as Record<string, unknown>;
    if (pr.resource !== `${base}/api/mcp` || (pr.authorization_servers as string[])[0] !== base) throw new Error(`the resource metadata: ${JSON.stringify(pr)}`);
    r = await rpc("", "initialize");
    if (r.status !== 401 || !(r.headers.get("www-authenticate") ?? "").includes("resource_metadata=")) throw new Error(`no token is 401 with the pointer: ${r.status} ${r.headers.get("www-authenticate")}`);
    console.log("✓ a client registered (https only), both metadata documents, and 401 with the resource metadata pointer");

    // ── 2. Consent, the code, the exchange. ──
    await login(page, "As a client");
    const k1 = pkce();
    const u = new URL(`${base}/oauth/authorize`);
    for (const [k, v] of Object.entries({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "today tasks body", state: "s1", code_challenge: k1.challenge, code_challenge_method: "S256" })) u.searchParams.set(k, v);
    await page.goto(u.toString());
    await page.locator('[data-testid="consent"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="consent-app"]').innerText()) !== "Walk connector" || (await page.locator('[data-testid="consent-host"]').innerText()) !== "localhost:4090") throw new Error("the consent screen names the app and its domain");
    if (!(await page.locator('[data-testid="consent-scope-today"] input').isChecked()) || !(await page.locator('[data-testid="consent-scope-tasks"] input').isChecked())) throw new Error("asked scopes are ticked");
    const bodyBox = page.locator('[data-testid="consent-scope-body"] input');
    if ((await bodyBox.count()) && (await bodyBox.isChecked())) throw new Error("Body is never pre-ticked");
    // An unregistered redirect: an error here, no redirect anywhere.
    await page.goto(`${base}/oauth/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("http://localhost:4090/other")}&response_type=code&code_challenge=${k1.challenge}&code_challenge_method=S256`);
    if (!(await page.locator('[data-testid="consent-refused"]').count()) || !page.url().includes("/oauth/authorize")) throw new Error("an unregistered redirect is refused on the page, never redirected");
    const { code } = await consent(page, reg.client_id, "today tasks body", ["tasks"], k1.challenge);
    if (!code.startsWith("mcpx_")) throw new Error("a code came back");
    r = await form({ grant_type: "authorization_code", code, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier-wrong", client_id: reg.client_id, redirect_uri: CALLBACK });
    if (r.status !== 400 || ((await r.json()) as { error: string }).error !== "invalid_grant") throw new Error("a wrong verifier is invalid_grant");
    r = await form({ grant_type: "authorization_code", code, code_verifier: k1.verifier, client_id: reg.client_id, redirect_uri: CALLBACK, resource: `${base}/api/mcp` });
    if (r.status !== 200 || r.headers.get("cache-control") !== "no-store") throw new Error(`the exchange: ${r.status} ${await r.text()}`);
    let tok = (await r.json()) as { access_token: string; refresh_token: string; scope: string; token_type: string; expires_in: number };
    if (tok.scope !== "tasks" || tok.token_type !== "Bearer" || tok.expires_in !== 3600 || !tok.access_token.startsWith("mcpa_") || !tok.refresh_token.startsWith("mcpr_")) throw new Error(`the token pair with the ticked scope only: ${JSON.stringify(tok)}`);
    r = await form({ grant_type: "authorization_code", code, code_verifier: k1.verifier, client_id: reg.client_id, redirect_uri: CALLBACK });
    if (r.status !== 400) throw new Error("a code is single use");
    r = await rpc(tok.access_token, "initialize");
    if (r.status !== 401) throw new Error("a second use of the code revokes what the first issued");
    console.log("✓ consent: app and domain shown, Body unticked, an unregistered redirect refused; the code exchanged once with PKCE, a reuse revoking the grant");

    // ── 3. A fresh grant, the MCP route, the audit, Settings. ──
    const k2 = pkce();
    const c2 = await consent(page, reg.client_id, "today tasks", ["today", "tasks"], k2.challenge);
    tok = (await (await form({ grant_type: "authorization_code", code: c2.code, code_verifier: k2.verifier, client_id: reg.client_id, redirect_uri: CALLBACK })).json()) as typeof tok;
    r = await initialize(tok.access_token);
    if (r.status !== 200) throw new Error(`initialize: ${r.status} ${await r.text()}`);
    const init = (await r.json()) as { result?: { serverInfo?: { name?: string } } };
    if (init.result?.serverInfo?.name !== "HelixOS") throw new Error(`the server names itself: ${JSON.stringify(init)}`);
    const list = (await (await rpc(tok.access_token, "tools/list")).json()) as { result?: { tools?: { name: string }[] } };
    const names = (list.result?.tools ?? []).map((t) => t.name);
    if (!names.includes("whoami") || names.some((n) => n.includes("."))) throw new Error(`tools listed: ${names.join(", ")}`);
    const call = (await (await rpc(tok.access_token, "tools/call", { name: "whoami", arguments: {} })).json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
    const text = call.result?.content?.[0]?.text ?? "";
    if (call.result?.isError || !text.includes(client.name) || !text.includes("(client)")) throw new Error(`whoami answers as the member: ${JSON.stringify(call)}`);
    const audit = await db.query.mcpCalls.findMany({ where: eq(schema.mcpCalls.userId, client.id) });
    if (!audit.some((a) => a.tool === "whoami" && a.ok)) throw new Error("the call is in the audit log");
    await page.goto(`${base}/settings?at=${Date.now()}#connected-apps`);
    const row = page.locator('[data-testid="connected-app"]');
    if ((await row.count()) !== 1 || (await row.getAttribute("data-scopes")) !== "today tasks" || !(await row.innerText()).includes("whoami")) throw new Error(`Settings lists the app with its scopes and last tool: ${await row.count()}`);
    console.log("✓ over the MCP route: initialize, the grant's tools (no dots), whoami as the member, the audit row, the app in Settings");

    // ── 3b. The business tools (rev 380 steps 1 to 3): each called over the route as the member, each checked in the database. ──
    {
      const { and, desc } = await import("drizzle-orm");
      type Called = { text: string; data: Record<string, unknown> | null; isError: boolean };
      const callTool = async (name: string, args: Record<string, unknown>): Promise<Called> => {
        const res = (await (await rpc(tok.access_token, "tools/call", { name, arguments: args })).json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
        const full = res.result?.content?.[0]?.text ?? "";
        const cut = full.indexOf("\n\n{");
        return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), isError: Boolean(res.result?.isError) };
      };
      const listed = new Set(names);
      for (const n of ["tasks_list", "tasks_add", "tasks_complete", "tasks_uncomplete", "tasks_reschedule", "today_lockin", "today_lock_in", "today_close"]) if (!listed.has(n)) throw new Error(`a grant of today and tasks lists ${n}`);
      if (names.some((n) => n.startsWith("body_"))) throw new Error("a grant without the body scope lists no HumanOS tool");
      const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? "";
      if (!today) throw new Error(`whoami names today's date: ${text}`);
      const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const taskNamed = (title: string) => db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, client.id), eq(schema.tasks.title, title)), orderBy: desc(schema.tasks.createdAt) });
      const logToday = () => db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, client.id), eq(schema.dailyLogs.date, today)) });

      const T1 = "Walk: send the replay to three leads";
      let c = await callTool("tasks_add", { title: T1, category: "sales" });
      const t1 = await taskNamed(T1);
      if (c.isError || !t1 || t1.dueDate !== today || t1.status !== "today" || (c.data?.created as boolean) !== true) throw new Error(`tasks_add makes the task, due today: ${c.text}`);
      c = await callTool("tasks_add", { title: T1 });
      if ((c.data?.created as boolean) !== false || (await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, client.id), eq(schema.tasks.title, T1)) })).length !== 1) throw new Error(`the same title twice at once is one task, as on the page: ${c.text}`);
      c = await callTool("tasks_list", {});
      if (c.isError || !c.text.includes(T1) || !Array.isArray(c.data?.dueToday)) throw new Error(`tasks_list shows it among today's: ${c.text}`);

      const before = await logToday();
      const T2 = "Walk: a task said out loud";
      c = await callTool("today_lock_in", { top3: ["send the replay", T2], energy: "Bright", commitment: "Three real conversations before noon" });
      const log = await logToday();
      const t2 = await taskNamed(T2);
      const t1b = await taskNamed(T1);
      if (c.isError || !log?.morningDoneAt || log.energy !== 4 || log.intention !== "Three real conversations before noon") throw new Error(`today_lock_in writes the day's log: ${c.text}`);
      if (!t2 || t2.focusDate !== today || t2.urgency !== "top3" || t1b?.focusDate !== today) throw new Error(`the Top 3: the open task by its words, and a new one for the title that matched nothing: ${c.text}`);
      if (before?.morningDoneAt ? !c.text.includes("it replaced") : !c.text.includes("+10 points")) throw new Error(`a first lock-in scores, a redo says what it replaced: ${c.text}`);
      c = await callTool("today_lock_in", { top3: [T2], energy: 2 });
      if (!c.text.includes("it replaced energy Bright") || !c.text.includes("No points this time") || (await taskNamed(T1))?.focusDate !== null) throw new Error(`a redo says what it replaced, scores nothing, and un-stars what it dropped: ${c.text}`);
      c = await callTool("today_lockin", {});
      if (c.isError || c.data?.lockedIn !== true || c.data?.energy !== "Slow" || !c.text.includes(T2)) throw new Error(`today_lockin reads the lock-in back: ${c.text}`);

      c = await callTool("tasks_complete", { title: "said out loud" });
      const done = await taskNamed(T2);
      const ledger = await db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, client.id), eq(schema.pointsLedger.refId, done?.id ?? "")) });
      if (c.isError || done?.status !== "done" || !ledger || !c.text.includes(`+${ledger.points} points`)) throw new Error(`tasks_complete ticks it and scores once: ${c.text}`);
      c = await callTool("tasks_uncomplete", { title: T2 });
      if (c.isError || (await taskNamed(T2))?.status !== "today") throw new Error(`tasks_uncomplete puts it back on today: ${c.text}`);
      c = await callTool("tasks_complete", { title: T2 });
      if (!c.text.includes("already scored") || (await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, client.id), eq(schema.pointsLedger.refId, done!.id)) })).length !== 1) throw new Error(`ticked again, it scores nothing more: ${c.text}`);
      c = await callTool("tasks_reschedule", { title: T1 });
      const moved = await taskNamed(T1);
      if (c.isError || moved?.dueDate !== tomorrow || moved.status !== "upcoming") throw new Error(`tasks_reschedule moves it to tomorrow: ${c.text}`);
      // Two open tasks carry the same words: the tool refuses and names both, never ticking either.
      await callTool("tasks_add", { title: "Walk: a second task with the same words" });
      c = await callTool("tasks_complete", { title: "Walk:" });
      if (!c.isError || !/2 match it/.test(c.text) || !c.text.includes(T1) || (await taskNamed(T1))?.status === "done") throw new Error(`words that fit two tasks are refused with the titles to pick from: ${c.text}`);

      const cashBefore = (await logToday())?.cashCollected ?? 0;
      c = await callTool("today_close", { dms_started: 12, conversations: 5, cash_collected: cashBefore + 500, win: "Booked two calls by voice" });
      const closed = await logToday();
      if (c.isError || !closed?.eveningDoneAt || closed.dmsStarted !== 12 || closed.conversations !== 5 || closed.cashCollected !== cashBefore + 500 || closed.win !== "Booked two calls by voice") throw new Error(`today_close writes the close: ${c.text}`);
      if (!/collected/.test(c.text) || !c.data?.month) throw new Error(`the close answers with the month's cash: ${c.text}`);
      c = await callTool("today_close", { calls_booked: 2 });
      const again = await logToday();
      if (again?.dmsStarted !== 12 || again.callsBooked !== 2 || again.win !== "Booked two calls by voice" || !c.text.startsWith("Updated")) throw new Error(`a second close changes only what was said and keeps the rest: ${c.text}`);
      const calls = await db.query.mcpCalls.findMany({ where: eq(schema.mcpCalls.userId, client.id) });
      for (const n of ["tasks_add", "tasks_list", "today_lock_in", "today_lockin", "tasks_complete", "tasks_uncomplete", "tasks_reschedule", "today_close"]) if (!calls.some((a) => a.tool === n && a.ok)) throw new Error(`the audit log has ${n}`);
      if (!calls.some((a) => a.tool === "tasks_complete" && !a.ok)) throw new Error("the refused call is in the audit log as not ok");
      await page.goto(`${base}/today`);
      await page.getByText(T2).first().waitFor({ timeout: 20000 });
      console.log("✓ the business tools over the route: a task added (a double tap is one), listed, locked into the Top 3 by its words with a new one made, a redo saying what it replaced, ticked and scored once, un-ticked, moved, ambiguous words refused; the day closed and corrected; every call audited; Today shows it");
    }

    // ── 4. Refresh rotation, reuse, Disconnect. ──
    r = await form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id });
    if (r.status !== 200) throw new Error(`refresh: ${r.status} ${await r.text()}`);
    const tok2 = (await r.json()) as typeof tok;
    if (tok2.access_token === tok.access_token || tok2.refresh_token === tok.refresh_token) throw new Error("refresh rotates both tokens");
    if ((await rpc(tok.access_token, "initialize")).status !== 401) throw new Error("the old access token is dead after a refresh");
    if ((await initialize(tok2.access_token)).status !== 200) throw new Error("the new access token works");
    r = await form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id });
    if (r.status !== 400) throw new Error("the old refresh token, used again, is refused");
    if ((await initialize(tok2.access_token)).status !== 401) throw new Error("a refresh token seen twice ends the whole grant");
    await page.goto(`${base}/settings?at=${Date.now()}#connected-apps`);
    if (await page.locator('[data-testid="connected-app"]').count()) throw new Error("the revoked grant is off the list");
    // A new grant, cut from Settings.
    const k3 = pkce();
    const c3 = await consent(page, reg.client_id, "today", ["today"], k3.challenge);
    const tok3 = (await (await form({ grant_type: "authorization_code", code: c3.code, code_verifier: k3.verifier, client_id: reg.client_id, redirect_uri: CALLBACK })).json()) as typeof tok;
    if ((await initialize(tok3.access_token)).status !== 200) throw new Error("the third grant works");
    await page.goto(`${base}/settings?at=${Date.now()}#connected-apps`);
    await submit(page, '[data-testid="app-disconnect"]');
    await page.waitForURL(/apps=disconnected/);
    if ((await initialize(tok3.access_token)).status !== 401) throw new Error("Disconnect ends access at once");
    r = await fetch(`${base}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${encodeURIComponent(tok3.refresh_token)}` });
    if (r.status !== 200) throw new Error("the revoke endpoint answers 200 for a token already dead");
    await logout(page);
    console.log("✓ refresh rotates and a reuse revokes; Disconnect cuts access at once; the revoke endpoint answers 200");

    // ── 5. The coach's switch, and a switched-in coach. ──
    await login(page, "As a client");
    const k4 = pkce();
    const c4 = await consent(page, reg.client_id, "today", ["today"], k4.challenge);
    const tok4 = (await (await form({ grant_type: "authorization_code", code: c4.code, code_verifier: k4.verifier, client_id: reg.client_id, redirect_uri: CALLBACK })).json()) as typeof tok;
    if ((await initialize(tok4.access_token)).status !== 200) throw new Error("the client's grant works while open");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/settings?at=${Date.now()}#connected-apps`);
    // The page streams and then lands its hash: let it settle before the click, or the click lands on a moving box.
    await page.locator('[data-testid="apps-open-toggle"]').waitFor({ timeout: 20000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await page.locator('[data-testid="apps-open-toggle"]').uncheck();
    await submit(page, '[data-testid="apps-open-save"]');
    await page.waitForURL(/apps=closed/);
    if ((await initialize(tok4.access_token)).status !== 401) throw new Error("closing the switch cuts a client's existing connection");
    // The coach's own connection is unaffected by the switch.
    const k5 = pkce();
    const c5 = await consent(page, reg.client_id, "today", ["today"], k5.challenge);
    const tok5 = (await (await form({ grant_type: "authorization_code", code: c5.code, code_verifier: k5.verifier, client_id: reg.client_id, redirect_uri: CALLBACK })).json()) as typeof tok;
    const who = (await (await rpc(tok5.access_token, "tools/call", { name: "whoami", arguments: {} })).json()) as { result?: { content?: { text: string }[] } };
    if (!(who.result?.content?.[0]?.text ?? "").includes("(coach)")) throw new Error("the coach connects as the coach");
    // Switched into the client: consent is refused.
    await page.goto(`${base}/coach/${clientM.id}`);
    await submit(page, '[data-testid="switch-view"]');
    await page.goto(u.toString());
    if ((await page.locator('[data-testid="consent-refused"]').getAttribute("data-state")) !== "switched") throw new Error("a coach switched into a client can't connect for them");
    await submit(page, '[data-testid="switch-back"]');
    await page.goto(`${base}/settings?at=${Date.now()}#connected-apps`);
    await page.locator('[data-testid="apps-open-toggle"]').check();
    await submit(page, '[data-testid="apps-open-save"]');
    await page.waitForURL(/apps=open/);
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/connect`);
    if (!(await page.locator('[data-testid="connect-url"]').innerText()).includes("/api/mcp")) throw new Error("the help page shows the address");
    await logout(page);
    console.log("✓ the coach's switch cuts clients' connections and refuses new consent; the coach connects as the coach; a switched-in coach can't connect for a client");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("MCP smoke passed");
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
