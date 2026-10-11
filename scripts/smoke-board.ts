/**
 * My Board (revs 664, 698), slice 1, as Maya with her AI key against scripts/mock-ai.ts: the hours asked on first use; a Board
 * question played back in the Boardroom in seat order (about 3.4s a speaker, the rows appearing as each speaks, a tapped seat
 * stopping it, reduced motion, the keyboard, 1440/1024/390 wide), with the server's checks visible (a figure she never gave and a claim to be Danno left out, a
 * weekend step moved to a working day, a step dropped to fit her hours); "The Board used" naming what was read; a Focus
 * follow-up from one advisor; the decision log; the coach's Danno Seat principles (seeded from the pack, a price refused, a
 * new one reaching the next answer's prompt); the Edge Preset on the coach's own Board only; the same Board by voice; and a team
 * member refused.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const CALLBACK = "http://localhost:4090/cb";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
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

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { seal } = await import("@/lib/crypto");
    const { newId } = await import("@/lib/ids");
    const { principlesFromPack, SEATS, MODES, SPEAK_MS } = await import("@/lib/engine/board");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const coachU = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = m.workspaceId;
    for (const u of [maya.id, coachU.id]) {
      await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, ws), eq(schema.aiCredentials.userId, u)));
      await db.insert(schema.aiCredentials).values({ id: newId(), workspaceId: ws, userId: u, provider: "anthropic", keyEncrypted: seal("sk-ant-good")!, last4: "good" });
    }
    await db.update(schema.memberships).set({ boardHours: null }).where(eq(schema.memberships.id, m.id));
    // A webinar of her own (the seeded two are worked examples, which the Board never reads as hers).
    await db.insert(schema.webinars).values({ id: newId(), workspaceId: ws, userId: maya.id, title: "Spring Reset Workshop", status: "building" });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // First use: the hours.
    await login(page, "As a client");
    await page.goto(`${base}/my-board`);
    must(!(await page.locator('[data-testid="board-ask"]').count()), "no ask box before the hours are set");
    await page.locator('[data-testid="board-hours"]').fill("5");
    await press(page, '[data-testid="board-hours-save"]');
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!.boardHours === 5, "the hours saved");
    console.log("✓ first use: the hours asked before anything else, then the ask box");

    // A Board question: the Boardroom plays it back in order, then the minutes, the steps and the checks.
    await page.locator('[data-testid="board-question"]').fill("Should I run a webinar this month or put the time into DMs?");
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
    const decisionId = page.url().split("/my-board/")[1].split(/[?#]/)[0];
    const t0 = Date.now();
    const heard: string[] = [];
    const rowsWhile: number[] = [];
    while (Date.now() - t0 < 30000) {
      if (await page.locator('[data-testid="board-table-recommends"]').count()) break;
      const label = await page.locator('[data-testid="board-speaking"] .br-says-label').innerText().catch(() => "");
      const who = SEATS.find((x) => label === `${x.short.toUpperCase()} SAYS`)?.key;
      if (who && heard.at(-1) !== who) {
        heard.push(who);
        rowsWhile.push(await page.locator('[data-testid^="board-minute-"]').count());
        must(await page.locator(`[data-testid="board-seat-${who}"].br-speaking`).count(), `${who}'s seat is the one speaking`);
        must((await page.locator(".br-seat.br-dim").count()) === 4, "the other four seats dim");
        must(!(await page.locator('[data-testid="board-steps"]').count()), "the steps wait until the discussion ends");
      }
      await page.waitForTimeout(250);
    }
    const took = Date.now() - t0;
    must(heard.join() === "danno,alex,jordan,morgan,riley", `the seats speak in order: ${heard.join()}`);
    must(rowsWhile.join() === "1,2,3,4,5", `each row appears as its advisor speaks, earlier rows staying: ${rowsWhile.join()}`);
    must(took > 4 * SPEAK_MS - 1500 && took < 5 * SPEAK_MS + 6000, `about ${SPEAK_MS} ms a speaker: ${took} ms for five`);
    must((await page.locator('[data-testid="board-table-recommends"]').innerText()).startsWith("THE BOARD RECOMMENDS"), "the table ends on the recommendation");
    console.log(`✓ the Boardroom plays it back: ${heard.join(" → ")}, ${took} ms, rows appearing as each speaks, the recommendation last`);
    for (const x of SEATS) must(await page.locator(`[data-testid="board-minute-${x.key}"]`).count(), `the ${x.name} row in the minutes`);
    const danno = await page.locator('[data-testid="board-minute-danno"]').innerText();
    must(!/As Danno/i.test(danno) && danno.includes("Be painfully specific"), `the Danno Seat never claims to be Danno: ${danno}`);
    must((await page.locator('[data-testid^="board-minute-"] .br-ask').count()) === 5, "each advisor's question under their counsel");
    const morgan = await page.locator('[data-testid="board-minute-morgan"]').innerText();
    must(!morgan.includes("9,999"), "a figure she never gave is left out");
    const steps = page.locator('[data-testid="board-step"]');
    must((await steps.count()) === 2, `the steps cut to fit 5 hours: ${await steps.count()}`);
    must((await page.locator('[data-testid="board-hours-line"]').innerText()).includes("of the 5 h you set aside this week"), "the hours line beside the steps");
    const notes = await page.locator('[data-testid="board-notes"]').innerText();
    must(notes.includes('Jordan: dropped "Book three follow-up calls" so the steps fit your 5 hours a week') && notes.includes("a working day") && notes.includes("you didn't give"), `the server's changes are said: ${notes}`);
    const used = await page.locator('[data-testid="board-used"]').innerText();
    const d = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, decisionId) }))!;
    must(d.answer && d.used.length && d.used.every((u) => used.includes(u.label)) && used.includes("Offers") && used.includes("Webinars") && !used.includes("Energy"), `"The Board used" names what was read: ${used}`);
    must(d.answer!.steps.every((x) => ![0, 6].includes(new Date(`${x.by}T12:00:00Z`).getUTCDay())), "every step on a working day");
    must((await page.locator('[data-testid="board-you-decide"]').innerText()).startsWith("You decide"), "You decide");
    must((await page.locator('[data-testid="board-decision"]').innerText()).length > 0, "the decision line");
    console.log("✓ the minutes: five rows, Danno never claimed, a made-up figure left out, a weekend step moved, a step dropped for her hours, what it used named");

    // Run the discussion again, and tap a seat during it: the playback stops on that advisor; tap again for the whole Board.
    await page.locator('[data-testid="board-replay"]').click();
    await page.locator('[data-testid="board-speaking"]').waitFor({ timeout: 5000 });
    must(!(await page.locator('[data-testid="board-steps"]').count()), "Run the discussion hides the steps until it ends");
    await page.locator('[data-testid="board-seat-morgan"]').click();
    const spotLine = await page.locator('[data-testid="board-speaking"] .br-says-label').innerText();
    await page.waitForTimeout(SPEAK_MS + 600);
    must(spotLine === "MORGAN SAYS" && (await page.locator('[data-testid="board-speaking"] .br-says-label').innerText()) === "MORGAN SAYS", `a tapped seat stops the playback on that advisor: ${spotLine}`);
    must((await page.locator('[data-testid="board-seat-morgan"]').getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid="board-minute-morgan"]:not(.br-dim)').count()) === 1, "the spotlight on Morgan");
    await page.locator('[data-testid="board-seat-morgan"]').click();
    must((await page.locator('[data-testid="board-table-recommends"]').count()) && (await page.locator('[data-testid="board-steps"]').count()), "tapping it again returns to the whole Board");
    console.log("✓ Run the discussion again; a seat tapped mid-playback stops it on that advisor, tapped again returns to the Board");

    // Every seat and tab reachable by keyboard.
    await page.goto(`${base}/my-board/${decisionId}`);
    // From the ask box onward (the sidebar's links come before it): every tab and seat follows in order.
    await page.locator('[data-testid="board-question"]').focus();
    const reached = new Set<string>(["board-question"]);
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
      if (id) reached.add(id);
    }
    const want = [...SEATS.map((x) => `board-seat-${x.key}`), ...MODES.map((x) => `board-mode-${x}`), "board-question"];
    must(want.every((x) => reached.has(x)), `every seat and tab by keyboard; missed ${want.filter((x) => !reached.has(x)).join(", ")}`);
    await page.locator('[data-testid="board-seat-alex"]').focus();
    await page.keyboard.press("Enter");
    must((await page.locator('[data-testid="board-speaking"] .br-says-label').innerText()) === "ALEX SAYS", "Enter on a seat spotlights it");
    console.log(`✓ the keyboard reaches every seat and all ${MODES.length} mode tabs; Enter on a seat spotlights it`);

    // Reduced motion: no pulse, bars or rise; the speaker keeps the gold ring and the others dim.
    const still = await (await browser.newContext({ viewport: { width: 1280, height: 950 }, reducedMotion: "reduce", storageState: await page.context().storageState() })).newPage();
    await still.goto(`${base}/my-board/${decisionId}?play=1`);
    await still.locator(".br-seat.br-speaking").waitFor({ timeout: 5000 });
    const motion = await still.evaluate(() => {
      const disc = document.querySelector(".br-seat.br-speaking .br-disc")!;
      const cs = getComputedStyle(disc);
      return { anim: cs.animationName, transform: cs.transform, ring: cs.borderTopColor, eq: getComputedStyle(document.querySelector(".br-seat.br-speaking .br-eq")!).visibility, rise: getComputedStyle(document.querySelector(".br-says")!).animationName, dim: document.querySelectorAll(".br-seat.br-dim").length };
    });
    must(motion.anim === "none" && motion.transform === "none" && motion.eq === "hidden" && motion.rise === "none", `reduced motion: nothing moves ${JSON.stringify(motion)}`);
    must(motion.ring === "rgb(226, 190, 106)" && motion.dim === 4, `reduced motion: the gold ring and the others dim ${JSON.stringify(motion)}`);
    await still.context().close();
    console.log("✓ reduced motion: no pulse, bars or rise; the speaker keeps the gold ring, the others dim");

    // Widths 1440, 1024 and 390: nothing scrolls sideways, every seat in the room and at least 44px, none on top of another.
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/my-board/${decisionId}`);
      await page.locator('[data-testid="board-seat-riley"]').waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(300);
      const box = await page.evaluate(() => {
        const room = document.querySelector('[data-testid="board-room"]')!.getBoundingClientRect();
        const seats = [...document.querySelectorAll(".br-seat")].map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }));
        const head = document.querySelector(".br-head")!.getBoundingClientRect();
        return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, width: document.documentElement.clientWidth, headBottom: head.bottom, room: { l: room.left, r: room.right, t: room.top, b: room.bottom }, seats };
      });
      must(box.sideways <= 0, `${width}px: nothing scrolls sideways (${box.sideways}px)`);
      // Each seat is centred on its spot in the room, on screen, and clear of the header above it.
      const inRoom = (x: (typeof box.seats)[number]) => {
        const cx = (x.l + x.r) / 2;
        const cy = (x.t + x.b) / 2;
        return cx > box.room.l && cx < box.room.r && cy > box.room.t && cy < box.room.b;
      };
      must(box.seats.length === 5 && box.seats.every((x) => x.w >= 44 && x.h >= 44 && inRoom(x) && x.l >= 0 && x.r <= box.width && x.t >= box.headBottom), `${width}px: the seats sit around the table ${JSON.stringify(box)}`);
      const overlap = box.seats.some((a, i) => box.seats.some((b, j) => j > i && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b));
      must(!overlap, `${width}px: no seat on top of another`);
    }
    await page.setViewportSize({ width: 1280, height: 950 });
    console.log("✓ 1440, 1024 and 390 wide: nothing scrolls sideways, the five seats sit around the table, none overlapping, each at least 44px");

    // A Focus follow-up: only Morgan.
    await page.goto(`${base}/my-board/${decisionId}`);
    await page.locator('[data-testid="board-question"]').fill("What could go wrong with the DMs plan?");
    await page.locator('[data-testid="board-mode-focus"]').click();
    must((await page.locator('[data-testid="board-focus-hint"]').innerText()).includes("Tap the advisor"), "Focus asks which advisor");
    await page.locator('[data-testid="board-seat-morgan"]').click();
    must((await page.locator('[data-testid="board-focus-hint"]').innerText()).includes("You'll hear from Morgan"), "Focus names the advisor");
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\?play=1/, { timeout: 60000 });
    const follow = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.parentId, decisionId) }))!;
    must(follow.answer?.advisors.map((a) => a.seat).join() === "morgan", `Focus hears one advisor: ${JSON.stringify(follow.answer?.advisors)}`);
    await page.locator('[data-testid="board-table-recommends"]').waitFor({ timeout: SPEAK_MS * 2 + 4000 });
    must((await page.locator('[data-testid^="board-minute-"]').count()) === 1 && (await page.locator('[data-testid="board-minute-morgan"]').count()), "the follow-up plays Morgan alone");
    must(await page.locator(`#d-${decisionId}`).count(), "the first answer under Earlier on this decision");
    await page.goto(`${base}/my-board`);
    must((await page.locator('[data-testid="board-decisions"]').innerText()).includes("1 follow-up"), "the decision log");
    console.log("✓ a Focus follow-up from Morgan only, on the same decision; the decision log lists it");

    // The coach's Danno Seat: seeded from the pack, a price refused, a new principle reaching the next prompt.
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/board`);
    must((await page.locator('[data-testid="principle-title"]').count()) === principlesFromPack().length, "seeded from the pack");
    await page.locator('[data-testid="principle-new-title"]').fill("Price it high");
    await page.locator('[data-testid="principle-new-body"]').fill("Charge $5,000 for coaching.");
    await press(page, '[data-testid="principle-add"]');
    must((await page.locator('[data-testid="principle-error"]').innerText()).includes("No prices"), "a price is refused");
    await page.locator('[data-testid="principle-new-title"]').fill("Walk the floor");
    await page.locator('[data-testid="principle-new-body"]').fill("Spend an hour a week inside your client's day before you change the offer.");
    await page.locator('[data-testid="principle-new-goodfor"]').fill("Offers");
    await press(page, '[data-testid="principle-add"]');
    must((await page.locator('[data-testid="principle-title"]').count()) === principlesFromPack().length + 1, "added");

    // Edge Preset: the coach's own Board only.
    await db.update(schema.memberships).set({ boardHours: 6 }).where(and(eq(schema.memberships.userId, coachU.id), eq(schema.memberships.workspaceId, ws)));
    await page.goto(`${base}/my-board`);
    await page.locator("#hours-edit summary").click();
    await page.locator('[data-testid="board-preset"] select').selectOption("edge");
    await press(page, '[data-testid="board-preset"] button');
    await page.goto(`${base}/my-board`);
    await page.locator('[data-testid="board-question"]').fill("Should I launch a new program this quarter?");
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
    for (const k of ["tony", "dean", "igor", "jordan", "morgan"]) must(await page.locator(`[data-testid="board-seat-${k}"]`).count(), `the Edge seat ${k}`);
    const last = (await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { system: { text: string }[] };
    const sys = last.system.map((b) => b.text).join("\n");
    must(sys.includes("Walk the floor") && sys.includes("never claim to be them"), "the new principle and the Edge rules reach the prompt");
    console.log("✓ the Danno Seat: seeded from the pack, a price refused, a new principle in the next prompt; Edge Preset on the coach's own Board");

    // Maya's Board is never Edge, whatever is stored.
    await db.update(schema.memberships).set({ boardPreset: "edge" }).where(eq(schema.memberships.id, m.id));
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/my-board`);
    must(!(await page.locator('[data-testid="board-preset"]').count()) && (await page.locator('[data-testid="board-seat-danno"]').count()) && !(await page.locator('[data-testid="board-seat-tony"]').count()), "a client sees the standard five and no preset");

    // By voice, and a team member refused.
    const { viewerFor } = await import("@/lib/auth");
    const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
    const { createHash, randomBytes } = await import("node:crypto");
    const v = (await viewerFor(maya.id, ws))!;
    const client = await registerClient("Walk board", [CALLBACK]);
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: ["board"] as never });
    const pair = (await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string };
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await (await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${pair.access_token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
      return { text: res.result?.content?.[0]?.text ?? "", isError: Boolean(res.result?.isError) };
    };
    const r = await call("board_ask", { decision: "Should I post daily or three times a week?" });
    must(!r.isError && r.text.startsWith("The Board recommends: ") && r.text.includes("Your action steps:\n1. "), `voice: the recommendation first, the steps numbered: ${r.text.slice(0, 160)}`);
    must((await call("decisions_list", {})).text.includes("Should I post daily"), "voice: the list");
    const { allTools } = await import("@/lib/mcp/registry");
    await import("@/lib/mcp/tools");
    const team = { ...v, team: { teamMemberId: "walk", ownerMembershipId: m.id, ownerName: maya.name, teamName: "Walk VA" } };
    const refused = await allTools().find((t) => t.name === "board_ask")!.handler(team, { decision: "x x x" }).then(() => "ok", (e: Error) => e.message);
    must(refused.startsWith("A team member can read the Board's decisions but can't ask it"), `a team member is refused: ${refused}`);
    console.log("✓ by voice: the recommendation first, the steps numbered; a team member can't ask");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\nboard walk passed");
  } finally {
    await browser.close();
    try {
      process.kill(-mock.pid!);
    } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
