/**
 * Issues and ideas on the connector (H-583, plan H-591): reports_list, report_read and report_mark, for the coach's daily
 * triage. Coach-only: listed and run only on the coach's own connection, never on an agent token or a client's connection,
 * and only for the coach's own workspace. Seen is the one thing they set; Done stays the coach's, on Coach → Issues and ideas.
 * Nothing here returns a store key, a store address or a signed link: the screenshot comes back as the picture itself.
 */
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { formatDateTime, instantOf, nowIso } from "@/lib/dates";
import { IMAGE_MAX_BYTES, IMAGE_TYPES, REPORT_STATES, firstName, listLimit, listRow, type ReportState } from "@/lib/engine/report-tools";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { readProofObject } from "@/lib/proof-storage";

const NOT_FOUND = "No report with that id in your workspace.";
const utcOf = (stamp: string) => new Date(instantOf(stamp)).toISOString();

/** The senders of these reports: first name, member id and zone, nothing else. */
async function sendersOf(v: Viewer, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map<string, { name: string | null; memberId: string | null; tz: string }>();
  const [users, members] = await Promise.all([
    db.query.users.findMany({ where: inArray(schema.users.id, ids), columns: { id: true, name: true } }),
    db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), inArray(schema.memberships.userId, ids)), columns: { id: true, userId: true, timezone: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const memberOf = new Map(members.map((m) => [m.userId, m]));
  return new Map(ids.map((id) => [id, { name: nameOf.get(id) ?? null, memberId: memberOf.get(id)?.id ?? null, tz: memberOf.get(id)?.timezone || v.tz }]));
}

async function reportOf(v: Viewer, id: unknown) {
  if (typeof id !== "string" || !id.trim()) return null;
  return (await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.id, id.trim()), eq(schema.memberReports.workspaceId, v.workspace.id)) })) ?? null;
}

/** The screenshot's bytes from the private store, as a picture an MCP client shows: its own type when it can, scaled down when over about 1.5 MB. */
export async function pictureOf(url: string, type: string | null): Promise<{ data: string; mimeType: string } | null> {
  const res = await readProofObject(url);
  if (!res.ok) return null;
  let bytes = Buffer.from(await res.arrayBuffer());
  let mimeType = type && (IMAGE_TYPES as readonly string[]).includes(type) ? type : "";
  if (!mimeType || bytes.length > IMAGE_MAX_BYTES) {
    // Smaller each round until it fits: 1600 px wide first, then a little narrower and softer.
    for (const [width, quality] of [[1600, 82], [1280, 75], [1024, 70], [800, 65]] as const) {
      bytes = await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
      mimeType = "image/jpeg";
      if (bytes.length <= IMAGE_MAX_BYTES) break;
    }
  }
  return { data: bytes.toString("base64"), mimeType };
}

defineTool({
  name: "reports_list",
  scope: "inbox",
  kind: "read",
  coachOnly: true,
  description:
    "Issues and ideas from your members (Coach → Issues and ideas), newest first. state: new (not Seen yet, the default), open (not Done yet) or all; limit 1 to 50, default 20. Each row has the id, kind, severity, the page, the first 200 characters, whether there's a screenshot, talkToCoach, seenAt, doneAt, when it was sent in the sender's zone, and the sender's first name and member id. Read one in full, with its screenshot, with report_read.",
  input: {
    state: z.enum(REPORT_STATES).optional().describe("new (default), open or all"),
    limit: z.number().int().min(1).max(50).optional().describe("How many, 1 to 50 (default 20)"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const state = (input.state as ReportState | undefined) ?? "new";
    const limit = listLimit(input.limit as number | undefined);
    const where: SQL[] = [eq(schema.memberReports.workspaceId, v.workspace.id)];
    if (state === "new") where.push(isNull(schema.memberReports.seenAt));
    if (state === "open") where.push(isNull(schema.memberReports.doneAt));
    const rows = await db.query.memberReports.findMany({ where: and(...where), orderBy: [desc(schema.memberReports.createdAt), desc(schema.memberReports.id)], limit });
    const senders = await sendersOf(v, rows.map((r) => r.userId));
    const reports = rows.map((r) => {
      const s = senders.get(r.userId)!;
      return listRow(r, s, formatDateTime(r.createdAt, s.tz, { zone: true }), utcOf(r.createdAt));
    });
    const words = state === "new" ? "not Seen yet" : state === "open" ? "not Done yet" : "in all";
    if (!reports.length) return { text: `No reports ${words}.`, data: { state, reports: [] } };
    return {
      text: `${reports.length} report${reports.length === 1 ? "" : "s"} ${words}, newest first:\n${reports.map((r) => `${r.id} ${r.kind} ${r.severity} from ${r.sender.firstName}, ${r.createdAt}${r.hasScreenshot ? ", with a screenshot" : ""}`).join("\n")}`,
      data: { state, reports },
    };
  },
});

defineTool({
  name: "report_read",
  scope: "inbox",
  kind: "read",
  coachOnly: true,
  description:
    "One member report in full: the description, the page, and for an Ask Danno answer the question, the answer and whether they want to talk to you about it. Its screenshot, if any, comes back as a picture after the text. Reading doesn't mark it Seen; report_mark does.",
  input: { id: z.string().min(1).max(64).describe("The report's id, from reports_list") },
  handler: async (v, input): Promise<ToolResult> => {
    const r = await reportOf(v, input.id);
    if (!r) throw new Error(NOT_FOUND);
    const s = (await sendersOf(v, [r.userId])).get(r.userId)!;
    const picture = r.screenshotUrl ? await pictureOf(r.screenshotUrl, r.screenshotType) : null;
    const data = {
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      page: r.page,
      description: r.description,
      ...(r.kind === "ask_danno" ? { question: r.question, answer: r.answer } : {}),
      // A Content report (H-745): what it is about, by id; Hide this win stays on Coach → Issues and ideas.
      ...(r.kind === "content" ? { targetKind: r.targetKind, targetId: r.targetId, handledAt: r.handledAt } : {}),
      talkToCoach: r.talkToCoach,
      hasScreenshot: Boolean(r.screenshotUrl),
      screenshot: r.screenshotUrl ? (picture ? "attached below" : "couldn't be read from the store just now") : null,
      seenAt: r.seenAt,
      doneAt: r.doneAt,
      createdAt: formatDateTime(r.createdAt, s.tz, { zone: true }),
      createdAtUtc: utcOf(r.createdAt),
      sender: { firstName: firstName(s.name), memberId: s.memberId },
    };
    return { text: `${r.kind} ${r.severity} from ${data.sender.firstName}, ${data.createdAt}${picture ? ", screenshot attached" : ""}.`, data, images: picture ? [picture] : [] };
  },
});

defineTool({
  name: "report_mark",
  scope: "inbox",
  kind: "write",
  coachOnly: true,
  description: "Mark a member report Seen (seen: true). That's all it can set: Done stays yours, on Coach → Issues and ideas. Marking one already Seen keeps its first Seen time.",
  input: { id: z.string().min(1).max(64).describe("The report's id"), seen: z.literal(true).describe("true") },
  handler: async (v, input): Promise<ToolResult> => {
    if (input.seen !== true) throw new Error("report_mark only sets seen: true.");
    const r = await reportOf(v, input.id);
    if (!r) throw new Error(NOT_FOUND);
    const seenAt = r.seenAt ?? nowIso();
    if (!r.seenAt) await db.update(schema.memberReports).set({ seenAt }).where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, v.workspace.id)));
    return { text: r.seenAt ? "It was already Seen." : "Marked Seen.", data: { id: r.id, seenAt, doneAt: r.doneAt } };
  },
});
