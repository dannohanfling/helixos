import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { BODY_EXPORT_TABLES, COACH_EXPORT_TABLES, EXPORT_TABLES, exportAll, exportTable, toCsv, type ExportTable } from "@/lib/export";

export const dynamic = "force-dynamic";

/**
 * GET /api/export?format=json                      everything the signed-in member owns in this workspace, one JSON file
 * GET /api/export?format=csv&table=leads           one table as CSV (see EXPORT_TABLES)
 * GET /api/export?...&user=<userId>                a coach exporting one of their clients (same workspace only), never HumanOS
 * GET /api/export?format=json&scope=body           the member's own HumanOS data alone
 */
export async function GET(request: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  // A client's export is theirs to ask for: never from a coach switched into their HelixOS (rev 216), in either mode.
  if (v.switchedInto) return NextResponse.json({ error: "A client's export is theirs to download." }, { status: 403 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const table = url.searchParams.get("table") as ExportTable | null;
  const forUser = url.searchParams.get("user");
  const bodyOnly = url.searchParams.get("scope") === "body";

  let userId = v.user.id;
  let label = v.user.name;
  if (forUser && forUser !== v.user.id) {
    if (v.role !== "coach") return NextResponse.json({ error: "only a coach can export another member" }, { status: 403 });
    const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, forUser)) });
    if (!m) return NextResponse.json({ error: "not a member of this workspace" }, { status: 404 });
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, forUser) });
    userId = forUser;
    label = u?.name ?? forUser;
  }
  // Body is private to the member (rev 179): a coach's export of a client never includes it, whether or not it's shared.
  const allowed = userId === v.user.id ? EXPORT_TABLES : COACH_EXPORT_TABLES;
  if (bodyOnly && userId !== v.user.id) return NextResponse.json({ error: "only the member can export their HumanOS data" }, { status: 403 });
  // Body ships dark (rev 195): for a member whose Body is off, the Body export doesn't exist.
  if (bodyOnly && !v.membership.bodyEnabled) return NextResponse.json({ error: "not found" }, { status: 404 });
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "member";

  if (format === "csv") {
    if (!table || !allowed.includes(table)) return NextResponse.json({ error: `table must be one of ${allowed.join(", ")}` }, { status: 400 });
    const rows = await exportTable(table, v.workspace.id, userId);
    return new Response(toCsv(rows), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="helixos-${slug}-${table}-${stamp}.csv"`, "cache-control": "no-store" },
    });
  }
  const data = table && allowed.includes(table) ? { [table]: await exportTable(table, v.workspace.id, userId) } : await exportAll(v.workspace.id, userId, bodyOnly ? BODY_EXPORT_TABLES : allowed);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), workspace: v.workspace.name, member: label, ...data }, null, 2);
  return new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="helixos-${slug}-${table ?? (bodyOnly ? "body" : "all")}-${stamp}.json"`, "cache-control": "no-store" },
  });
}
