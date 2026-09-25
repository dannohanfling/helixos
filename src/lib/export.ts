/**
 * A member's own data, whole, for offboarding and for the terms: every row they created in this workspace, with secrets removed.
 * JSON gives everything in one file; CSV gives one table at a time.
 */
import { and, eq, inArray, like } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, schema } from "@/db";
import { CHILD_TABLES, COACH_ONLY_COLUMNS, MEMBER_TABLES, STRIP_COLUMNS, USER_TABLES, type MemberLabel } from "@/lib/member-data";

type Row = Record<string, unknown>;
type AnyTable = SQLiteTable & Record<string, SQLiteColumn>;
const col = (t: SQLiteTable, name: string): SQLiteColumn => (t as AnyTable)[name];

/**
 * The export reads the one list in src/lib/member-data.ts, the same list deletion on request removes, so the two cover the same
 * tables. Left out on purpose: coach_notes, the coach's own working notes about the member, which are the coach's, not theirs
 * (deletion still removes them with the member).
 */
const EXPORT_CHILDREN = CHILD_TABLES.filter((c) => c.label !== "coach_notes");
type ChildExport = (typeof EXPORT_CHILDREN)[number]["label"];
type UserLabel = keyof typeof USER_TABLES;
export type ExportTable = "profile" | MemberLabel | ChildExport | UserLabel | "stored_files";
export const EXPORT_TABLES: ExportTable[] = ["profile", ...(Object.keys(MEMBER_TABLES) as MemberLabel[]), ...EXPORT_CHILDREN.map((c) => c.label), ...(Object.keys(USER_TABLES) as UserLabel[]), "stored_files"];

/** Credentials never leave in an export, sealed or not, at any depth (the membership sits inside the profile); nor a coach's notes. */
function clean(rows: Row[]): Row[] {
  const strip = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Row).filter(([k]) => !STRIP_COLUMNS.has(k) && !COACH_ONLY_COLUMNS.has(k)).map(([k, x]) => [k, strip(x)])) : v);
  return rows.map((r) => strip(r) as Row);
}

async function memberRows(label: MemberLabel, workspaceId: string, userId: string): Promise<Row[]> {
  const t = MEMBER_TABLES[label];
  return (await db.select().from(t).where(and(eq(col(t, "workspaceId"), workspaceId), eq(col(t, "userId"), userId)))) as Row[];
}

/** A child table's rows: those whose parent is one of the member's own, found through the parent's own rows. */
async function childRows(label: string, workspaceId: string, userId: string): Promise<Row[]> {
  const c = CHILD_TABLES.find((x) => x.label === label)!;
  // A child of the membership (bot_approvals) hangs off the member's own membership in this workspace.
  const parents = c.parent === "membership" ? ((await db.select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)))) as Row[]) : c.parent in MEMBER_TABLES ? await memberRows(c.parent as MemberLabel, workspaceId, userId) : await childRows(c.parent, workspaceId, userId);
  const ids = parents.map((p) => p.id as string);
  return ids.length ? ((await db.select().from(c.table).where(inArray(col(c.table, c.fk), ids))) as Row[]) : [];
}

/**
 * The member's stored files as a manifest of keys, not the bytes (the ruling of 22 Sep: a manifest rather than a zip): each
 * with its store, the row that holds it, and its type. Private files (proof attachments, deck images) are named by key only;
 * their bytes are reachable only through the app, signed in. A lead magnet's public files carry their public address.
 */
async function storedFiles(workspaceId: string, userId: string): Promise<Row[]> {
  const out: Row[] = [];
  for (const a of (await childRows("proof_attachments", workspaceId, userId)) as schema.ProofAttachment[]) {
    out.push({ store: "private", table: "proof_attachments", rowId: a.id, key: a.blobKey, contentType: a.mime });
    if (a.displayKey && a.displayKey !== a.blobKey) out.push({ store: "private", table: "proof_attachments", rowId: a.id, key: a.displayKey, contentType: "image/jpeg" });
  }
  for (const d of (await memberRows("deck_images", workspaceId, userId)) as schema.DeckImage[]) out.push({ store: "private", table: "deck_images", rowId: d.id, key: d.blobKey, contentType: d.mime });
  for (const m of (await memberRows("lead_magnets", workspaceId, userId)) as schema.LeadMagnet[]) {
    const files = await db.query.files.findMany({ where: and(eq(schema.files.workspaceId, workspaceId), like(schema.files.key, `public/magnets/${m.slug}/%`)) });
    for (const f of files) out.push({ store: "public", table: "lead_magnets", rowId: m.id, key: f.key, contentType: f.contentType, size: f.size, url: f.url });
  }
  return out;
}

export async function exportTable(table: ExportTable, workspaceId: string, userId: string): Promise<Row[]> {
  if (table === "profile") {
    const [user, membership] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) }),
    ]);
    return clean([{ ...(user ?? {}), membership: membership ?? null }]);
  }
  if (table === "stored_files") return storedFiles(workspaceId, userId);
  if (table in MEMBER_TABLES) return clean(await memberRows(table as MemberLabel, workspaceId, userId));
  if (table in USER_TABLES) {
    const t = USER_TABLES[table as UserLabel];
    return clean((await db.select().from(t).where(eq(col(t, "userId"), userId))) as Row[]);
  }
  return clean(await childRows(table, workspaceId, userId));
}

export async function exportAll(workspaceId: string, userId: string): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const t of EXPORT_TABLES) out[t] = await exportTable(t, workspaceId, userId);
  return out;
}

/** RFC 4180 CSV. Objects and arrays are JSON-encoded in their cell; a formula-looking cell is prefixed so spreadsheets don't execute it. */
export function toCsv(rows: Row[]): string {
  if (!rows.length) return "";
  const cols = Array.from(rows.reduce((set, r) => (Object.keys(r).forEach((k) => set.add(k)), set), new Set<string>()));
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
