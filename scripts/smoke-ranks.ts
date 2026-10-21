/**
 * The kept rank (H-1088, plan H-1093): the thresholds rose from Alchemist up, and nobody lost a rank. Maya, kept at Sentinel
 * with points that now earn only Alchemist, still shows Sentinel on the Rewards ladder with Centurion at 12,000 next, gets no
 * ceremony, and her coach switched in sees the same rank and writes nothing. With nothing kept, her points earn Alchemist, and
 * opening HelixOS records that as her kept rank. Runs against the dev server; fixtures go straight to the database.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { tierFor, TIERS } = await import("@/lib/engine/tiers");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  // The app's own count: this workspace's rows only.
  const total = async () => (await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.workspaceId, mm.workspaceId)) })).reduce((s, r) => s + r.points, 0);
  const member = async () => (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mm.id) }))!;
  const was = { kept: mm.rankKeptLevel, celebrated: mm.celebratedTierLevel, welcome: mm.welcomeShownOn };
  const sentinel = TIERS.find((t) => t.name === "Sentinel")!;
  const centurion = TIERS.find((t) => t.name === "Centurion")!;
  const points = await total();
  const earned = tierFor(points);
  must(earned.level < sentinel.level, `Maya's points earn less than Sentinel under the new table (${points}, ${earned.name})`);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) =>
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
  const ladder = async (page: Page) => {
    await page.goto(`${base}/rewards`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="tier-ladder"]').waitFor({ timeout: 20000 });
    const current = await page.locator('[data-testid="tier-ladder"] [data-state="current"]').getAttribute("data-tier");
    const next = await page.locator('[data-testid="tier-ladder"] [data-state="next"]').getAttribute("data-tier");
    const reached = await page.locator('[data-testid="tier-ladder"] [data-state="reached"]').count();
    return { current, next, reached };
  };
  try {
    // ── Kept at Sentinel: the ladder, the next rank, no ceremony. ──
    await db.update(schema.memberships).set({ rankKeptLevel: sentinel.level, celebratedTierLevel: sentinel.level, welcomeShownOn: "2099-01-01" }).where(eq(schema.memberships.id, mm.id));
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.waitForTimeout(1200);
    must((await page.locator('[data-testid="rank-up"]').count()) === 0, "kept at Sentinel: no ceremony replays");
    const kept = await ladder(page);
    must(kept.current === "Sentinel" && kept.next === "Centurion", `the ladder keeps Sentinel, Centurion next (${JSON.stringify(kept)})`);
    must(kept.reached === sentinel.level - 1, `every rank below Sentinel shows as reached (${kept.reached})`);
    const nextLine = (await page.locator('[data-testid="tier-ladder"] [data-state="next"]').innerText()).replace(/\s+/g, " ");
    const now = await total();
    must(nextLine.includes((centurion.minPoints - now).toLocaleString()), `Centurion's distance is counted from the real points (${now.toLocaleString()} points, ${(centurion.minPoints - now).toLocaleString()} to go): ${nextLine}`);
    must((await member()).rankKeptLevel === sentinel.level, "the kept rank is not lowered by an open");
    await ctx.close();

    // ── The coach switched in sees the same rank and writes nothing. ──
    const kx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const kp = await kx.newPage();
    watch(kp);
    await kp.goto(`${base}/login`);
    await kp.click('button:has-text("As the coach")');
    await kp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    await kp.goto(`${base}/coach/${mm.id}`, { waitUntil: "networkidle" });
    await kp.click('[data-testid="switch-open"]');
    await kp.locator('[data-testid="switch-back"]').first().waitFor({ timeout: 30000 });
    const seen = await ladder(kp);
    must(seen.current === "Sentinel", `switched in, the coach sees Maya's kept rank (${seen.current})`);
    await kp.locator('[data-testid="switch-back"]').first().click();
    await kx.close();

    // ── Nothing kept: the points earn their rank, and the open records it. ──
    await db.update(schema.memberships).set({ rankKeptLevel: null }).where(eq(schema.memberships.id, mm.id));
    const nx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const np = await nx.newPage();
    watch(np);
    await np.goto(`${base}/login`);
    await np.click('button:has-text("As a client")');
    await np.waitForURL(/\/today/);
    const plain = await ladder(np);
    must(plain.current === earned.name, `with nothing kept, the points earn ${earned.name} (${plain.current})`);
    must((await member()).rankKeptLevel === earned.level, `the open records ${earned.name} as kept (${(await member()).rankKeptLevel})`);
    await nx.close();
    must(failures.length === 0, `no server errors:\n${failures.join("\n")}`);
    console.log(`✓ the kept rank: Sentinel kept at ${points.toLocaleString()} points (${earned.name} by points), Centurion next at ${centurion.minPoints.toLocaleString()}, no ceremony, the coach switched in sees Sentinel and writes nothing; with nothing kept the open records ${earned.name}`);
  } finally {
    await db.update(schema.memberships).set({ rankKeptLevel: was.kept, celebratedTierLevel: was.celebrated, welcomeShownOn: was.welcome }).where(eq(schema.memberships.id, mm.id));
    await browser.close();
  }
  console.log("Ranks smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
