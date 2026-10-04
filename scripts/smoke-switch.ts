/**
 * "Switch to client" (revs 216 and 236):
 *  1. The client's own "Let my coach work in my HelixOS" (off by default for someone who joined), in their Settings.
 *  2. View: the banner, their HelixOS as they see it, every control disabled, and a write that gets through refused on the
 *     server with its reason. Body is not found, their export is refused, Settings shows only "set"/"not set". Back again.
 *  3. Work (once they allow it): an offer created and edited, each logged for the client in plain words; the lock-in refused;
 *     no points, nothing marked seen, no first sign-in for them.
 *  4. The client sees "Changes by your coach".
 *  5. A switch into another workspace's client, or into a removed one, simply isn't a switch.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

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

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  const failures: string[] = [];
  try {
    const coach = (await db.query.users.findFirst({
      where: eq(schema.users.email, "coach@demo.helixos.app"),
    }))!;
    const maya = (await db.query.users.findFirst({
      where: eq(schema.users.email, "client@demo.helixos.app"),
    }))!;
    const jordan = (await db.query.users.findFirst({
      where: eq(schema.users.email, "client2@demo.helixos.app"),
    }))!;
    const mayaM = (await db.query.memberships.findFirst({
      where: eq(schema.memberships.userId, maya.id),
    }))!;
    const jordanM = (await db.query.memberships.findFirst({
      where: eq(schema.memberships.userId, jordan.id),
    }))!;
    const ws = mayaM.workspaceId;
    // Maya shares Body and has it on: a switched coach must still never see it.
    await db
      .update(schema.memberships)
      .set({
        coachCanWork: false,
        bodyEnabled: true,
        whatsNewSeen: null,
        celebratedTierLevel: null,
      })
      .where(eq(schema.memberships.id, mayaM.id));
    await db.delete(schema.coachChanges).where(eq(schema.coachChanges.userId, maya.id));
    await db.delete(schema.offers).where(and(eq(schema.offers.userId, maya.id), eq(schema.offers.name, "Walk offer")));

    const context = await browser.newContext({
      viewport: { width: 1300, height: 950 },
    });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));

    // ── 1. The client's own setting: off for someone who joined, nothing changed by the coach yet. ──
    await login(page, "As a client");
    await page.goto(`${base}/settings#your-coach`);
    if ((await page.locator('[data-testid="coach-work"]').getAttribute("data-on")) !== "0") throw new Error("Let my coach work starts off for a client who joined");
    if (!(await page.locator('[data-testid="your-coach"], #your-coach').first().innerText()).includes("hasn't changed anything"))
      throw new Error("the client sees their coach hasn't changed anything");
    await logout(page);
    console.log('✓ the client\'s Settings: "Let my coach work in my HelixOS" off by default, and no changes by the coach');

    // ── 2. View. ──
    await db.update(schema.users).set({ firstSignedInAt: null }).where(eq(schema.users.id, maya.id));
    const pointsBefore = (
      await db.query.pointsLedger.findMany({
        where: eq(schema.pointsLedger.userId, maya.id),
      })
    ).length;
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${mayaM.id}`);
    if ((await page.locator('[data-testid="client-switch"]').getAttribute("data-can-work")) !== "0" || (await page.locator('[data-testid="switch-work"]').count()))
      throw new Error("with the setting off, the coach can only view");
    await submit(page, '[data-testid="switch-view"]');
    await page.waitForURL(/\/today/);
    const banner = page.locator('[data-testid="switch-banner"]');
    if ((await banner.getAttribute("data-mode")) !== "view" || !(await banner.innerText()).includes(`You're in ${maya.name}'s HelixOS as their coach (Viewing)`))
      throw new Error(`the banner says whose HelixOS and View: ${await banner.innerText()}`);
    if (!(await page.locator("aside").innerText()).includes(maya.name)) throw new Error("the coach sees the client's HelixOS as they see it");
    if (!(await page.locator('[data-testid="switch-view-lock"]').count())) throw new Error("every control is disabled while viewing");
    // A write that gets past the disabled controls is refused on the server, with the reason, and writes nothing.
    await page.goto(`${base}/tasks`);
    await page.evaluate(() => document.querySelector('[data-testid="switch-view-lock"]')?.removeAttribute("disabled"));
    await page.click('summary:has-text("+ New task")');
    await page.fill('input[name="title"]', "Written while viewing");
    await submit(page, 'button:has-text("Add task")');
    await page.locator('[data-testid="switch-error"]').waitFor({ timeout: 15000 });
    if (!(await page.locator('[data-testid="switch-error"]').innerText()).includes(`You're viewing ${maya.name.split(" ")[0]}'s HelixOS`)) throw new Error("the refusal says why");
    if (
      await db.query.tasks.findFirst({
        where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.title, "Written while viewing")),
      })
    )
      throw new Error("nothing is written while viewing");
    // Body: not found, even though the client has it on. Their export: refused. Settings: set or not set only.
    // Every (app) page streams behind loading.tsx, so a missing page is the app's not-found page with a 200 (the soft 404 the
    // Body walk checks the same way): the not-found page, and nothing of Body.
    for (const path of ["/body", "/body/settings", "/body/foods"]) {
      await page.goto(`${base}${path}`);
      await page.locator('[data-testid="item-gone"]').waitFor({ timeout: 30000 });
      if (await page.locator('[data-testid="body-start"], [data-testid="body-tiles"], [data-testid="body-private-note"]').count()) throw new Error(`${path} shows nothing of Body while switched`);
    }
    if ((await page.request.get(`${base}/api/export?format=json&scope=body`)).status() === 200) throw new Error("the Body export is refused while switched");
    const ex = await page.request.get(`${base}/api/export?format=json`);
    if (ex.status() !== 403) throw new Error(`the client's export is refused while switched (got ${ex.status()})`);
    await page.goto(`${base}/settings`);
    await page.locator('[data-testid="switched-settings-status"]').waitFor({ timeout: 15000 });
    if (await page.locator('text="Password"').count()) throw new Error("the client's password isn't on the switched Settings");
    console.log("✓ View: the banner, the client's HelixOS as they see it, controls disabled, a write refused with its reason, Body not found, the export refused, Settings set/not set only");
    await submit(page, '[data-testid="switch-back"]');
    await page.waitForURL(new RegExp(`/coach/${mayaM.id}`));
    if (await page.locator('[data-testid="switch-banner"]').count()) throw new Error("back in the coach's own account, no banner");
    await page.locator('[data-testid="client-switch"] summary').click();
    if ((await page.locator('[data-testid="client-switches"] li').count()) < 2) throw new Error("the coach's page shows the switch in and out");
    await logout(page);
    console.log("✓ Back to my account: the coach's own client page, with the switch in and out recorded");

    // ── 3. The client allows Work; the coach works. ──
    await login(page, "As a client");
    await page.goto(`${base}/settings#your-coach`);
    await page.locator('[data-testid="coach-work-toggle"]').check();
    await submit(page, '[data-testid="coach-work-save"]');
    if (
      !(await db.query.memberships.findFirst({
        where: eq(schema.memberships.id, mayaM.id),
      }))!.coachCanWork
    )
      throw new Error("the client turns Let my coach work on");
    await logout(page);
    // Maya's own visits just now stamped her tier celebration, as they should: from here on, only what the coach does counts.
    await db.update(schema.users).set({ firstSignedInAt: null }).where(eq(schema.users.id, maya.id));
    await db.update(schema.memberships).set({ whatsNewSeen: null, celebratedTierLevel: null }).where(eq(schema.memberships.id, mayaM.id));
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${mayaM.id}`);
    await submit(page, '[data-testid="switch-work"]');
    await page.waitForURL(/\/today/);
    if ((await page.locator('[data-testid="switch-banner"]').getAttribute("data-mode")) !== "work") throw new Error("Work mode once the client allows it");
    await page.goto(`${base}/offers`);
    await page.locator('summary:has-text("+ New offer")').click();
    await page.fill('input[name="name"]', "Walk offer");
    await submit(page, 'button:has-text("Open the wizard")');
    await page.waitForURL(/\/offers\/[^/]+$/);
    const offer = (await db.query.offers.findFirst({
      where: and(eq(schema.offers.userId, maya.id), eq(schema.offers.name, "Walk offer")),
    }))!;
    if (!offer) throw new Error("the coach creates an offer in the client's HelixOS");
    await page.fill('#who input[name="name"]', "Walk offer, edited");
    // The container is required on the form: pick the first real one.
    const container = page.locator('[data-testid="offer-container"]');
    const firstValue = await container.locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).find((v) => v));
    await container.selectOption(firstValue!);
    await submit(page, 'button:has-text("Save offer")');
    if (
      (await db.query.offers.findFirst({
        where: eq(schema.offers.id, offer.id),
      }))!.name !== "Walk offer, edited"
    )
      throw new Error("the coach edits the offer");
    // Rev 444 part two: a coach's typing in a client's form never becomes the client's draft on the server.
    await page.fill('#who input[name="name"]', "Coach typing, never saved");
    await page.waitForTimeout(3500);
    const coachDrafts = await db.query.formDrafts.findMany({ where: eq(schema.formDrafts.userId, maya.id) });
    if (coachDrafts.length) throw new Error(`nothing a switched coach types is kept as the client's draft: ${coachDrafts.map((d) => d.key).join(",")}`);
    await page.fill('#who input[name="name"]', "Walk offer, edited");
    console.log("✓ rev 444 part two: a coach switched in leaves no draft on the client's account");
    // The client's own: the lock-in is refused, with its reason. Today starts not locked in, so its form is the one on show.
    const { todayInTz } = await import("@/lib/dates");
    const mayaToday = todayInTz(
      mayaM.timezone ||
        (await db.query.workspaces.findFirst({
          where: eq(schema.workspaces.id, ws),
        }))!.timezone,
    );
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await db.delete(schema.dailyLogs).where(and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, mayaToday)));
    await page.goto(`${base}/today`);
    const redo = page.locator('summary:has-text("Redo lock-in")');
    if (await redo.isVisible()) await redo.click();
    await page.locator('label:has(input[name="energy"][value="4"])').click();
    await page.fill('input[name="intention"]', "Not mine to set");
    await submit(page, 'button:has-text("Lock it in")');
    await page.locator('[data-testid="switch-error"]').waitFor({ timeout: 15000 });
    if (!(await page.locator('[data-testid="switch-error"]').innerText()).includes("The lock-in, the close and the streak are")) throw new Error("the lock-in is the client's own");
    // Opening What's new marks nothing seen for them.
    await page.goto(`${base}/whats-new`);
    await page.locator('[data-testid="whats-new-entry"]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await submit(page, '[data-testid="switch-back"]');
    const after = (await db.query.memberships.findFirst({
      where: eq(schema.memberships.id, mayaM.id),
    }))!;
    if (after.whatsNewSeen !== null || after.celebratedTierLevel !== null) throw new Error(`nothing is marked seen for the client: ${after.whatsNewSeen} ${after.celebratedTierLevel}`);
    if ((await db.query.users.findFirst({ where: eq(schema.users.id, maya.id) }))!.firstSignedInAt !== null) throw new Error("switching in never counts as the client's first sign-in");
    if (
      (
        await db.query.pointsLedger.findMany({
          where: eq(schema.pointsLedger.userId, maya.id),
        })
      ).length !== pointsBefore
    )
      throw new Error("nothing a switched coach does scores points for the client");
    const changes = await db.query.coachChanges.findMany({
      where: and(eq(schema.coachChanges.userId, maya.id), eq(schema.coachChanges.kind, "change")),
    });
    const words = changes.map((c) => `${c.action} · ${c.item ?? ""} · ${c.page}`);
    if (!words.some((w) => w.startsWith("Created offer") && w.endsWith("Offers")) || !words.some((w) => w.startsWith("Updated offer · Walk offer") && w.endsWith("Offers")))
      throw new Error(`each change is logged in plain words: ${words.join(" | ")}`);
    if (changes.some((c) => c.coachUserId !== coach.id)) throw new Error("the coach is the one logged, never the client");
    await logout(page);
    console.log(`✓ Work: an offer created and edited (${words.length} changes logged in plain words), the lock-in refused, no points, nothing marked seen, no first sign-in for the client`);

    // ── 4. The client sees the changes. ──
    await login(page, "As a client");
    await page.goto(`${base}/settings#your-coach`);
    const seen = await page.locator('[data-testid="coach-changes"]').innerText();
    if (!seen.includes("Updated offer") || !seen.includes("Walk offer") || !seen.includes(`by ${coach.name} (coach)`)) throw new Error(`the client sees what their coach changed: ${seen}`);
    await logout(page);
    console.log("✓ the client's Settings lists each change: what, which item, where, and by their coach");

    // ── 5. Not a switch: a client in another workspace, or a removed one. Checked on every request, not only at the switch. ──
    const stamp = Date.now();
    const otherWs = newId();
    await db.insert(schema.workspaces).values({
      id: otherWs,
      name: "Another academy",
      slug: `switch-other-${stamp}`,
      clientInviteCode: `SWC${stamp}`,
      coachInviteCode: `SWK${stamp}`,
    });
    // Always undone, pass or fail: a real-looking workspace left here would stop the next reseed.
    const restore = async () => {
      await db.update(schema.memberships).set({ workspaceId: ws, removedAt: null }).where(eq(schema.memberships.id, jordanM.id));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, otherWs));
    };
    try {
      await login(page, "As the coach");
      // A fresh sign-in each time: the refused switch stays in that session and would count again once the client is back.
      const switchIntoJordan = async () => {
        await logout(page);
        await login(page, "As the coach");
        await page.goto(`${base}/coach/${jordanM.id}`);
        await submit(page, '[data-testid="switch-view"]');
        await page.waitForURL(/\/today/);
        await page.locator('[data-testid="switch-banner"]').waitFor({ timeout: 15000 });
      };
      const bannerGone = async (why: string) => {
        await page.goto(`${base}/today`);
        await page.locator("aside").waitFor({ timeout: 15000 });
        if ((await page.locator('[data-testid="switch-banner"]').count()) || (await page.locator("aside").innerText()).includes(jordan.name)) throw new Error(why);
      };
      await switchIntoJordan();
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      await db.update(schema.memberships).set({ workspaceId: otherWs }).where(eq(schema.memberships.id, jordanM.id));
      try {
        await bannerGone("a client in another workspace is never switched into: the switch is refused on the next request");
      } finally {
        await db.update(schema.memberships).set({ workspaceId: ws }).where(eq(schema.memberships.id, jordanM.id));
      }
      await switchIntoJordan();
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      await db.update(schema.memberships).set({ removedAt: new Date().toISOString() }).where(eq(schema.memberships.id, jordanM.id));
      try {
        await bannerGone("a removed client can't be switched into: the switch is refused on the next request");
      } finally {
        await db.update(schema.memberships).set({ removedAt: null }).where(eq(schema.memberships.id, jordanM.id));
      }
      // On a phone, the banner fits.
      await switchIntoJordan();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/today`);
      await page.locator('[data-testid="switch-banner"]').waitFor({ timeout: 15000 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("the banner scrolls sideways on a phone");
      await submit(page, '[data-testid="switch-back"]');
    } finally {
      await restore();
    }
    console.log("✓ a client moved to another workspace, or removed, is refused on the next request; the banner fits a phone");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Switch smoke passed");
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
