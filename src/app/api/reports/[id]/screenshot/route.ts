import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { readProofObject } from "@/lib/proof-storage";

/**
 * A report's screenshot (rev 432), streamed from the private store: to the workspace's coach, and to the member who sent it.
 * Anyone else, a missing report and a report with no picture all answer the same 404, so an id tells nobody anything.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const v = await getViewer();
  if (!v) return notFound();
  const { id } = await params;
  const r = await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.id, id), eq(schema.memberReports.workspaceId, v.workspace.id)) });
  // A coach switched into a client is the client here, and sees only the client's own.
  const coach = v.role === "coach" && !v.switchedInto;
  if (!r || !r.screenshotUrl || !(coach || r.userId === v.user.id)) return notFound();
  const res = await readProofObject(r.screenshotUrl);
  if (!res.ok || !res.body) return notFound();
  return new Response(res.body, { status: 200, headers: { "content-type": r.screenshotType ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline" } });
}
