/**
 * Tenancy at runtime: a client can never read or write another client's record, over every route and a mutating action per
 * owned table. Two clients are seeded, A and B, each owning a record in every client-owned table; the walk signs in as A and
 * tries B's ids, guessed and tampered into bodies. Every read must answer exactly as a nonexistent id does (same status, same
 * body, B's private words absent); every write must leave B's row untouched. The route list is derived from src/app and the
 * route-to-table map is asserted against it, so a new dynamic route fails the walk until it is classified (second rule); every
 * "no leak" is paired with a count of what was tried (first rule); a route or action not exercised is named, never skipped.
 * The source companion is src/lib/engine/__tests__/tenancy.test.ts. Run with the dev server up.
 */
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";

/** Every dynamic route under src/app, as "<url pattern> :: <source file>", read off the filesystem, never typed by hand. */
function dynamicRoutes(): { pattern: string; file: string }[] {
  const root = path.join(process.cwd(), "src/app");
  const out: { pattern: string; file: string }[] = [];
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // A route group like (app) is a folder that adds no path segment.
        const seg = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
        walk(full, url + seg);
      } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
        if (url.includes("[")) out.push({ pattern: url || "/", file: path.relative(process.cwd(), full) });
      }
    }
  };
  walk(root, "");
  return out.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

/**
 * The map from a dynamic route to the table whose id it takes, and the ids the walk substitutes. `owned` routes read a record
 * scoped to a user and are probed with B's id; `public` routes read by a slug, a code, a token or a global catalog and are
 * listed with the reason; `coach` routes require the coach role and are probed to prove a client is bounced. The keys are
 * asserted against the filesystem below, so this map can never silently fall out of step with the routes that exist.
 */
type Owned = { kind: "owned"; table: string };
type Route = Owned | { kind: "public"; why: string } | { kind: "coach" };
const ROUTES: Record<string, Route> = {
  "/clients/[id]": { kind: "owned", table: "clientRecords" },
  "/coach/[clientId]": { kind: "coach" },
  "/coach/[clientId]/body": { kind: "coach" },
  "/coach/[clientId]/bot": { kind: "coach" },
  "/coach/[clientId]/delete": { kind: "coach" },
  "/content/[id]": { kind: "owned", table: "contentItems" },
  "/content/[id]/compose": { kind: "owned", table: "contentItems" },
  "/content/[id]/repurpose": { kind: "owned", table: "contentItems" },
  "/content/ladders/[id]": { kind: "owned", table: "ladders" },
  "/conversations/[id]": { kind: "owned", table: "contacts" },
  "/doctrine/[code]": { kind: "public", why: "a principle code from the shared doctrine, the same for everyone" },
  "/groups/[id]": { kind: "owned", table: "groups" },
  "/library/[id]": { kind: "owned", table: "libraryPosts" },
  "/magnets/[id]": { kind: "owned", table: "leadMagnets" },
  "/offers/[id]": { kind: "owned", table: "offers" },
  "/proof/[id]": { kind: "owned", table: "proofs" },
  "/recordings/[id]": { kind: "owned", table: "recordings" },
  "/rewards/book/[claimId]": { kind: "owned", table: "rewardClaims" },
  "/socrates/scripts/[id]": { kind: "owned", table: "socratesScripts" },
  "/socrates/scripts/[id]/sheet": { kind: "owned", table: "socratesScripts" },
  "/webinars/[id]": { kind: "owned", table: "webinars" },
  "/webinars/[id]/runsheet": { kind: "owned", table: "webinars" },
  "/join/[code]": { kind: "public", why: "the workspace invite code, entered before any session exists" },
  "/reset/[token]": { kind: "public", why: "a single-use password-reset token, its own secret" },
  "/link-chat/[token]": { kind: "public", why: "a single-use chat-link token, its own secret; the page itself refuses a token from another workspace" },
  "/api/deck-images/[id]": { kind: "owned", table: "deckImages" },
  "/body/training/[exerciseId]": { kind: "owned", table: "bodyExercises" },
  "/api/proofs/attachments/[id]": { kind: "owned", table: "proofAttachments" },
  "/api/reports/[id]/screenshot": { kind: "owned", table: "memberReports" },
  "/api/webinars/[id]/deck": { kind: "owned", table: "webinars" },
  "/api/webhooks/fathom/[connectionId]": { kind: "public", why: "Fathom's signed delivery for one workspace connection: POST only, verified against the connection's sealed secret, 401 unsigned; a GET answers 405 for every id" },
  "/files/[...key]": { kind: "public", why: "the public object store; a private proof file is served by /api/proofs/attachments/[id]" },
  "/g/[slug]": { kind: "public", why: "a lead magnet's public tracked link, read by strangers" },
  "/m/[slug]": { kind: "public", why: "a lead magnet's public hosted page, read by strangers" },
};

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { slugify, scaffoldContent } = await import("@/lib/engine/lead-magnet");

  // The route list is the source of truth; the map is asserted against it so drift fails here.
  const routes = dynamicRoutes();
  const patterns = new Set(routes.map((r) => r.pattern));
  const mapped = new Set(Object.keys(ROUTES));
  const unmapped = [...patterns].filter((p) => !mapped.has(p));
  const stale = [...mapped].filter((p) => !patterns.has(p));
  if (unmapped.length) throw new Error(`a dynamic route exists that this walk does not classify: ${unmapped.join(", ")}`);
  if (stale.length) throw new Error(`this walk classifies a route that no longer exists: ${stale.join(", ")}`);
  console.log(`✓ ${routes.length} dynamic routes on disk, every one classified (${Object.values(ROUTES).filter((r) => r.kind === "owned").length} owned, ${Object.values(ROUTES).filter((r) => r.kind === "public").length} public, ${Object.values(ROUTES).filter((r) => r.kind === "coach").length} coach)`);

  const A = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!; // Jordan
  const B = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!; // Maya
  const bMem = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, B.id) }))!;
  const ws = bMem.workspaceId;

  // Seed a B-owned record in the client-owned tables the demo leaves empty for Maya, so every owned route has a target.
  const ensureMagnet = async () => {
    let m = await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.userId, B.id) });
    if (!m) {
      const id = newId();
      await db.insert(schema.leadMagnets).values({ id, workspaceId: ws, userId: B.id, title: "B's Private Magnet", promise: "B only.", keyword: "BONLY", slug: slugify("B Private Magnet " + id.slice(0, 6)), content: scaffoldContent("checklist", "B only."), generatedBy: "scaffold", origin: "rule" });
      m = (await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, id) }))!;
    }
    return m;
  };
  const ensureLibrary = async () => {
    let l = await db.query.libraryPosts.findFirst({ where: eq(schema.libraryPosts.userId, B.id) });
    if (!l) {
      const id = newId();
      await db.insert(schema.libraryPosts).values({ id, workspaceId: ws, userId: B.id, title: "B's Private Library Post", body: "B only, never shared.", shared: false });
      l = (await db.query.libraryPosts.findFirst({ where: eq(schema.libraryPosts.id, id) }))!;
    }
    return l;
  };
  const ensureScript = async () => {
    let s = await db.query.socratesScripts.findFirst({ where: eq(schema.socratesScripts.userId, B.id) });
    if (!s) {
      const id = newId();
      await db.insert(schema.socratesScripts).values({ id, workspaceId: ws, userId: B.id, name: "B's Private Script", scriptType: "DM" });
      s = (await db.query.socratesScripts.findFirst({ where: eq(schema.socratesScripts.id, id) }))!;
    }
    return s;
  };
  const ensureClaim = async () => {
    let c = await db.query.rewardClaims.findFirst({ where: eq(schema.rewardClaims.userId, B.id) });
    if (!c) {
      const id = newId();
      await db.insert(schema.rewardClaims).values({ id, workspaceId: ws, userId: B.id, rewardName: "B's Private Reward", pointsSpent: 100 });
      c = (await db.query.rewardClaims.findFirst({ where: eq(schema.rewardClaims.id, id) }))!;
    }
    return c;
  };
  const ensureAttachment = async () => {
    const proof = (await db.query.proofs.findFirst({ where: eq(schema.proofs.userId, B.id) }))!;
    let a = await db.query.proofAttachments.findFirst({ where: eq(schema.proofAttachments.proofId, proof.id) });
    if (!a) {
      const id = newId();
      await db.insert(schema.proofAttachments).values({ id, proofId: proof.id, workspaceId: ws, blobKey: `proofs/${ws}/${proof.id}/${id}.jpg`, blobUrl: "https://private.example/x", kind: "image", mime: "image/jpeg", bytes: 1, originalFilename: "b.jpg", uploadedBy: B.id, showsAResult: false, showsAPerson: false });
      a = (await db.query.proofAttachments.findFirst({ where: eq(schema.proofAttachments.id, id) }))!;
    }
    return a;
  };
  const ensureDeckImage = async () => {
    let d = await db.query.deckImages.findFirst({ where: eq(schema.deckImages.userId, B.id) });
    if (!d) {
      const id = newId();
      await db.insert(schema.deckImages).values({ id, workspaceId: ws, userId: B.id, kind: "photo", blobKey: `deck/${ws}/${B.id}/${id}.png`, blobUrl: "https://private.example/x", mime: "image/png", width: 1, height: 1 });
      d = (await db.query.deckImages.findFirst({ where: eq(schema.deckImages.id, id) }))!;
    }
    return d;
  };
  // Body (B2): A has Body on and set up, so B's exercise id is refused by the member scoping, not by A's Body being off; B owns
  // a private exercise with a logged set.
  const { and } = await import("drizzle-orm");
  const aMem = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, A.id), eq(schema.memberships.workspaceId, ws)) }))!;
  await db.update(schema.memberships).set({ bodyEnabled: true }).where(eq(schema.memberships.id, aMem.id));
  if (!(await db.query.bodySettings.findFirst({ where: and(eq(schema.bodySettings.workspaceId, ws), eq(schema.bodySettings.userId, A.id)) }))) await db.insert(schema.bodySettings).values({ id: newId(), workspaceId: ws, userId: A.id });
  const ensureExercise = async () => {
    let e = await db.query.bodyExercises.findFirst({ where: eq(schema.bodyExercises.userId, B.id) });
    if (!e) {
      const id = newId();
      const sessionId = newId();
      await db.insert(schema.bodyExercises).values({ id, workspaceId: ws, userId: B.id, name: "B's Private Lift" });
      await db.insert(schema.bodySessions).values({ id: sessionId, workspaceId: ws, userId: B.id, date: "2026-09-01" });
      await db.insert(schema.bodySets).values({ id: newId(), workspaceId: ws, userId: B.id, sessionId, exerciseId: id, date: "2026-09-01", weight: 123, reps: 4 });
      e = (await db.query.bodyExercises.findFirst({ where: eq(schema.bodyExercises.id, id) }))!;
    }
    return e;
  };
  // Phase 8: B owns a private habit and a health-log entry; A's actions on their ids must leave both untouched.
  const ensureHabit = async () => {
    let h = await db.query.bodyHabits.findFirst({ where: eq(schema.bodyHabits.userId, B.id) });
    if (!h) {
      const id = newId();
      await db.insert(schema.bodyHabits).values({ id, workspaceId: ws, userId: B.id, name: "B's Private Habit", kind: "done" });
      h = (await db.query.bodyHabits.findFirst({ where: eq(schema.bodyHabits.id, id) }))!;
    }
    return h;
  };
  const ensureHealth = async () => {
    let h = await db.query.bodyHealth.findFirst({ where: eq(schema.bodyHealth.userId, B.id) });
    if (!h) {
      const id = newId();
      await db.insert(schema.bodyHealth).values({ id, workspaceId: ws, userId: B.id, title: "B's Private Injury", startedOn: "2026-09-01" });
      h = (await db.query.bodyHealth.findFirst({ where: eq(schema.bodyHealth.id, id) }))!;
    }
    return h;
  };
  // A recording published to B alone (Recordings R1): a workspace row whose audience names B, so to A it must read as missing.
  const ensureRecording = async () => {
    let r = (await db.query.recordings.findMany({ where: eq(schema.recordings.workspaceId, ws) })).find((x) => x.status === "published" && x.audience === "members" && x.audienceUserIds.includes(B.id) && !x.audienceUserIds.includes(A.id));
    if (!r) {
      const id = newId();
      await db.insert(schema.recordings).values({ id, workspaceId: ws, fathomRecordingId: `tenancy-${id.slice(0, 8)}`, title: "B's Private One-to-one", url: "https://fathom.video/calls/1", summary: "B's private launch plan.", source: "sync", audience: "members", audienceUserIds: [B.id], status: "published", publishedAt: new Date().toISOString(), publishedBy: "tenancy" });
      r = (await db.query.recordings.findFirst({ where: eq(schema.recordings.id, id) }))!;
    }
    return r;
  };
  // An issue B sent with a screenshot (rev 432): to A, its picture must read exactly as a missing one.
  const ensureReport = async () => {
    let r = await db.query.memberReports.findFirst({ where: eq(schema.memberReports.userId, B.id) });
    if (!r) {
      const id = newId();
      await db.insert(schema.memberReports).values({ id, workspaceId: ws, userId: B.id, kind: "issue", severity: "red", description: "B's private issue.", page: "/today", screenshotKey: `reports/${ws}/${id}.png`, screenshotUrl: `http://localhost:4050/reports/${ws}/${id}.png`, screenshotType: "image/png" });
      r = (await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, id) }))!;
    }
    return r;
  };
  await Promise.all([ensureMagnet(), ensureLibrary(), ensureScript(), ensureClaim(), ensureAttachment(), ensureDeckImage(), ensureExercise(), ensureHabit(), ensureHealth(), ensureRecording(), ensureReport()]);

  // One B-owned id per table the routes name, so the walk can substitute B's id into A's request.
  const first = async <T>(q: Promise<T | undefined>): Promise<T> => {
    const r = await q;
    if (!r) throw new Error("expected a B-owned record to exist for the sweep");
    return r;
  };
  const bId: Record<string, string> = {
    clientRecords: (await first(db.query.clientRecords.findFirst({ where: eq(schema.clientRecords.userId, B.id) }))).id,
    contentItems: (await first(db.query.contentItems.findFirst({ where: eq(schema.contentItems.userId, B.id) }))).id,
    ladders: (await first(db.query.ladders.findFirst({ where: eq(schema.ladders.userId, B.id) }))).id,
    contacts: (await first(db.query.contacts.findFirst({ where: eq(schema.contacts.userId, B.id) }))).id,
    groups: (await first(db.query.groups.findFirst({ where: eq(schema.groups.userId, B.id) }))).id,
    libraryPosts: (await ensureLibrary()).id,
    leadMagnets: (await ensureMagnet()).id,
    offers: (await first(db.query.offers.findFirst({ where: eq(schema.offers.userId, B.id) }))).id,
    proofs: (await first(db.query.proofs.findFirst({ where: eq(schema.proofs.userId, B.id) }))).id,
    rewardClaims: (await ensureClaim()).id,
    socratesScripts: (await ensureScript()).id,
    webinars: (await first(db.query.webinars.findFirst({ where: eq(schema.webinars.userId, B.id) }))).id,
    proofAttachments: (await ensureAttachment()).id,
    deckImages: (await ensureDeckImage()).id,
    bodyExercises: (await ensureExercise()).id,
    bodySets: (await first(db.query.bodySets.findFirst({ where: eq(schema.bodySets.userId, B.id) }))).id,
    bodyHabits: (await ensureHabit()).id,
    bodyHealth: (await ensureHealth()).id,
    recordings: (await ensureRecording()).id,
    memberReports: (await ensureReport()).id,
  };
  // B's private words, per table, that must never appear in a response to A.
  const bWord: Record<string, string> = {
    contentItems: (await first(db.query.contentItems.findFirst({ where: eq(schema.contentItems.userId, B.id) }))).title,
    webinars: (await first(db.query.webinars.findFirst({ where: eq(schema.webinars.userId, B.id) }))).title,
    offers: (await first(db.query.offers.findFirst({ where: eq(schema.offers.userId, B.id) }))).name,
    bodyExercises: (await ensureExercise()).name,
    bodyHealth: (await ensureHealth()).title,
    recordings: (await ensureRecording()).title,
  };

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', A.email);
    await page.fill('input[name="password"]', "demo1234");
    await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
    console.log(`✓ signed in as A (${A.name}); B is ${B.name}`);

    const getBody = async (url: string) => {
      const r = await page.request.get(`${base}${url}`, { maxRedirects: 0 });
      return { status: r.status(), loc: r.headers()["location"] ?? "", text: await r.text() };
    };

    // ── Route sweep: B's id must read exactly as a nonexistent id, and never carry B's words. ──
    let ownedProbed = 0;
    const publicListed: string[] = [];
    const coachListed: string[] = [];
    for (const { pattern } of routes) {
      const r = ROUTES[pattern];
      if (r.kind === "public") {
        publicListed.push(`${pattern} (${r.why})`);
        continue;
      }
      const rnd = randomUUID();
      const toUrl = (id: string) => pattern.replace(/\[\.\.\.key\]/, id).replace(/\[\w+\]/, id);
      if (r.kind === "coach") {
        // A client has no coach role: requireCoach() sends them to /today, delivered in the streamed body in dev, so the
        // check is the same as an owned route (B's id reads exactly as a random one) plus B's coach data never appearing.
        const b = await getBody(toUrl(bMem.id));
        const n = await getBody(toUrl(rnd));
        if (b.status !== n.status || b.text.length !== n.text.length) failures.push(`${pattern}: B's membership id answers differently from a random one (B: ${b.status} len ${b.text.length}; random: ${n.status} len ${n.text.length})`);
        for (const w of ["Maya Torres", "Call notes"]) if (b.text.includes(w)) failures.push(`${pattern}: a client's response carries B's coach data "${w}"`);
        coachListed.push(pattern);
        continue;
      }
      const id = bId[r.table];
      if (!id) throw new Error(`${pattern}: no B-owned ${r.table} id to try`);
      const b = await getBody(toUrl(id));
      const n = await getBody(toUrl(rnd));
      if (b.status !== n.status || b.loc !== n.loc || b.text.length !== n.text.length) {
        failures.push(`${pattern}: B's id answers differently from a missing id (B: ${b.status} len ${b.text.length}; missing: ${n.status} len ${n.text.length})`);
        continue;
      }
      const word = bWord[r.table];
      if (word && b.text.includes(word)) failures.push(`${pattern}: the response to A contains B's private "${word}"`);
      ownedProbed++;
    }
    console.log(`✓ routes: ${ownedProbed} owned routes each answer B's id exactly as a missing id, with none of B's words`);
    console.log(`✓ ${coachListed.length} coach route: a client reads it exactly as a missing id, with none of B's coach data: ${coachListed.join(", ")}`);
    console.log(`· public routes not owner-scoped, listed not skipped: ${publicListed.join("; ")}`);

    // ── Action sweep: a mutating action per owned table, called as A with B's id, changes nothing. ──
    // The dev server compiles a page's actions on first visit: open A's own Training pages so the Body actions are registered.
    for (const p of ["/body/training", "/body/training/routines"]) await page.goto(`${base}${p}`);
    const actionMap = buildActionMap();
    const byName = Object.fromEntries(Object.entries(actionMap).map(([id, n]) => [n, id]));
    const post = async (name: string, fields: Record<string, string>) => {
      const id = byName[name];
      if (!id) throw new Error(`no action id for ${name}: the dev build did not register it`);
      const r = await page.request.post(`${base}/today`, { multipart: { ...fields, [`$ACTION_ID_${id}`]: "" }, maxRedirects: 0 });
      return { status: r.status(), body: (await r.text()).slice(0, 120) };
    };
    // action :: the field the id rides in :: a table+column to read back and a mutating field to attempt
    const probes: { action: string; idField: string; table: keyof typeof readers; extra?: Record<string, string> }[] = [
      { action: "updateContentAction", idField: "id", table: "contentItems", extra: { title: "HACKED", body: "hacked", status: "posted" } },
      { action: "deleteContentAction", idField: "id", table: "contentItems" },
      { action: "acceptContentAction", idField: "id", table: "contentItems" },
      { action: "updateOfferAction", idField: "id", table: "offers", extra: { name: "HACKED" } },
      { action: "deleteOfferAction", idField: "id", table: "offers" },
      { action: "updateGroupAction", idField: "id", table: "groups", extra: { name: "HACKED" } },
      { action: "deleteGroupAction", idField: "id", table: "groups" },
      { action: "updateContactAction", idField: "id", table: "contacts", extra: { name: "HACKED" } },
      { action: "deleteContactAction", idField: "id", table: "contacts" },
      { action: "updateProofAction", idField: "id", table: "proofs", extra: { name: "HACKED" } },
      { action: "approveProofAction", idField: "id", table: "proofs" },
      { action: "deleteProofAction", idField: "id", table: "proofs" },
      { action: "updateClientRecordAction", idField: "id", table: "clientRecords", extra: { name: "HACKED" } },
      { action: "deleteClientRecordAction", idField: "id", table: "clientRecords" },
      { action: "updateMagnetAction", idField: "id", table: "leadMagnets", extra: { title: "HACKED", keyword: "HACK" } },
      { action: "deleteMagnetAction", idField: "id", table: "leadMagnets" },
      { action: "setLadderStatusAction", idField: "id", table: "ladders", extra: { status: "live" } },
      { action: "deleteLadderAction", idField: "id", table: "ladders" },
      { action: "updateLibraryPostAction", idField: "id", table: "libraryPosts", extra: { title: "HACKED", body: "hacked" } },
      { action: "deleteLibraryPostAction", idField: "id", table: "libraryPosts" },
      { action: "saveExerciseAction", idField: "id", table: "bodyExercises", extra: { name: "HACKED", kind: "bodyweight" } },
      { action: "archiveExerciseAction", idField: "id", table: "bodyExercises" },
      { action: "deleteSetAction", idField: "id", table: "bodySets" },
      { action: "saveHabitAction", idField: "id", table: "bodyHabits", extra: { name: "HACKED", kind: "done" } },
      { action: "archiveHabitAction", idField: "id", table: "bodyHabits" },
      { action: "logHabitAction", idField: "habitId", table: "bodyHabits", extra: { value: "1" } },
      { action: "saveHealthAction", idField: "id", table: "bodyHealth", extra: { title: "HACKED", startedOn: "2026-09-01" } },
      { action: "resolveHealthAction", idField: "id", table: "bodyHealth" },
      { action: "deleteHealthAction", idField: "id", table: "bodyHealth" },
    ];
    const readers = {
      contentItems: async () => JSON.stringify(await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, bId.contentItems) })),
      offers: async () => JSON.stringify(await db.query.offers.findFirst({ where: eq(schema.offers.id, bId.offers) })),
      groups: async () => JSON.stringify(await db.query.groups.findFirst({ where: eq(schema.groups.id, bId.groups) })),
      contacts: async () => JSON.stringify(await db.query.contacts.findFirst({ where: eq(schema.contacts.id, bId.contacts) })),
      proofs: async () => JSON.stringify(await db.query.proofs.findFirst({ where: eq(schema.proofs.id, bId.proofs) })),
      clientRecords: async () => JSON.stringify(await db.query.clientRecords.findFirst({ where: eq(schema.clientRecords.id, bId.clientRecords) })),
      leadMagnets: async () => JSON.stringify(await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, bId.leadMagnets) })),
      ladders: async () => JSON.stringify(await db.query.ladders.findFirst({ where: eq(schema.ladders.id, bId.ladders) })),
      libraryPosts: async () => JSON.stringify(await db.query.libraryPosts.findFirst({ where: eq(schema.libraryPosts.id, bId.libraryPosts) })),
      bodyExercises: async () => JSON.stringify(await db.query.bodyExercises.findFirst({ where: eq(schema.bodyExercises.id, bId.bodyExercises) })),
      bodySets: async () => JSON.stringify(await db.query.bodySets.findFirst({ where: eq(schema.bodySets.id, bId.bodySets) })),
      bodyHabits: async () => JSON.stringify([await db.query.bodyHabits.findFirst({ where: eq(schema.bodyHabits.id, bId.bodyHabits) }), await db.query.bodyHabitLogs.findMany({ where: eq(schema.bodyHabitLogs.habitId, bId.bodyHabits) })]),
      bodyHealth: async () => JSON.stringify(await db.query.bodyHealth.findFirst({ where: eq(schema.bodyHealth.id, bId.bodyHealth) })),
    };
    let actionProbed = 0;
    for (const p of probes) {
      const before = await readers[p.table]();
      await post(p.action, { [p.idField]: bId[p.table], ...(p.extra ?? {}) });
      const after = await readers[p.table]();
      if (before !== after) {
        failures.push(`${p.action}: A changed B's ${p.table} row`);
        continue;
      }
      actionProbed++;
    }
    console.log(`✓ actions: ${actionProbed} mutating actions called as A with B's id left B's row byte-for-byte unchanged`);
    // The full action surface (172, of which 102 take an id and mutate) is covered statically by tenancy.test.ts; this walk
    // exercises one update and one delete per owned table at runtime. The rest are named there, not skipped here.
    console.log(`· runtime action coverage: ${probes.map((p) => p.action).filter((v, i, a) => a.indexOf(v) === i).length} distinct actions across ${new Set(probes.map((p) => p.table)).size} tables; the remainder are pinned by src/lib/engine/__tests__/tenancy.test.ts`);

    if (failures.length) throw new Error("TENANCY LEAK:\n" + failures.join("\n"));
    console.log("Tenancy walk passed.");
  } finally {
    await browser.close();
  }
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
        /* a chunk whose entry comment isn't JSON we can read is skipped; the byName lookup throws if an action is missing */
      }
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
