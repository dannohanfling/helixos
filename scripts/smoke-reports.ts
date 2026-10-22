/**
 * "I have an issue or a suggestion" and the coach's inbox (rev 432 items 2 to 4): a client sends an issue with a screenshot from
 * Today (shrunk in the browser, checked by its bytes, kept private under reports/), an Ask Danno answer from Tasks with the
 * wish to talk, and an idea from More; a picture that isn't one is refused in words. The coach sees the counts in the menu, on
 * the Coach page and on Today, the inbox newest first with the screenshot, Seen and Done; only the coach and the sender can open
 * the screenshot. New monthly feedback is counted until the coach opens Monthly feedback. A coach switched into a client has no
 * button. Against scripts/mock-blob.ts on :4050 (dev-server.sh sets the store's tokens).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";

const base = process.argv[2] ?? "http://localhost:3000";
const blob = "http://localhost:4050";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function loginAs(page: Page, email: string) {
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
async function fillChecked(page: Page, selector: string, value: string) {
  for (let i = 0; i < 6; i++) {
    await page.locator(selector).fill(value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector}`);
}
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

const DRAFT = "Done: the broken button is fixed. It now saves on the first tap. Thanks for flagging it!";

async function main() {
  const { db, schema } = await import("@/db");
  const { and, desc, eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const up = await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const coachU = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = mayaM.workspaceId;
    const coachFirst = coachU.name.split(" ")[0];
    const reports = () => db.query.memberReports.findMany({ where: eq(schema.memberReports.workspaceId, ws), orderBy: desc(schema.memberReports.createdAt) });
    must((await reports()).length === 0, "no reports to begin with");
    const png = await sharp({ create: { width: 2400, height: 1500, channels: 3, background: { r: 30, g: 110, b: 200 } } }).png().toBuffer();

    // ── 1. A client: an issue with a screenshot from Today; a picture that isn't one refused in words. ──
    await login(page, "As a client");
    await page.locator('[data-testid="report-open"]').first().click();
    const dialog = page.locator('dialog[open][data-testid="report-dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    must((await dialog.innerText()).includes(`Tell ${coachFirst}`), "the dialog names the coach");
    // H-1656: My reports is a clear button at the top of the panel, before the form, with no count while nothing is new.
    const myBtn = dialog.locator('[data-testid="report-form-my-reports"]');
    const myBox = (await myBtn.boundingBox())!;
    const kindBox = (await dialog.locator('[data-testid="report-kind-issue"]').boundingBox())!;
    must(myBox.height >= 36 && myBox.y < kindBox.y && (await myBtn.innerText()).trim().endsWith("My reports"), `My reports is a button above the form: ${JSON.stringify(myBox)} "${await myBtn.innerText()}"`);
    must((await dialog.innerText()).includes("The page you're on goes with it: /today"), "the page it came from is shown and goes with it");
    await page.locator('dialog[open] [data-testid="report-screenshot"]').setInputFiles({ name: "not-a-picture.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
    await dialog.getByText("That picture couldn't be read").waitFor({ timeout: 10000 });
    await page.locator('dialog[open] [data-testid="report-kind-issue"]').check();
    await page.locator('dialog[open] [data-testid="report-severity-red"]').check();
    const ISSUE = "The Save button on the month card did nothing on my phone, twice.";
    await fillChecked(page, 'dialog[open] [data-testid="report-description"]', ISSUE);
    await page.locator('dialog[open] [data-testid="report-screenshot"]').setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: png });
    await page.locator('dialog[open] [data-testid="report-preview"]').waitFor({ timeout: 10000 });
    await page.locator('dialog[open] [data-testid="report-send"]').click();
    await page.locator('dialog[open] [data-testid="report-sent"]').waitFor({ timeout: 20000 });
    must((await page.locator('dialog[open] [data-testid="report-sent"]').innerText()).includes("The screenshot went with it"), "the sent panel says the screenshot went");
    const seeIt = page.locator('dialog[open] [data-testid="report-my-reports"]');
    must((await seeIt.innerText()).trim() === "See it in My reports" && /\bbtn\b/.test((await seeIt.getAttribute("class")) ?? ""), "the thank-you has a See it in My reports button");
    const issue = (await reports())[0];
    must(issue && issue.kind === "issue" && issue.severity === "red" && issue.description === ISSUE && issue.page === "/today" && issue.userId === maya.id, `the issue is stored as sent: ${JSON.stringify(issue)}`);
    must(issue.screenshotKey === `reports/${ws}/${issue.id}.jpg` && issue.screenshotType === "image/jpeg", "the screenshot was shrunk to a JPEG and kept under reports/");
    const stored = ((await (await fetch(`${blob}/__list`)).json()) as { objects: { pathname: string; access: string; size: number }[] }).objects.find((o) => o.pathname === issue.screenshotKey);
    must(stored && stored.access === "private" && stored.size < 950_000 && stored.size > 1000, `the picture is in the private store, under the size a form may send: ${JSON.stringify(stored)}`);
    await page.locator('dialog[open] button:has-text("Close")').click();
    console.log("✓ an issue from Today with a screenshot: shrunk in the browser, checked by its bytes, private under reports/; a picture that isn't one refused in words");

    // ── 2. An Ask Danno answer from Tasks, with the wish to talk; an idea from More. ──
    await page.goto(`${base}/tasks`);
    await page.locator('[data-testid="report-open"]').first().click();
    // Docket #2: Start over clears what was typed and the kind; the form stays open for a fresh go.
    await page.locator('dialog[open] [data-testid="report-kind-suggestion"]').check();
    await fillChecked(page, 'dialog[open] [data-testid="report-description"]', "Half a thought");
    await page.locator('dialog[open] [data-testid="report-start-over"]').click();
    must((await page.locator('dialog[open] [data-testid="report-description"]').inputValue()) === "" && (await page.locator('dialog[open] [data-testid="report-kind-issue"]').isChecked()), "Start over clears the form and goes back to an issue");
    await page.locator('dialog[open] [data-testid="report-kind-ask_danno"]').check();
    await page.locator('dialog[open] [data-testid="report-severity-orange"]').check();
    await fillChecked(page, 'dialog[open] [data-testid="report-question"]', "How many rungs should a comment ladder have?");
    await fillChecked(page, 'dialog[open] [data-testid="report-answer"]', "Twelve, always.");
    await page.locator('dialog[open] [data-testid="report-talk"]').check();
    await page.locator('dialog[open] [data-testid="report-send"]').click();
    await page.locator('dialog[open] [data-testid="report-sent"]').waitFor({ timeout: 20000 });
    const ask = (await reports())[0];
    must(ask.kind === "ask_danno" && ask.page === "/tasks" && ask.question === "How many rungs should a comment ladder have?" && ask.answer === "Twelve, always." && ask.talkToCoach === true && !ask.screenshotKey, `the Ask Danno answer is stored with the wish to talk: ${JSON.stringify(ask)}`);
    await page.goto(`${base}/more`);
    await page.locator('[data-testid="report-open"]').first().click();
    await page.locator('dialog[open] [data-testid="report-kind-suggestion"]').check();
    await page.locator('dialog[open] [data-testid="report-severity-green"]').check();
    await fillChecked(page, 'dialog[open] [data-testid="report-description"]', "A dark mode for late nights.");
    await page.locator('dialog[open] [data-testid="report-send"]').click();
    await page.locator('dialog[open] [data-testid="report-sent"]').waitFor({ timeout: 20000 });
    must((await reports())[0].kind === "suggestion" && (await reports())[0].page === "/more", "the idea from More is stored");
    must((await reports()).length === 3, "three reports in all");
    await logout(page);
    console.log("✓ an Ask Danno answer from Tasks with the question, the answer and the wish to talk; an idea from More");

    // ── 3. New monthly feedback, sent as a member would, before the coach looks. ──
    const month = new Date().toISOString().slice(0, 7);
    await db.delete(schema.monthlyFeedback).where(and(eq(schema.monthlyFeedback.userId, jordan.id), eq(schema.monthlyFeedback.month, month)));
    await db.insert(schema.monthlyFeedback).values({ id: newId(), workspaceId: ws, userId: jordan.id, month, proud: "Booking my first two calls.", love: "The lock-in.", less: "Nothing.", more: "Office Hours.", wow: "The deck.", referralScore: 9, favorite: "The community." });
    const coachM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coachU.id) }))!;
    await db.update(schema.memberships).set({ feedbackSeenAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(schema.memberships.id, coachM.id));

    // ── 4. The coach: counts in the menu, on Today and on the Coach page; the inbox; Seen and Done; the screenshot. ──
    await login(page, "As the coach");
    must((await page.locator('aside a[href="/coach/reports"]').innerText()).includes("3"), "the menu counts three issues and ideas");
    must((await page.locator('[data-testid="coach-new-reports"]').innerText()).includes("3 new issues and ideas"), "Today says three new issues and ideas");
    must((await page.locator('[data-testid="coach-new-feedback"]').innerText()).includes("1 new monthly feedback"), "Today says one new monthly feedback");
    must(!(await page.locator('[data-testid="report-open"]').count()), "the coach has the inbox, not the button");
    await page.goto(`${base}/coach?connections=open`);
    must((await page.locator('[data-testid="coach-reports-new"]').innerText()) === "3 new" && (await page.locator('[data-testid="coach-feedback-new"]').innerText()) === "1 new", "the Coach page counts both");
    await page.goto(`${base}/coach/reports`);
    const rows = page.locator('[data-testid="report-row"]');
    await rows.first().waitFor({ timeout: 20000 });
    must((await rows.count()) === 3, "three in the inbox");
    must((await rows.nth(0).getAttribute("data-kind")) === "suggestion" && (await rows.nth(2).getAttribute("data-kind")) === "issue", "newest first");
    const issueRow = page.locator(`#r-${issue.id} [data-testid="report-row"]`);
    must((await issueRow.innerText()).includes(ISSUE) && (await issueRow.innerText()).includes("/today") && (await issueRow.innerText()).includes(maya.name), "the issue shows its words, its page and who sent it");
    const img = issueRow.locator('[data-testid="report-screenshot-img"]');
    await img.waitFor({ timeout: 10000 });
    for (let i = 0; i < 40 && !(await img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)); i++) await page.waitForTimeout(150);
    must(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth === 1600), "the screenshot shows, shrunk to 1600 wide");
    const askRow = page.locator(`#r-${ask.id} [data-testid="report-row"]`);
    must((await askRow.innerText()).includes("wants to talk") && (await askRow.innerText()).includes("Twelve, always."), "the Ask Danno answer shows the answer and the wish to talk");
    // H-202: each status is a reply in Danno's words, edited and sent with Send, logged on the report.
    must((await issueRow.locator('[data-testid="report-log-line"][data-kind="receipt"]').innerText()).includes("will see this soon"), "the receipt is on the report");
    await issueRow.locator('[data-testid="reply-seen"] > summary').click();
    const seenBox = issueRow.locator('[data-testid="reply-seen"] [data-testid="reply-message"]');
    must((await seenBox.inputValue()).startsWith(`Thanks, ${maya.name.split(" ")[0]}. I've got your note about`), `the Seen reply is prefilled in Danno's words: ${await seenBox.inputValue()}`);
    await issueRow.locator('[data-testid="reply-seen"] [data-testid="reply-topic"]').fill("the broken button");
    await seenBox.fill(`Thanks, ${maya.name.split(" ")[0]}. I've got your note about the broken button and I'm on it.`);
    await submit(page, `#r-${issue.id} [data-testid="reply-seen"] [data-testid="reply-send"]`);
    const sent = (await db.query.reportMessages.findMany({ where: eq(schema.reportMessages.reportId, issue.id) })).filter((m) => m.kind === "status");
    must(sent.length === 1 && sent[0]!.status === "seen" && sent[0]!.body.includes("the broken button"), "Seen sends once, with the edited words");
    must((await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, issue.id) }))!.status === "seen", "and the report is Seen");
    await page.goto(`${base}/coach/reports?tab=new`);
    const askRow2 = page.locator(`#r-${ask.id} [data-testid="report-row"]`);
    await askRow2.waitFor({ timeout: 20000 });
    await askRow2.locator('[data-testid="reply-done"] > summary').click();
    await submit(page, `#r-${ask.id} [data-testid="reply-done"] [data-testid="reply-send"]`);
    must((await page.locator(`#r-${ask.id} [data-testid="reply-error"]`).innerText()).includes("how it was fixed"), "Done is refused while it doesn't say how");
    await page.locator(`#r-${ask.id} [data-testid="reply-done"] > summary`).click();
    await page.locator(`#r-${ask.id} [data-testid="reply-done"] [data-testid="reply-message"]`).fill("Done: the answer about posts is fixed. Ask Danno now reads your plan first. Thanks for flagging it!");
    await submit(page, `#r-${ask.id} [data-testid="reply-done"] [data-testid="reply-send"]`);
    must((await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, ask.id) }))!.status === "done", "Done sends with the line on how");
    await page.goto(`${base}/coach/reports?tab=done`);
    must((await page.locator(`#r-${ask.id} [data-testid="report-row"]`).getAttribute("data-status")) === "done", "and it's on the Done tab");
    await page.goto(`${base}/today`);
    must((await page.locator('[data-testid="coach-new-reports"]').innerText()).includes("1 new issue and idea"), "two answered: one left new");
    const coachShot = await page.request.get(`${base}/api/reports/${issue.id}/screenshot`);
    must(coachShot.status() === 200 && coachShot.headers()["content-type"] === "image/jpeg", `the coach opens the screenshot (${coachShot.status()})`);
    console.log("✓ the coach: counts in the menu, on Today and on the Coach page; the inbox newest first with the screenshot; Seen and Done sent as replies");

    // ── 5. Monthly feedback: new until the coach opens it. ──
    await page.goto(`${base}/coach/feedback`);
    must((await page.locator('[data-testid="feedback-proud"] li[data-new="1"]').count()) === 1, "the new response is marked new on the page");
    await page.goto(`${base}/coach?connections=open`);
    must(!(await page.locator('[data-testid="coach-feedback-new"]').count()), "once opened, the count clears");
    console.log("✓ new monthly feedback is counted until the coach opens Monthly feedback, marked new there once");

    // ── 6. A switched coach has no button; the screenshot is the sender's and the coach's only. ──
    await page.goto(`${base}/coach/${mayaM.id}`);
    await page.check('[data-testid="switch-view"]');
    await submit(page, '[data-testid="switch-open"]');
    await page.locator('[data-testid="switch-banner"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="report-open"]').count()), "switched into a client, there's no button to send as them");
    const switchedShot = await page.request.get(`${base}/api/reports/${issue.id}/screenshot`);
    must(switchedShot.status() === 200, "switched into Maya, her own screenshot opens as hers");
    await submit(page, '[data-testid="switch-back"]');
    await logout(page);
    await loginAs(page, jordan.email);
    const theirs = await page.request.get(`${base}/api/reports/${issue.id}/screenshot`);
    const nothing = await page.request.get(`${base}/api/reports/${newId()}/screenshot`);
    must(theirs.status() === 404 && nothing.status() === 404 && (await theirs.text()) === (await nothing.text()), "another member gets the same 404 as for nothing at all");
    await logout(page);
    await login(page, "As a client");
    must((await page.request.get(`${base}/api/reports/${issue.id}/screenshot`)).status() === 200, "the sender opens their own");
    await logout(page);
    console.log("✓ a switched coach has no button; the screenshot opens for the coach and the sender, and reads as missing to anyone else");

    // ── 7. The connector (H-591): the coach's own connection lists the issue, reads it with its screenshot, marks it Seen.
    // An agent token and a client's connection never see the tools, and a call by name answers as a tool that isn't there. ──
    {
      const { viewerFor } = await import("@/lib/auth");
      const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
      const { makeAgentToken, revokeAgentTokens } = await import("@/lib/handoff");
      const { seedCoachForum } = await import("@/lib/forum");
      const { createHash, randomBytes } = await import("node:crypto");
      const coachM = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, coachU.id), eq(schema.memberships.workspaceId, ws)) }))!;
      const O = { workspaceId: ws, userId: coachU.id };
      const CALLBACK = "http://localhost:4090/cb";
      let rpcId = 0;
      const rpc = async (token: string, method: string, params: unknown = {}) => {
        const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
        return (await res.json()) as { result?: { tools?: { name: string }[]; content?: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }; error?: { message: string } };
      };
      const listed = async (token: string) => ((await rpc(token, "tools/list")).result?.tools ?? []).map((t) => t.name).filter((n) => ["reports_list", "report_read", "report_mark"].includes(n));
      const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
        const j = await rpc(token, "tools/call", { name, arguments: args });
        const content = j.result?.content ?? [];
        const full = content.find((c) => c.type === "text")?.text ?? j.error?.message ?? "";
        const cut = full.indexOf("\n\n{");
        return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), images: content.filter((c) => c.type === "image"), isError: Boolean(j.result?.isError || j.error) };
      };
      const connect = async (userId: string) => {
        const client = await registerClient("Smoke reports", [CALLBACK]);
        const v = (await viewerFor(userId, ws))!;
        const verifier = randomBytes(32).toString("base64url");
        const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: ["forum", "inbox"] as never });
        const token = ((await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string }).access_token;
        return { token, clientId: client.id };
      };
      await db.update(schema.memberReports).set({ seenAt: null, doneAt: null, status: "new" }).where(eq(schema.memberReports.id, issue.id));
      const own = await connect(coachU.id);
      await seedCoachForum(O);
      const agentRow = (await db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, ws), eq(schema.forumAgents.userId, coachU.id)) })).find((a) => !a.builtIn)!;
      const agentToken = (await makeAgentToken({ ...O, membershipId: coachM.id }, agentRow.id))!;
      const member = await connect(maya.id);
      try {
        must((await listed(own.token)).length === 3, "the coach's own connection lists the three report tools");
        let r = await call(own.token, "reports_list");
        const rows = (r.data?.reports ?? []) as { id: string; hasScreenshot: boolean; sender: Record<string, unknown>; createdAt: string; excerpt: string }[];
        const row = rows.find((x) => x.id === issue.id);
        must(!r.isError && row && row.hasScreenshot && row.sender.firstName === maya.name.split(" ")[0] && row.sender.memberId === mayaM.id && Object.keys(row.sender).length === 2, `the issue is listed under new, with its screenshot and the sender's first name and member id only: ${r.text}`);
        must(/ [A-Z]{2,5}$|GMT/.test(row!.createdAt), `its time is in the sender's zone, with the zone written (${row!.createdAt})`);
        must(!JSON.stringify(r.data).includes(maya.email) && !JSON.stringify(r.data).includes("reports/") && !JSON.stringify(r.data).includes(blob), "no email, store key or store address in the list");
        r = await call(own.token, "report_read", { id: issue.id });
        // What was stored, as the coach's own screenshot link streams it from the private store.
        await login(page, "As the coach");
        const stored = Buffer.from(await (await page.request.get(`${base}/api/reports/${issue.id}/screenshot`)).body());
        await logout(page);
        must(!r.isError && r.images.length === 1 && r.images[0].mimeType === "image/jpeg" && Buffer.from(r.images[0].data!, "base64").equals(stored), `report_read returns the screenshot itself, byte for byte (${r.images.length} picture(s), ${r.text})`);
        must(r.data?.description === issue.description && !JSON.stringify(r.data).includes("reports/") && !JSON.stringify(r.data).includes(blob), "the whole description, and no store key or address");
        must((await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, issue.id) }))!.seenAt === null, "reading doesn't mark it Seen");
        r = await call(own.token, "report_mark", { id: issue.id, seen: true });
        must(!r.isError && r.text === "Marked Seen.", `report_mark sets Seen: ${r.text}`);
        const after = (await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, issue.id) }))!;
        must(after.seenAt && !after.doneAt, "Seen, and Done stays the coach's");
        must(!((await call(own.token, "reports_list")).data?.reports as { id: string }[]).some((x) => x.id === issue.id), "gone from new");
        must(((await call(own.token, "reports_list", { state: "open" })).data?.reports as { id: string }[]).some((x) => x.id === issue.id), "still in open");
        must((await call(own.token, "report_read", { id: newId() })).text === "No report with that id in your workspace.", "a missing id reads as not found");
        // A connection tied to an agent (Scriba's Cowork) is still the coach's own: it keeps the tools.
        await db.update(schema.connectedApps).set({ agentId: agentRow.id }).where(eq(schema.connectedApps.clientId, own.clientId));
        must((await listed(own.token)).length === 3, "tied to an agent, the coach's own connection keeps the tools");
        must((await listed(agentToken)).length === 0, "an agent token never lists them");
        r = await call(agentToken, "reports_list");
        must(r.isError && /not found/i.test(r.text), `an agent token calling one by name: not found (${r.text})`);
        must((await listed(member.token)).length === 0, "a client's connection never lists them");
        r = await call(member.token, "report_read", { id: issue.id });
        must(r.isError && /not found/i.test(r.text) && !r.images.length, `a client's connection calling one by name: not found (${r.text})`);
        // H-202: the coach's own agents write a Done draft; a member's connection never sees the tool.
        const draftTool = async (token: string) => ((await rpc(token, "tools/list")).result?.tools ?? []).some((t) => t.name === "report_done_draft");
        must((await draftTool(agentToken)) && (await draftTool(own.token)), "the coach's agent token, and the connection tied to an agent, list report_done_draft");
        must(!(await draftTool(member.token)), "a client's connection never lists report_done_draft");
        r = await call(member.token, "report_done_draft", { id: issue.id, text: DRAFT });
        must(r.isError && /not found/i.test(r.text), `a client's connection calling it by name: not found (${r.text})`);
        r = await call(agentToken, "report_done_draft", { id: issue.id, text: "Done: the button is fixed. [how it was fixed, one line]. Thanks!" });
        must(r.isError && /how it was fixed/.test(r.text), `a draft with its blank still in is refused (${r.text})`);
        r = await call(agentToken, "report_done_draft", { id: issue.id, text: DRAFT });
        must(!r.isError && r.data?.sent === false, `the agent's Done draft is saved, not sent (${r.text})`);
        const drafted = (await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, issue.id) }))!;
        must(drafted.doneDraft === DRAFT && drafted.doneDraftBy === agentRow.name && drafted.status !== "done", "on the report as a draft by that agent; nothing sent");
        console.log("✓ the connector: listed under new with the sender's first name and member id, read with the screenshot byte for byte, marked Seen (gone from new, still open); hidden from an agent token and a client, not found by name");
      } finally {
        await revokeAgentTokens(O, agentRow.id).catch(() => undefined);
        for (const c of [own, member]) await db.delete(schema.connectedApps).where(eq(schema.connectedApps.clientId, c.clientId));
      }
    }

    // ── 8. The member hears back (H-202): a Today line, the reply on My reports, and a follow-up on the same report. ──
    await logout(page).catch(() => undefined);
    await login(page, "As a client");
    await page.goto(`${base}/today`);
    const replyLine = page.locator('[data-testid="today-report-reply"]');
    await replyLine.waitFor({ timeout: 20000 });
    must((await replyLine.innerText()).includes("My reports"), "Today says there's a reply");
    // H-1656: the panel's My reports button counts the reply too.
    await page.locator('[data-testid="report-open"]').first().click();
    const countBtn = page.locator('dialog[open] [data-testid="report-form-my-reports"]');
    await page.waitForFunction(() => document.querySelector('dialog[open] [data-testid="report-form-my-reports"]')?.textContent?.includes("1 new reply"), null, { timeout: 15000 });
    must((await countBtn.innerText()).includes("My reports (1 new reply)"), `the panel's button counts the reply: ${await countBtn.innerText()}`);
    await page.keyboard.press("Escape");
    await page.goto(`${base}/reports`);
    const mine = page.locator(`#r-${issue.id} [data-testid="my-report"]`);
    await mine.waitFor({ timeout: 20000 });
    must((await mine.innerText()).includes("the broken button and I'm on it"), "My reports shows the reply in the coach's words");
    await mine.locator('[data-testid="follow-up"] > summary').click();
    await mine.locator('[data-testid="follow-up-text"]').fill("It still fails on my phone.");
    await submit(page, `#r-${issue.id} [data-testid="follow-up-send"]`);
    const back = (await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, issue.id) }))!;
    must(back.status === "new", "a follow-up sends it back to New for the coach");
    must((await db.query.reportMessages.findMany({ where: eq(schema.reportMessages.reportId, issue.id) })).some((m) => m.kind === "followup" && m.body === "It still fails on my phone."), "on the same report");
    await page.goto(`${base}/today`);
    await page.waitForTimeout(500);
    must(!(await page.locator('[data-testid="today-report-reply"]').count()), "and Today's line is gone once read");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/reports`);
    await mine.waitFor({ timeout: 20000 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    must(over <= 1, `My reports: nothing scrolls sideways at 390 (${over}px over)`);
    await page.setViewportSize({ width: 1440, height: 950 });
    console.log("✓ the member: a Today line, the reply on My reports, a follow-up on the same report sends it back to New");

    // ── 9. Merge and the agent's Done draft (H-202): the same member's second report goes under the first, the amber draft
    // fills Done, and one Send answers both; the member hears it once and sees both under one report. ──
    {
      const twin = newId();
      await db.insert(schema.memberReports).values({ id: twin, workspaceId: ws, userId: maya.id, kind: "issue", severity: "orange", description: "The same button is still broken on my phone." });
      await logout(page);
      await login(page, "As the coach");
      await page.goto(`${base}/settings?tab=coach`);
      must((await page.locator('[data-testid="auto-done"]').count()) === 1 && !(await page.locator('[data-testid="auto-done"]').isChecked()), "Settings has the auto-send switch, off by default");
      await page.goto(`${base}/coach/reports?tab=new`);
      const card = page.locator(`#r-${issue.id}`);
      await card.waitFor({ timeout: 20000 });
      must((await card.locator('[data-testid="done-draft"]').innerText()).includes(DRAFT), "the agent's Done draft shows on the report");
      await card.locator('[data-testid="report-merge"] > summary').click();
      await card.locator(`[data-testid="merge-pick"][value="${twin}"]`).check();
      await submit(page, `#r-${issue.id} [data-testid="merge-send"]`);
      must((await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, twin) }))!.parentId === issue.id, "the second report sits under the first");
      await page.goto(`${base}/coach/reports?tab=new`);
      await card.waitFor({ timeout: 20000 });
      must((await card.locator('[data-testid="report-row"]').getAttribute("data-merged")) === "1" && !(await page.locator(`#r-${twin}`).count()), "listed once, with the merged one under it");
      must((await card.locator('[data-testid="reply-done"] [data-testid="reply-message"]').inputValue()) === DRAFT, "Done opens with the draft in it");
      const before = (await db.query.reportMessages.findMany({ where: eq(schema.reportMessages.workspaceId, ws) })).filter((m) => m.kind === "status").length;
      await submit(page, `#r-${issue.id} [data-testid="reply-done"] [data-testid="reply-send"]`);
      const [top, under] = await Promise.all([db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, issue.id) }), db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, twin) })]);
      must(top!.status === "done" && under!.status === "done" && top!.doneDraft === null, "one Send: both Done, and the draft is gone");
      const sent = (await db.query.reportMessages.findMany({ where: eq(schema.reportMessages.workspaceId, ws) })).filter((m) => m.kind === "status");
      must(sent.length === before + 1 && sent.some((m) => m.reportId === issue.id && m.status === "done" && m.body === DRAFT), "the member hears it once");
      await logout(page);
      await login(page, "As a client");
      await page.goto(`${base}/reports`);
      const merged = page.locator(`#r-${issue.id} [data-testid="my-report-merged"]`);
      await merged.waitFor({ timeout: 20000 });
      must((await merged.innerText()).includes("still broken on my phone") && !(await page.locator(`#r-${twin}`).count()), "My reports shows both under one");
      console.log("✓ merge and drafts: the second report under the first, the agent's draft fills Done, one Send answers both, the member sees one report");
    }

    console.log("\nsmoke-reports: all checks passed");
  } finally {
    await browser.close();
    if (proc?.pid) {
      try {
        process.kill(-proc.pid);
      } catch {
        /* already gone */
      }
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
