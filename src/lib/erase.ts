/**
 * Deletion on request: one member's account and everything they made in one workspace, removed for good. Owner-only, one member
 * at a time, confirmed by typing their email, irreversible (scope: the handoff's rev-31 report, built on the rev-32 ruling).
 *
 * planErase reads and writes nothing: it returns the row counts per table and every stored object it would remove, and the
 * page shows exactly that before the button. eraseMember then runs the plan in this order:
 *   1. stored objects first, each followed at once by the row that pointed at it, so no row outlives its file and no file is
 *      silently orphaned. A refused delete stops the run there and names the object; what went is gone, the rest is intact,
 *      and a second run finishes it;
 *   2. the rows, one transaction per table group (a member table with everything that hangs off it), children first;
 *   3. the membership, then the account when no membership in another workspace remains, then the workspace when this was its
 *      last member;
 *   4. one audit row: who ran it, the email, when, the counts. No content.
 * The tables come from src/lib/member-data.ts, the same list the export reads.
 */
import { and, eq, inArray, like, ne } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { CHILD_TABLES, MEMBER_TABLES, USER_TABLES, WORKSPACE_TABLES, type MemberLabel } from "@/lib/member-data";
import { deleteProofObject, listProofObjects, proofStorageConfigured } from "@/lib/proof-storage";
import { deletePublicObjectStrict } from "@/lib/storage";

type AnyTable = SQLiteTable & Record<string, SQLiteColumn>;
const col = (t: SQLiteTable, name: string): SQLiteColumn => (t as AnyTable)[name];

export type EraseObject = { store: "proof" | "public"; key: string; url: string; label: string; rowId: string };
export type ErasePlan = {
  workspaceId: string;
  userId: string;
  membershipId: string;
  email: string;
  name: string;
  /** Row ids per table label, so the executor deletes exactly what was counted. */
  ids: Record<string, string[]>;
  /** How many rows per table label: what the page shows and the audit keeps. */
  counts: Record<string, number>;
  objects: EraseObject[];
  userGoes: boolean;
  workspaceGoes: boolean;
};

/** Every row id a set of parent ids owns in one child table. */
async function childIds(table: SQLiteTable, fk: string, parentIds: string[]): Promise<string[]> {
  if (!parentIds.length) return [];
  const rows = (await db.select({ id: col(table, "id") }).from(table).where(inArray(col(table, fk), parentIds))) as { id: string }[];
  return rows.map((r) => r.id);
}

/** What deleting this member would remove. Reads only. Null when the membership is not in this workspace. */
export async function planErase(workspaceId: string, membershipId: string): Promise<ErasePlan | null> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, workspaceId)) });
  if (!m) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!user) return null;
  const ids: Record<string, string[]> = { membership: [m.id] };
  for (const [label, table] of Object.entries(MEMBER_TABLES)) {
    const rows = (await db.select({ id: col(table, "id") }).from(table).where(and(eq(col(table, "workspaceId"), workspaceId), eq(col(table, "userId"), m.userId)))) as { id: string }[];
    ids[label] = rows.map((r) => r.id);
  }
  for (const c of CHILD_TABLES) ids[c.label] = await childIds(c.table, c.fk, ids[c.parent] ?? []);

  const elsewhere = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, m.userId), ne(schema.memberships.workspaceId, workspaceId)) });
  const userGoes = !elsewhere;
  if (userGoes) {
    ids.user = [user.id];
    for (const [label, table] of Object.entries(USER_TABLES)) ids[label] = ((await db.select({ id: col(table, "id") }).from(table).where(eq(col(table, "userId"), user.id))) as { id: string }[]).map((r) => r.id);
  }
  const others = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), ne(schema.memberships.userId, m.userId)) });
  const workspaceGoes = !others;
  if (workspaceGoes) {
    ids.workspace = [workspaceId];
    for (const [label, table] of Object.entries(WORKSPACE_TABLES)) {
      const key = label === "files" ? "key" : "id";
      ids[label] = ((await db.select({ id: col(table, key) }).from(table).where(eq(col(table, "workspaceId"), workspaceId))) as { id: string }[]).map((r) => r.id);
    }
    ids.lessons = await childIds(schema.lessons, "courseId", ids.courses ?? []);
  }

  // The stored objects, each with the row that points at it.
  const objects: EraseObject[] = [];
  if (ids.proof_attachments.length) {
    for (const a of await db.query.proofAttachments.findMany({ where: inArray(schema.proofAttachments.id, ids.proof_attachments) })) {
      objects.push({ store: "proof", key: a.blobKey, url: a.blobUrl, label: "proof_attachments", rowId: a.id });
      if (a.displayKey && a.displayUrl && a.displayKey !== a.blobKey) objects.push({ store: "proof", key: a.displayKey, url: a.displayUrl, label: "proof_attachments", rowId: a.id });
    }
  }
  // Deck images: every row's object, and anything else under the member's own prefix (an upload never recorded).
  const deckRows = ids.deck_images.length ? await db.query.deckImages.findMany({ where: inArray(schema.deckImages.id, ids.deck_images) }) : [];
  for (const d of deckRows) objects.push({ store: "proof", key: d.blobKey, url: d.blobUrl, label: "deck_images", rowId: d.id });
  if (proofStorageConfigured()) {
    const known = new Set(deckRows.map((d) => d.blobKey));
    for (const o of await listProofObjects(`deck/${workspaceId}/${m.userId}/`)) if (!known.has(o.key)) objects.push({ store: "proof", key: o.key, url: o.url, label: "deck_images", rowId: "" });
  }
  // Lead magnet files in the public store: the recorded PDF and upload, and every file under the magnet's folder.
  const magnets = ids.lead_magnets.length ? await db.query.leadMagnets.findMany({ where: inArray(schema.leadMagnets.id, ids.lead_magnets) }) : [];
  const publicKeys = new Set<string>();
  for (const mg of magnets) {
    for (const k of [mg.pdfKey, mg.fileKey]) if (k) publicKeys.add(k);
    for (const f of await db.query.files.findMany({ where: and(eq(schema.files.workspaceId, workspaceId), like(schema.files.key, `public/magnets/${mg.slug}/%`)) })) publicKeys.add(f.key);
  }
  for (const k of publicKeys) {
    const f = await db.query.files.findFirst({ where: eq(schema.files.key, k) });
    objects.push({ store: "public", key: k, url: f?.url ?? "", label: "files", rowId: k });
  }

  const counts = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.length]));
  counts.files = (counts.files ?? 0) + (workspaceGoes ? 0 : publicKeys.size);
  return { workspaceId, userId: m.userId, membershipId: m.id, email: user.email, name: user.name, ids, counts, objects, userGoes, workspaceGoes };
}

export class EraseStopped extends Error {
  constructor(public readonly key: string, cause: unknown) {
    super(`Stopped at ${key}: the store refused to delete it (${cause instanceof Error ? cause.message : String(cause)}). Nothing after it was removed; run it again to finish.`);
    this.name = "EraseStopped";
  }
}

/** Deletes one row by id from a table, in the given transaction or the database. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function drop(tx: Tx | typeof db, table: SQLiteTable, ids: string[], key = "id"): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) await tx.delete(table).where(inArray(col(table, key), ids.slice(i, i + 200)));
}

/**
 * Runs a plan made moments before, for the member it names. Throws EraseStopped, naming the object, when the store refuses one
 * delete. Returns the audit row's id.
 */
export async function eraseMember(plan: ErasePlan, ranByUserId: string): Promise<string> {
  // 1. Objects first, each row's objects together, then at once the row that pointed at them (a public object's index row goes
  //    inside deletePublicObjectStrict). A refusal throws before its row is touched.
  const removed: Record<string, number> = {};
  let objectsRemoved = 0;
  const count = (label: string) => (removed[label] = (removed[label] ?? 0) + 1);
  const byRow = new Map<string, EraseObject[]>();
  for (const o of plan.objects) {
    const k = o.rowId ? `${o.label}:${o.rowId}` : `${o.label}:key:${o.key}`;
    byRow.set(k, [...(byRow.get(k) ?? []), o]);
  }
  for (const objs of byRow.values()) {
    for (const o of objs) {
      try {
        if (o.store === "proof") await deleteProofObject(o.url);
        else await deletePublicObjectStrict(o.key);
      } catch (e) {
        // What went before the refusal is gone for good, so this run is on the record too, saying where it stopped.
        await audit(plan, ranByUserId, removed, objectsRemoved, { stoppedAt: o.key, userGoes: false, workspaceGoes: false });
        throw new EraseStopped(o.key, e);
      }
      objectsRemoved++;
      if (o.store === "public") count("files");
    }
    const { label, rowId } = objs[0];
    if (rowId && label === "proof_attachments") {
      await db.delete(schema.proofAttachmentReads).where(eq(schema.proofAttachmentReads.attachmentId, rowId));
      await db.delete(schema.proofAttachments).where(eq(schema.proofAttachments.id, rowId));
      count("proof_attachments");
    }
    if (rowId && label === "deck_images") {
      await db.delete(schema.deckSlots).where(eq(schema.deckSlots.imageId, rowId));
      await db.delete(schema.deckImages).where(eq(schema.deckImages.id, rowId));
      count("deck_images");
    }
  }

  // 2. The rows, one transaction per member table with everything that hangs off it, children (deepest first) before parents.
  const childrenOf = (parent: string): (typeof CHILD_TABLES)[number][] => CHILD_TABLES.filter((c) => c.parent === parent);
  const subtree = (parent: string): (typeof CHILD_TABLES)[number][] => childrenOf(parent).flatMap((c) => [...subtree(c.label), c]);
  for (const [label, table] of Object.entries(MEMBER_TABLES) as [MemberLabel, SQLiteTable][]) {
    await db.transaction(async (tx) => {
      for (const c of subtree(label)) await drop(tx, c.table, plan.ids[c.label] ?? []);
      await drop(tx, table, plan.ids[label] ?? []);
    });
  }

  // 3. The membership with what hangs off it, then the account, then the workspace.
  await db.transaction(async (tx) => {
    for (const c of subtree("membership")) await drop(tx, c.table, plan.ids[c.label] ?? []);
    await drop(tx, schema.memberships, [plan.membershipId]);
  });
  if (plan.userGoes) {
    await db.transaction(async (tx) => {
      for (const [label, table] of Object.entries(USER_TABLES)) await drop(tx, table, plan.ids[label] ?? []);
      await drop(tx, schema.users, [plan.userId]);
    });
  }
  if (plan.workspaceGoes) {
    await db.transaction(async (tx) => {
      await drop(tx, schema.lessons, plan.ids.lessons ?? []);
      for (const [label, table] of Object.entries(WORKSPACE_TABLES)) await drop(tx, table, plan.ids[label] ?? [], label === "files" ? "key" : "id");
      await drop(tx, schema.workspaces, [plan.workspaceId]);
    });
  }

  // 4. One audit row: who, whose email, when, how many. No content.
  return audit(plan, ranByUserId, plan.counts, plan.objects.length, { stoppedAt: null, userGoes: plan.userGoes, workspaceGoes: plan.workspaceGoes });
}

/** The audit row for one run: counts and the email, never content. */
async function audit(plan: ErasePlan, ranByUserId: string, counts: Record<string, number>, objects: number, run: { stoppedAt: string | null; userGoes: boolean; workspaceGoes: boolean }): Promise<string> {
  const id = newId();
  await db.insert(schema.deletionAudits).values({ id, workspaceId: plan.workspaceId, ranByUserId, deletedEmail: plan.email, counts, objects, userRemoved: run.userGoes, workspaceRemoved: run.workspaceGoes, stoppedAt: run.stoppedAt });
  return id;
}
