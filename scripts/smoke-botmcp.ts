/**
 * Bot connection (rev 696, Danno's answers at rev 808): the small MCP server a member's Community Loyalty bot calls mid-chat.
 *  1. Settings: the booking link and what to expect (a link that isn't https:// is refused); Bot connection makes a key, shows
 *     it once, then only its last four.
 *  2. The server: no key, a wrong key, a member-connector token, or the bot key at the member connector all get 401; the bot key
 *     lists exactly the seven tools (mf_prepare since rev 812), and every never-list name is refused.
 *  3. The reads: offers with prices only where allowed, the FAQ, the booking link, the next webinar in the asker's time zone.
 *  4. lead_log: adds and updates only the person with that contact id, replies only "logged" or "updated", sets booked-on for
 *     booked (the scoreboard counts it), the No-show stage, over-long input refused; another member's key never touches hers.
 *  5. webinar_register: the sign-up with custom fields and a personal link code, the person in DMs as a webinar lead, the join
 *     link back, once per email; bad email or too many fields refused.
 *  6. Limits: 60 reads a minute, 10 writes a minute, 200 writes a day, each a 429 the bot can say. The key is in no response;
 *     the log holds the tool and the outcome only. Rotate and Revoke stop the old key at once; the coach makes one for a client.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};
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
async function press(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST", { timeout: 60000 }), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

const seen: string[] = [];
let rpcId = 0;
async function rpc(token: string, method: string, params: unknown = {}, path = "/api/bot-mcp"): Promise<{ status: number; body: string; json: { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: { message: string } } | null }> {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  const body = await res.text();
  seen.push(body);
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {}
  return { status: res.status, body, json };
}
const call = (token: string, name: string, args: Record<string, unknown> = {}) => rpc(token, "tools/call", { name, arguments: args });
const said = (r: Awaited<ReturnType<typeof rpc>>) => r.json?.result?.content?.[0]?.text ?? r.json?.error?.message ?? "";

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { nowWallInTz, addDays, todayInTz } = await import("@/lib/dates");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const coachU = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = m.workspaceId;
  const tz = m.timezone ?? "America/Los_Angeles";
  const mine = (t: { workspaceId: never; userId: never }, u = maya.id) => and(eq(t.workspaceId, ws as never), eq(t.userId, u as never));
  // Her bot's world: one offer on the bot priced, one that never quotes, one off the bot; an FAQ; a webinar next week.
  await db.delete(schema.offers).where(mine(schema.offers as never));
  await db.insert(schema.offers).values([
    { id: newId(), workspaceId: ws, userId: maya.id, name: "Coach Accelerator", status: "live", promise: "Ten clients in 90 days", botFor: "Coaches starting out", container: "12 weeks", price: 3000, botRole: "core", neverQuotePrice: false },
    { id: newId(), workspaceId: ws, userId: maya.id, name: "VIP Day", status: "live", promise: "A plan in a day", container: "1 day", price: 5000, botRole: "one_on_one", neverQuotePrice: true },
    { id: newId(), workspaceId: ws, userId: maya.id, name: "Secret Mastermind", status: "live", promise: "Hidden", container: "", price: 9000, botRole: "not_on_bot" },
  ]);
  await db.insert(schema.faqEntries).values({ id: newId(), workspaceId: ws, userId: maya.id, question: "Do you offer refunds?", alsoAsked: ["Can I get my money back?"], keywords: ["refund"], answer: "Yes: within 14 days, no questions asked.", origin: "coach", source: "paste" });
  const webinarId = newId();
  const nextWeek = `${addDays(todayInTz(tz), 7)}T18:00`;
  await db.insert(schema.webinars).values({ id: webinarId, workspaceId: ws, userId: maya.id, title: "Ten Clients Workshop", status: "scheduled", scheduledAt: nextWeek, registrationUrl: "https://example.com/register", joinUrl: "https://example.com/join" });
  await db.update(schema.memberships).set({ botPricesOn: true, priceAnswer: "It depends on where you are; a quick call sorts it." }).where(eq(schema.memberships.id, m.id));
  await db.delete(schema.botKeys).where(eq(schema.botKeys.workspaceId, ws));
  await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, "botmcp:%"));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // 1. Settings: the booking fields and the key, shown once.
    await login(page, "As a client");
    await page.goto(`${base}/settings?tab=bot#your-bot`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="booking-url"]').fill("http://example.com/book");
    await press(page, 'form:has([data-testid="booking-url"]) button[type="submit"]');
    must((await page.locator('[data-testid="bot-facts-error"]').innerText()).includes("https://"), "a booking link that isn't https:// is refused");
    await page.goto(`${base}/settings?tab=bot#your-bot`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="booking-url"]').fill("https://example.com/book-maya");
    await page.locator('[data-testid="booking-expect"]').fill("A 30-minute call to map your next 90 days. Bring your numbers.");
    await press(page, 'form:has([data-testid="booking-url"]) button[type="submit"]');
    const saved = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!;
    must(saved.bookingUrl === "https://example.com/book-maya" && saved.bookingExpect?.startsWith("A 30-minute call"), `the booking fields saved: ${saved.bookingUrl}`);
    must((await page.locator('[data-testid="bot-key-state"]').innerText()) === "no key", "no key at first");
    await press(page, '[data-testid="bot-key-make"]');
    const key = (await page.locator('[data-testid="bot-key"]').innerText()).trim();
    must(/^hxb_[A-Za-z0-9_-]{43}$/.test(key), `a key is shown once: ${key.slice(0, 8)}…`);
    must((await page.locator('[data-testid="bot-url"]').innerText()).endsWith("/api/bot-mcp"), "the address to paste");
    await press(page, '[data-testid="bot-key-hide"]');
    await page.goto(`${base}/settings?tab=bot`, { waitUntil: "networkidle" });
    must(!(await page.content()).includes(key) && (await page.locator('[data-testid="bot-key-state"]').innerText()) === `key ····${key.slice(-4)}`, "after I've saved it: only the last four");
    const stored = await db.query.botKeys.findFirst({ where: and(eq(schema.botKeys.userId, maya.id)) });
    must(stored && stored.tokenHash !== key && !JSON.stringify(stored).includes(key), "stored as a hash only");
    console.log("✓ Settings: the booking link (http:// refused) and what to expect; Make a key shows it once, then only its last four; stored as a hash");

    // 2. Who gets in, and what is listed.
    must((await rpc("", "tools/list")).status === 401, "no key: 401");
    must((await rpc(`hxb_${"x".repeat(43)}`, "tools/list")).status === 401, "a wrong key: 401");
    must((await rpc(`mcpa_${"x".repeat(43)}`, "tools/list")).status === 401, "a member-connector token: 401");
    must((await rpc(key, "tools/list", {}, "/api/mcp")).status === 401, "the bot key at the member connector: 401");
    const init = await rpc(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "walk", version: "1" } });
    must(init.status === 200, `initialize: ${init.status}`);
    const listed = (await rpc(key, "tools/list")).json?.result?.tools?.map((t) => t.name).sort();
    must(JSON.stringify(listed) === JSON.stringify(["booking_info", "faq_answer", "lead_log", "mf_prepare", "offer_info", "webinar_next", "webinar_register"]), `exactly the seven tools: ${listed}`);
    for (const never of ["essence_read", "scoreboard_read", "tasks_list", "proofs_list", "contacts_list", "pathway_read", "body_today", "dm_send", "contact_delete", "whoami"]) {
      const r = await call(key, never);
      must(r.json?.error || r.json?.result?.isError, `the never-list tool ${never} is refused: ${r.body.slice(0, 120)}`);
    }
    console.log("✓ no key, a wrong key, a member token, and the bot key at the member connector: 401; exactly seven tools; every never-list name refused");

    // 3. The reads.
    const offers = JSON.parse(said(await call(key, "offer_info"))).offers as { name: string; main: boolean; price: string | null; price_answer: string | null }[];
    must(offers.length === 2 && offers[0].name === "Coach Accelerator" && offers[0].main && offers[0].price?.includes("3,000"), `the main offer first, with its price: ${JSON.stringify(offers)}`);
    must(offers[1].name === "VIP Day" && offers[1].price === null && offers[1].price_answer?.includes("quick call") && !JSON.stringify(offers).includes("Secret"), "never quote prices honoured; an offer off the bot not shown");
    await db.update(schema.memberships).set({ botPricesOn: false }).where(eq(schema.memberships.id, m.id));
    must(!said(await call(key, "offer_info")).match(/3,?000|5,?000/), "prices off: no numbers at all");
    await db.update(schema.memberships).set({ botPricesOn: true }).where(eq(schema.memberships.id, m.id));
    must(said(await call(key, "faq_answer", { question: "Can I get a refund?" })).includes("within 14 days"), "the FAQ answers");
    const booking = JSON.parse(said(await call(key, "booking_info")));
    must(booking.booking_link === "https://example.com/book-maya" && booking.what_to_expect.startsWith("A 30-minute call"), "the booking link and what to expect");
    const next = JSON.parse(said(await call(key, "webinar_next", { timezone: "America/New_York" })));
    must(next.title === "Ten Clients Workshop" && /E[SD]T$/.test(next.when) && next.registration_link === "https://example.com/register" && !("join_link" in next), `the next webinar in the asker's zone: ${JSON.stringify(next)}`);
    console.log("✓ offer_info (main first, never-quote and prices-off honoured), faq_answer, booking_info, webinar_next in the asker's time zone");

    // 4. lead_log.
    const logged = await call(key, "lead_log", { contact_id: "cl-walk-1", first_name: "Rosa", channel: "Messenger", stage: "qualified", note: "Runs a yoga studio" });
    must(said(logged) === "logged", `a new person: "logged" only: ${said(logged)}`);
    let rosa = (await db.query.contacts.findFirst({ where: and(mine(schema.contacts as never), eq(schema.contacts.userNs, "cl-walk-1")) }))!;
    must(rosa.stage === "conversation" && rosa.source === "bot" && rosa.platform === "Messenger" && rosa.notes?.includes("(bot): Runs a yoga studio"), `qualified is In conversation: ${rosa.stage}`);
    const today = todayInTz(tz);
    must(said(await call(key, "lead_log", { contact_id: "cl-walk-1", first_name: "Rosa", stage: "booked", booked_on: today, note: "Booked for Thursday" })) === "updated", "the same person: updated");
    rosa = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, rosa.id) }))!;
    must(rosa.stage === "call_booked" && rosa.callBookedAt?.startsWith(today) && rosa.notes?.split("\n").length === 2, `booked sets booked-on and adds a line: ${rosa.callBookedAt}`);
    const { scoreboardFor } = await import("@/lib/scoreboard");
    const board = await scoreboardFor({ workspaceId: ws, userId: maya.id } as never, tz, today, "this");
    must((board as { ghlBooked?: number }).ghlBooked! >= 1, `the scoreboard counts the bot's booking: ${JSON.stringify(board).slice(0, 200)}`);
    must(said(await call(key, "lead_log", { contact_id: "cl-walk-1", first_name: "Rosa", stage: "no_show" })) === "updated", "no-show");
    must((await db.query.contacts.findFirst({ where: eq(schema.contacts.id, rosa.id) }))!.stage === "no_show", "the No-show stage");
    await page.goto(`${base}/conversations`, { waitUntil: "networkidle" });
    must((await page.content()).includes("No-show"), "DMs shows the No-show stage");
    const long = await call(key, "lead_log", { contact_id: "cl-walk-1", first_name: "Rosa", stage: "new", note: "x".repeat(281) });
    must(long.json?.result?.isError || long.json?.error, "a note over 280 is refused");
    must((await db.query.contacts.findFirst({ where: eq(schema.contacts.id, rosa.id) }))!.stage === "no_show", "...and nothing changed");
    must(said(await call(key, "lead_log", { contact_id: "1; drop table", first_name: "X", stage: "new" })).includes("contact id"), "a contact id that isn't one is refused");
    console.log("✓ lead_log: logged, then updated; qualified is In conversation, booked sets booked-on (the scoreboard counts it), the No-show stage on DMs; over-long and bad ids refused");

    // 5. webinar_register.
    const reg = JSON.parse(said(await call(key, "webinar_register", { first_name: "Dev", email: "Dev.Patel@Example.com", contact_id: "cl-walk-2", custom: { industry: "Fitness", pain: "No leads\u0000 at all", favourite_tool: "Canva" } })));
    must(reg.status === "registered" && reg.join_link === "https://example.com/join", `registered, with the join link: ${JSON.stringify(reg)}`);
    const signup = (await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.webinarId, webinarId) }))!;
    must(signup.email === "dev.patel@example.com" && signup.pageCode.length === 43 && signup.custom.industry === "Fitness" && signup.custom.pain === "No leads at all" && signup.clContactId === "cl-walk-2", `the sign-up with its custom fields and personal link code: ${JSON.stringify(signup.custom)}`);
    const dev = (await db.query.contacts.findFirst({ where: and(mine(schema.contacts as never), eq(schema.contacts.email, "dev.patel@example.com")) }))!;
    must(dev.source === "webinar" && dev.stage === "new" && dev.userNs === "cl-walk-2", "in DMs as a webinar lead");
    const again = JSON.parse(said(await call(key, "webinar_register", { first_name: "Dev", email: "dev.patel@example.com" })));
    must(again.status === "already registered" && (await db.query.webinarSignups.findMany({ where: eq(schema.webinarSignups.webinarId, webinarId) })).length === 1, "once per email");
    must((await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }))!.registered === 1, "counted once in Registered");
    must(said(await call(key, "webinar_register", { first_name: "Al", email: "not-an-email" })).includes("email"), "a bad email is refused");
    must(said(await call(key, "webinar_register", { first_name: "Al", email: "al@example.com", custom: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, "x"])) })).includes("12"), "13 custom fields refused");
    await page.goto(`${base}/webinars/${webinarId}?step=run`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="webinar-join-url"]').inputValue()) === "https://example.com/join" && (await page.locator('[data-testid="webinar-signups"]').innerText()).includes("1"), "the webinar page: the join link and the bot's sign-ups");
    console.log("✓ webinar_register: the sign-up with cleaned custom fields and a 43-character personal code, a webinar lead in DMs, the join link back, once per email; bad email and 13 fields refused");

    // Another member's key never touches hers.
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/settings?tab=bot`, { waitUntil: "networkidle" });
    await press(page, '[data-testid="bot-key-make"]');
    const coachKey = (await page.locator('[data-testid="bot-key"]').innerText()).trim();
    await press(page, '[data-testid="bot-key-hide"]');
    must(!said(await call(coachKey, "offer_info")).includes("Coach Accelerator"), "the coach's key reads the coach's offers, not hers");
    must(said(await call(coachKey, "lead_log", { contact_id: "cl-walk-1", first_name: "Rosa", stage: "booked" })) === "logged", "the same contact id on another bot is that bot's own new lead");
    must((await db.query.contacts.findFirst({ where: eq(schema.contacts.id, rosa.id) }))!.stage === "no_show", "hers untouched");
    console.log("✓ another member's key reads its own offers, and the same contact id there is its own lead; hers untouched");

    // 6. Limits, on fresh keys so earlier calls don't count.
    const fresh = async (): Promise<string> => {
      await page.goto(`${base}/coach/${m.id}/bot#bot-connection`, { waitUntil: "networkidle" });
      await press(page, '[data-testid="bot-key-make"]');
      const k = (await page.locator('[data-testid="bot-key"]').innerText()).trim();
      await press(page, '[data-testid="bot-key-hide"]');
      return k;
    };
    const k1 = await fresh();
    must((await rpc(key, "tools/list")).status === 401 && (await rpc(k1, "tools/list")).status === 200, "the coach makes her a new key from her bot page; her old one stops at once");
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await call(k1, "booking_info")).status);
    const busy = await call(k1, "booking_info");
    must(statuses.slice(0, 59).every((s) => s === 200) && statuses.includes(429) && busy.status === 429 && busy.body.includes("try again in a minute"), `60 reads a minute, then a 429 the bot can say: ${statuses.filter((s) => s === 429).length}`);
    const k2 = await fresh();
    const writes: number[] = [];
    for (let i = 0; i < 11; i++) writes.push((await call(k2, "lead_log", { contact_id: `cl-burst-${i}`, first_name: "B", stage: "new" })).status);
    must(writes.slice(0, 10).every((s) => s === 200) && writes[10] === 429, `10 writes a minute: ${writes.join()}`);
    const k3 = await fresh();
    await db.update(schema.rateLimits).set({ count: 200 }).where(eq(schema.rateLimits.key, `botmcp:wday:${ws}:${maya.id}`));
    must((await call(k3, "lead_log", { contact_id: "cl-day", first_name: "D", stage: "new" })).status === 429 && (await call(k3, "booking_info")).status === 200, "200 writes a day per member; reads go on");
    await press(page, '[data-testid="bot-key-revoke"]');
    must((await rpc(k3, "tools/list")).status === 401 && (await page.locator('[data-testid="bot-key-state"]').innerText()) === "no key", "Revoke stops it at once");
    console.log("✓ 60 reads and 10 writes a minute, 200 writes a day, each a 429 the bot can say; Rotate and Revoke stop the old key at once");

    // The key is in no response; the log holds the tool and the outcome only.
    for (const k of [key, coachKey, k1, k2, k3]) must(!seen.some((b) => b.includes(k)), "a key came back in a response");
    const logs = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, ws), like(schema.syncEvents.event, "bot_mcp:%")) });
    must(logs.length > 20 && logs.every((l) => JSON.stringify(l.payload) === "{}" && !/Rosa|Dev|example\.com|yoga/i.test(l.note ?? "")), `logged as tool and outcome only: ${logs.length}`);
    console.log("✓ no key in any response; the log holds the tool, the member and the outcome, never what was said or who");

    // Back as it was.
    await db.delete(schema.botKeys).where(eq(schema.botKeys.workspaceId, ws));
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, "botmcp:%"));
    void coachU;
    void nowWallInTz;
    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\nbotmcp walk passed");
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
