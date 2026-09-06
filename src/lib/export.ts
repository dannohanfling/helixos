/**
 * A member's own data, whole, for offboarding and for the terms: every row they created in this workspace, with secrets removed.
 * JSON gives everything in one file; CSV gives one table at a time.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

type Row = Record<string, unknown>;

/** Tables keyed by (workspace, user). The label is the file / section name a client sees. */
const OWN = {
  leads: schema.contacts,
  messages: schema.messages,
  content: schema.contentItems,
  content_versions: schema.contentVariants,
  library_posts: schema.libraryPosts,
  library_entries: schema.libraryAssets,
  tasks: schema.tasks,
  goals: schema.goals,
  daily_logs: schema.dailyLogs,
  points: schema.pointsLedger,
  reward_claims: schema.rewardClaims,
  pathway_progress: schema.pathwayProgress,
  curriculum_progress: schema.curriculumProgress,
  lesson_progress: schema.lessonProgress,
  certification_submissions: schema.certSubmissions,
  offers: schema.offers,
  webinars: schema.webinars,
  client_records: schema.clientRecords,
  client_checkins: schema.clientCheckins,
  community_pass_points: schema.memberPoints,
  proofs: schema.proofs,
  groups: schema.groups,
  targets: schema.targets,
  sync_events: schema.syncEvents,
} as const;

export type ExportTable = keyof typeof OWN | "offer_components" | "webinar_beliefs" | "webinar_sections" | "profile";
export const EXPORT_TABLES: ExportTable[] = ["profile", ...(Object.keys(OWN) as (keyof typeof OWN)[]), "offer_components", "webinar_beliefs", "webinar_sections"];

/** Columns that never leave the database: credentials, and hashes that only exist to be matched. */
const STRIP = new Set(["passwordHash", "manualToken", "sessionVersion", "inboundSecretHash"]);

function clean(rows: Row[]): Row[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !STRIP.has(k))));
}

async function own(table: keyof typeof OWN, workspaceId: string, userId: string): Promise<Row[]> {
  const t = OWN[table];
  const where = "workspaceId" in t ? and(eq(t.workspaceId, workspaceId), eq(t.userId, userId)) : eq(t.userId, userId);
  return clean((await db.select().from(t).where(where)) as Row[]);
}

export async function exportTable(table: ExportTable, workspaceId: string, userId: string): Promise<Row[]> {
  if (table === "profile") {
    const [user, membership, connection] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) }),
      db.query.socialConnections.findFirst({ where: and(eq(schema.socialConnections.workspaceId, workspaceId), eq(schema.socialConnections.userId, userId)) }),
    ]);
    return clean([{ ...(user ?? {}), membership: membership ?? null, publishing: connection ? { locationId: connection.locationId, mapping: connection.mapping, connectedAt: connection.connectedAt } : null }]);
  }
  if (table === "offer_components") {
    const ids = (await own("offers", workspaceId, userId)).map((o) => o.id as string);
    return ids.length ? clean((await db.select().from(schema.offerComponents).where(inArray(schema.offerComponents.offerId, ids))) as Row[]) : [];
  }
  if (table === "webinar_beliefs" || table === "webinar_sections") {
    const ids = (await own("webinars", workspaceId, userId)).map((w) => w.id as string);
    if (!ids.length) return [];
    const t = table === "webinar_beliefs" ? schema.webinarBeliefs : schema.webinarSections;
    return clean((await db.select().from(t).where(inArray(t.webinarId, ids))) as Row[]);
  }
  return own(table, workspaceId, userId);
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
