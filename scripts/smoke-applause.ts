/**
 * Applause on Colosseum wins (H-1171, plan H-1177), end to end: Maya applauds another member's win and both earn points (2 and
 * 5); her own win has no button; taking it back the same day takes the points back; the coach's applause gives her 10, named;
 * Today tells her and closes; at 390 the button is a 44 px target and nothing scrolls sideways.
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
/** Polls until the check holds: a form's POST can land after another request on the page answers. */
async function until(page: Page, check: () => Promise<boolean>, msg: string) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await page.waitForTimeout(250);
  }
  throw new Error(msg);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, like } = await import("drizzle-orm");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const W = mm.workspaceId;
  const coachM = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, W), eq(schema.memberships.role, "coach")) }))!;
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.id, coachM.userId) }))!;
  const wasOn = Boolean((await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, W) }))!.colosseumOn);

  const CROWD = "applause-crowd@example.com";
  const clear = async () => {
    await db.delete(schema.winApplause).where(eq(schema.winApplause.workspaceId, W));
    await db.delete(schema.colosseumWins).where(and(eq(schema.colosseumWins.workspaceId, W), like(schema.colosseumWins.id, "smoke-applause-%")));
    for (const p of ["applaud:%", "unapplaud:%", "applauded:%", "unapplauded:%", "win-down:%"])
      await db.delete(schema.pointsLedger).where(and(eq(schema.pointsLedger.workspaceId, W), like(schema.pointsLedger.refId, p)));
    for (const u of await db.query.users.findMany({ where: eq(schema.users.email, CROWD), columns: { id: true } })) {
      await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.userId, u.id));
      await db.delete(schema.memberships).where(eq(schema.memberships.userId, u.id));
      await db.delete(schema.users).where(eq(schema.users.id, u.id));
    }
  };
  await clear();
  await db.update(schema.workspaces).set({ colosseumOn: true }).where(eq(schema.workspaces.id, W));
  await db.update(schema.memberships).set({ applauseSeenAt: null, arenaHidden: false }).where(eq(schema.memberships.id, mm.id));
  const crowdId = crypto.randomUUID();
  await db.insert(schema.users).values({ id: crowdId, email: CROWD, name: "Crowd Applause", passwordHash: "x" });
  await db.insert(schema.memberships).values({ id: crypto.randomUUID(), workspaceId: W, userId: crowdId, role: "client" });
  await db.insert(schema.colosseumWins).values({ id: "smoke-applause-crowd", workspaceId: W, userId: crowdId, kind: "business", text: "Signed my second client this week" });
  await db.insert(schema.colosseumWins).values({ id: "smoke-applause-maya", workspaceId: W, userId: maya.id, kind: "community", text: "Hosted my first live workshop" });

  const sum = async (userId: string, prefix: string) =>
    (await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.workspaceId, W), eq(schema.pointsLedger.userId, userId), like(schema.pointsLedger.refId, `${prefix}%`)) })).reduce((t, r) => t + r.points, 0);
  const rows = async (winId: string) => db.query.winApplause.findMany({ where: eq(schema.winApplause.winId, winId) });
  const WINS = `${base}/rewards?tab=colosseum&section=wins`;
  const crowdWin = '[data-testid="tab-wins-body"] [data-testid="win"][data-win="smoke-applause-crowd"]';
  const mayaWin = '[data-testid="tab-wins-body"] [data-testid="win"][data-win="smoke-applause-maya"]';

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  try {
    // ── Maya applauds another member's win; her own has no button. ──
    await login(page, "As a client");
    await page.goto(WINS, { waitUntil: "networkidle" });
    await page.locator(crowdWin).waitFor({ timeout: 15000 });
    must((await page.locator(`${mayaWin} [data-testid="win-applaud"]`).count()) === 0, "no Applaud on her own win");
    const clap = page.locator(`${crowdWin} [data-testid="win-applaud"]`);
    must((await clap.getAttribute("aria-pressed")) === "false", "not applauded yet");
    await clap.click();
    await until(page, async () => (await rows("smoke-applause-crowd")).length === 1, "her applause was saved");
    await until(page, async () => (await clap.getAttribute("aria-pressed")) === "true", "the button shows Applauded");
    must((await sum(maya.id, "applaud:smoke-applause-crowd")) === 2, "Maya earned 2 for applauding");
    must((await sum(crowdId, "applauded:smoke-applause-crowd:")) === 5, "the winner earned 5");
    await page.goto(WINS, { waitUntil: "networkidle" });
    must((await page.locator(`${crowdWin} [data-testid="win-applause"]`).getAttribute("data-count")) === "1", "the count reads 1 after a reload");
    await page.locator(`${crowdWin} [data-testid="win-applause-count"]`).click();
    must((await page.locator(`${crowdWin} [data-testid="win-applause-who"]`).innerText()).includes("You"), "who applauded shows You");
    console.log("✓ Maya applauds another member's win: one row, 2 for her, 5 for the winner; no button on her own win");

    // ── Taking it back the same day takes the points back as minus rows. ──
    await page.locator(`${crowdWin} [data-testid="win-applaud"]`).click();
    await until(page, async () => (await rows("smoke-applause-crowd")).length === 0, "her applause was taken back");
    await until(page, async () => (await sum(maya.id, "applaud:smoke-applause-crowd")) + (await sum(maya.id, "unapplaud:smoke-applause-crowd")) === 0, "her 2 came back off");
    await until(page, async () => (await sum(crowdId, "applauded:smoke-applause-crowd:")) + (await sum(crowdId, "unapplauded:smoke-applause-crowd:")) === 0, "the winner's 5 came back off");
    console.log("✓ taking it back the same day takes both awards back");

    // ── The coach applauds Maya's win: 10 for her, named. ──
    await login(page, "As the coach");
    await page.goto(WINS, { waitUntil: "networkidle" });
    await page.locator(`${mayaWin} [data-testid="win-applaud"]`).click();
    await until(page, async () => (await rows("smoke-applause-maya")).length === 1, "the coach's applause was saved");
    await until(page, async () => (await sum(maya.id, "applauded:smoke-applause-maya:")) === 10, "Maya earned 10 from her coach");
    must((await sum(coach.id, "applaud:")) === 0, "the coach earns nothing for applauding");
    const first = (coach.name ?? "").trim().split(/\s+/)[0];
    const reasons = (await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), like(schema.pointsLedger.refId, "applauded:smoke-applause-maya:%")) })).map((r) => r.reason);
    must(reasons.includes(`${first} applauded your win`), `the award names the coach: ${reasons.join(" | ")}`);
    console.log("✓ the coach's applause gives 10, named, and earns the coach nothing");

    // ── Today tells Maya, and closes. ──
    await login(page, "As a client");
    await page.goto(`${base}/today`, { waitUntil: "networkidle" });
    const line = page.locator('[data-testid="today-applause-line"]');
    await line.waitFor({ timeout: 15000 });
    must((await line.innerText()).includes(`${first} applauded your win: Hosted my first live workshop`), `Today's line: ${await line.innerText()}`);
    must(/\/rewards\?tab=colosseum&section=wins$/.test((await line.getAttribute("href")) ?? ""), "the line goes to the wins");
    await page.locator('[data-testid="today-applause-close"]').click();
    await until(page, async () => Boolean((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!.applauseSeenAt), "closing marks it seen");
    await page.goto(`${base}/today`, { waitUntil: "networkidle" });
    must((await page.locator('[data-testid="today-applause"]').count()) === 0, "closed, the line stays gone");
    console.log("✓ Today says who applauded which win, goes to the wins, and closes for good");

    // ── At 390: a 44 px target and nothing sideways. ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(WINS, { waitUntil: "networkidle" });
    const box = (await page.locator(`${crowdWin} [data-testid="win-applaud"]`).boundingBox())!;
    must(box.height >= 44 && box.width >= 44, `the button is a 44 px target at 390: ${box.width}x${box.height}`);
    must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, "at 390 nothing scrolls sideways");
    console.log("✓ at 390 the button is a 44 px target and nothing scrolls sideways");

    must(failures.length === 0, `server errors: ${failures.join(", ")}`);
    console.log("applause walk passed");
  } finally {
    await browser.close();
    await clear();
    await db.update(schema.workspaces).set({ colosseumOn: wasOn }).where(eq(schema.workspaces.id, W));
    await db.update(schema.memberships).set({ applauseSeenAt: null }).where(eq(schema.memberships.id, mm.id));
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
