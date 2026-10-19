/**
 * Coach → Booking calendars (H-892, plan H-1040, approved H-1044), against a stand-in GoHighLevel (scripts/mock-ghl-calendars.ts).
 *  1. A key without calendar permission: Step 1 says which three to add; nothing is written, no button shows.
 *  2. A connection for another sub-account: refused before any call; nothing is written.
 *  3. The right key: Step 1 shows Evolve Omega Booking, the copy live under its old name, Elite not made, the fields to write.
 *  4. Step 2 (Danno picks himself, ticks, presses): Academy first, then Elite created; only the brief's changes, the rest
 *     copied from the template; the template and every other calendar untouched. Pressed again: both updated, still one Elite.
 *  5. Step 3: a bad contact id is refused; then one booking on each for the test contact, a Zoom link on each, both cancelled,
 *     no email sent.
 *  6. A member is turned away from the page and the coach's link is there. At 390: nothing wider than the screen.
 *  7. The server log holds no key.
 *
 * `npx tsx scripts/smoke-calendars.ts http://localhost:3000`
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ||= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const PORT = 4084;
const LOC = "OsyiwYzwGdK9O1noUOcT";
const TEMPLATE = "nntnynKtR00uxmgnrivj";
const COPY = "9lNBnfzLoNpgkcwwiUGj";
const must = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const up = () => fetch(`http://localhost:${PORT}/`).then(() => true).catch(() => false);
type State = { calendars: (Record<string, unknown> & { id: string; name: string })[]; writes: { method: string; id: string; body: Record<string, unknown> }[]; appointments: { id: string; calendarId: string; contactId: string; status: string; toNotify: unknown; address?: string }[] };
const state = async (): Promise<State> => (await (await fetch(`http://localhost:${PORT}/__state`)).json()) as State;

async function login(page: Page, who: "As the coach" | "As a client") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { seal } = await import("@/lib/crypto");

  let child: ReturnType<typeof spawn> | null = null;
  if (!(await up())) {
    child = spawn("npx", ["tsx", "scripts/mock-ghl-calendars.ts", String(PORT)], { stdio: "ignore", detached: true });
    for (let i = 0; i < 60 && !(await up()); i++) await sleep(250);
  }
  must(await up(), "the stand-in GoHighLevel answers");
  await fetch(`http://localhost:${PORT}/__reset`);

  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!.workspaceId;
  const integ = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.provider, "gohighlevel")) });
  const before = integ ? { ...integ.config } : null;
  if (integ) await db.update(schema.integrations).set({ enabled: true, config: { ...integ.config, apiUrl: `http://localhost:${PORT}` } }).where(eq(schema.integrations.id, integ.id));
  else await db.insert(schema.integrations).values({ id: newId(), workspaceId: ws, provider: "gohighlevel", enabled: true, config: { apiUrl: `http://localhost:${PORT}` } });
  const connect = async (locationId: string, token: string) => {
    await db.delete(schema.socialConnections).where(and(eq(schema.socialConnections.userId, coach.id), eq(schema.socialConnections.provider, "gohighlevel")));
    await db.insert(schema.socialConnections).values({ id: newId(), workspaceId: ws, userId: coach.id, provider: "gohighlevel", locationId, manualToken: seal(token) });
  };

  const logFile = "screenshots/logs/dev.log";
  const logStart = existsSync(logFile) ? statSync(logFile).size : 0;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await login(page, "As the coach");

    // 1. No calendar permission.
    await connect(LOC, "pit-nocal");
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="coach-calendars-link"]').click();
    await page.waitForURL(/\/hermes\/calendars/);
    const err = await page.locator('[data-testid="cal-read-error"]').innerText({ timeout: 60000 });
    for (const s of ["calendars.readonly", "calendars.write", "calendars/events.write"]) must(err.includes(s), `the refusal names ${s}: ${err}`);
    must(!(await page.locator('[data-testid="cal-write"]').count()), "no write button without the permission");
    must(!(await state()).writes.length, "nothing written");
    console.log("✓ a key without calendar permission: the three permissions named, no button, nothing written");

    // 2. Another sub-account.
    await connect("loc_someone_else", "pit-cal");
    await page.reload();
    must((await page.locator('[data-testid="cal-read-error"]').innerText()).includes("another sub-account"), "another sub-account is refused");
    must(!(await state()).writes.length, "nothing written");
    console.log("✓ a connection for another sub-account is refused before any call");

    // 3. Step 1.
    await connect(LOC, "pit-cal");
    await page.reload();
    await page.locator('[data-testid="cal-read"]').waitFor();
    must((await page.locator('[data-testid="cal-academy-now"]').innerText()).includes("live under its old name"), "the copy is shown live under its old name");
    must((await page.locator('[data-testid="cal-elite-now"]').innerText()).includes("not made yet"), "Elite not made yet");
    await page.locator('[data-testid="cal-fields-elite"] summary').click();
    const fields = await page.locator('[data-testid="cal-fields-elite"] table').innerText();
    for (const s of ["slotDuration", "openHours", "preBuffer", "lookBusyConfig", "zoom_conf", "elite-conversation"]) must(fields.includes(s), `the Elite fields show ${s}`);
    must(!(await state()).writes.length, "Step 1 writes nothing");
    console.log("✓ Step 1 reads only: the template, the copy under its old name, Elite not made, the fields to write");

    // 4. Step 2.
    await page.selectOption('[data-testid="cal-user"]', "usrDanno00001");
    await page.locator('[data-testid="cal-write"]').click();
    must((await page.locator('[data-testid="cal-write-error"]').innerText({ timeout: 30000 })).includes("Tick the box"), "the box must be ticked first");
    must(!(await state()).writes.length, "nothing written before the tick");
    await page.check('[data-testid="cal-sure"]');
    await page.locator('[data-testid="cal-write"]').click();
    await page.locator('[data-testid="cal-written"]').waitFor({ timeout: 60000 });
    let s = await state();
    must(s.writes.length === 2 && s.writes[0].method === "PUT" && s.writes[0].id === COPY && s.writes[1].method === "POST", `Academy first, then Elite created: ${JSON.stringify(s.writes.map((w) => [w.method, w.id]))}`);
    const tpl = s.calendars.find((c) => c.id === TEMPLATE)!;
    for (const w of s.writes) {
      const b = w.body;
      const tm = (b.teamMembers as { userId: string; locationConfigurations: { kind: string }[] }[])[0];
      must(b.calendarType === "personal" && tm.userId === "usrDanno00001" && tm.locationConfigurations[0].kind === "zoom_conf", "one-person calendar, Danno, Zoom");
      must(b.slotDuration === 30 && b.slotInterval === 30 && (b.lookBusyConfig as { enabled: boolean }).enabled === false, "30 minutes, slot interval 30, Look busy off");
      for (const k of ["openHours", "slotBuffer", "preBuffer", "allowBookingFor", "allowBookingForUnit", "allowBookingAfter", "autoConfirm", "eventColor"]) must(JSON.stringify(b[k]) === JSON.stringify(tpl[k]), `${k} copied from the template`);
      must(!("workflows" in b) && !("eventType" in b), "no workflow, the template's round-robin type not copied");
    }
    must(s.writes[0].body.slug === "academy-conversation" && s.writes[0].body.name === "Academy Conversation" && String(s.writes[0].body.description).includes("joining Academy"), "Academy's name, slug and description");
    must(s.writes[1].body.slug === "elite-conversation" && s.writes[1].body.name === "Elite Conversation" && String(s.writes[1].body.description).includes("joining Elite") && s.writes[1].body.locationId === LOC, "Elite's name, slug, description and location");
    must(tpl.name === "Evolve Omega Booking" && s.calendars.find((c) => c.id === "otherCal000000000001")!.name === "Evolve Omega Appointments", "the template and the other calendar untouched");
    const eliteId = s.writes[1].id;
    const written = await page.locator('[data-testid="cal-written"]').innerText();
    must(written.includes(`widget/booking/${COPY}`) && written.includes(`widget/booking/${eliteId}`) && written.includes("created"), `both ids and booking links shown: ${written}`);
    await page.reload();
    must((await page.locator('[data-testid="cal-academy-now"]').innerText()).includes("updated"), "the copy reads updated");
    must((await page.locator('[data-testid="cal-elite-now"]').innerText()).includes(eliteId), "Elite reads made");
    await page.selectOption('[data-testid="cal-user"]', "usrDanno00001");
    await page.check('[data-testid="cal-sure"]');
    await page.locator('[data-testid="cal-write"]').click();
    await page.locator('[data-testid="cal-written-elite"]').waitFor({ timeout: 60000 });
    s = await state();
    must(s.writes.length === 4 && s.writes[3].method === "PUT" && s.writes[3].id === eliteId && s.calendars.filter((c) => c.slug === "elite-conversation").length === 1, "pressed again: both updated in place, still one Elite");
    console.log("✓ Step 2: Academy first, Elite created, only the brief's changes on the template's settings; again: updated in place");

    // 5. Step 3.
    await page.fill('[data-testid="cal-contact"]', "not an id!");
    await page.locator('[data-testid="cal-test"]').click();
    must((await page.locator('[data-testid="cal-test-error"]').innerText({ timeout: 30000 })).includes("test contact"), "a bad contact id is refused");
    must(!(await state()).appointments.length, "no booking made");
    await page.fill('[data-testid="cal-contact"]', "TestContact0000000001");
    await page.locator('[data-testid="cal-test"]').click();
    await page.locator('[data-testid="cal-tested"]').waitFor({ timeout: 90000 });
    s = await state();
    must(s.appointments.length === 2 && s.appointments.every((a) => a.status === "cancelled" && a.toNotify === false && a.contactId === "TestContact0000000001"), `two bookings, both cancelled, no email: ${JSON.stringify(s.appointments)}`);
    must(new Set(s.appointments.map((a) => a.calendarId)).size === 2 && s.appointments.some((a) => a.calendarId === COPY) && s.appointments.some((a) => a.calendarId === eliteId), "one on each calendar");
    for (const k of ["academy", "elite"]) {
      const t = await page.locator(`[data-testid="cal-tested-${k}"]`).innerText();
      must(/Zoom link: yes/.test(t) && /Cancelled: yes/.test(t) && !t.includes("pwd="), `${k}: Zoom yes, cancelled, no passcode shown: ${t}`);
    }
    console.log("✓ Step 3: one test booking on each, a Zoom link on each, both cancelled, no email sent");

    // 6. A member; the phone width.
    const member = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await login(member, "As a client");
    await member.goto(`${base}/hermes/calendars`);
    await member.waitForURL(/\/today/);
    must(!(await member.locator('[data-testid="cal-page"]').count()), "a member never sees the page");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('[data-testid="cal-read"]').waitFor();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    must(wide <= 0, `nothing wider than the screen at 390 (${wide}px over)`);
    console.log("✓ a member is turned away; at 390 nothing is wider than the screen");

    // 7. The log.
    must(!failures.length, `no server errors: ${failures.join(", ")}`);
    if (existsSync(logFile)) {
      const log = readFileSync(logFile, "utf8").slice(logStart);
      for (const t of ["pit-cal", "pit-nocal"]) must(!log.includes(t), `the server log never holds the key "${t}"`);
      console.log("✓ the server log holds no key");
    }
    console.log("\ncalendars walk: all checks passed");
  } finally {
    await browser.close();
    await db.delete(schema.socialConnections).where(and(eq(schema.socialConnections.userId, coach.id), eq(schema.socialConnections.provider, "gohighlevel")));
    if (integ && before) await db.update(schema.integrations).set({ config: before }).where(eq(schema.integrations.id, integ.id));
    if (child?.pid) try { process.kill(-child.pid); } catch { /* gone */ }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
