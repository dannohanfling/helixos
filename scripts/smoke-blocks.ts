/**
 * Block a member and report a win (H-735, plan H-745; App Store guideline 1.2), end to end at 1440 and at 390:
 * - Maya blocks Jordan from the ⋯ on his win: his win leaves her feed, his place in the standings and the arena reads
 *   "A member", the Rewards leaderboard says "A member" and shows first names with a last initial, and his photo route answers
 *   her 404; Settings → Blocked members lists him and Unblock brings everything back.
 * - Maya reports his win (harassment, with a note): it leaves her feed at once and lands in Coach → Issues and ideas as
 *   Content, with the win's words, its author and the reporter; Hide this win hides it for everyone and Maya's Settings →
 *   Your reports reads Handled; Show this win again undoes it. A report about the coach's win shows Support instead.
 * - A win with a listed word is held back with the plain line and the text kept in the box.
 * - /join carries the Terms and Community Guidelines line; the Guidelines carry the 24 hours line and zero tolerance; More
 *   has Help and support. Nothing scrolls sideways at 390.
 * The demo has Maya, Jordan and the coach: Jordan's win, his photo and his points this week are fixture rows, removed after.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const BLOB = "http://localhost:4050";
const PROOF_TOKEN = process.env.PROOF_BLOB_READ_WRITE_TOKEN ?? "vercel_blob_rw_PROOFSTORE_testsecret";
const JORDAN_WIN = "smoke-blocks-jordan-win";
const COACH_WIN = "smoke-blocks-coach-win";
const JORDAN_TEXT = "Smoke blocks: booked five discovery calls";
const COACH_TEXT = "Smoke blocks: ran the Friday call";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
}
async function login(page: Page, who: "As the coach" | "As a client") {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
const noSideways = async (page: Page, where: string, w: number) => must((await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true, `${w}: nothing scrolls sideways on ${where}`);
const wins = (section = "wins") => `${base}/rewards?tab=colosseum&section=${section}`;

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { WIN_REFUSED } = await import("@/lib/engine/word-filter");
  const { REPORTED, A_MEMBER } = await import("@/lib/engine/blocks");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = mm.workspaceId;
  const jm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, jordan.id), eq(schema.memberships.workspaceId, ws)) }))!;
  const wsBefore = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, ws) }))!;
  const jordanShort = `${jordan.name.split(" ")[0]} ${jordan.name.split(" ").slice(-1)[0][0]}.`;
  const mayaShort = `${maya.name.split(" ")[0]} ${maya.name.split(" ").slice(-1)[0][0]}.`;

  // Jordan's photo, in the walk's stand-in for the private store (unless another walk left one running).
  const blobUp = await fetch(`${BLOB}/__list`).then((r) => r.ok).catch(() => false);
  const blobProc = blobUp ? null : spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${BLOB}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  const put = await fetch(`${BLOB}/?pathname=${encodeURIComponent(`headshots/${ws}/smoke-blocks-512.jpg`)}`, { method: "PUT", headers: { authorization: `Bearer ${PROOF_TOKEN}`, "x-vercel-blob-access": "private", "x-allow-overwrite": "1", "x-content-type": "image/jpeg" }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]) });
  must(put.ok, `the stand-in store took Jordan's photo: ${put.status}`);
  const photoUrl = ((await put.json()) as { url: string }).url;

  const cleanup = async () => {
    await db.delete(schema.memberReports).where(and(eq(schema.memberReports.workspaceId, ws), eq(schema.memberReports.kind, "content")));
    await db.delete(schema.memberBlocks).where(eq(schema.memberBlocks.workspaceId, ws));
    await db.delete(schema.colosseumWins).where(inArray(schema.colosseumWins.id, [JORDAN_WIN, COACH_WIN]));
    await db.delete(schema.colosseumWins).where(and(eq(schema.colosseumWins.workspaceId, ws), eq(schema.colosseumWins.userId, maya.id)));
    await db.delete(schema.pointsLedger).where(inArray(schema.pointsLedger.id, ["smoke-blocks-points", "smoke-blocks-points-maya"]));
  };
  await cleanup();
  await db.update(schema.workspaces).set({ colosseumOn: true }).where(eq(schema.workspaces.id, ws));
  await db.update(schema.memberships).set({ arenaHidden: false }).where(eq(schema.memberships.workspaceId, ws));
  await db.update(schema.memberships).set({ arenaPhoto: true, headshotUrl: photoUrl, headshotDisplayUrl: photoUrl, headshotSource: "upload", leaderboardOptIn: true }).where(eq(schema.memberships.id, jm.id));
  await db.insert(schema.colosseumWins).values([
    { id: JORDAN_WIN, workspaceId: ws, userId: jordan.id, kind: "business", text: JORDAN_TEXT },
    { id: COACH_WIN, workspaceId: ws, userId: coach.id, kind: "community", text: COACH_TEXT },
  ]);
  // Both on this week's leaderboard, stamped the way the week's start is written, so a Monday run counts them too.
  const now = new Date().toISOString();
  await db.insert(schema.pointsLedger).values([
    { id: "smoke-blocks-points", workspaceId: ws, userId: jordan.id, type: "bonus", points: 40, reason: "Smoke: a place on this week's leaderboard", createdAt: now },
    { id: "smoke-blocks-points-maya", workspaceId: ws, userId: maya.id, type: "bonus", points: 30, reason: "Smoke: a place on this week's leaderboard", createdAt: now },
  ]);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    for (const w of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      page.on("response", (r) => {
        if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
      });
      const winRow = (id: string) => page.locator(`[data-testid="win"][data-win="${id}"]`);
      const photo = async () => (await page.request.get(`${base}/api/headshots/${jm.id}`)).status();

      // ── Before: Jordan's win, his name in the standings and the arena, his photo; the leaderboard in "First L." ──
      await login(page, "As a client");
      await page.goto(wins(), { waitUntil: "networkidle" });
      must((await winRow(JORDAN_WIN).count()) === 1 && (await winRow(JORDAN_WIN).innerText()).includes(jordanShort), `${w}: Jordan's win is on Maya's feed`);
      await noSideways(page, "the wins", w);
      must((await photo()) === 200, `${w}: Jordan's opted-in photo is Maya's to see before she blocks him`);
      await page.goto(`${base}/rewards`, { waitUntil: "networkidle" });
      const board = await page.locator('[data-testid="leaderboard-name"]').allInnerTexts();
      must(board.length >= 2 && board.includes(jordanShort) && board.includes(mayaShort), `${w}: the leaderboard shows "First L." (${board.join(", ")})`);
      must(!board.some((n) => n === maya.name || n === jordan.name), `${w}: never a full name on the leaderboard`);
      await page.goto(wins("standings"), { waitUntil: "networkidle" });
      const seat = page.locator(`[data-testid="arena-seat"][aria-label^="${jordanShort},"], [data-testid="arena-champ"][aria-label^="${jordanShort},"]`);
      must((await seat.count()) === 1, `${w}: Jordan has a seat in the arena`);
      await seat.dispatchEvent("click");
      must((await page.locator('[data-testid="arena-card-mod"]').count()) === 1, `${w}: his seat's card offers Block or report`);
      await noSideways(page, "the standings", w);

      // ── Block from the ⋯ on his win. ──
      await page.goto(wins(), { waitUntil: "networkidle" });
      await winRow(JORDAN_WIN).locator('[data-testid="mod-open"]').click();
      await page.locator('[data-testid="mod-block"]').click();
      must((await page.locator('[data-testid="mod-block-form"]').innerText()).includes(`Block ${jordanShort}? You won't see their wins or their name. They won't be told.`), `${w}: Block asks once, in plain words`);
      await noSideways(page, "the block question", w);
      await submit(page, '[data-testid="mod-block-confirm"]');
      must((await db.query.memberBlocks.findMany({ where: eq(schema.memberBlocks.blockerMembershipId, mm.id) })).map((b) => b.blockedMembershipId).join() === jm.id, `${w}: one block, Maya's of Jordan`);
      await page.goto(wins(), { waitUntil: "networkidle" });
      must((await winRow(JORDAN_WIN).count()) === 0 && (await page.locator('[data-testid="wins"]').innerText()).includes(COACH_TEXT), `${w}: his win is gone from her feed, the rest stay`);
      await page.goto(wins("standings"), { waitUntil: "networkidle" });
      const standings = await page.locator('[data-testid="standings"]').innerText();
      must(standings.includes(A_MEMBER) && !standings.includes(jordanShort) && (await page.locator('[data-testid="standing"][data-veiled="1"]').count()) === 1, `${w}: his place in the standings reads "${A_MEMBER}"`);
      must((await page.locator(`[aria-label^="${A_MEMBER},"]`).count()) === 1 && (await page.locator(`[aria-label^="${jordanShort},"]`).count()) === 0, `${w}: his seat in the arena reads "${A_MEMBER}"`);
      must((await page.locator(`img[src="/api/headshots/${jm.id}"]`).count()) === 0, `${w}: his photo isn't drawn for her`);
      must((await photo()) === 404, `${w}: the photo route refuses the blocker`);
      await page.goto(`${base}/rewards`, { waitUntil: "networkidle" });
      const after = await page.locator('[data-testid="leaderboard-name"]').allInnerTexts();
      must(after.includes(A_MEMBER) && !after.includes(jordanShort) && after.length === board.length, `${w}: the leaderboard keeps his place as "${A_MEMBER}" (${after.join(", ")})`);

      // ── Settings → Blocked members: Unblock brings him back. ──
      await page.goto(`${base}/settings#blocked`, { waitUntil: "networkidle" });
      must((await page.locator('[data-testid="blocked-member"]').count()) === 1 && (await page.locator('[data-testid="blocked-member"]').innerText()).includes(jordanShort), `${w}: Settings lists him under Blocked members`);
      await noSideways(page, "Settings", w);
      await submit(page, '[data-testid="unblock"]');
      must((await db.query.memberBlocks.findMany({ where: eq(schema.memberBlocks.blockerMembershipId, mm.id) })).length === 0, `${w}: unblocked`);
      await page.goto(wins(), { waitUntil: "networkidle" });
      must((await winRow(JORDAN_WIN).count()) === 1 && (await photo()) === 200, `${w}: after Unblock his win and his photo are back`);
      console.log(`✓ ${w}: block from a win: his win gone, "${A_MEMBER}" in the standings, the arena and the leaderboard, his photo refused; Unblock brings him back`);

      // ── Report his win: gone for Maya at once, Content in the coach's inbox. The coach's win goes to Support. ──
      await winRow(COACH_WIN).locator('[data-testid="mod-open"]').click();
      must((await page.locator('[data-testid="mod-block"]').count()) === 0, `${w}: the coach can't be blocked`);
      await page.locator('[data-testid="mod-report"]').click();
      must((await page.locator('[data-testid="mod-coach-support"] a[href="/support"]').count()) === 1, `${w}: a report about the coach shows Support instead`);
      await page.goto(wins(), { waitUntil: "networkidle" });
      await winRow(JORDAN_WIN).locator('[data-testid="mod-open"]').click();
      await page.locator('[data-testid="mod-report"]').click();
      must((await page.locator('[data-testid="mod-report-form"] a[href="/support"]').count()) === 1 && (await page.locator('[data-testid="mod-report-form"]').innerText()).includes("Reports are reviewed within 24 hours."), `${w}: the report form has Help and support and the 24 hours line`);
      await page.locator('[data-testid="mod-reason-harassment"]').check();
      await page.fill('[data-testid="mod-note"]', "Smoke: not kind");
      await noSideways(page, "the report form", w);
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('[data-testid="mod-report-send"]')]);
      await page.locator('[data-testid="win-reported"]').waitFor({ timeout: 10000 });
      must((await page.locator('[data-testid="win-reported"]').innerText()).includes(REPORTED), `${w}: "${REPORTED}"`);
      await page.goto(wins(), { waitUntil: "networkidle" });
      must((await winRow(JORDAN_WIN).count()) === 0, `${w}: the reported win is gone from her feed`);
      const report = (await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.workspaceId, ws), eq(schema.memberReports.kind, "content")) }))!;
      must(report && report.userId === maya.id && report.targetId === JORDAN_WIN && report.targetUserId === jordan.id && report.severity === "red" && report.description === "Smoke: not kind", `${w}: the report is Content, from Maya, about Jordan's win`);

      await login(page, "As the coach");
      await page.goto(`${base}/coach/reports`, { waitUntil: "networkidle" });
      const row = page.locator('[data-testid="report-row"][data-kind="content"]');
      must((await row.count()) === 1, `${w}: one Content report in Issues and ideas`);
      const rowText = await row.innerText();
      must(rowText.includes(JORDAN_TEXT) && rowText.includes(jordan.name) && rowText.includes(maya.name) && rowText.includes("Harassment or hurtful") && rowText.includes("Content"), `${w}: it shows the win's words, who wrote it, who reported it and why`);
      await noSideways(page, "Issues and ideas", w);
      await submit(page, '[data-testid="report-hide-win"]');
      must((await db.query.colosseumWins.findFirst({ where: eq(schema.colosseumWins.id, JORDAN_WIN) }))!.hiddenAt, `${w}: Hide this win hid it`);
      await page.goto(wins(), { waitUntil: "networkidle" });
      must((await winRow(JORDAN_WIN).count()) === 0, `${w}: hidden for everyone, the coach too`);
      await login(page, "As a client");
      await page.goto(`${base}/settings#your-reports`, { waitUntil: "networkidle" });
      const mine = page.locator('[data-testid="your-report"][data-kind="content"]');
      must((await mine.count()) === 1 && (await mine.locator('[data-testid="your-report-status"]').innerText()) === "Handled", `${w}: Maya's Your reports reads Handled`);
      await login(page, "As the coach");
      await page.goto(`${base}/coach/reports`, { waitUntil: "networkidle" });
      await submit(page, '[data-testid="report-unhide-win"]');
      must(!(await db.query.colosseumWins.findFirst({ where: eq(schema.colosseumWins.id, JORDAN_WIN) }))!.hiddenAt, `${w}: Show this win again undoes it`);
      console.log(`✓ ${w}: report a win: gone for the reporter at once, Content in Issues and ideas with the words, author and reporter; Hide this win for everyone, Handled for her, and the undo; the coach's win shows Support`);

      // ── The word filter: held back, the words kept. ──
      await login(page, "As a client");
      await page.goto(wins(), { waitUntil: "networkidle" });
      const typed = "Closed a fucking big deal";
      await page.fill('[data-testid="share-win-text"]', typed);
      await page.click('[data-testid="share-win-send"]');
      await page.locator('[data-testid="share-win-error"]').waitFor({ timeout: 10000 });
      must((await page.locator('[data-testid="share-win-error"]').innerText()) === WIN_REFUSED, `${w}: "${WIN_REFUSED}"`);
      must((await page.locator('[data-testid="share-win-text"]').inputValue()) === typed, `${w}: the words stay in the box`);
      must((await db.query.colosseumWins.findMany({ where: and(eq(schema.colosseumWins.workspaceId, ws), eq(schema.colosseumWins.userId, maya.id)) })).length === 0, `${w}: nothing was saved`);
      console.log(`✓ ${w}: a win with a listed word is held back, the words kept in the box`);

      // ── More, /join and the Guidelines. ──
      await page.goto(`${base}/more`, { waitUntil: "networkidle" });
      must((await page.locator('a[data-testid="more-support"][href="/support"]').innerText()).includes("Help and support"), `${w}: More has Help and support`);
      await noSideways(page, "More", w);
      await page.context().clearCookies();
      await page.goto(`${base}/join`, { waitUntil: "networkidle" });
      const terms = page.locator('[data-testid="join-terms"]');
      must((await terms.innerText()).replace(/\s+/g, " ").trim() === "By joining you agree to the Terms and the Community Guidelines." && (await terms.locator('a[href="/terms"]').count()) === 1 && (await terms.locator('a[href="/community-guidelines"]').count()) === 1, `${w}: /join has the Terms line, both linked`);
      await noSideways(page, "/join", w);
      await page.goto(`${base}/community-guidelines`, { waitUntil: "networkidle" });
      const guide = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      must(guide.includes("Reports are reviewed within 24 hours.") && guide.includes("zero tolerance for abusive or objectionable posts"), `${w}: the Guidelines carry the 24 hours line and zero tolerance`);
      await noSideways(page, "the Guidelines", w);
      console.log(`✓ ${w}: More has Help and support; /join links the Terms and the Guidelines; the Guidelines say 24 hours and zero tolerance`);

      // Ready for the next width.
      await db.delete(schema.memberReports).where(and(eq(schema.memberReports.workspaceId, ws), eq(schema.memberReports.kind, "content")));
      await ctx.close();
    }
    must(failures.length === 0, `no server errors: ${failures.join(", ")}`);
    console.log("Blocks smoke passed");
  } finally {
    await browser.close();
    await cleanup();
    await db.update(schema.memberships).set({ arenaPhoto: jm.arenaPhoto, headshotUrl: jm.headshotUrl, headshotDisplayUrl: jm.headshotDisplayUrl, headshotSource: jm.headshotSource, leaderboardOptIn: jm.leaderboardOptIn }).where(eq(schema.memberships.id, jm.id));
    await db.update(schema.workspaces).set({ colosseumOn: wsBefore.colosseumOn }).where(eq(schema.workspaces.id, ws));
    if (blobProc?.pid) process.kill(-blobProc.pid);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
