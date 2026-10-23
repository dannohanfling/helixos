import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { oohVisibleTo } from "@/lib/engine/office-hours";
import { readProofObject } from "@/lib/proof-storage";

/**
 * An Office Hours request's screenshot (H-1706), streamed from the private store: to the workspace's coach, to the member it
 * belongs to, and to a team member who submitted or attends it (the same rule as the page's list). A coach switched into a
 * client is the client here. Anyone else, a missing request and a request with no picture all answer the same 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const v = await apiViewer({ team: "allow" });
  if (!v) return notFound();
  const { id } = await params;
  const r = await db.query.officeHoursRequests.findFirst({ where: and(eq(schema.officeHoursRequests.id, id), eq(schema.officeHoursRequests.workspaceId, v.workspace.id)) });
  if (!r || !r.screenshotUrl) return notFound();
  const coach = v.role === "coach" && !v.switchedInto && !v.team;
  const mine = r.userId === v.user.id && oohVisibleTo(r, { ownerId: v.user.id, actorId: v.actor.id, team: Boolean(v.team) });
  if (!coach && !mine) return notFound();
  const res = await readProofObject(r.screenshotUrl);
  if (!res.ok || !res.body) return notFound();
  return new Response(res.body, { status: 200, headers: { "content-type": r.screenshotType ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline" } });
}
