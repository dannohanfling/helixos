import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { pointsCheckReport, readExportUpload } from "@/lib/points-check";

export const dynamic = "force-dynamic";

/**
 * POST /api/coach/points-check-report (multipart: id = the leaderboard feed, export = the Community Loyalty CSV)
 *
 * The points check's id report (H-402 step 2): the same read-only comparison as "Compare with eLoyalty", handed back as a
 * CSV of customer ids and numbers for Danno to review before any correction is written. Coach only, never while switched
 * into a client, only for a feed in the coach's own workspace. Nothing is stored: not the export, not the report.
 */
export async function POST(request: Request) {
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  if (v.role !== "coach" || v.switchedInto) return NextResponse.json({ error: "The id report is the coach's own, from Coach." }, { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the export as a form upload." }, { status: 400 });
  }
  const id = form.get("id");
  const feed = typeof id === "string" && id ? await db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.id, id), eq(schema.leaderboardFeeds.workspaceId, v.workspace.id)) }) : undefined;
  if (!feed) return NextResponse.json({ error: "not found" }, { status: 404 });
  // A problem is answered in words; the button shows it beside itself.
  const upload = await readExportUpload(form.get("export"));
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: 400 });
  const r = await pointsCheckReport(feed, upload.parsed.records);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  console.log(`[points-check] id report for feed ${feed.id.slice(0, 8)}: ${r.csv.split("\n").length - 2} rows; ${r.note}`);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(r.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="points-check-ids-${stamp}.csv"`, "cache-control": "no-store" } });
}
