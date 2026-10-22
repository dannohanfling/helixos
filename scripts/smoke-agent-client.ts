/**
 * An agent in a client's HelixOS (H-1385, plan H-1389), end to end: the coach allows an agent on Maya's page; the agent's
 * token lists client_switch and the client tools but a client tool is refused until it switches; client_switch by first
 * name; whoami names Maya and work mode; tasks_add makes Maya's task and lands in her Settings as "<agent> (Danno's agent)";
 * a send (dm_log) and HumanOS are refused; the coach's page lists the switch in; Stop ends the switch on the next call;
 * with Maya's coach-work switch off the agent only views; the card fits 390.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page, who: "As the coach" | "As a client") {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
let rpcId = 0;
const rpc = (token: string, method: string, params: Record<string, unknown> = {}) =>
  fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; data: Record<string, unknown> | null; isError: boolean }> {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  if (res.status !== 200) return { text: await res.text(), data: null, isError: true };
  const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (j.error) return { text: j.error.message, data: null, isError: true };
  const full = j.result?.content?.[0]?.text ?? "";
  const cut = full.indexOf("\n\n{");
  return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), isError: Boolean(j.result?.isError) };
}
const listTools = async (token: string) => (((await (await rpc(token, "tools/list")).json()) as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const { makeAgentToken } = await import("@/lib/handoff");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const cm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const W = cm.workspaceId;
  const AGENT = "smoke-agent-client";
  const NAME = "Smoke Hospes";
  const clear = async () => {
    const toks = await db.query.agentTokens.findMany({ where: eq(schema.agentTokens.agentId, AGENT) });
    for (const t of toks) await db.delete(schema.connectedApps).where(eq(schema.connectedApps.id, t.appId));
    await db.delete(schema.agentTokens).where(eq(schema.agentTokens.agentId, AGENT));
    await db.delete(schema.agentClientGrants).where(eq(schema.agentClientGrants.agentId, AGENT));
    await db.delete(schema.coachChanges).where(eq(schema.coachChanges.agentId, AGENT));
    await db.delete(schema.forumAgents).where(eq(schema.forumAgents.id, AGENT));
    await db.delete(schema.handoffAudit).where(eq(schema.handoffAudit.agentId, AGENT));
    await db.delete(schema.tasks).where(and(eq(schema.tasks.userId, maya.id), like(schema.tasks.title, "Smoke agent task%")));
    await db.update(schema.memberships).set({ coachCanWork: true }).where(eq(schema.memberships.id, mm.id));
  };
  await clear();
  await db.insert(schema.forumAgents).values({ id: AGENT, workspaceId: W, userId: coach.id, name: NAME, nameKey: NAME.toLowerCase(), platform: "Claude Code", createdBy: "member", confirmed: true });
  const token = (await makeAgentToken({ workspaceId: W, userId: coach.id, membershipId: cm.id }, AGENT))!;
  const first = maya.name.split(" ")[0];

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  try {
    // ── Before any grant: no switch tools on the token, no client tools either. ──
    let names = await listTools(token);
    must(!names.includes("client_switch") && !names.includes("tasks_add"), `an ungranted agent token has neither the switch nor client tools: ${names.join(", ")}`);

    // ── The coach allows the agent on Maya's page. ──
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${mm.id}`);
    const card = page.locator('[data-testid="client-agents"]');
    await card.waitFor({ timeout: 20000 });
    const row = `[data-testid="client-agent"][data-agent="${NAME}"]`;
    must((await page.locator(row).getAttribute("data-granted")) === "0", "off by default");
    await Promise.all([page.waitForURL(/#agents/, { timeout: 20000 }), page.locator(`${row} [data-testid="client-agent-toggle"]`).click()]);
    await page.waitForLoadState("networkidle");
    must((await page.locator(row).getAttribute("data-granted")) === "1", "Allow grants it");
    console.log("✓ the coach allows the agent on the client's page; off by default");

    // ── The token: the switch and the client tools are listed; a client tool is refused until switched; never HumanOS. ──
    names = await listTools(token);
    must(names.includes("client_switch") && names.includes("client_switch_off") && names.includes("tasks_add") && names.includes("tasks_list"), `granted: the switch and the client tools are on the token: ${names.join(", ")}`);
    must(!names.some((n) => n.startsWith("body_")) && !names.includes("reports_list"), "never HumanOS, never a coach-only tool");
    let r = await tool(token, "tasks_add", { title: "Smoke agent task too early" });
    must(r.isError && /client_switch/.test(r.text), `a client tool before the switch is refused: ${r.text}`);
    r = await tool(token, "whoami");
    must(!r.isError && !/HelixOS:/.test(r.text) && r.text.includes(NAME), `whoami outside: the agent, nobody's HelixOS: ${r.text}`);
    r = await tool(token, "client_switch", { client: "nobody-here" });
    must(!r.isError && /No client of the coach's matches/.test(r.text), `an unknown client: ${r.text}`);
    r = await tool(token, "client_switch", { client: first });
    must(!r.isError && r.text.startsWith(`Working in ${first}'s HelixOS`), `client_switch by first name: ${r.text}`);
    r = await tool(token, "whoami");
    must(!r.isError && r.text.includes(`Working in ${first}'s HelixOS`) && r.text.includes(NAME) && (r.data?.inside as { mode: string })?.mode === "work", `whoami inside names the client and the mode: ${r.text}`);
    console.log("✓ the switch: refused before, by first name after, whoami says whose and which mode; no HumanOS, no coach-only tools");

    // ── A write as the client lands on Maya and in her record under the agent's name; sends are refused. ──
    r = await tool(token, "tasks_add", { title: "Smoke agent task for Maya" });
    must(!r.isError, `tasks_add as the client: ${r.text}`);
    const task = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.title, "Smoke agent task for Maya")) });
    must(Boolean(task), "the task is Maya's");
    // Allow itself is also in her record under the agent; the task's own line is the one with the task's words.
    const change = await db.query.coachChanges.findFirst({ where: and(eq(schema.coachChanges.clientMembershipId, mm.id), eq(schema.coachChanges.agentId, AGENT), eq(schema.coachChanges.action, "Added a task")) });
    must(change?.action === "Added a task" && change.coachUserId === coach.id && change.userId === maya.id, `the change is in Maya's record under the agent: ${JSON.stringify(change)}`);
    r = await tool(token, "dm_log", { person: "Someone Smoke", note: "hi" });
    must(r.isError && /sends or publishes as/.test(r.text) && /inbox/.test(r.text), `a send is refused inside: ${r.text}`);
    r = await tool(token, "tasks_list");
    must(!r.isError && r.text.includes("Smoke agent task for Maya"), `a read inside reads Maya's: ${r.text.slice(0, 120)}`);
    // The agent's own tools stay the agent's: a Forum report lands on the coach's Forum, not Maya's.
    r = await tool(token, "forum_report", { agent: NAME, status: "working", now: "In a client's HelixOS" });
    must(!r.isError, `forum_report inside still works as the agent: ${r.text}`);
    must((await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, AGENT) }))!.now === "In a client's HelixOS", "and lands on the coach's own Forum");
    console.log("✓ inside: a task lands on Maya with the change in her record; a send is refused; reads read Maya; the Forum stays the agent's");

    // ── Maya's Settings names the agent; the coach's page lists the switch in. ──
    await login(page, "As a client");
    await page.goto(`${base}/settings`);
    const line = page.locator('[data-testid="coach-change-agent"]').first();
    await line.waitFor({ timeout: 20000 });
    must((await line.innerText()).includes(`${NAME} (${coach.name.split(" ")[0]}'s agent)`), `Changes by your coach names the agent: ${await line.innerText()}`);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${mm.id}`);
    await page.locator('[data-testid="client-agents"]').waitFor({ timeout: 20000 });
    await page.locator('[data-testid="client-agents"] summary').click();
    must((await page.locator('[data-testid="client-agent-switches"]').innerText()).includes(`${NAME} · In · Working`), "the coach's page lists the agent's switch in");
    console.log("✓ Maya's Settings names the agent as the coach's; the coach's page lists the switch in");

    // ── Stop: the next call is refused, whoami is outside; Allow again with Maya's coach-work off: view only. ──
    await Promise.all([page.waitForURL(/#agents/, { timeout: 20000 }), page.locator(`${row} [data-testid="client-agent-toggle"]`).click()]);
    await page.waitForLoadState("networkidle");
    must((await page.locator(row).getAttribute("data-granted")) === "0", "Stop revokes");
    r = await tool(token, "tasks_add", { title: "Smoke agent task after stop" });
    must(r.isError && !(await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.title, "Smoke agent task after stop")) })), `after Stop a client tool does nothing: ${r.text}`);
    r = await tool(token, "whoami");
    must(!r.isError && !/HelixOS:/.test(r.text), `whoami is outside after Stop: ${r.text}`);
    await db.update(schema.memberships).set({ coachCanWork: false }).where(eq(schema.memberships.id, mm.id));
    await page.goto(`${base}/coach/${mm.id}`);
    await page.locator('[data-testid="client-agents"]').waitFor({ timeout: 20000 });
    await Promise.all([page.waitForURL(/#agents/, { timeout: 20000 }), page.locator(`${row} [data-testid="client-agent-toggle"]`).click()]);
    await page.waitForLoadState("networkidle");
    r = await tool(token, "client_switch", { client: first });
    must(!r.isError && r.text.startsWith(`Viewing ${first}'s HelixOS`), `with the client's coach-work switch off the agent views: ${r.text}`);
    r = await tool(token, "tasks_add", { title: "Smoke agent task in view" });
    must(r.isError && /coach-work switch is off/.test(r.text), `a write in view is refused: ${r.text}`);
    r = await tool(token, "tasks_list");
    must(!r.isError, "a read in view works");
    r = await tool(token, "client_switch_off");
    must(!r.isError && /Out of/.test(r.text), `client_switch_off: ${r.text}`);
    console.log("✓ Stop ends it on the next call; with the client's coach-work switch off the agent only views; switch off comes back out");

    // ── 390: the card fits. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/coach/${mm.id}`);
    await page.locator('[data-testid="client-agents"]').waitFor({ timeout: 20000 });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    must(wide <= 390, `the client page fits a phone: ${wide}px wide`);
    console.log("✓ the card fits 390");
  } finally {
    await browser.close();
    await clear();
  }
  if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
  console.log("The agent-in-a-client's-HelixOS walk passed");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
