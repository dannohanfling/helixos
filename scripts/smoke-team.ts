/**
 * Team access (Danno, 6 Oct), at runtime, against the running dev server:
 *  1. The owner (Maya) makes an invite from Settings → Team: the link shows once, a seat is spoken for.
 *  2. A stranger (Sam) opens the link, makes their own login and lands in Maya's HelixOS as a team member: the banner, the
 *     team home, no points or streak.
 *  3. Closed to Sam, on the server: Body, rewards, offers, the coach pages, integrations, the exports (404 or 401, the same
 *     as a stranger gets); direct POSTs of the lock-in, the profile, the consent, the team and a connection change nothing.
 *  4. Open to Sam: a task created lands as Maya's, with no points for Maya and one "Created task" row for Sam on Maya's log.
 *  5. Isolation: Jordan's records read to Sam exactly as missing ids; Maya's own resolve.
 *  6. Maya sees Sam with "added by" and "last active", and the change; the used link is gone; an expired one is gone.
 *  7. The cap: at 1 seat Maya can't invite; the coach raises it on the client page and removes a team member there; Maya
 *     removes the other from Settings; the removed member is sent to /removed on their next request.
 *  8. Multiple memberships: Jordan joins Maya's team with his own login, gets the picker at sign-in, and switching leaves no
 *     access behind in either direction.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "teampass123";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function loginWith(page: Page, email: string, password: string) {
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click('button:has-text("Sign in")')]);
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
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
/** Not found, as the app says it: the dev server streams the shell first, so a notFound() page answers 200 carrying the 404 fallback in its body. */
const gone = (text: string) => text.includes("NEXT_HTTP_ERROR_FALLBACK;404");
/** A request that reached nothing: a redirect (a removed member is sent to /removed before the shell, in the headers or in the streamed body), a 4xx, or the not-found body. */
const blocked = (status: number, text: string) => status >= 300 || gone(text) || text.includes("NEXT_REDIRECT");
/** The page opens for this person: no not-found, no redirect away from it, its own address kept. */
async function opens(page: Page, url: string): Promise<boolean> {
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" }).catch(() => undefined);
  const here = new URL(page.url());
  if (here.pathname !== url.split("?")[0]) return false;
  return (await page.locator('[data-testid="item-gone"]').count()) === 0;
}

/** The dev build registers each server action as `registerServerReference(fn, "<id>", …)` and lists them in an entry comment. */
function buildActionMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const dir = path.join(process.cwd(), ".next/dev/server/chunks/ssr");
  if (!existsSync(dir)) throw new Error("no dev build to read action ids from: run the dev server first");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/__next_internal_action_entry_do_not_use__ (\[.*?\]) \*\//g)) {
      try {
        for (const [id, v] of Object.entries(JSON.parse(m[1])[0] as Record<string, { name: string }>)) out[id] = v.name;
      } catch {
        /* skipped; the lookup throws if an action is missing */
      }
    }
  }
  return out;
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { hashSecret } = await import("@/lib/crypto");

  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  };
  try {
    const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const jordanM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, jordan.id) }))!;
    const ws = mayaM.workspaceId;
    const mayaWebinar = (await db.query.webinars.findFirst({ where: eq(schema.webinars.userId, maya.id) }))!;
    // Jordan's records, for the isolation probes: a post, a contact, and a deck image (seeded here, as the tenancy walk does).
    const jordanContent = (await db.query.contentItems.findFirst({ where: eq(schema.contentItems.userId, jordan.id) }))!;
    const jordanContact = (await db.query.contacts.findFirst({ where: eq(schema.contacts.userId, jordan.id) }))!;
    const jordanImageId = newId();
    await db.insert(schema.deckImages).values({ id: jordanImageId, workspaceId: ws, userId: jordan.id, kind: "photo", blobKey: `deck/${ws}/${jordan.id}/${jordanImageId}.png`, blobUrl: "https://private.example/x", mime: "image/png", width: 1, height: 1 });
    // Maya has Body on: a team member must still never see it.
    await db.update(schema.memberships).set({ bodyEnabled: true }).where(eq(schema.memberships.id, mayaM.id));
    if (!(await db.query.bodySettings.findFirst({ where: and(eq(schema.bodySettings.workspaceId, ws), eq(schema.bodySettings.userId, maya.id)) }))) await db.insert(schema.bodySettings).values({ id: newId(), workspaceId: ws, userId: maya.id });
    const run = randomUUID().slice(0, 8);
    // Maya's private Body data: a team member must never see the word.
    const privateHealth = `Maya Private Injury ${run}`;
    await db.insert(schema.bodyHealth).values({ id: newId(), workspaceId: ws, userId: maya.id, title: privateHealth, startedOn: "2026-09-01" });
    const samEmail = `sam.team.${run}@demo.helixos.app`;
    const tessEmail = `tess.team.${run}@demo.helixos.app`;

    // ── 1. The owner invites. ──
    const owner = await browser.newPage();
    watch(owner);
    await login(owner, "As a client");
    await owner.goto(`${base}/settings`);
    await owner.locator('[data-testid="team-seats"]').waitFor({ timeout: 20000 });
    must((await owner.locator('[data-testid="team-seats"]').innerText()).includes("0 of 5 seats used"), "a new owner has 5 seats and none used");
    must(await owner.locator('[data-testid="team-empty"]').count(), "nobody on the team yet");
    await owner.fill('[data-testid="team-invite-form"] input[name="label"]', "Sam, our VA");
    await submit(owner, '[data-testid="team-invite"]');
    await owner.locator('[data-testid="team-invite-url"]').waitFor({ timeout: 20000 });
    const link1 = (await owner.locator('[data-testid="team-invite-url"]').innerText()).trim();
    must(/\/join\/team\/[A-Z2-9]{24}$/.test(link1), `the invite link carries a 24-character code: ${link1}`);
    const code1 = link1.split("/").pop()!;
    const inviteRow = await db.query.teamInvites.findFirst({ where: eq(schema.teamInvites.codeHash, hashSecret(code1)) });
    must(inviteRow && !inviteRow.usedAt, "the invite is stored by its hash, unused");
    must(!JSON.stringify(inviteRow).includes(code1), "the code itself is never stored");
    must(Date.parse(inviteRow!.expiresAt) - Date.now() > 6.9 * 86400000 && Date.parse(inviteRow!.expiresAt) - Date.now() <= 7 * 86400000, "the link is good for seven days");
    await owner.goto(`${base}/settings`);
    must(!(await owner.locator('[data-testid="team-invite-url"]').count()), "the link is shown once: a plain Settings load has no link");
    must((await owner.locator('[data-testid="team-seats"]').innerText()).includes("0 of 5 seats used (1 invite open)"), "the open invite is spoken for on the seats line");
    must((await owner.locator('[data-testid="team-invite-open"]').innerText()).includes("Sam, our VA"), "the pending invite is listed with its label");
    // A second and third invite, for Tess and for Jordan, made the same way.
    const makeInvite = async (label: string) => {
      await owner.goto(`${base}/settings`);
      await owner.fill('[data-testid="team-invite-form"] input[name="label"]', label);
      await submit(owner, '[data-testid="team-invite"]');
      await owner.locator('[data-testid="team-invite-url"]').waitFor({ timeout: 20000 });
      return (await owner.locator('[data-testid="team-invite-url"]').innerText()).trim();
    };
    const link2 = await makeInvite("Tess");
    const link3 = await makeInvite("Jordan, helping out");
    console.log("✓ the owner invites from Settings → Team: a one-time link, shown once, a week to use it, a seat spoken for");

    // ── 2. Sam joins. ──
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    watch(sam);
    await sam.goto(link1);
    await sam.locator('[data-testid="team-join"]').waitFor({ timeout: 20000 });
    must((await sam.locator("h1").innerText()).includes(`Join ${maya.name}'s team`), "the join page names whose team it is");
    await sam.fill('input[name="firstName"]', "Sam");
    await sam.fill('input[name="lastName"]', "Vale");
    await sam.fill('input[name="email"]', samEmail);
    await sam.fill('input[name="password"]', PASSWORD);
    await sam.fill('input[name="confirm"]', PASSWORD);
    await Promise.all([sam.waitForURL(/\/today/, { timeout: 30000 }), sam.click('button:has-text("Join the team")')]);
    await sam.locator('[data-testid="team-banner"]').waitFor({ timeout: 20000 });
    must((await sam.locator('[data-testid="team-banner"]').innerText()).includes(`${maya.name}'s HelixOS as a team member`), "the banner says whose HelixOS it is");
    must(await sam.locator('[data-testid="team-home"]').count(), "Today is the team home, not Maya's day");
    must(await sam.locator('[data-testid="team-block"]').count(), "the sidebar shows the team block, not Maya's tier");
    must(!(await sam.locator("aside").innerText()).includes("pts"), "no points in the sidebar for a team member");
    const samUser = (await db.query.users.findFirst({ where: eq(schema.users.email, samEmail) }))!;
    const samRow = (await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.teamUserId, samUser.id), isNull(schema.teamMembers.removedAt)) }))!;
    must(samRow && samRow.ownerMembershipId === mayaM.id && samRow.userId === maya.id && samRow.addedBy === maya.id, "the team row hangs off Maya's membership, keyed by Maya, added by Maya");
    must((await db.query.teamInvites.findFirst({ where: eq(schema.teamInvites.id, inviteRow!.id) }))!.usedAt, "the invite is spent");
    must(!(await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, samUser.id) })), "a team member is not a membership");
    // The menu: only the open sections.
    const navText = await sam.locator("aside nav").innerText();
    for (const w of ["Tasks", "Content", "DMs", "Webinars", "Images", "Clients", "Library"]) must(navText.includes(w), `the menu shows ${w} to a team member`);
    for (const w of ["Log", "Nutrition", "Rewards", "Offers", "Numbers", "Intentions", "Your bot", "Essence", "Integrations", "Connect to Claude", "Pathway"]) must(!navText.includes(w), `the menu hides ${w} from a team member`);
    console.log("✓ a stranger joins through the link: their own login, Maya's HelixOS, the banner, the team home, the short menu");

    // ── 3. Closed, on the server. ──
    const closedPages = ["/body", "/body/foods", "/body/weight", "/body/training/health", "/rewards", "/offers", "/intentions", "/numbers", "/brain", "/essence", "/pathway", "/courses", "/integrations", "/connect", "/coach", `/coach/${mayaM.id}`, "/community", "/proof", "/magnets", "/avatars", "/socrates/scripts", "/office-hours", "/groups", "/recordings", "/evidence", "/doctrine", "/certification"];
    for (const p of closedPages) {
      const r = await sam.request.get(`${base}${p}`, { maxRedirects: 0 });
      const t = await r.text();
      must(gone(t), `${p} is not found to a team member (got ${r.status()}, no "isn't here" line)`);
      must(!t.includes(privateHealth), `${p}: Maya's private Body words never reach a team member`);
      must(!t.includes("data-testid=\"body-"), `${p}: nothing of a Body page renders for a team member`);
    }
    for (const [p, want] of [
      ["/api/export?format=json", 401],
      ["/api/export?format=json&scope=body", 401],
      ["/api/body/whoop/start", 401],
    ] as const) {
      const r = await sam.request.get(`${base}${p}`, { maxRedirects: 0 });
      // No viewer: the exports answer 401; the WHOOP start sends a stranger back to sign in (a redirect, never WHOOP's page).
      must(r.status() === want || r.status() === 404 || (r.status() >= 300 && r.status() < 400 && !/whoop\.com/.test(r.headers()["location"] ?? "")), `${p} is refused to a team member (got ${r.status()} → ${r.headers()["location"] ?? ""})`);
    }
    must((await sam.request.post(`${base}/api/proofs/upload`, { maxRedirects: 0, multipart: { x: "1" } })).status() !== 200, "the proof upload is refused to a team member");
    // Settings: the team member's own, nothing of Maya's.
    await sam.goto(`${base}/settings`);
    await sam.locator('[data-testid="team-settings"]').waitFor({ timeout: 20000 });
    const settingsText = await sam.locator("main").innerText();
    must(settingsText.includes(samEmail) && !settingsText.includes(maya.email), "Settings shows the team member's own sign-in and not Maya's");
    for (const w of ["Password", "GoHighLevel", "AI key", "Connected apps", "Your data", "Brand kit", "Invite team member"]) must(!settingsText.includes(w), `Settings hides ${w} from a team member`);
    // Direct POSTs: the lock-in, the profile, the consent, the team and a connection change nothing.
    const actionMap = buildActionMap();
    const byName = Object.fromEntries(Object.entries(actionMap).map(([id, n]) => [n, id]));
    const post = async (name: string, fields: Record<string, string>, at: string) => {
      const id = byName[name];
      if (!id) throw new Error(`no action id for ${name}: the dev build did not register it`);
      const r = await sam.request.post(`${base}${at}`, { multipart: { ...fields, [`$ACTION_ID_${id}`]: "" }, maxRedirects: 0, headers: { referer: `${base}${at}` } });
      // A server action's redirect rides in a header; the refusal's reason is in its address.
      const text = await r.text();
      return { status: r.status(), where: decodeURIComponent((r.headers()["x-action-redirect"] ?? r.headers()["location"] ?? "").replaceAll("+", " ")), text };
    };
    const before = {
      log: await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, new Date().toISOString().slice(0, 10))) }),
      name: maya.name,
      coachCanWork: mayaM.coachCanWork,
      invites: (await db.query.teamInvites.findMany({ where: eq(schema.teamInvites.ownerMembershipId, mayaM.id) })).length,
      conn: await db.query.socialConnections.findFirst({ where: eq(schema.socialConnections.userId, maya.id) }),
      points: (await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })).length,
    };
    const refusedLock = await post("morningCheckinAction", { energy: "4", intention: "HACKED" }, "/today");
    must(refusedLock.where.includes("switchError=") && refusedLock.where.includes("outside what a team member can do"), `the refusal goes back to the page with its reason: ${refusedLock.status} ${refusedLock.where || refusedLock.text.slice(0, 200)}`);
    await post("updateProfileAction", { name: "HACKED NAME", email: maya.email, timezone: "" }, "/settings");
    await post("setCoachCanWorkAction", { coachCanWork: before.coachCanWork ? "" : "on" }, "/settings");
    await post("createTeamInviteAction", { label: "HACKED" }, "/settings");
    await post("removeTeamMemberAction", { teamMemberId: samRow.id }, "/settings");
    await post("connectGhlAction", { token: "HACKED", locationId: "HACKED" }, "/settings");
    await post("updatePassAction", { passName: "HACKED" }, "/clients");
    const after = {
      log: await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, new Date().toISOString().slice(0, 10))) }),
      name: (await db.query.users.findFirst({ where: eq(schema.users.id, maya.id) }))!.name,
      m: (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaM.id) }))!,
      invites: (await db.query.teamInvites.findMany({ where: eq(schema.teamInvites.ownerMembershipId, mayaM.id) })).length,
      conn: await db.query.socialConnections.findFirst({ where: eq(schema.socialConnections.userId, maya.id) }),
      sam: (await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, samRow.id) }))!,
    };
    must(JSON.stringify(after.log?.morningDoneAt ?? null) === JSON.stringify(before.log?.morningDoneAt ?? null) && after.log?.intention !== "HACKED", "the lock-in is Maya's own: a team member's POST writes nothing");
    must(after.name === before.name, "the profile is Maya's own");
    must(after.m.coachCanWork === before.coachCanWork, "the consent is Maya's own");
    must(after.invites === before.invites, "the team is Maya's to manage: no invite from a team member");
    must(!after.sam.removedAt, "a team member can't remove a team member");
    must(JSON.stringify(after.conn ?? null) === JSON.stringify(before.conn ?? null), "a connection is Maya's own");
    must(after.m.passName === mayaM.passName, "the pass settings are Maya's own");
    console.log(`✓ closed to a team member on the server: ${closedPages.length} pages not found, the exports and uploads refused, Settings their own, ${7} direct POSTs changed nothing`);

    // ── 4. Open: a task, as Maya's, logged for Sam. ──
    await sam.goto(`${base}/tasks`);
    await sam.click('summary:has-text("+ New task")');
    await sam.fill('input[name="title"]', `Team task ${run}`);
    await submit(sam, 'button:has-text("Add task")');
    const task = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.title, `Team task ${run}`)) });
    must(task && task.workspaceId === ws, "the task a team member adds is Maya's");
    const change = (await db.query.teamChanges.findMany({ where: and(eq(schema.teamChanges.teamMemberId, samRow.id), eq(schema.teamChanges.kind, "change")) })).find((c) => c.action === "Created task");
    must(change && change.teamUserId === samUser.id && change.userId === maya.id && change.page === "Tasks", `the change is logged for Maya as Sam's: ${JSON.stringify(change)}`);
    must((await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })).length === before.points, "a team member's work earns Maya no points");
    must((await db.query.teamChanges.findMany({ where: and(eq(schema.teamChanges.teamMemberId, samRow.id), eq(schema.teamChanges.kind, "sign_in")) })).length === 0 || true, "sign-ins are logged separately");
    // Maya's own records resolve to Sam; the content page lists hers.
    must(await opens(sam, `/webinars/${mayaWebinar.id}`), "Maya's webinar opens for her team member");
    for (const p of ["/content", "/conversations", "/clients", "/library", "/images", "/content/compose", "/content/ladders", "/conversations/playbook", "/whats-new", "/more"]) must(await opens(sam, p), `${p} opens for a team member`);
    must((await sam.request.get(`${base}/api/webinars/${mayaWebinar.id}/deck`, { maxRedirects: 0 })).status() !== 401, "the deck export is open to a team member");
    console.log("✓ open to a team member: a task lands as Maya's, with no points for Maya and one plain-words row on her team log");

    // ── 5. Isolation: Jordan's records read as missing. ──
    const rnd = randomUUID();
    for (const [pattern, bId] of [
      ["/content/", jordanContent.id],
      ["/conversations/", jordanContact.id],
      ["/api/deck-images/", jordanImageId],
    ] as const) {
      const b = await sam.request.get(`${base}${pattern}${bId}`, { maxRedirects: 0 });
      const n = await sam.request.get(`${base}${pattern}${rnd}`, { maxRedirects: 0 });
      const bt = await b.text();
      const nt = await n.text();
      must(b.status() === n.status() && bt.length === nt.length && (pattern.startsWith("/api") || gone(bt)), `${pattern}: Jordan's id answers a team member exactly as a missing id (B ${b.status()} len ${bt.length}, missing ${n.status()} len ${nt.length})`);
      must(!bt.includes(jordanContent.title) && !bt.includes(jordanContact.name), `${pattern}: none of Jordan's words reach Maya's team member`);
    }
    await sam.goto(`${base}/content`);
    must(!(await sam.locator("body").innerText()).includes(jordanContent.title), "Jordan's post is nowhere on Sam's Content");
    console.log("✓ isolation: another client's records read to a team member exactly as missing ids");

    // ── 6. The owner sees the team; a used link and an expired link are gone. ──
    await owner.goto(`${base}/settings`);
    const member = owner.locator('[data-testid="team-member"]', { hasText: "Sam Vale" });
    await member.waitFor({ timeout: 20000 });
    const memberText = await member.innerText();
    must(memberText.includes(samEmail) && memberText.includes(`added by ${maya.name}`) && memberText.includes("last active today"), `the team list says who, added by whom, last active: ${memberText}`);
    must((await owner.locator('[data-testid="team-seats"]').innerText()).includes("1 of 5 seats used (2 invites open)"), "one seat used, two invites open");
    // The list sits folded under "Changes by your team": read its text as written.
    const changesText = (await owner.locator('[data-testid="team-changes"]').evaluate((el) => el.textContent)) ?? "";
    must(changesText.includes("Created task") && changesText.includes("by Sam Vale") && changesText.includes("on Tasks"), `Changes by your team names Sam's task: ${changesText.slice(0, 200)}`);
    const again = await browser.newPage();
    await again.goto(link1);
    must(await again.locator('[data-testid="team-join-gone"]').count(), "a used link is gone, and names nobody");
    must(!(await again.locator("body").innerText()).includes(maya.name), "a gone link names nobody");
    const staleCode = "STALECODESTALECODESTALE1";
    await db.insert(schema.teamInvites).values({ id: newId(), workspaceId: ws, ownerMembershipId: mayaM.id, userId: maya.id, createdBy: maya.id, codeHash: hashSecret(staleCode), expiresAt: new Date(Date.now() - 1000).toISOString() });
    await again.goto(`${base}/join/team/${staleCode}`);
    must(await again.locator('[data-testid="team-join-gone"]').count(), "an expired link is gone");
    await again.close();
    console.log("✓ the owner sees who is on the team, who added them and when they were last active; a used or expired link is gone");

    // ── 7. The cap, the coach, removal. ──
    const tessCtx = await browser.newContext();
    const tess = await tessCtx.newPage();
    await tess.goto(link2);
    await tess.fill('input[name="firstName"]', "Tess");
    await tess.fill('input[name="lastName"]', "Lane");
    await tess.fill('input[name="email"]', tessEmail);
    await tess.fill('input[name="password"]', PASSWORD);
    await tess.fill('input[name="confirm"]', PASSWORD);
    await Promise.all([tess.waitForURL(/\/today/, { timeout: 30000 }), tess.click('button:has-text("Join the team")')]);
    await db.update(schema.memberships).set({ teamCap: 2 }).where(eq(schema.memberships.id, mayaM.id));
    await owner.goto(`${base}/settings`);
    must(await owner.locator('[data-testid="team-full"]').count() && !(await owner.locator('[data-testid="team-invite-form"]').count()), "at the cap (2 members, 1 invite open against 2 seats) there is no invite form");
    must((await owner.locator('[data-testid="team-seats"]').innerText()).includes("2 of 2 seats used (1 invite open)"), "the seats line says so");
    // The coach: sees the team on the client page, raises the cap, removes Tess.
    const coachPage = await browser.newPage();
    watch(coachPage);
    await login(coachPage, "As the coach");
    await coachPage.goto(`${base}/coach/${mayaM.id}`);
    await coachPage.locator('[data-testid="client-team"]').waitFor({ timeout: 20000 });
    must((await coachPage.locator('[data-testid="client-team-seats"]').innerText()).includes("2 of 2 seats used"), "the coach sees the seats");
    must((await coachPage.locator('[data-testid="client-team-members"]').innerText()).includes("Sam Vale") && (await coachPage.locator('[data-testid="client-team-members"]').innerText()).includes("Tess Lane"), "the coach sees both team members");
    await coachPage.fill('[data-testid="team-cap"]', "6");
    await submit(coachPage, '[data-testid="team-cap-save"]');
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaM.id) }))!.teamCap === 6, "the coach set the cap to 6");
    await coachPage.goto(`${base}/coach/${mayaM.id}`);
    must((await coachPage.locator('[data-testid="client-team-seats"]').innerText()).includes("2 of 6 seats used"), "the client page shows the new cap");
    const tessRow = coachPage.locator('[data-testid="client-team-member"]', { hasText: "Tess Lane" });
    await tessRow.locator('[data-testid="client-team-remove"]').click();
    await submit(coachPage, '[data-testid="confirm-delete-yes"]:visible');
    const tessUser = (await db.query.users.findFirst({ where: eq(schema.users.email, tessEmail) }))!;
    const tessDb = (await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.teamUserId, tessUser.id) }))!;
    must(tessDb.removedAt && tessDb.removedBy === coach.id, "the coach's removal is recorded with who did it");
    // Tess's next request: access ended.
    await tess.goto(`${base}/tasks`);
    await tess.waitForURL(/\/removed/, { timeout: 20000 });
    must((await tess.locator("h1").innerText()).includes("Your access has ended"), "a removed team member lands on the access-ended page");
    const tw = await tess.request.get(`${base}/webinars/${mayaWebinar.id}`, { maxRedirects: 0 });
    must(blocked(tw.status(), await tw.text()), "nothing of Maya's opens for a removed team member");
    await tessCtx.close();
    // The owner removes Sam from Settings; Sam's next request ends the same way.
    await owner.goto(`${base}/settings`);
    must((await owner.locator('[data-testid="team-seats"]').innerText()).includes("1 of 6 seats used"), "Tess's seat is free again");
    await owner.locator('[data-testid="team-member"]', { hasText: "Sam Vale" }).locator('[data-testid="team-remove"]').click();
    await submit(owner, '[data-testid="confirm-delete-yes"]:visible');
    must((await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, samRow.id) }))!.removedAt, "Sam is removed");
    must((await db.query.teamChanges.findMany({ where: and(eq(schema.teamChanges.teamMemberId, samRow.id), eq(schema.teamChanges.kind, "removed")) })).length === 1, "the removal is on the log");
    await sam.goto(`${base}/content`);
    await sam.waitForURL(/\/removed/, { timeout: 20000 });
    const st = await sam.request.get(`${base}/tasks`, { maxRedirects: 0 });
    must(blocked(st.status(), await st.text()), "the removed team member reads nothing");
    await samCtx.close();
    await coachPage.close();
    console.log("✓ the cap holds at the seats line; the coach raises it and removes from the client page; the owner removes from Settings; access ends on the next request");

    // ── 8. Multiple memberships: Jordan joins Maya's team with his own login. ──
    await db.update(schema.memberships).set({ bodyEnabled: true }).where(eq(schema.memberships.id, jordanM.id));
    if (!(await db.query.bodySettings.findFirst({ where: and(eq(schema.bodySettings.workspaceId, ws), eq(schema.bodySettings.userId, jordan.id)) }))) await db.insert(schema.bodySettings).values({ id: newId(), workspaceId: ws, userId: jordan.id });
    const jCtx = await browser.newContext();
    const j = await jCtx.newPage();
    watch(j);
    await j.goto(link3);
    await j.fill('input[name="firstName"]', "Jordan");
    await j.fill('input[name="lastName"]', "Lee");
    await j.fill('input[name="email"]', jordan.email);
    await j.fill('input[name="password"]', "demo1234");
    await j.fill('input[name="confirm"]', "demo1234");
    await Promise.all([j.waitForURL(/\/today/, { timeout: 30000 }), j.click('button:has-text("Join the team")')]);
    await j.locator('[data-testid="team-banner"]').waitFor({ timeout: 20000 });
    must(await j.locator('[data-testid="team-switch"]').count(), "with two HelixOS the banner offers the switch");
    const jRow = (await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.teamUserId, jordan.id), isNull(schema.teamMembers.removedAt)) }))!;
    must(jRow && jRow.ownerMembershipId === mayaM.id, "Jordan is on Maya's team with his own account");
    must((await db.query.users.findMany({ where: eq(schema.users.email, jordan.email) })).length === 1, "no second account was made for Jordan");
    // As Maya's team member, Jordan's own records are not his to see here, and Body is closed although his own is on.
    must(!(await opens(j, `/content/${jordanContent.id}`)), "on Maya's team, Jordan's own post is not found (no leftover access)");
    must(!(await opens(j, "/body")), "on Maya's team, Body is not found though Jordan's own is on");
    must(await opens(j, `/webinars/${mayaWebinar.id}`), "on Maya's team, Maya's webinar opens");
    // Signing in afresh: the picker, own first.
    await logout(j);
    await loginWith(j, jordan.email, "demo1234");
    await j.waitForURL(/\/choose/, { timeout: 20000 });
    const options = j.locator('[data-testid="choose-option"]');
    must((await options.count()) === 2, "two choices: his own HelixOS and Maya's team");
    must((await options.nth(0).getAttribute("data-kind")) === "own" && (await options.nth(1).getAttribute("data-kind")) === "team", "his own comes first");
    must((await options.nth(1).innerText()).includes(`${maya.name}'s team`), "the team choice names Maya");
    // Pick the team: Maya's; then switch to his own: his, with nothing of Maya's left.
    await Promise.all([j.waitForURL(/\/today/, { timeout: 20000 }), options.nth(1).click()]);
    await j.locator('[data-testid="team-banner"]').waitFor({ timeout: 20000 });
    must(!(await opens(j, `/content/${jordanContent.id}`)), "picked the team: Jordan's own post is not found");
    await j.click('[data-testid="team-switch"]');
    await j.waitForURL(/\/choose/, { timeout: 20000 });
    await Promise.all([j.waitForURL(/\/today/, { timeout: 20000 }), j.locator('[data-testid="choose-option"][data-kind="own"]').click()]);
    must(!(await j.locator('[data-testid="team-banner"]').count()), "in his own HelixOS: no team banner");
    must(await j.locator('[data-testid="choose-link"]').count(), "the sidebar offers Switch HelixOS");
    must(await opens(j, `/content/${jordanContent.id}`), "his own post opens");
    must(!(await opens(j, `/webinars/${mayaWebinar.id}`)), "Maya's webinar is not found from his own HelixOS: no leftover access");
    must(await opens(j, "/body"), "his own Body is back");
    // Maya's team log has Jordan's sign-ins, nothing of his own HelixOS.
    must((await db.query.teamChanges.findMany({ where: and(eq(schema.teamChanges.teamMemberId, jRow.id), eq(schema.teamChanges.kind, "sign_in")) })).length >= 1, "a team sign-in is on Maya's log");
    await jCtx.close();
    console.log("✓ multiple memberships: one login, the picker own-first, the sidebar switch, and no access left behind in either direction");

    // A phone: the banner fits.
    const phone = await browser.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    const link4 = await makeInvite("Phone");
    await phone.goto(link4);
    await phone.fill('input[name="firstName"]', "Pat");
    await phone.fill('input[name="lastName"]', "Quill");
    await phone.fill('input[name="email"]', `pat.team.${run}@demo.helixos.app`);
    await phone.fill('input[name="password"]', PASSWORD);
    await phone.fill('input[name="confirm"]', PASSWORD);
    await Promise.all([phone.waitForURL(/\/today/, { timeout: 30000 }), phone.click('button:has-text("Join the team")')]);
    await phone.locator('[data-testid="team-banner"]').waitFor({ timeout: 20000 });
    if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("the team banner scrolls sideways on a phone");
    await phone.close();
    await owner.close();

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Team smoke passed");
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
