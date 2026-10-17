/**
 * The stall watch (H-495), end to end on the coach's own Forum: agents with tokens and set silences, the Forum page's own
 * watch run and the cron's, then the agents' own connector calls. An agent with 3-minute check-ins silent past 15 minutes and
 * a check-ins-off agent left working past an hour show Paused in amber with the brief's line, one What needs you item each
 * (with Open its session where a session link is set) and a line on Today; one silent for less, a muted one, one with no token,
 * an idle check-ins-off one and an hourly one short of 3 hours never do. A second watch run alerts nothing more. A check-in and
 * a report each clear their stall (the item ticked by the agent, "back at" in the news, Today's line gone); muting ends a
 * stall; the card saves a session link; Coach → Inbox's email switch saves both ways; the cron refuses a call without its
 * secret; and the Forum fits a phone with a Paused card on it.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
let rpcId = 0;
async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  if (res.status !== 200) return { text: await res.text(), isError: true };
  const j = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (j.error) return { text: j.error.message, isError: true };
  return { text: j.result?.content?.[0]?.text ?? "", isError: Boolean(j.result?.isError) };
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { makeAgentToken, agentSettings } = await import("@/lib/handoff");
  const { seedCoachForum } = await import("@/lib/forum");
  const { watchAllForums, watchForum } = await import("@/lib/forum-watch");
  const { stallWords } = await import("@/lib/engine/forum-watch");
  const { formatDateTime } = await import("@/lib/dates");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const cm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const ws = cm.workspaceId;
  const O = { workspaceId: ws, userId: coach.id };
  const tz = cm.timezone || (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, ws) }))!.timezone;
  for (const t of [schema.agentTokens, schema.forumAgents, schema.forumEvents, schema.forumNeeds, schema.forumSettings, schema.handoffAgents]) await db.delete(t).where(and(eq(t.workspaceId, ws), eq(t.userId, coach.id)));
  await db.delete(schema.connectedApps).where(and(eq(schema.connectedApps.workspaceId, ws), eq(schema.connectedApps.userId, coach.id)));
  await seedCoachForum(O);
  const agents = await db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, ws), eq(schema.forumAgents.userId, coach.id)) });
  const agent = (n: string) => agents.find((a) => a.name === n)!;
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const ALL_DAY = { activeFrom: "00:00", activeTo: "23:59", activeDays: [0, 1, 2, 3, 4, 5, 6], tz: "America/Los_Angeles" };
  const SESSION = "https://claude.ai/code/session_walk_stall";
  /** One agent: a token or not, its check-ins, its status and how long since it was last heard from. */
  const setUp = async (name: string, o: { token: boolean; every?: number; status: "working" | "waiting" | "idle"; silent: number; muted?: boolean; session?: string }) => {
    const a = agent(name);
    const token = o.token ? (await makeAgentToken({ ...O, membershipId: cm.id }, a.id))! : null;
    const s = await agentSettings(O, a.id);
    await db.update(schema.handoffAgents).set({ checkins: Boolean(o.every), everyMinutes: o.every ?? 60, ...ALL_DAY, sessionUrl: o.session ?? null, lastCheckinAt: o.every ? ago(o.silent) : null }).where(eq(schema.handoffAgents.id, s.id));
    await db.update(schema.forumAgents).set({ status: o.status, restStatus: null, reportedAt: ago(o.silent), lastCallAt: ago(o.silent), stallMuted: Boolean(o.muted) }).where(eq(schema.forumAgents.id, a.id));
    return { a, token, heard: ago(o.silent) };
  };
  const poller = await setUp("Architectus", { token: true, every: 3, status: "waiting", silent: 20, session: SESSION });
  await db.update(schema.forumAgents).set({ now: "running the gate" }).where(eq(schema.forumAgents.id, poller.a.id));
  await setUp("Hermes", { token: true, every: 3, status: "waiting", silent: 10 });
  await setUp("Orator", { token: true, every: 3, status: "waiting", silent: 120, muted: true });
  await setUp("Porta", { token: false, status: "working", silent: 180 });
  const worker = await setUp("Medicus", { token: true, status: "working", silent: 65 });
  await setUp("Hospes", { token: true, status: "idle", silent: 300 });
  await setUp("Scriba", { token: true, every: 60, status: "waiting", silent: 170 });
  const openNeeds = async (id: string) => (await db.query.forumNeeds.findMany({ where: and(eq(schema.forumNeeds.agentId, id), isNull(schema.forumNeeds.doneAt)) })).length;
  const watchEvents = async (id: string, kind: "stopped" | "back") => (await db.query.forumEvents.findMany({ where: and(eq(schema.forumEvents.agentId, id), eq(schema.forumEvents.source, "watch")) })).filter((e) => e.payload.stall === kind).length;
  const fresh = async (id: string) => (await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, id) }))!;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', "coach@demo.helixos.app");
    await page.fill('input[name="password"]', "demo1234");
    await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
    const card = (name: string) => page.locator('[data-testid="forum-card"]', { has: page.locator(".fo-nm", { hasText: name }) });
    // A card's Edit panel stays open across a save (React keeps it), so open it only when it is shut.
    const openEdit = async (name: string) => {
      const d = card(name).locator("details.fo-edit");
      if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator("summary").click();
    };

    // ── 1. The Forum page's own watch run flags exactly the two that stopped. ──
    await page.goto(`${base}/forum`);
    await page.locator('[data-testid="forum-ledger"]').waitFor({ timeout: 20000 });
    const pausedNames = await page.locator('[data-testid="forum-card"]:has([data-testid="forum-paused"]) .fo-nm').allInnerTexts();
    must(pausedNames.map((n) => n.trim()).sort().join() === "Architectus,Medicus", `Paused on the 3-minute agent past 15 minutes and the working agent past an hour, nobody else: ${pausedNames.join()}`);
    const pollerTime = formatDateTime(poller.heard, tz, { zone: true });
    must((await card("Architectus").locator('[data-testid="forum-stall-line"]').innerText()).trim() === stallWords.card(pollerTime), "the card's line says when it stopped, in the owner's zone, and why");
    must((await card("Architectus").locator('[data-testid="forum-paused"]').innerText()).trim().toLowerCase() === "paused", "the chip reads Paused");
    must((await card("Architectus").locator(".fo-row", { hasText: "running the gate" }).count()) === 1, "Now stays as it was, so you can see what it was in the middle of");
    const need = page.locator('[data-testid="forum-need"]', { hasText: stallWords.need("Architectus", pollerTime) });
    must((await need.count()) === 1, "one What needs you item in the brief's words");
    must((await need.locator('[data-testid="forum-stall-session"]').getAttribute("href")) === SESSION, "it opens the agent's session");
    must((await page.locator('[data-testid="forum-need"]', { hasText: "Medicus stopped at" }).locator('[data-testid="forum-stall-session"]').count()) === 0, "no session link where none is set");
    console.log("✓ the page's watch flags the 3-minute agent past 15 minutes and the working agent past an hour; the line, the item and its session link");

    // ── 2. One alert per stall: a second page run and the cron's run add nothing; the cron refuses a call without its secret. ──
    await page.reload();
    await page.locator('[data-testid="forum-ledger"]').waitFor({ timeout: 20000 });
    // The cron's run covers every Forum in the demo data; this walk reads only the coach's own.
    const cron = await watchAllForums(new Date());
    must(cron.forums >= 1, `the cron's run reaches the coach's Forum: ${JSON.stringify(cron)}`);
    const flaggedNow = (await db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, ws), eq(schema.forumAgents.userId, coach.id)) })).filter((a) => a.stalledAt).map((a) => a.name).sort();
    must(flaggedNow.join() === "Architectus,Medicus", `still the same two flagged after the cron's run: ${flaggedNow.join()}`);
    must((await openNeeds(poller.a.id)) === 1 && (await watchEvents(poller.a.id, "stopped")) === 1, "still one item and one news line for the stall");
    must((await fetch(`${base}/api/cron/forum-watch`)).status === 401, "the cron route refuses a call without its secret");
    for (const n of ["Hermes", "Orator", "Porta", "Hospes", "Scriba"]) must(!(await fresh(agent(n).id)).stalledAt, `${n} is not flagged`);
    console.log("✓ one alert per stall; silent for less, muted, no token, idle and hourly-short-of-3-hours are never flagged; the cron needs its secret");

    // ── 3. Today carries a line for each. ──
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="today-stalled"]').waitFor({ timeout: 20000 });
    const lines = await page.locator('[data-testid="today-stalled-agent"]').allInnerTexts();
    must(lines.length === 2 && lines.some((l) => l.startsWith(`Architectus stopped checking in at ${pollerTime}`)), `Today names each stalled agent: ${lines.join(" | ")}`);
    console.log("✓ Today shows a line for each stalled agent, linking to the Forum");

    // ── 4. Back: a check-in clears one, a report the other. ──
    const checkin = await tool(poller.token!, "handoff_checkin");
    must(!checkin.isError, `the check-in answers: ${checkin.text.slice(0, 120)}`);
    const back = await fresh(poller.a.id);
    must(!back.stalledAt && !back.stallNeedId, "the check-in ends the stall");
    must((await openNeeds(poller.a.id)) === 0, "its item is ticked");
    const ticked = await db.query.forumNeeds.findFirst({ where: eq(schema.forumNeeds.agentId, poller.a.id) });
    must(ticked?.doneBy === "agent", "ticked by the agent, not by Danno");
    must((await watchEvents(poller.a.id, "back")) === 1, "the news says it is back");
    const report = await tool(worker.token!, "forum_report", { agent: "Medicus", status: "waiting", now: "back on the gate" });
    must(!report.isError && !(await fresh(worker.a.id)).stalledAt, `a report ends the other: ${report.text.slice(0, 120)}`);
    await page.goto(`${base}/forum`);
    await page.locator('[data-testid="forum-ledger"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="forum-paused"]').count()) === 0, "no Paused left on the Forum");
    must((await page.locator('[data-testid="forum-need"]', { hasText: "stopped at" }).count()) === 0, "no stall items left");
    must((await page.locator('[data-testid="forum-news"]').innerText()).includes("back at"), "the news shows it back");
    await page.goto(`${base}/today`);
    await page.locator("h1").first().waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="today-stalled"]').count()) === 0, "Today's lines are gone");
    console.log("✓ a check-in and a report each clear their stall: the item ticked by the agent, back at in the news, Today clear");

    // ── 5. Muting ends a stall and keeps it off; the card saves a session link. ──
    await db.update(schema.forumAgents).set({ reportedAt: ago(30), lastCallAt: ago(30), status: "waiting" }).where(eq(schema.forumAgents.id, poller.a.id));
    await db.update(schema.handoffAgents).set({ lastCheckinAt: ago(30) }).where(and(eq(schema.handoffAgents.workspaceId, ws), eq(schema.handoffAgents.agentId, poller.a.id)));
    await page.goto(`${base}/forum`);
    await card("Architectus").locator('[data-testid="forum-paused"]').waitFor({ timeout: 20000 });
    await openEdit("Architectus");
    await submit(page, `[data-forum-card="${poller.a.id}"] [data-testid="forum-mute"]`);
    must((await fresh(poller.a.id)).stallMuted && !(await fresh(poller.a.id)).stalledAt, "Don't watch this agent mutes it and ends the stall");
    must((await card("Architectus").locator('[data-testid="forum-paused"]').count()) === 0, "the card is no longer Paused");
    must((await watchForum(O, new Date())).flagged === 0 && !(await fresh(poller.a.id)).stalledAt, "a muted agent is never flagged");
    await openEdit("Architectus");
    await submit(page, `[data-forum-card="${poller.a.id}"] [data-testid="forum-mute"]`);
    must(!(await fresh(poller.a.id)).stallMuted, "and Watch this agent turns it back on");
    must((await fresh(poller.a.id)).stalledAt, "still silent, so the watch flags it again at once");
    must((await openNeeds(poller.a.id)) === 1, "with one item again, not two");
    await openEdit("Medicus");
    await card("Medicus").locator('[data-testid="forum-session-url"]').fill("https://claude.ai/code/session_walk_medicus");
    await submit(page, `[data-forum-card="${worker.a.id}"] form:has([data-testid="forum-session-url"]) button[type="submit"]`);
    const ms = await db.query.handoffAgents.findFirst({ where: and(eq(schema.handoffAgents.workspaceId, ws), eq(schema.handoffAgents.agentId, worker.a.id)) });
    must(ms?.sessionUrl === "https://claude.ai/code/session_walk_medicus", "the card saves the agent's session link, the one Nudge and the stall item open");
    console.log("✓ muting ends a stall and keeps it off; Watch this agent turns it back on and flags it again; the card saves a session link");

    // ── 6. Coach → Inbox: the email switch, off until turned on. ──
    await page.goto(`${base}/coach/inbox`);
    await page.locator('[data-testid="stall-emails"]').waitFor({ timeout: 20000 });
    const emails = async () => (await db.query.forumSettings.findFirst({ where: and(eq(schema.forumSettings.workspaceId, ws), eq(schema.forumSettings.userId, coach.id)) }))?.stallEmails;
    must((await emails()) === false, "stall emails start off");
    await submit(page, '[data-testid="stall-emails-toggle"]');
    must((await emails()) === true, "Email me when an agent stops turns them on");
    await submit(page, '[data-testid="stall-emails-toggle"]');
    must((await emails()) === false, "and off again");
    console.log("✓ Coach → Inbox: Email me when an agent stops, off by default, saves both ways");

    // ── 7. A phone: the Forum with a Paused card (Architectus, flagged again above) fits the screen. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/forum`);
    await card("Architectus").locator('[data-testid="forum-paused"]').waitFor({ timeout: 20000 });
    must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390 px: nothing wider than the screen");
    await page.screenshot({ path: "screenshots/stall-phone.png", fullPage: false });
    console.log("✓ 390 px: the Forum with a Paused card fits the screen");
    must(!failures.length, `no server errors: ${failures.join(", ")}`);
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
