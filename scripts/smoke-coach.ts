/**
 * Earn Your Way, batch 2: the coach can open a client. Roster rows link to /coach/[clientId]; the page shows where they
 * are, their own words, pathway state, claims, what they've built and their pillar split; a call note becomes tasks in the
 * client's Today and Tasks marked as from the call; the nudge is on the page; an inbound GoHighLevel appointment books an
 * open claim only when the match is certain. Needs the dev server (GHL_WEBHOOK_PUBLIC_KEY and REWARDS_CONFIG_OVERRIDE set).
 */
import { createPrivateKey, sign } from "node:crypto";
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const overridePath = process.env.REWARDS_CONFIG_OVERRIDE ?? "screenshots/logs/rewards-config.override.json";
const SMOKE_GHL_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJRyao0LTanJUp2y74dA69WrRmLTzSUbFFr4VOzwI02j\n-----END PRIVATE KEY-----\n";
mkdirSync("screenshots/logs", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}
async function login(page: Page, who: "client" | "coach") {
  await page.goto(`${base}/settings`).catch(() => null);
  if (await page.locator('button:has-text("Log out")').count()) {
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
  } else await page.goto(`${base}/login`);
  await page.click(who === "client" ? 'button:has-text("As a client")' : 'button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { nowIso } = await import("@/lib/dates");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = mm.workspaceId;
  writeFileSync(overridePath, JSON.stringify({ perMonth: "calendar", bookingLinks: { "VIP Laser Coaching Call": "https://booking.example.test/vip", "Offer + Messaging Alignment Session": "https://booking.example.test/alignment" }, calendarIds: {} }, null, 2));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // Roster → detail
    await login(page, "coach");
    await page.goto(`${base}/coach`);
    await page.locator('[data-testid="client-link"]', { hasText: "Maya" }).first().click();
    await page.waitForURL(new RegExp(`/coach/${mm.id}$`));
    for (const t of ["Tier", "Streak", "Last active", "Goal", "In their words", "Call notes", "Pathway", "Claimed rewards", "What they've built", "Revenue by pillar"]) await expectText(page, t, `detail: ${t}`);
    const words = await page.locator('[data-testid="their-words"] li').count();
    if (words < 3) throw new Error(`expected the client's recent days in their own words, saw ${words}`);
    const strip = await page.locator('[data-testid="client-strip"]').innerText();
    if (!/pts/.test(strip) || !/🔥 \d+/.test(strip)) throw new Error(`strip missing points or streak:\n${strip}`);
    await page.screenshot({ path: "screenshots/co01-client-detail.png", fullPage: true });
    console.log(`✓ detail view: ${words} days in their words, strip, pathway, claims, built, pillars`);

    // Nudge from the detail view
    await submit(page, 'button:has-text("Nudge")');
    await expectText(page, "nudged today", "nudge on detail");
    console.log("✓ nudge from the detail view");

    // Call notes → tasks in the client's app
    await page.fill('textarea[name="body"]', "Decided: run the first webinar on the 20th. Offer stays at $497.");
    await page.fill('textarea[name="tasks"]', "- Write the webinar title\n- Invite 10 people from the group");
    await page.selectOption('select[name="due"]', "today");
    await submit(page, '[data-testid="note-form"] button[type="submit"]');
    await expectText(page, "Offer stays at $497", "note saved");
    const noteRow = page.locator('[data-testid="note-row"]').first();
    const noteText = await noteRow.innerText();
    if (!/Write the webinar title/.test(noteText) || !/Invite 10 people/.test(noteText)) throw new Error(`note should list the tasks it created:\n${noteText}`);
    const created = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.source, "coach_call")) });
    if (created.length !== 2 || created.some((t) => !t.sourceRef)) throw new Error(`expected 2 coach_call tasks with a sourceRef, got ${JSON.stringify(created.map((t) => [t.title, t.source, t.sourceRef]))}`);
    console.log("✓ call note saved; 2 tasks created with source coach_call");

    // Booking signal: an inbound appointment books the only open claim; two open claims are never guessed between
    const machine = await browser.newContext();
    const post = async (payload: Record<string, unknown>) => {
      const body = JSON.stringify({ type: "AppointmentCreate", locationId: "loc_maya", email: "client@demo.helixos.app", full_name: "Maya Torres", ...payload });
      const signature = sign(null, Buffer.from(body), createPrivateKey(SMOKE_GHL_PRIVATE_KEY)).toString("base64");
      const r = await machine.request.post(`${base}/api/webhooks/ghl`, { headers: { "x-ghl-signature": signature, "content-type": "application/json" }, data: body });
      if (r.status() !== 200) throw new Error(`webhook returned ${r.status()}: ${await r.text()}`);
      return ((await r.json()) as { note: string }).note;
    };
    const claimA = crypto.randomUUID();
    const claimB = crypto.randomUUID();
    await db.insert(schema.rewardClaims).values([
      { id: claimA, workspaceId: ws, userId: maya.id, rewardName: "VIP Laser Coaching Call", pointsSpent: 750, createdAt: nowIso() },
      { id: claimB, workspaceId: ws, userId: maya.id, rewardName: "Offer + Messaging Alignment Session", pointsSpent: 500, createdAt: nowIso() },
    ]);
    const ambiguous = await post({ id: "appt-1", appointment: { startTime: "2030-01-05T17:00:00.000Z" } });
    if (!/2 open claims/.test(ambiguous) || !/calendarIds/.test(ambiguous)) throw new Error(`two open claims must not be guessed between: "${ambiguous}"`);
    const untouched = await db.query.rewardClaims.findMany({ where: eq(schema.rewardClaims.userId, maya.id) });
    if (untouched.some((c) => c.bookedAt)) throw new Error("an ambiguous appointment marked a claim booked");
    writeFileSync(overridePath, JSON.stringify({ perMonth: "calendar", bookingLinks: { "VIP Laser Coaching Call": "https://booking.example.test/vip", "Offer + Messaging Alignment Session": "https://booking.example.test/alignment" }, calendarIds: { "VIP Laser Coaching Call": "cal_vip" } }, null, 2));
    const certain = await post({ id: "appt-2", calendarId: "cal_vip", appointment: { startTime: "2030-01-05T17:00:00.000Z" } });
    if (!/Booked "VIP Laser Coaching Call" \(calendar cal_vip\)/.test(certain)) throw new Error(`mapped calendar should book VIP: "${certain}"`);
    const remaining = await post({ id: "appt-3", appointment: { startTime: "2030-01-06T17:00:00.000Z" } });
    if (!/Booked "Offer \+ Messaging Alignment Session" \(only open claim\)/.test(remaining)) throw new Error(`single open claim should book: "${remaining}"`);
    const none = await post({ id: "appt-4", appointment: { startTime: "2030-01-07T17:00:00.000Z" } });
    if (!/No open reward claim/.test(none)) throw new Error(`no open claim should book nothing: "${none}"`);
    const vipRow = await db.query.rewardClaims.findFirst({ where: eq(schema.rewardClaims.id, claimA) });
    if (vipRow?.bookedAt !== "2030-01-05T17:00:00.000Z" || vipRow.bookedRef !== "appt-2") throw new Error(`VIP claim not stamped from the appointment: ${JSON.stringify(vipRow)}`);
    await page.reload();
    const claimsText = await page.locator('[data-testid="client-claims"]').innerText();
    if ((claimsText.match(/booked for/g) ?? []).length !== 2) throw new Error(`detail view should show both claims booked:\n${claimsText}`);
    await page.goto(`${base}/coach`);
    const coachClaims = await page.locator('[data-testid="claims-list"]').innerText();
    if (!/VIP Laser Coaching Call[\s\S]*booked for/.test(coachClaims)) throw new Error(`coach claims card should say booked:\n${coachClaims}`);
    await machine.close();
    console.log("✓ appointments: ambiguity reported not guessed, mapped calendar certain, single open claim booked; shown on both views");

    // The client sees the tasks in the daily loop, marked as from the call
    await login(page, "client");
    await page.goto(`${base}/today`);
    await expectText(page, "Write the webinar title", "task on Today");
    const originTag = await page.locator('[data-testid="task-origin"]').first().innerText();
    if (!/From your call on/.test(originTag)) throw new Error(`task should say it came from the call, got "${originTag}"`);
    await page.goto(`${base}/tasks`);
    await expectText(page, "Invite 10 people from the group", "task on Tasks");
    if ((await page.locator('[data-testid="task-origin"]').count()) < 2) throw new Error("both call tasks should carry the origin tag on Tasks");
    await page.screenshot({ path: "screenshots/co02-client-tasks.png", fullPage: true });
    console.log("✓ client: call tasks on Today and Tasks, tagged with the call date");

    // A client can't open the coach view; a membership from nowhere is a 404
    await page.goto(`${base}/coach/${mm.id}`);
    if (!/\/today/.test(page.url())) throw new Error(`a client reached ${page.url()}`);
    await login(page, "coach");
    const missing = await page.goto(`${base}/coach/not-a-membership`);
    if (missing?.status() !== 404) throw new Error(`unknown membership should 404, got ${missing?.status()}`);
    console.log("✓ access: client redirected, unknown membership 404");
  } finally {
    await browser.close();
    rmSync(overridePath, { force: true });
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Coach smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    rmSync(overridePath, { force: true });
    process.exit(1);
  });
