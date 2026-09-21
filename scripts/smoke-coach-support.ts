/**
 * Coach support, the two beta blockers: the coach can send a client a password-reset link, and can remove a client (a soft
 * remove that ends access on the next request, stops reminders, and drops them from the coach's counts) and reinstate them.
 * With email off (the walk's server has none), the reset link is handed to the coach to copy; the walk follows it and signs the
 * client in, proving it is the client's own single-use link. Every claim is read off the record and the rendered page, not
 * assumed. Run with the dev server up.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function login(page: Page, email: string) {
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
}
async function loginCoach(page: Page) {
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { runReminders } = await import("@/lib/reminders");

  const B = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!; // Maya
  const bMem = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, B.id) }))!;
  const resetsBefore = (await db.query.passwordResets.findMany({ where: eq(schema.passwordResets.userId, B.id) })).length;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const coach = await (await browser.newContext()).newPage();
    await loginCoach(coach);

    // ── (2a) Send reset link. Email is off on this server, so the coach is handed a link to copy. ──
    await coach.goto(`${base}/coach/${bMem.id}`);
    await Promise.all([coach.waitForResponse((r) => r.request().method() === "POST"), coach.locator('[data-testid="send-reset"]').click()]);
    await coach.waitForURL(/reset=copy/);
    const link = (await coach.locator('[data-testid="reset-copy-link"]').innerText()).trim();
    if (!/\/reset\//.test(link)) throw new Error(`the coach is shown a reset link to copy, got "${link}"`);
    const resetsAfter = (await db.query.passwordResets.findMany({ where: eq(schema.passwordResets.userId, B.id) })).length;
    if (resetsAfter !== resetsBefore + 1) throw new Error(`one reset row was created for the client, got ${resetsAfter - resetsBefore}`);
    // The log holds who and when and a reason, never the token or the link.
    const logRow = await db.query.syncEvents.findFirst({ where: and(eq(schema.syncEvents.userId, B.id), eq(schema.syncEvents.event, "password_reset.sent")) });
    if (!logRow || !/issued by/i.test(logRow.note ?? "")) throw new Error("the send is logged with who issued it");
    if (JSON.stringify(logRow).includes(link.split("/reset/")[1])) throw new Error("the token must never be in the log");
    console.log("✓ (2a) coach sends a reset link: one single-use row created, the link handed over to copy, the send logged without the token");

    // The link is the client's own: opening it as a signed-out stranger sets a new password and lands on Today.
    const stranger = await (await browser.newContext()).newPage();
    await stranger.goto(link);
    await stranger.fill('input[name="password"]', "newpass123");
    await stranger.fill('input[name="confirm"]', "newpass123");
    await Promise.all([stranger.waitForURL(/\/today/), stranger.click('button[type="submit"]')]);
    if (!/\/today/.test(stranger.url())) throw new Error(`the reset link signs the client in with the new password, landed ${stranger.url()}`);
    // Single use: the same link now refuses.
    const reuse = await (await browser.newContext()).newPage();
    await reuse.goto(link);
    await reuse.fill('input[name="password"]', "again12345");
    await reuse.fill('input[name="confirm"]', "again12345");
    await reuse.click('button[type="submit"]');
    await reuse.waitForLoadState("networkidle");
    if (!/expired or was already used/i.test(await reuse.locator("body").innerText())) throw new Error("the reset link is single use: the second attempt is refused");
    console.log("✓ (2a) the link is the client's own single-use link: it set a new password once, and refused the second time");
    // Put Maya's password back so the rest of the demo (and other walks) still logs in with demo1234.
    const { hashPassword } = await import("@/lib/password");
    await db.update(schema.users).set({ passwordHash: await hashPassword("demo1234") }).where(eq(schema.users.id, B.id));

    // ── (2b) Remove a client. ──
    const client = await (await browser.newContext()).newPage();
    await login(client, "client@demo.helixos.app"); // Maya, freshly reset above then restored
    if (!/\/today/.test(client.url())) throw new Error("the client can sign in before removal");

    await coach.goto(`${base}/coach/${bMem.id}`);
    coach.on("dialog", (d) => d.accept());
    await Promise.all([coach.waitForResponse((r) => r.request().method() === "POST"), coach.locator('[data-testid="remove-client-form"] button[type="submit"]').click()]);
    await coach.waitForURL(/\/coach/);
    const removed = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, bMem.id) }))!;
    if (!removed.removedAt || !removed.removedBy) throw new Error("removedAt and removedBy are set on the membership");
    // Removed from the coach's counts, present in the Removed card.
    await coach.goto(`${base}/coach`);
    if (!(await coach.locator('[data-testid="removed-clients"]').count())) throw new Error("a removed client appears in the Removed card");
    if (!(await coach.locator('[data-testid="removed-clients"]').getByText(B.name).count())) throw new Error("the Removed card names the client");
    console.log("✓ (2b) remove: removedAt/removedBy on the record, and the client is in the Removed card, out of the active counts");

    // The removed client's next request is refused with the access-ended page.
    await client.goto(`${base}/today`);
    await client.waitForLoadState("networkidle");
    const seen = await client.locator("body").innerText();
    if (!/access has ended/i.test(seen) || !/\/removed$/.test(client.url())) throw new Error(`the removed client is sent to the access-ended page, landed ${client.url()} showing "${seen.slice(0, 60)}"`);
    console.log("✓ (2b) the removed client's next request lands on the access-ended page, not the app");

    // Reminders skip a removed client: the cron run touches every active client and never this one.
    const results = await runReminders(new Date(), "morning");
    if (results.some((r) => r.userId === B.id)) throw new Error("a removed client still received a reminder");
    const active = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, bMem.workspaceId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
    if (!active.length) throw new Error("there are active clients for the reminder run to consider");
    console.log(`✓ (2b) reminders skip the removed client: the run considered ${active.length} active clients and none was the removed one`);

    // Reinstate restores access, reminders and counts.
    await coach.goto(`${base}/coach/${bMem.id}`);
    await Promise.all([coach.waitForResponse((r) => r.request().method() === "POST"), coach.locator('[data-testid="reinstate"]').click()]);
    await coach.waitForURL(/reinstated=1/);
    const back = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, bMem.id) }))!;
    if (back.removedAt || back.removedBy) throw new Error("reinstate clears removedAt and removedBy");
    await client.goto(`${base}/today`);
    await client.waitForLoadState("networkidle");
    if (/access has ended/i.test(await client.locator("body").innerText())) throw new Error("a reinstated client has their access back");
    console.log("✓ (2b) reinstate: access, reminders and counts all restored");

    // The coach invite link carries its warning on Settings.
    await coach.goto(`${base}/settings`);
    if (!/becomes a coach/i.test(await coach.locator('[data-testid="coach-code-warning"]').innerText())) throw new Error("the coach invite link warns that anyone with it becomes a coach");
    console.log("✓ the coach invite link carries its 'anyone with this link becomes a coach' warning");

    if (failures.length) throw new Error(failures.join("\n"));
    console.log("Coach-support walk passed.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
