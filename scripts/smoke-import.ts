/**
 * Import a client from Airtable (handoff 27 Sep), walked as the coach meets it, against the demo database and
 * scripts/mock-airtable.ts serving the synthetic bases in scripts/fixtures/airtable-client.ts:
 * - a client can't open it;
 * - a bad token, or one base's token on the other base, says which base and what to do, and writes nothing;
 * - the dry run for a new client shows what the mapper plans (every count read from the mapper, not typed), writes nothing and
 *   creates no one; the tokens stay in their boxes and never come back from the server;
 * - a base that changed between the dry run and Approve writes nothing and shows the new plan;
 * - Approve creates the client with no email sent and writes the plan; a re-run says update for all of it and doubles nothing;
 * - with the fallback left empty, the dry run lists what it couldn't fill;
 * - the import only ever read (GET), and no token reached the database or the server log.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { V1_BASE, V1_TABLES, V2_BASE, V2_TABLES } from "./fixtures/airtable-client";
import { TESTIMONIALS_TOKEN } from "./fixtures/airtable-testimonials";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4070;
const RUN = randomUUID().slice(0, 6);
const SOURCE_TOKEN = "pat-source-good";
const FALLBACK_TOKEN = "pat-fallback-good";
const SINCE = "2026-06-10";
const BLOB = "http://localhost:4050";

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray, isNotNull } = await import("drizzle-orm");
  const { buildPlan, planSummary, tableKey } = await import("@/lib/engine/airtable-import");

  const mock = spawn("npx", ["tsx", "scripts/mock-airtable.ts", String(mockPort)], { stdio: "ignore", detached: true });
  // Client headshots keep their photos in the private store: the walk's stand-in, unless another walk left one running.
  const blobUp = await fetch(`${BLOB}/__list`).then((r) => r.ok).catch(() => false);
  const blobProc = blobUp ? null : spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${BLOB}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 2500));
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!.workspaceId;
  const email = `harbour-${RUN}@example.com`;
  const name = `Harbour ${RUN}`;

  // What the mapper plans for the fixture, as the page should show it. The walk's own copy of the reader's table naming.
  const clean = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
  const wanted = ["vision", "offersos", "methodologies", "buyer readiness", "tasksos", "groups", "lead magnet"];
  const src = (withFallback: boolean) => ({
    v2: Object.fromEntries(V2_TABLES.filter((t) => wanted.includes(tableKey(t.name))).map((t) => [tableKey(t.name), { name: clean(t.name), records: t.records }])),
    v1: withFallback ? Object.fromEntries(V1_TABLES.map((t) => [tableKey(t.name), { name: clean(t.name), records: t.records }])) : {},
  });
  const expected = buildPlan(src(true), { createdSince: SINCE }, new Set());
  const bare = buildPlan(src(false), { createdSince: SINCE }, new Set());

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const echoed: string[] = [];
  let userId: string | null = null;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
    page.on("response", async (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
      if (r.request().method() !== "POST") return;
      const body = await r.text().catch(() => "");
      for (const t of [SOURCE_TOKEN, FALLBACK_TOKEN, TESTIMONIALS_TOKEN]) if (body.includes(t)) echoed.push(`${t} in ${r.url()}`);
    });
    const signIn = async (who: "coach" | "client") => {
      await page.goto(`${base}/login`);
      await page.click(`button:has-text("${who === "coach" ? "As the coach" : "As a client"}")`);
      await page.waitForURL(/\/today/);
    };
    const press = async (testid: string, waitFor: string) => {
      const before = page.url();
      await page.locator(`[data-testid="${testid}"]`).click();
      // Approve ends in a redirect with a fresh form; an earlier import's notice is already on screen, so wait for the address.
      if (waitFor === "import-done") await page.waitForURL((u) => u.toString() !== before, { timeout: 60000 });
      await page.locator(`[data-testid="${waitFor}"]`).first().waitFor({ timeout: 60000 }).catch(async (e) => {
        const why = await page.evaluate(() => [...document.querySelectorAll("form [name]")].map((el) => { const i = el as HTMLInputElement; return `${i.name}=${i.type === "password" ? (i.value ? "set" : "") : i.value} ${i.validity.valid ? "" : "INVALID"}`; }).join("; "));
        await page.screenshot({ path: "screenshots/logs/import-fail.png", fullPage: true });
        throw new Error(`${e}\nform: ${why}`);
      });
      await page.waitForLoadState("networkidle");
    };
    const fill = async (sourceToken: string, fallback: boolean) => {
      await page.locator('[data-testid="import-source-base"]').fill(V2_BASE);
      await page.locator('[data-testid="import-source-token"]').fill(sourceToken);
      await page.locator('[data-testid="import-fallback-base"]').fill(fallback ? V1_BASE : "");
      await page.locator('[data-testid="import-fallback-token"]').fill(fallback ? FALLBACK_TOKEN : "");
      await page.locator('[data-testid="import-since"]').fill(SINCE);
    };
    const summary = async () => Object.fromEntries((await page.locator('[data-testid="import-summary-row"]').evaluateAll((els) => els.map((e) => [...e.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? "")))).map(([a, c, u]) => [a, `${c}/${u}`]));
    const mine = async () => (await db.query.users.findFirst({ where: eq(schema.users.email, email) })) ?? null;

    // ── A client can't open it. ──
    await signIn("client");
    await page.goto(`${base}/coach/import`);
    await page.waitForURL(/\/today$/, { timeout: 15000 }).catch(() => undefined);
    if (!page.url().endsWith("/today") || (await page.locator('[data-testid="import-form"]').count())) throw new Error("the import page is the coach's only");
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);

    // ── The coach, a new client, a bad token, then one base's token on the other base. ──
    await signIn("coach");
    await page.goto(`${base}/coach`);
    await Promise.all([page.waitForURL(/\/coach\/import/), page.locator('[data-testid="coach-import-link"]').click()]);
    await page.locator('[data-testid="import-client"]').selectOption("new");
    await page.locator('[data-testid="import-new-name"]').fill(name);
    await page.locator('[data-testid="import-new-email"]').fill(email);
    await fill("pat-wrong", true);
    await press("import-dry", "import-error");
    let err = await page.locator('[data-testid="import-error"]').innerText();
    if (!err.startsWith("Source base:") || !err.includes("didn't accept that token")) throw new Error(`a bad token says which base and what to do, got ${err}`);
    await page.locator('[data-testid="import-source-token"]').fill(FALLBACK_TOKEN);
    await press("import-dry", "import-error");
    await page.waitForFunction(() => document.querySelector('[data-testid="import-error"]')?.textContent?.includes("can't read this base"), null, { timeout: 30000 });
    err = await page.locator('[data-testid="import-error"]').innerText();
    if (!err.startsWith("Source base:")) throw new Error(`the other base's token says it can't read this one, got ${err}`);
    if (await mine()) throw new Error("a failed run creates no one");
    console.log("✓ a bad token and the other base's token each say which base and what to do; nothing written, no one created");

    // ── The dry run: the mapper's plan on screen, nothing written. ──
    await page.locator('[data-testid="import-source-token"]').fill(SOURCE_TOKEN);
    await press("import-dry", "import-preview");
    const shown = await summary();
    const want = Object.fromEntries(planSummary(expected).map((s) => [s.area, `${s.create}/${s.update}`]));
    if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(`the dry run shows the mapper's plan:\nwant ${JSON.stringify(want)}\ngot  ${JSON.stringify(shown)}`);
    if (await page.locator('[data-testid="import-unfilled"]').count()) throw new Error("with the fallback given, nothing is left unfilled");
    const notImported = await page.locator('[data-testid="import-not-imported-row"]').allInnerTexts();
    const wantNot = ["Phase 2 · Lead Magnet (the rest): 1 rows", "Phase 2 · KPIs: 1 rows", "No home yet · Calendar: 2 rows", "Stays out · Leads ·"];
    if (!wantNot.every((w, i) => notImported[i]?.startsWith(w)) || notImported.length !== wantNot.length) throw new Error(`every other table of theirs is answered, got ${JSON.stringify(notImported)}`);
    if (await mine()) throw new Error("the dry run creates no one");
    if ((await page.locator('[data-testid="import-source-token"]').inputValue()) !== SOURCE_TOKEN || (await page.locator('[data-testid="import-fallback-token"]').inputValue()) !== FALLBACK_TOKEN) throw new Error("the tokens stay in their boxes for Approve");
    if (!(await page.locator('[data-testid="import-approve"]').isEnabled())) throw new Error("Approve is on after a clean dry run");
    console.log(`✓ dry run for ${name}: ${Object.entries(shown).map(([a, n]) => `${a} ${n.split("/")[0]}`).join(", ")}; nothing written, no one created; the tokens stayed in their boxes`);

    // ── The base changes before Approve: nothing written, the new plan shown. ──
    await fetch(`http://localhost:${mockPort}/__edit`, { method: "POST" });
    await press("import-approve", "import-changed");
    if (await mine()) throw new Error("a plan that changed writes nothing and creates no one");
    await press("import-approve", "import-done");
    const user = await mine();
    if (!user) throw new Error("Approve creates the client");
    userId = user.id;
    const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.workspaceId, ws)) });
    if (m?.role !== "client") throw new Error("the new client is a client of the coach's workspace");
    const sent = await db.query.syncEvents.findMany({ where: eq(schema.syncEvents.userId, user.id) });
    if (sent.length) throw new Error(`nothing is sent to the new client, got ${sent.map((s) => s.event).join(", ")}`);
    const count = async () => ({
      pathways: (await db.query.pathways.findMany({ where: and(eq(schema.pathways.workspaceId, ws), eq(schema.pathways.userId, user.id)) })).length,
      offers: (await db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, ws), eq(schema.offers.userId, user.id)) })).length,
      magnets: (await db.query.leadMagnets.findMany({ where: and(eq(schema.leadMagnets.workspaceId, ws), eq(schema.leadMagnets.userId, user.id)) })).length,
      assets: (await db.query.libraryAssets.findMany({ where: and(eq(schema.libraryAssets.workspaceId, ws), eq(schema.libraryAssets.userId, user.id)) })).length,
      goals: (await db.query.goals.findMany({ where: and(eq(schema.goals.workspaceId, ws), eq(schema.goals.userId, user.id)) })).length,
      tasks: (await db.query.tasks.findMany({ where: and(eq(schema.tasks.workspaceId, ws), eq(schema.tasks.userId, user.id), eq(schema.tasks.source, "airtable")) })).length,
      groups: (await db.query.groups.findMany({ where: and(eq(schema.groups.workspaceId, ws), eq(schema.groups.userId, user.id)) })).length,
    });
    const first = await count();
    const wantCounts = { pathways: expected.pathways.length, offers: expected.offers.length, magnets: expected.magnets.length, assets: expected.assets.length, goals: expected.goals.length, tasks: expected.tasks.length, groups: expected.groups.length };
    if (JSON.stringify(first) !== JSON.stringify(wantCounts)) throw new Error(`Approve writes the plan:\nwant ${JSON.stringify(wantCounts)}\ngot  ${JSON.stringify(first)}`);
    const edited = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, user.id), eq(schema.tasks.title, "Book three discovery calls (edited)")) });
    if (!edited) throw new Error("what was written is the base as it was at Approve");
    // Open imported tasks wait for review (30 Sep); a task marked Today in the base arrives as an ordinary open one; done is history.
    const imported = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, user.id), eq(schema.tasks.source, "airtable")) });
    const open = imported.filter((t) => t.status !== "done");
    if (!open.length || open.some((t) => t.reviewState !== "to_review") || imported.some((t) => t.status === "done" && t.reviewState !== null)) throw new Error("open imported tasks wait for review; done ones are history");
    if (edited.status !== "upcoming") throw new Error(`a task marked Today in the base arrives as an ordinary open task, got ${edited.status}`);
    const essence = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, ws), eq(schema.essences.userId, user.id)) });
    const brand = (essence?.data as { brand?: { slogan?: string } } | undefined)?.brand;
    if (brand?.slogan !== "Lead lighter.") throw new Error("the brand lines are in their Essence");
    const t00 = await db.query.offers.findFirst({ where: and(eq(schema.offers.userId, user.id), eq(schema.offers.tierCode, "T00")) });
    const old = await db.query.offers.findFirst({ where: and(eq(schema.offers.userId, user.id), eq(schema.offers.tierCode, "01")) });
    if (!t00?.pathwayId || old?.status !== "retired" || old.replacedByOfferId !== t00.id) throw new Error("the current offer sits on its pathway; the older one is archived and points at it");
    console.log(`✓ a base that changed after the dry run wrote nothing; Approve created ${name} with nothing sent and wrote ${Object.entries(first).map(([k, n]) => `${n} ${k}`).join(", ")}, the base as it was at Approve`);

    // ── Emails from HelixOS (29 Sep): the new client starts with emails off, and the reminder run sends them nothing. Turning the
    // switch on is logged, and still sends nothing until they have signed in once. ──
    if (m.emailsEnabled !== false || user.firstSignedInAt !== null) throw new Error("the import creates the client with emails off, never signed in");
    const { runReminders } = await import("@/lib/reminders");
    const remind = async () => [...(await runReminders(new Date(), "morning")), ...(await runReminders(new Date(), "evening"))].filter((r) => r.userId === user.id);
    if ((await remind()).length) throw new Error("the reminder run sends the imported client nothing");
    await page.goto(`${base}/coach/${m.id}`);
    if ((await page.locator('[data-testid="client-emails"]').getAttribute("data-on")) !== "0" || !(await page.locator('[data-testid="nudge-off"]').count())) throw new Error("their page shows emails off, and no Nudge");
    await page.locator('[data-testid="client-emails-toggle"]').click();
    await page.waitForURL(/emails=on/);
    const onRow = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!;
    const logged = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.userId, user.id), eq(schema.syncEvents.event, "emails.on")) });
    if (!onRow.emailsEnabled || logged.length !== 1) throw new Error("turning emails on is saved and logged");
    if ((await remind()).length) throw new Error("switched on but never signed in: still nothing");
    if (!(await page.locator('[data-testid="client-emails"]').innerText()).includes("Held until they sign in")) throw new Error("their page says emails are held until they sign in");
    await page.locator('[data-testid="client-emails-toggle"]').click();
    await page.waitForURL(/emails=off/);
    await page.goto(`${base}/coach/import`);
    console.log("✓ the new client starts with emails off: the reminder run sends them nothing; turning it on is logged and still sends nothing until they sign in");

    // ── A re-run for the same client: all update, nothing doubled. Their Essence is near the cap by now (28 Sep: the first live
    // run came to 23,633), so this import takes it over: it still goes in whole, marked, and their AI stops using it until trimmed. ──
    const { essenceBlockFor } = await import("@/lib/queries/essence");
    const { ESSENCE_CAP, essenceChars } = await import("@/lib/engine/essence");
    // Their Essence 20 characters under the cap without mission and vision; the re-run puts those back and takes it over.
    const rest = Object.fromEntries(Object.entries(essence!.data as Record<string, unknown>).filter(([k]) => k !== "mission_and_vision"));
    const base0 = essenceChars({ ...rest, identity: { name, role: "x" } } as never);
    const withLong = { ...rest, identity: { name, role: "x".repeat(ESSENCE_CAP - 20 - base0 + 1) } };
    await db.update(schema.essences).set({ data: withLong }).where(eq(schema.essences.id, essence!.id));
    // One task the client has kept and renamed is theirs now: the re-run leaves it as they have it.
    const retreat = (await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, user.id), eq(schema.tasks.title, "Plan the retreat")) }))!;
    await db.update(schema.tasks).set({ reviewState: null, title: "Plan the retreat, my way" }).where(eq(schema.tasks.id, retreat.id));
    await page.locator('[data-testid="import-client"]').selectOption(m.id);
    await fill(SOURCE_TOKEN, true);
    await press("import-dry", "import-preview");
    const again = await summary();
    if (!(await page.locator('[data-testid="import-essence-size"]').innerText()).includes("goes in whole") || !(await page.locator('[data-testid="import-approve"]').isEnabled())) throw new Error("over the limit, the dry run says it goes in whole, and Approve stays on");
    if (Object.values(again).some((v) => !v.startsWith("0/"))) throw new Error(`a re-run says update for all of it, got ${JSON.stringify(again)}`);
    await press("import-approve", "import-done");
    const second = await count();
    if (JSON.stringify(second) !== JSON.stringify(first)) throw new Error(`a re-run doubles nothing, got ${JSON.stringify(second)}`);
    const kept = (await db.query.tasks.findFirst({ where: eq(schema.tasks.id, retreat.id) }))!;
    if (kept.title !== "Plan the retreat, my way" || kept.reviewState !== null) throw new Error("a re-run leaves a task the client has kept as they have it");
    // Nothing in the Essence was cut; it's over, flagged on the client page with its trim-to-fit, and the AI leaves it out.
    const after = (await db.query.essences.findFirst({ where: eq(schema.essences.id, essence!.id) }))!.data as { identity?: { role?: string }; brand?: { slogan?: string } };
    if (after.identity?.role !== withLong.identity.role || after.brand?.slogan !== "Lead lighter.") throw new Error("nothing of theirs is cut");
    await page.goto(`${base}/coach/${m.id}`);
    const flag = await page.locator('[data-testid="essence-over-cap"]').innerText();
    const trim = await page.locator('[data-testid="essence-trim"] li').allInnerTexts();
    if (!flag.includes("Over the limit") || !trim[0]?.startsWith("Identity")) throw new Error(`the client page flags the Essence over the limit with its trim-to-fit, largest first, got ${flag} / ${trim.join(" | ")}`);
    if ((await essenceBlockFor(ws, user.id)) !== null) throw new Error("an Essence over the limit is left out of the AI's calls until trimmed");
    await page.goto(`${base}/coach/import`);
    console.log(`✓ a re-run for the same client: every line an update, nothing doubled; an import over the limit went in whole (${essenceChars(after as never).toLocaleString()} characters), flagged on the client page with its trim-to-fit, and left out of the AI`);

    // ── No fallback: the dry run lists what it couldn't fill. ──
    await page.locator('[data-testid="import-client"]').selectOption(m.id);
    await fill(SOURCE_TOKEN, false);
    await press("import-dry", "import-unfilled");
    const unfilled = await page.locator('[data-testid="import-unfilled"] li').allInnerTexts();
    if (JSON.stringify(unfilled) !== JSON.stringify(bare.unfilled)) throw new Error(`without the fallback, the dry run lists what it couldn't fill, got ${JSON.stringify(unfilled)}`);
    console.log(`✓ with the fallback empty, the dry run lists what it couldn't fill: ${unfilled.length} row`);

    // ── Imported tasks on the client's own pages (30 Sep): off Today until kept; Tasks' review group with Keep, Done and Let go;
    // one press keeps all dated after today; Let go hides without deleting, and Keep brings one back. The demo client is used
    // because an imported client can't sign in yet. ──
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const { todayInTz, addDays } = await import("@/lib/dates");
    const today = todayInTz(mayaM.timezone || "America/Los_Angeles");
    const T = (s2: string) => `${s2} ${RUN}`;
    const reviewIds = { overdue: randomUUID(), future: randomUUID(), third: randomUUID() };
    await db.insert(schema.tasks).values([
      { id: reviewIds.overdue, workspaceId: ws, userId: maya.id, title: T("Old imported task"), status: "upcoming", dueDate: addDays(today, -40), source: "airtable", sourceRef: `rec-o-${RUN}`, reviewState: "to_review" },
      { id: reviewIds.future, workspaceId: ws, userId: maya.id, title: T("Future imported task"), status: "upcoming", dueDate: addDays(today, 20), source: "airtable", sourceRef: `rec-f-${RUN}`, reviewState: "to_review" },
      { id: reviewIds.third, workspaceId: ws, userId: maya.id, title: T("Undated imported task"), status: "upcoming", dueDate: null, source: "airtable", sourceRef: `rec-u-${RUN}`, reviewState: "to_review" },
    ]);
    try {
      await page.goto(`${base}/settings`);
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);
      await signIn("client");
      if ((await page.content()).includes(T("Old imported task"))) throw new Error("an imported task waiting for review stays off Today, even overdue");
      await page.goto(`${base}/tasks`);
      if ((await page.locator('main').innerText()).split("From Airtable")[0].includes(T("Old imported task"))) throw new Error("waiting tasks aren't in Tasks' own lists");
      const review = page.locator('[data-testid="tasks-review"]');
      await review.locator("summary").click();
      const row = (title: string) => review.locator('[data-testid="tasks-review-row"]', { hasText: title });
      if (!(await row(T("Old imported task")).innerText()).includes("was due")) throw new Error("the review row shows its date as written");
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="tasks-keep-future"]').click()]);
      await page.waitForLoadState("networkidle");
      const after1 = await db.query.tasks.findMany({ where: inArray(schema.tasks.id, Object.values(reviewIds)) });
      const state = (id: string) => after1.find((t) => t.id === id)!.reviewState;
      if (state(reviewIds.future) !== null || state(reviewIds.overdue) !== "to_review" || state(reviewIds.third) !== "to_review") throw new Error("Keep all dated after today keeps only the future one");
      await page.goto(`${base}/tasks`);
      await page.locator('[data-testid="tasks-review"] summary').click();
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), row(T("Undated imported task")).locator('[data-testid="tasks-review-let_go"]').click()]);
      await page.waitForLoadState("networkidle");
      if ((await db.query.tasks.findFirst({ where: eq(schema.tasks.id, reviewIds.third) }))?.reviewState !== "let_go") throw new Error("Let go hides it, not deletes it");
      await page.goto(`${base}/tasks`);
      await page.locator('[data-testid="tasks-review"] summary').click();
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), row(T("Old imported task")).locator('[data-testid="tasks-review-keep"]').click()]);
      await page.waitForLoadState("networkidle");
      await page.goto(`${base}/today`);
      if (!(await page.content()).includes(T("Old imported task"))) throw new Error("kept, the overdue task shows on Today like any overdue task");
      await page.goto(`${base}/tasks?filter=letgo`);
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="tasks-letgo"] [data-testid="tasks-review-keep"]').first().click()]);
      await page.waitForLoadState("networkidle");
      if ((await db.query.tasks.findFirst({ where: eq(schema.tasks.id, reviewIds.third) }))?.reviewState !== null) throw new Error("Keep on the Let go tab brings it back");
      console.log("✓ imported tasks: off Today while waiting (even overdue); Keep all dated after today kept only the future one; Let go hid one without deleting it and Keep brought it back; a kept overdue task shows on Today; a re-run left a kept task as the client has it");
      await page.goto(`${base}/settings`);
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);
    } finally {
      await db.delete(schema.tasks).where(inArray(schema.tasks.id, Object.values(reviewIds)));
    }

    // ── Danno's Proof Bank from Airtable (8 Oct): the coach's own clips, approved, off the bot, tagged; a second run adds nothing. ──
    await signIn("coach");
    await page.goto(`${base}/proof`);
    await page.locator('[data-testid="proof-import-open"]').click();
    await page.fill('[data-testid="proof-import-token"]', TESTIMONIALS_TOKEN);
    await page.locator('[data-testid="proof-import-run"]').click();
    await page.waitForURL(/imported=/, { timeout: 60000 });
    const note = await page.locator('[data-testid="proof-import-note"]').innerText();
    if (!note.includes("Added 3, skipped 0 already in, left out 1 with no quote")) throw new Error(`the first run says what it did: ${note}`);
    const clips = await db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, coach.id), isNotNull(schema.proofs.airtableId)) });
    if (clips.length !== 3 || clips.some((p) => p.status !== "approved" || p.onBot || !p.permissionAt)) throw new Error("every clip is approved and off the bot");
    const marisol = clips.find((p) => p.airtableId === "recTESTI000000002")!;
    if (marisol.who !== "Marisol Q." || /example\.com|0123/.test(marisol.quote ?? "") || marisol.sourceTitle !== "Office Hours" || marisol.sourceTimestamp !== "12:34") throw new Error(`first name and last initial, no email or number, the call and the stamp: ${JSON.stringify(marisol)}`);
    const tomas = clips.find((p) => p.airtableId === "recTESTI000000003")!;
    if (tomas.who !== "Tomas F." || !tomas.tags.includes("Results & Revenue")) throw new Error("a client named by email becomes a first name and initial, with the row's tags");
    // The bank: the three priority categories first, a tag filter, the tags on the rows.
    const titles = await page.locator('[data-testid="proof-row"]').allInnerTexts();
    if (!titles[0].includes("Tomas F.") || !titles[1].includes("Marisol Q.: I closed")) throw new Error(`Results & Revenue then Sales Wins come first: ${titles.slice(0, 3).join(" | ")}`);
    await page.locator('[data-testid="proof-tag-filter"] a', { hasText: "Transformation" }).click();
    await page.waitForURL(/tag=Transformation/);
    if ((await page.locator('[data-testid="proof-row"]').count()) !== 1) throw new Error("the tag filter narrows to that category");
    await page.goto(`${base}/proof`);
    await page.locator('[data-testid="proof-import-open"]').click();
    await page.fill('[data-testid="proof-import-token"]', TESTIMONIALS_TOKEN);
    await page.locator('[data-testid="proof-import-run"]').click();
    await page.waitForURL(/imported=0/, { timeout: 60000 });
    if ((await db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, coach.id), isNotNull(schema.proofs.airtableId)) })).length !== 3) throw new Error("a second run skips what is in");
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await signIn("client");
    await page.goto(`${base}/proof`);
    if ((await page.locator("main").innerText()).includes("Marisol Q.") || (await page.locator('[data-testid="proof-import-open"]').count())) throw new Error("a client sees none of the coach's clips and no import button");
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    console.log("✓ Proof Bank from Airtable: 3 added, 1 left out, approved and off the bot, names shortened, contacts blanked, tags first and filterable, a second run adds nothing, nothing reaches a client");

    // ── Client headshots from Airtable (Danno, 8 Oct): dry run, apply, review, re-run, the member's own photo wins. ──
    {
      const sharp = (await import("sharp")).default;
      const mem = async (email: string) => {
        const u = (await db.query.users.findFirst({ where: eq(schema.users.email, email) }))!;
        return (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, u.id), eq(schema.memberships.workspaceId, ws)) }))!;
      };
      const objects = async () => ((await (await fetch(`${BLOB}/__list`)).json()) as { objects: { pathname: string; access: string }[] }).objects.filter((o) => o.pathname.startsWith(`headshots/${ws}/`));
      const run = async (mode: "dry" | "apply", wait: RegExp) => {
        await page.goto(`${base}/coach/headshots`);
        await page.fill('[data-testid="headshots-token"]', TESTIMONIALS_TOKEN);
        await page.locator(`[data-testid="headshots-${mode === "dry" ? "dry-run" : "apply"}"]`).click();
        await page.waitForURL(wait, { timeout: 90000 });
        return page.locator(`[data-testid="headshots-${mode === "dry" ? "dry" : "applied"}"]`).innerText();
      };
      const maya0 = await mem("client@demo.helixos.app");
      const jordan0 = await mem("client2@demo.helixos.app");
      if (maya0.headshotUrl || jordan0.headshotUrl) throw new Error("the seed starts with no photos");

      // A client cannot open it, nor the photo route for another member.
      await signIn("client");
      await page.goto(`${base}/coach/headshots`);
      await page.waitForURL(/\/today/, { timeout: 15000 }).catch(() => undefined);
      if (page.url().includes("/coach/headshots")) throw new Error("a client cannot open the import");
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);

      await signIn("coach");
      await page.goto(`${base}/coach/headshots`);
      await page.fill('[data-testid="headshots-token"]', "pat-not-a-token");
      await page.locator('[data-testid="headshots-dry-run"]').click();
      await page.waitForURL(/error=/, { timeout: 60000 });
      if (!(await page.locator('[data-testid="headshots-error"]').isVisible())) throw new Error("a bad token says so");

      const dry = await run("dry", /dry=1/);
      if (!dry.includes("2 matched, 4 need review, 1 no headshot. Of the matched: 2 to store.") || !dry.includes("4 of those to review are new")) throw new Error(`the dry run's counts: ${dry}`);
      if ((await mem("client@demo.helixos.app")).headshotUrl || (await db.query.headshotReviews.findMany({ where: eq(schema.headshotReviews.workspaceId, ws) })).length || (await objects()).length) throw new Error("the dry run writes nothing");

      const first = await run("apply", /applied=1/);
      if (!first.includes("2 matched (2 stored, 0 unchanged, 0 kept the client's own), 4 new to review, 1 no headshot")) throw new Error(`the first apply: ${first}`);
      const maya1 = await mem("client@demo.helixos.app");
      const jordan1 = await mem("client2@demo.helixos.app");
      if (maya1.headshotSource !== "import" || maya1.headshotAirtableId !== "attMAYA000000001" || jordan1.headshotAirtableId !== "attJORDAN0000001") throw new Error("matched by email, case and spaces aside, the first attachment of each");
      const stored1 = await objects();
      if (stored1.length !== 2 * 2 + 4 * 2 || stored1.some((o) => o.access !== "private")) throw new Error(`the original and the square of each, all private: ${JSON.stringify(stored1)}`);
      if (!/^https?:/.test(maya1.headshotUrl!) || !maya1.headshotUrl!.includes("/private/")) throw new Error("kept in the private store");
      const reviews = await db.query.headshotReviews.findMany({ where: eq(schema.headshotReviews.workspaceId, ws) });
      if (reviews.map((r) => r.reason).sort().join() !== "no_email,no_match,shared_email,shared_email") throw new Error(`each one to review says why: ${reviews.map((r) => r.reason).join()}`);
      // The square copy is 512 a side; the original keeps its shape and type.
      const square = await page.request.get(`${base}/api/headshots/${jordan1.id}`);
      const sqMeta = await sharp(Buffer.from(await square.body())).metadata();
      if (square.status() !== 200 || sqMeta.width !== 512 || sqMeta.height !== 512 || square.headers()["cache-control"] !== "private, no-store") throw new Error(`the display copy is a 512 square, private: ${square.status()} ${sqMeta.width}x${sqMeta.height}`);
      const original = await page.request.get(`${base}/api/headshots/${jordan1.id}?size=original`);
      const orMeta = await sharp(Buffer.from(await original.body())).metadata();
      if (orMeta.format !== "png" || orMeta.width !== 900 || orMeta.height !== 1200) throw new Error(`the original is kept as it came: ${orMeta.format} ${orMeta.width}x${orMeta.height}`);
      await page.goto(`${base}/coach`);
      if (!(await page.locator('[data-testid="member-avatar"][data-photo="1"]').count())) throw new Error("the coach's client list shows the photos");

      // Review: the row with no email goes to the coach (picked), the one nobody matches is dismissed.
      await page.goto(`${base}/coach/headshots`);
      if ((await page.locator('[data-testid="headshots-review-row"]').count()) !== 4) throw new Error("the review list shows the four");
      const coachMem = await mem("coach@demo.helixos.app");
      const riley = page.locator('[data-testid="headshots-review-row"][data-reason="no_email"]');
      await riley.locator('[data-testid="headshots-review-pick"]').selectOption(coachMem.id);
      await riley.locator('[data-testid="headshots-review-set"]').click();
      await page.waitForURL(/picked=1/);
      const coachAfter = await mem("coach@demo.helixos.app");
      const picked = await db.query.headshotReviews.findFirst({ where: and(eq(schema.headshotReviews.workspaceId, ws), eq(schema.headshotReviews.reason, "no_email")) });
      if (coachAfter.headshotAirtableId !== "attRILEY00000001" || picked?.status !== "picked" || picked.photoUrl || picked.email || picked.name) throw new Error("picked: the photo is that member's, and the row keeps only that it was settled");
      await page.locator('[data-testid="headshots-review-row"][data-reason="no_match"] [data-testid="headshots-review-dismiss"]').click();
      await page.waitForURL(/dismissed=1/);
      const dismissed = await db.query.headshotReviews.findFirst({ where: and(eq(schema.headshotReviews.workspaceId, ws), eq(schema.headshotReviews.reason, "no_match")) });
      if (dismissed?.status !== "dismissed" || dismissed.photoUrl || (await objects()).length !== stored1.length - 2) throw new Error("dismissed: its photo leaves the store");
      if ((await page.locator('[data-testid="headshots-review-row"]').count()) !== 2) throw new Error("two left to review");

      // A re-run changes nothing and brings no settled row back.
      const second = await run("apply", /applied=1/);
      if (!second.includes("2 matched (0 stored, 2 unchanged, 0 kept the client's own), 0 new to review")) throw new Error(`the re-run: ${second}`);
      if ((await objects()).length !== stored1.length - 2) throw new Error("a re-run stores nothing again");
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);

      // Maya: her photo in the header; another member's photo and the review photos are not hers to see; her own upload wins.
      await signIn("client");
      if ((await page.locator('[data-testid="header-avatar"] [data-testid="member-avatar"]').getAttribute("data-photo")) !== "1") throw new Error("the client's header shows her photo");
      if ((await page.request.get(`${base}/api/headshots/${jordan1.id}`)).status() !== 404) throw new Error("another member's photo is not hers to see");
      if ((await page.request.get(`${base}/api/headshots/review/${reviews[0].id}`)).status() !== 404) throw new Error("the review photos are the coach's");
      if ((await page.request.get(`${base}/api/headshots/${maya1.id}`)).status() !== 200) throw new Error("her own photo is hers to see");
      await page.goto(`${base}/settings#photo`);
      if ((await page.locator('[data-testid="photo-source"]').innerText()) !== "from your coach's records") throw new Error("Settings says where the photo came from");
      if (!(await page.locator('[data-testid="headshot-save"]').isDisabled())) throw new Error("Save waits for a photo");
      const own = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
      await page.waitForLoadState("networkidle");
      await page.locator('[data-testid="headshot-file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: own });
      await page.locator('[data-testid="headshot-file-picker"][data-count="1"]').waitFor({ timeout: 10000 });
      await Promise.all([page.waitForResponse((r) => r.url().includes("/api/headshots/upload")), page.locator('[data-testid="headshot-save"]').click()]);
      await page.waitForFunction(() => document.querySelector('[data-testid="photo-source"]')?.textContent === "your own", null, { timeout: 15000 });
      const maya2 = await mem("client@demo.helixos.app");
      if (maya2.headshotSource !== "upload" || maya2.headshotAirtableId || maya2.headshotUrl === maya1.headshotUrl) throw new Error("her upload replaces the import");
      // The badge on her ladder graphics uses the photo only when she says so (rule 6: a photo in HelixOS is not consent to publish).
      await page.goto(`${base}/settings`);
      await page.waitForLoadState("networkidle");
      if (await page.locator('[data-testid="brand-use-headshot"]').isChecked()) throw new Error("the photo is not the badge until she ticks it");
      await page.fill('[data-testid="brand-form"] input[name="name"]', "Maya's kit");
      await page.check('[data-testid="brand-use-headshot"]');
      await page.locator('button:has-text("Save brand kit")').click();
      await page.locator('[data-testid="brand-saved"], [data-testid="brand-refused"]').first().waitFor({ timeout: 20000 }).catch(() => undefined);
      if (!(await page.locator('[data-testid="brand-saved"]').count())) throw new Error(`the kit saves: ${page.url()} ${await page.locator('[data-testid="brand-refused"]').innerText().catch(() => "no notice")}`);
      const mayaUser = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
      if (!(await db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, ws), eq(schema.brandKits.userId, mayaUser.id)) }))?.graphicUseHeadshot) throw new Error("ticked and saved, the badge uses her photo");
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);

      // Jordan's photo changes in Airtable: a re-run updates his alone; Maya's own stands, and the replaced objects are gone.
      await fetch(`http://localhost:${mockPort}/__headshot-change`, { method: "POST" });
      await signIn("coach");
      const third = await run("apply", /applied=1/);
      if (!third.includes("2 matched (1 stored, 0 unchanged, 1 kept the client's own)")) throw new Error(`the run after a change: ${third}`);
      const jordan3 = await mem("client2@demo.helixos.app");
      if (jordan3.headshotAirtableId !== "attJORDAN0000002" || (await mem("client@demo.helixos.app")).headshotSource !== "upload") throw new Error("the changed photo updated, the member's own kept");
      const paths3 = (await objects()).map((o) => o.pathname);
      if (paths3.some((p) => jordan1.headshotUrl!.endsWith(p) || jordan1.headshotDisplayUrl!.endsWith(p))) throw new Error("the replaced photo leaves the store");
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);

      // Maya removes hers: gone, and the import never puts it back.
      await signIn("client");
      await page.goto(`${base}/settings#photo`);
      await page.waitForLoadState("networkidle");
      await page.locator('[data-testid="photo-remove"]').click();
      await page.waitForURL(/photo=removed/, { timeout: 60000 });
      const maya4 = await mem("client@demo.helixos.app");
      if (maya4.headshotSource !== "removed" || maya4.headshotUrl || (await page.request.get(`${base}/api/headshots/${maya4.id}`)).status() !== 404) throw new Error("removed: no photo, and the route says so");
      if ((await page.locator('[data-testid="header-avatar"] [data-testid="member-avatar"]').getAttribute("data-photo")) !== "0") throw new Error("the header is back to her emoji");
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);
      await signIn("coach");
      const fourth = await run("apply", /applied=1/);
      if (!fourth.includes("2 matched (0 stored, 1 unchanged, 1 kept the client's own)") || (await mem("client@demo.helixos.app")).headshotUrl) throw new Error(`a removed photo stays removed: ${fourth}`);
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);
      console.log("✓ client headshots: a bad token said; dry run 2 matched, 4 to review, 1 no headshot, nothing written; apply stored the original and a 512 square of each, all private; the coach's list and the client's header show them; one picked, one dismissed (its photo gone); a re-run changed nothing; Maya's upload won and she ticked it as her badge, Jordan's changed photo alone updated, her removal stayed removed; another member's photo and the review photos 404 for a client");
    }

    // ── Read only, and the tokens went nowhere. ──
    const { methods, paths } = (await (await fetch(`http://localhost:${mockPort}/__methods`)).json()) as { methods: string[]; paths: string[] };
    if (!methods.length || methods.some((x) => x !== "GET")) throw new Error(`the import only reads, got ${[...new Set(methods)].join(", ")}`);
    if (paths.some((x) => x.includes("tblLEADS"))) throw new Error("the people tables are never read");
    if (echoed.length) throw new Error(`a token came back from the server:\n${echoed.join("\n")}`);
    const log = readFileSync(process.env.DEV_LOG ?? "screenshots/logs/dev.log", "utf8");
    const dbFiles = readdirSync("data").filter((f) => /\.(db|sqlite)(-wal)?$/.test(f));
    const stored = dbFiles.some((f) => {
      const raw = readFileSync(`data/${f}`).toString("latin1");
      return raw.includes(SOURCE_TOKEN) || raw.includes(FALLBACK_TOKEN) || raw.includes(TESTIMONIALS_TOKEN);
    });
    if (log.includes(SOURCE_TOKEN) || log.includes(FALLBACK_TOKEN) || log.includes(TESTIMONIALS_TOKEN) || stored || !dbFiles.length) throw new Error("no token reaches the server log or the database");
    console.log(`✓ ${methods.length} requests to Airtable, all GET, none for the people tables' rows; no token came back from the server, reached the log or the database`);
  } finally {
    if (userId) {
      await db.delete(schema.tasks).where(eq(schema.tasks.userId, userId));
      await db.delete(schema.groups).where(eq(schema.groups.userId, userId));
      await db.delete(schema.goals).where(eq(schema.goals.userId, userId));
      await db.delete(schema.libraryAssets).where(eq(schema.libraryAssets.userId, userId));
      await db.delete(schema.leadMagnets).where(eq(schema.leadMagnets.userId, userId));
      await db.update(schema.offers).set({ replacedByOfferId: null }).where(eq(schema.offers.userId, userId));
      await db.delete(schema.offers).where(eq(schema.offers.userId, userId));
      await db.delete(schema.pathways).where(eq(schema.pathways.userId, userId));
      await db.delete(schema.essences).where(eq(schema.essences.userId, userId));
      await db.delete(schema.memberships).where(eq(schema.memberships.userId, userId));
      await db.delete(schema.users).where(inArray(schema.users.id, [userId]));
    }
    await browser.close();
    if (mock.pid) process.kill(-mock.pid);
    if (blobProc?.pid) process.kill(-blobProc.pid);
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Import smoke passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
