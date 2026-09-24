/**
 * Deletion on request, end to end, as the coach runs it. Two members are seeded in the demo workspace, A and B, each with a row
 * in every table the shared list names (member, child and user tables, read from src/lib/member-data.ts, never typed here) and
 * a file under each store prefix: a proof attachment and its display copy, a deck image plus an upload never recorded under
 * deck/<workspace>/<A>/, and a lead magnet's public PDF. The coach opens A's delete page: every count and every file is shown
 * before the button. A wrong email deletes nothing. A refused store delete stops the run and names the file, with what went
 * before it on the record. Run again, it finishes: every one of A's rows is gone in every table, both prefixes are empty of A's
 * files, the account is gone, one audit row per run holds counts and the email and no content, and B's rows and files are all
 * still there. Against scripts/mock-blob.ts on :4050; the dev server must be up with the blob tokens (dev-server.sh sets them).
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { getTableColumns, inArray } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

const base = process.argv[2] ?? "http://localhost:3000";
const blob = "http://localhost:4050";
const PROOF_TOKEN = process.env.PROOF_BLOB_READ_WRITE_TOKEN ?? "vercel_blob_rw_PROOFSTORE_testsecret";
const PUBLIC_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? "vercel_blob_rw_TESTSTORE_testsecret";
const RUN = randomUUID().slice(0, 8);
// The walk tidies its second member through the same code, so it speaks to the same mock stores the dev server does.
process.env.PROOF_BLOB_READ_WRITE_TOKEN = PROOF_TOKEN;
process.env.BLOB_READ_WRITE_TOKEN = PUBLIC_TOKEN;
process.env.VERCEL_BLOB_API_URL = process.env.VERCEL_BLOB_API_URL ?? blob;

type AnyTable = SQLiteTable & Record<string, SQLiteColumn>;

async function put(pathname: string, access: "private" | "public"): Promise<string> {
  const res = await fetch(`${blob}/?pathname=${encodeURIComponent(pathname)}`, { method: "PUT", headers: { authorization: `Bearer ${access === "private" ? PROOF_TOKEN : PUBLIC_TOKEN}`, "x-vercel-blob-access": access, "x-content-type": "image/png" }, body: Buffer.from(`erase walk ${pathname}`) });
  if (!res.ok) throw new Error(`could not seed ${pathname}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { url: string }).url;
}
const stored = async (): Promise<string[]> => ((await (await fetch(`${blob}/__list`)).json()) as { objects: { pathname: string }[] }).objects.map((o) => o.pathname);

/** A row for any table: the fixed values given, a fresh id, and a plain value for every required column without a default. */
function fill(t: SQLiteTable, fixed: Record<string, unknown>, marker: string): Record<string, unknown> {
  const v: Record<string, unknown> = { ...fixed };
  for (const [k, c] of Object.entries(getTableColumns(t)) as [string, SQLiteColumn & { enumValues?: string[] }][]) {
    if (k in v) continue;
    if (k === "id") v[k] = randomUUID();
    else if (!c.notNull || c.hasDefault) continue;
    else if (c.dataType === "number") v[k] = 1;
    else if (c.dataType === "boolean") v[k] = false;
    else if (c.dataType === "json") v[k] = {};
    else v[k] = c.enumValues?.length ? c.enumValues[0] : `${marker}-${k}`;
  }
  return v;
}

async function main() {
  const { db, schema } = await import("@/db");
  const { eq, and } = await import("drizzle-orm");
  const { MEMBER_TABLES, CHILD_TABLES, USER_TABLES } = await import("@/lib/member-data");
  const { DELETED_MESSAGES } = await import("@/lib/deleted");
  const { newId } = await import("@/lib/ids");

  const up = await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${blob}/__refuse-delete`, { method: "POST" });

  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!.workspaceId;
  const taskKey = (await db.query.libraryTasks.findFirst())!.key;
  const lessonId = (await db.query.lessons.findFirst())!.id;
  const deliverableId = (await db.query.certDeliverables.findFirst())!.id;

  /** One member, with a row in every listed table and a file under each prefix. Returns the ids per table and the file keys. */
  async function seedMember(who: "a" | "b") {
    const marker = `ERASE-MARKER-${who}-${RUN}`;
    const userId = newId();
    const email = `erase-${who}-${RUN}@example.com`;
    await db.insert(schema.users).values({ id: userId, email, name: `Erase ${who.toUpperCase()} ${RUN}`, passwordHash: "x" });
    const membershipId = newId();
    await db.insert(schema.memberships).values({ id: membershipId, workspaceId: ws, userId, role: "client", businessName: marker });
    const ids: Record<string, string[]> = { membership: [membershipId] };
    const keys: string[] = [];
    // Files first, so the rows can point at them.
    const attachKey = `proofs/${ws}/${newId()}-erase-${who}.png`;
    const displayKey = `proofs/${ws}/${newId()}-erase-${who}-display.jpg`;
    const deckKey = `deck/${ws}/${userId}/${randomUUID()}.png`;
    const orphanKey = `deck/${ws}/${userId}/never-recorded-${RUN}.png`;
    const slug = `erase-${who}-${RUN}`;
    const magnetKey = `public/magnets/${slug}/${newId()}-${slug}.pdf`;
    const urls = { attach: await put(attachKey, "private"), display: await put(displayKey, "private"), deck: await put(deckKey, "private"), orphan: await put(orphanKey, "private"), magnet: await put(magnetKey, "public") };
    keys.push(attachKey, displayKey, deckKey, orphanKey, magnetKey);
    await db.insert(schema.files).values({ key: magnetKey, workspaceId: ws, contentType: "application/pdf", url: urls.magnet, size: 20, isPublic: true });

    const special: Record<string, Record<string, unknown>> = {
      pathway_progress: { libraryTaskKey: taskKey },
      lesson_progress: { lessonId },
      certification_submissions: { deliverableId },
      deck_images: { blobKey: deckKey, blobUrl: urls.deck, mime: "image/png" },
      lead_magnets: { slug, pdfKey: magnetKey, keyword: marker },
    };
    for (const [label, table] of Object.entries(MEMBER_TABLES)) {
      const row = fill(table, { workspaceId: ws, userId, ...(special[label] ?? {}) }, marker);
      await db.insert(table).values(row as never);
      ids[label] = [row.id as string];
    }
    const childSpecial: Record<string, Record<string, unknown>> = {
      proof_attachments: { workspaceId: ws, blobKey: attachKey, blobUrl: urls.attach, displayKey, displayUrl: urls.display, mime: "image/png", uploadedBy: userId },
      proof_attachment_reads: { workspaceId: ws },
      coach_notes: { workspaceId: ws, authorUserId: coach.id },
      deck_slots: { imageId: ids.deck_images[0] },
    };
    for (const c of CHILD_TABLES) {
      const row = fill(c.table, { [c.fk]: ids[c.parent][0], userId, ...(childSpecial[c.label] ?? {}) }, marker);
      // A child with no user column of its own does not take one.
      if (!("userId" in getTableColumns(c.table))) delete row.userId;
      await db.insert(c.table).values(row as never);
      ids[c.label] = [row.id as string];
    }
    for (const [label, table] of Object.entries(USER_TABLES)) {
      const row = fill(table, { userId }, marker);
      await db.insert(table).values(row as never);
      ids[label] = [row.id as string];
    }
    return { userId, email, membershipId, ids, keys, marker, orphanKey, magnetKey, deckPrefix: `deck/${ws}/${userId}/` };
  }

  const A = await seedMember("a");
  const B = await seedMember("b");
  const tableOf = (label: string): SQLiteTable => (MEMBER_TABLES as Record<string, SQLiteTable>)[label] ?? CHILD_TABLES.find((c) => c.label === label)?.table ?? (USER_TABLES as Record<string, SQLiteTable>)[label] ?? (label === "membership" ? schema.memberships : (undefined as never));
  const remaining = async (m: typeof A) => {
    const out: Record<string, number> = {};
    for (const [label, ids] of Object.entries(m.ids)) out[label] = (await db.select().from(tableOf(label)).where(inArray((tableOf(label) as AnyTable).id, ids))).length;
    return out;
  };
  const seeded = Object.keys(A.ids).length;
  const expected = Object.keys(MEMBER_TABLES).length + CHILD_TABLES.length + Object.keys(USER_TABLES).length + 1;
  if (seeded !== expected || Object.values(await remaining(A)).some((n) => n !== 1)) throw new Error(`A has one row in every listed table: ${seeded} of ${expected}`);
  const objectsBefore = await stored();
  for (const k of [...A.keys, ...B.keys]) if (!objectsBefore.includes(k)) throw new Error(`seeded file missing: ${k}`);
  console.log(`✓ seeded A and B: a row in each of ${seeded} tables and ${A.keys.length} files each (proof, display, deck, an unrecorded deck upload, a public PDF)`);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext()).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);

    // ── The plan, shown before the button: every table's count and every file, read only. ──
    await page.goto(`${base}/coach/${A.membershipId}/delete`);
    await page.locator('[data-testid="erase-plan"]').waitFor({ timeout: 30000 });
    const shown = Object.fromEntries(await page.locator('[data-testid="erase-row"]').evaluateAll((rows) => rows.map((r) => [r.getAttribute("data-table"), Number(r.querySelector('[data-testid="erase-count"]')?.textContent)])));
    for (const label of Object.keys(A.ids)) if (shown[label] !== 1) failures.push(`the plan shows ${label}: ${shown[label]}, expected 1`);
    if (shown.user !== 1) failures.push("the plan shows the account going");
    const files = await page.locator('[data-testid="erase-object"]').allInnerTexts();
    for (const k of A.keys) if (!files.some((f) => f.endsWith(k))) failures.push(`the plan lists ${k}`);
    if (files.some((f) => B.keys.some((k) => f.endsWith(k)))) failures.push("the plan lists none of B's files");
    if (failures.length) throw new Error(failures.join("\n"));
    if (Object.values(await remaining(A)).some((n) => n !== 1)) throw new Error("showing the plan deletes nothing");
    console.log(`✓ the plan: ${Object.keys(shown).length} tables counted and ${files.length} files listed before the button, nothing deleted`);

    // ── The export covers what the deletion removes: every table in the shared list, the files as a manifest of keys, no credential. ──
    const { EXPORT_TABLES } = await import("@/lib/export");
    const dump = (await (await page.request.get(`${base}/api/export?format=json&user=${A.userId}`)).json()) as Record<string, Record<string, unknown>[]>;
    const missing = EXPORT_TABLES.filter((t) => !Array.isArray(dump[t]));
    if (missing.length) throw new Error(`the export has every section: missing ${missing.join(", ")}`);
    const emptyInExport = Object.keys(A.ids).filter((l) => l !== "membership" && l !== "coach_notes" && dump[l]?.length !== 1);
    if (emptyInExport.length) throw new Error(`the export carries A's row in every table it lists: ${emptyInExport.join(", ")}`);
    if (dump.coach_notes) throw new Error("the coach's own notes about a member are not in the member's export");
    const manifest = dump.stored_files.map((f) => f.key as string);
    const recordedKeys = A.keys.filter((k) => k !== A.orphanKey);
    if (JSON.stringify([...manifest].sort()) !== JSON.stringify([...recordedKeys].sort())) throw new Error(`the manifest lists A's recorded files by key, got ${JSON.stringify(manifest)}`);
    const text = JSON.stringify(dump);
    for (const secret of ["keyEncrypted", "tokenHash", "clApiToken", "passwordHash", "manualToken", "clDripWebhookUrl"]) if (text.includes(`"${secret}"`)) throw new Error(`the export carries ${secret}`);
    if (text.includes(B.marker)) throw new Error("the export carries nothing of B's");
    console.log(`✓ the export: all ${EXPORT_TABLES.length} sections, A's row in each, ${manifest.length} files as a manifest of keys, no credential and nothing of B's`);

    // ── A wrong email deletes nothing. ──
    await page.fill('[data-testid="erase-email"]', `someone-else-${RUN}@example.com`);
    await Promise.all([page.waitForURL(/\?error=/), page.click('[data-testid="erase-submit"]')]);
    if (!/the email typed does not match/.test(await page.locator('[data-testid="erase-error"]').innerText()) || Object.values(await remaining(A)).some((n) => n !== 1)) throw new Error("a wrong email deletes nothing and says so");
    console.log("✓ a wrong email: nothing deleted, and it says so");

    // ── The store refuses one file: the run stops there and names it; what went before is on the record. ──
    await fetch(`${blob}/__refuse-delete?pathname=${encodeURIComponent(A.magnetKey)}`, { method: "POST" });
    // A fresh page: the address still carries the last ?error=, which a wait for the next one would match at once.
    await page.goto(`${base}/coach/${A.membershipId}/delete`);
    await page.fill('[data-testid="erase-email"]', A.email);
    await Promise.all([page.waitForURL(/\?error=/), page.click('[data-testid="erase-submit"]')]);
    const stopped = (await page.locator('[data-testid="erase-error"]').innerText()).trim();
    if (!stopped.startsWith(`Stopped at ${A.magnetKey}`)) throw new Error(`a refused delete names the file, got "${stopped}"`);
    const mid = await remaining(A);
    if (mid.membership !== 1 || mid.lead_magnets !== 1 || mid.proof_attachments !== 0 || mid.deck_images !== 0) throw new Error(`the run stopped at the refusal: files before it gone with their rows, the rest intact, got ${JSON.stringify(mid)}`);
    const partial = await db.query.deletionAudits.findFirst({ where: and(eq(schema.deletionAudits.deletedEmail, A.email), eq(schema.deletionAudits.stoppedAt, A.magnetKey)) });
    if (!partial || partial.objects !== 4 || partial.counts.proof_attachments !== 1 || partial.counts.deck_images !== 1) throw new Error(`the stopped run is on the record with what it removed, got ${JSON.stringify(partial)}`);
    console.log(`✓ a refused delete: "${stopped.slice(0, 80)}…"; the four files before it went with their rows, the rest is intact, and the stopped run is on the record`);

    // ── Run again: it finishes. ──
    await fetch(`${blob}/__refuse-delete`, { method: "POST" });
    await page.goto(`${base}/coach/${A.membershipId}/delete`);
    if ((await page.locator('[data-testid="erase-object"]').count()) !== 1) throw new Error("the second plan lists only the file left");
    await page.fill('[data-testid="erase-email"]', A.email.toUpperCase());
    await Promise.all([page.waitForURL(/\/coach(\?|$)/), page.click('[data-testid="erase-submit"]')]);
    const notice = page.locator('[data-testid="deleted-notice"]');
    await notice.waitFor({ timeout: 15000 });
    if ((await notice.innerText()).trim() !== DELETED_MESSAGES.member) throw new Error(`the Coach page says what went, got "${await notice.innerText()}"`);

    const after = await remaining(A);
    const left = Object.entries(after).filter(([, n]) => n);
    if (left.length) throw new Error(`every one of A's rows is gone: ${JSON.stringify(left)}`);
    if (await db.query.users.findFirst({ where: eq(schema.users.id, A.userId) })) throw new Error("A's account is gone");
    const objects = await stored();
    if (A.keys.some((k) => objects.includes(k)) || objects.some((o) => o.startsWith(A.deckPrefix))) throw new Error("A's files are gone from both stores, the unrecorded deck upload included");
    if (await db.query.files.findFirst({ where: eq(schema.files.key, A.magnetKey) })) throw new Error("the public file's index row is gone");
    console.log(`✓ run again, it finishes: 0 rows left in ${Object.keys(after).length} tables, the account gone, no file of A's in either store`);

    // ── The record: counts and the email, no content. B untouched. ──
    const audits = await db.query.deletionAudits.findMany({ where: eq(schema.deletionAudits.deletedEmail, A.email) });
    const done = audits.find((x) => !x.stoppedAt);
    if (audits.length !== 2 || !done || !done.userRemoved || done.ranByUserId !== coach.id || done.counts.membership !== 1 || done.counts.lead_magnets !== 1) throw new Error(`one audit row per run, the finished one with the counts, got ${JSON.stringify(audits)}`);
    const recorded = JSON.stringify(audits);
    if (recorded.includes(A.marker) || recorded.includes(`Erase A ${RUN}`)) throw new Error("the audit rows hold no content and no name");
    const bLeft = await remaining(B);
    if (Object.values(bLeft).some((n) => n !== 1) || B.keys.some((k) => !objects.includes(k))) throw new Error(`B's rows and files are all still there: ${JSON.stringify(bLeft)}`);
    console.log(`✓ the record: ${audits.length} audit rows (the stopped run and the finish), counts and the email only; B's ${Object.keys(bLeft).length} tables and ${B.keys.length} files untouched`);

    // ── The orphan sweep reaches deck/ too: an old file with no row goes on a Settings visit, a young one and every recorded one stay. ──
    const plant = async (key: string, uploadedAt: string) => {
      const r = await fetch(`${blob}/?pathname=${encodeURIComponent(key)}`, { method: "PUT", body: Buffer.from("orphan"), headers: { authorization: `Bearer ${PROOF_TOKEN}`, "x-content-type": "image/png", "x-vercel-blob-access": "private", "x-mock-uploaded-at": uploadedAt } });
      if (r.status !== 200) throw new Error(`could not plant ${key}: ${r.status}`);
    };
    const oldDeck = `${B.deckPrefix}orphan-old-${RUN}.png`;
    const youngDeck = `${B.deckPrefix}orphan-young-${RUN}.png`;
    await plant(oldDeck, new Date(Date.now() - 45 * 60 * 1000).toISOString());
    await plant(youngDeck, new Date().toISOString());
    const recordedDeck = B.keys.find((k) => k.startsWith(B.deckPrefix) && k !== B.orphanKey)!;
    await page.goto(`${base}/settings`);
    let swept: string[] = [];
    for (let i = 0; i < 60; i++) {
      swept = await stored();
      if (!swept.includes(oldDeck)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (swept.includes(oldDeck)) throw new Error("an old deck file with no row is deleted on the Settings visit");
    if (!swept.includes(youngDeck) || !swept.includes(recordedDeck)) throw new Error("a young deck file and a recorded one are left alone");
    console.log("✓ the orphan sweep reaches deck/: an old unrecorded file gone on the Settings visit, a young one and the recorded image kept");

    // ── The coach cannot delete their own account from here. ──
    const own = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, coach.id), eq(schema.memberships.workspaceId, ws)) }))!;
    await page.goto(`${base}/coach/${own.id}/delete`);
    await page.locator('[data-testid="erase-self"]').waitFor({ timeout: 20000 });
    if (await page.locator('[data-testid="erase-submit"]').count()) throw new Error("no delete button on the coach's own account");
    console.log("✓ the coach's own account: shown, with no delete button");
  } finally {
    await browser.close();
    // B is test data: tidy it the same way, so the demo stays clean.
    const { planErase, eraseMember } = await import("@/lib/erase");
    const planB = await planErase(ws, B.membershipId);
    if (planB) await eraseMember(planB, coach.id).catch(() => undefined);
    if (proc?.pid) try { process.kill(-proc.pid); } catch { /* already gone */ }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Erase walk passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
