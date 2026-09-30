/**
 * Community Loyalty web chat and SSO (revs 241, 243, 247):
 *  1. The coach sets the card up: widget id, the sub flow for members, a sealed secret, the bot's webhook URL (this walk's own
 *     receiver), web chat on; and creates the inbound secret the bot will use.
 *  2. A member's pages carry the widget with the server-computed identifier hash; the page's CSP names the widget's host.
 *  3. A coach switched into a client sees no widget.
 *  4. The bot asks for a link (secret as a header only, chat channels only, limits), the member confirms it signed in, the
 *     bot's webhook gets `link` with the member's own email; a used, an expired and a failed link each say so; the limit holds.
 *  5. Unlink posts `unlink`, and the list empties.
 */
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const HOOK_PORT = 4070;

type Hit = { event: string; body: Record<string, unknown> };
const hits: Hit[] = [];
let failNext = 0;
function receiver(): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (failNext > 0) {
          failNext--;
          res.writeHead(500);
          return res.end("down");
        }
        hits.push({ event: String(req.headers["x-helix-event"] ?? ""), body: JSON.parse(raw || "{}") });
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    s.listen(HOOK_PORT, () => resolve(s));
  });
}

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
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
const start = (secret: string | null, body: unknown) => fetch(`${base}/api/chat-link/start`, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-helix-secret": secret } : {}) }, body: JSON.stringify(body) });

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const hook = await receiver();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const client = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const clientM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, client.id) }))!;
    const ws = clientM.workspaceId;
    const SECRET = "walk-secret-not-a-real-one";

    // ── 1. The coach's card. ──
    await login(page, "As the coach");
    await page.goto(`${base}/integrations`);
    const card = page.locator('form:has([data-testid="integration-chatWidgetId"])');
    await card.locator('input[name="enabled"]').check();
    await card.locator('[data-testid="integration-chatOn"]').check();
    await card.locator('[data-testid="integration-chatWidgetId"]').fill("walkwidget1");
    await card.locator('[data-testid="integration-chatFlowNs"]').fill("f52594s4788801");
    await card.locator('[data-testid="integration-chatSecret"]').fill(SECRET);
    await card.locator('[data-testid="integration-chatWebhookUrl"]').fill(`http://localhost:${HOOK_PORT}/hook`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), card.locator('button:has-text("Save")').click()]);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    if (!(await page.locator('[data-testid="inbound-secret"]').count())) await submit(page, 'form:has(input[name="provider"][value="community_loyalty"]) button:has-text("inbound secret")');
    // The secret sits inside the card's closed "Inbound webhook" disclosure: read its text, not what is painted.
    const inbound = ((await page.locator('[data-testid="inbound-secret"] code').first().textContent()) ?? "").trim();
    if (!inbound.startsWith("hx_")) throw new Error(`the inbound secret is shown once: ${inbound}`);
    const integ = (await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.provider, "community_loyalty")) }))!;
    if (integ.config.chatSecret === SECRET || !integ.config.chatSecret?.startsWith("enc:")) throw new Error("the chat secret is stored sealed");
    if (!integ.config.chatWebhookUrl?.startsWith("enc:")) throw new Error("the webhook URL is stored sealed");
    if ((await page.locator('[data-testid="integration-chatSecret"]').inputValue()) !== "") throw new Error("a saved secret is never echoed into the form");
    if (!(await page.locator('[data-testid="chat-contract"]').count())) throw new Error("the card says what the bot needs");
    await logout(page);
    console.log("✓ the coach's card: widget id, sub flow, sealed secret and webhook URL, web chat on; the inbound secret shown once");

    // ── 2. The member's pages carry the widget. ──
    await login(page, "As a client");
    const res = await page.goto(`${base}/today`);
    const csp = res?.headers()["content-security-policy"] ?? "";
    if (!csp.includes("https://communityloyalty.io") || !csp.includes("report-uri /api/csp-report")) throw new Error(`the CSP names the widget's host and reports blocks: ${csp.slice(0, 120)}`);
    const widget = page.locator('[data-testid="chat-widget"]');
    if (!(await widget.count())) throw new Error("the widget is on a member's page");
    const expected = createHmac("sha256", SECRET).update(client.id).digest("hex");
    if ((await widget.getAttribute("data-user-id")) !== client.id || (await widget.getAttribute("data-hash")) !== expected) throw new Error("the widget carries the member's id and the server-computed hash");
    if ((await widget.getAttribute("data-flow")) !== "f52594s4788801") throw new Error("the sub flow id rides with the widget");
    // next/script adds the tag after hydration, so give it a moment to be attached (the host is unreachable here; only the tag matters).
    await page.locator('script[src="https://communityloyalty.io/js/widget/walkwidget1/float.js"]').waitFor({ state: "attached", timeout: 15000 }).catch(() => undefined);
    if (!(await page.locator('script[src="https://communityloyalty.io/js/widget/walkwidget1/float.js"]').count())) throw new Error("the widget script comes from the card's widget id");
    const html = await page.content();
    if (html.includes(SECRET)) throw new Error("the secret never reaches the page");
    await page.goto(`${base}/settings`);
    if (!(await page.locator('[data-testid="linked-chats-empty"]').count())) throw new Error("Linked chats starts empty");
    await logout(page);
    console.log("✓ a member's page: the widget with the identifier hash, the CSP naming its host, no secret in the page");

    // ── 3. Switched in: no widget. ──
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${clientM.id}`);
    await submit(page, '[data-testid="switch-view"]');
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="switch-banner"]').waitFor({ timeout: 15000 });
    if (await page.locator('[data-testid="chat-widget"]').count()) throw new Error("no widget while a coach is switched into a client");
    if (await page.locator('script[src*="communityloyalty.io"]').count()) throw new Error("no widget script while switched");
    await submit(page, '[data-testid="switch-back"]');
    await logout(page);
    console.log("✓ switched into a client: no widget, no script");

    // ── 4. The link flow. ──
    let r = await start(null, { user_ns: "walk-ns-1", channel: "messenger" });
    if (r.status !== 401) throw new Error(`no secret is 401, got ${r.status}`);
    r = await start("hx_wrong", { user_ns: "walk-ns-1", channel: "messenger" });
    if (r.status !== 401) throw new Error(`a wrong secret is 401, got ${r.status}`);
    r = await start(inbound, { user_ns: "walk-ns-1", channel: "email" });
    if (r.status !== 400) throw new Error(`email is not a chat channel: expected 400, got ${r.status}`);
    r = await start(inbound, { user_ns: "walk-ns-1", channel: "messenger" });
    if (r.status !== 200) throw new Error(`a good request is 200, got ${r.status} ${await r.text()}`);
    const { url } = (await r.json()) as { url: string };
    if (!url.includes("/link-chat/")) throw new Error(`the answer is a link: ${url}`);
    const path = new URL(url).pathname;

    await login(page, "As a client");
    await page.goto(`${base}${path}`);
    const state = page.locator('[data-testid="link-chat-state"]');
    if ((await state.getAttribute("data-state")) !== "ok") throw new Error("a fresh link can be confirmed");
    // The bot's webhook is down for the first press: the link is not spent, and the member sees why.
    failNext = 2;
    await submit(page, '[data-testid="link-chat-confirm"]');
    if (!(await page.locator('[data-testid="link-chat-error"]').count())) throw new Error("a failed post shows its reason");
    if (hits.length) throw new Error("nothing recorded while the webhook was down");
    await submit(page, '[data-testid="link-chat-confirm"]');
    await page.waitForURL(/\/settings\?chat=linked/);
    const link = hits.find((h) => h.event === "link");
    if (!link || link.body.email !== "client@demo.helixos.app" || link.body.user_ns !== "walk-ns-1" || link.body.channel !== "messenger" || link.body.name !== client.name) throw new Error(`the bot got link with the member's own email: ${JSON.stringify(link)}`);
    if (Object.keys(link.body).sort().join(",") !== "at,channel,email,event,name,user_ns") throw new Error(`link carries only what was promised: ${Object.keys(link.body)}`);
    const row = page.locator('[data-testid="linked-chat"]');
    // Settings streams: the address changes before the row has landed, so wait for it rather than counting once.
    await row.first().waitFor({ timeout: 15000 }).catch(() => undefined);
    if ((await row.count()) !== 1 || (await row.getAttribute("data-channel")) !== "messenger") throw new Error("Settings lists the linked chat");
    if (!(await page.locator('[data-testid="chat-note"]').innerText()).includes("linked")) throw new Error("the note says it's linked");
    await page.goto(`${base}${path}`);
    if ((await state.getAttribute("data-state")) !== "used") throw new Error("a used link says so");
    // Expired: a fresh link aged past its ten minutes.
    r = await start(inbound, { user_ns: "walk-ns-2", channel: "whatsapp" });
    const old = new URL(((await r.json()) as { url: string }).url).pathname;
    await db.update(schema.chatLinks).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(schema.chatLinks.userNs, "walk-ns-2"));
    await page.goto(`${base}${old}`);
    if ((await state.getAttribute("data-state")) !== "expired") throw new Error("an expired link says so");
    // The limit: five links per chat contact an hour.
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await start(inbound, { user_ns: "walk-ns-rl", channel: "instagram" })).status;
    if (last !== 429) throw new Error(`the sixth link for one contact is refused, got ${last}`);
    const logged = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, ws), eq(schema.syncEvents.event, "chat.link")) });
    if (!logged.length || logged.some((e) => JSON.stringify(e.payload).includes("@") || (e.note ?? "").includes("localhost"))) throw new Error("the sync log holds the event and channel, never the email or the URL");
    // The CSP report endpoint takes a report and says nothing back.
    const rep = await fetch(`${base}/api/csp-report`, { method: "POST", headers: { "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": { "effective-directive": "script-src", "blocked-uri": "https://cdn.example.com/x.js?token=abc" } }) });
    if (rep.status !== 204) throw new Error(`the CSP report endpoint answers 204, got ${rep.status}`);
    console.log("✓ the link flow: header-only secret, chat channels only, a down webhook keeps the link, then link posted with the member's email; used, expired and the limit refused");

    // ── 5. Unlink. ──
    await page.goto(`${base}/settings#linked-chats`);
    await submit(page, '[data-testid="chat-unlink"]');
    await page.waitForURL(/\/settings\?chat=unlinked/);
    const un = hits.find((h) => h.event === "unlink");
    if (!un || un.body.user_ns !== "walk-ns-1" || un.body.email !== "client@demo.helixos.app") throw new Error(`the bot got unlink: ${JSON.stringify(un)}`);
    if (!(await page.locator('[data-testid="linked-chats-empty"]').count())) throw new Error("the list is empty after unlink");
    await logout(page);
    console.log("✓ unlink: posted to the bot, and the chat is off the list");

    // ── 6. Progress pushes: the goal saved, once an hour, and only while the member's switch is on. ──
    const progressHits = () => hits.filter((h) => h.event === "progress");
    const waitFor = async (n: number) => {
      for (let i = 0; i < 40 && progressHits().length < n; i++) await page.waitForTimeout(250);
    };
    await login(page, "As a client");
    await page.goto(`${base}/settings`);
    if ((await page.locator('[data-testid="chat-share"]').getAttribute("data-on")) !== "1") throw new Error("progress sharing is on by default");
    const goalForm = page.locator('form:has(input[name="target"])');
    await goalForm.locator('input[name="target"]').fill("7500");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), goalForm.locator("button").last().click()]);
    await waitFor(1);
    const prog = progressHits()[0];
    if (!prog) throw new Error("saving the goal posts progress");
    if (Object.keys(prog.body).sort().join(",") !== "at,email,event,goal,main_offer,name,pathway_stage,reason,week_313") throw new Error(`progress carries exactly the promised keys: ${Object.keys(prog.body)}`);
    if (prog.body.email !== "client@demo.helixos.app" || prog.body.reason !== "goal_changed" || !String(prog.body.goal).includes("7,500") || !String(prog.body.pathway_stage)) throw new Error(`progress reads right: ${JSON.stringify(prog.body)}`);
    if (JSON.stringify(prog.body).toLowerCase().includes("body")) throw new Error("never Body in a push");
    // Within the hour: nothing more.
    await goalForm.locator('input[name="target"]').fill("8000");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), goalForm.locator("button").last().click()]);
    await page.waitForTimeout(1500);
    if (progressHits().length !== 1) throw new Error("a second change inside the hour is not pushed");
    // The switch off: nothing, even after the hour.
    await page.goto(`${base}/settings`);
    await page.locator('[data-testid="chat-share-toggle"]').uncheck();
    await submit(page, '[data-testid="chat-share-save"]');
    await page.waitForURL(/chat=share-off/);
    await db.update(schema.memberships).set({ lastChatPushAt: null }).where(eq(schema.memberships.id, clientM.id));
    await page.goto(`${base}/settings`);
    await page.locator('form:has(input[name="target"]) input[name="target"]').fill("9000");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('form:has(input[name="target"]) button').last().click()]);
    await page.waitForTimeout(1500);
    if (progressHits().length !== 1) throw new Error("with the switch off, nothing is pushed");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/integrations`);
    const countText = (await page.locator('[data-testid="chat-count"]').textContent()) ?? "";
    if (!countText.includes("3 of 500")) throw new Error(`the card counts today's posts (link, unlink, progress): ${countText}`);
    await logout(page);
    console.log("✓ progress: the goal change posted with exactly the promised keys, once an hour, never with the member's switch off; the card counts the day");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Chat smoke passed");
  } finally {
    await browser.close();
    hook.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
