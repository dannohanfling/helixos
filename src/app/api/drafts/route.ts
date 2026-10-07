import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { DRAFT_MAX_BYTES, draftExpired, validDraftKey } from "@/lib/engine/drafts";

/**
 * A form's draft on the server, so it follows the member to another device (rev 444, part two): GET reads one, PUT keeps one,
 * DELETE lets go of the ones a confirmed save made stale. A route, not a server action, so a form's own send is the only POST a
 * page makes. Each row is the signed-in member's own, by their session; while a coach is switched in nothing is read or
 * written, so a coach's typing never lands in a client's drafts. Writes must come from this site's own pages.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });

/** Another site's page can't write a member's drafts: the browser names the page's origin on a PUT or a DELETE. */
const sameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

export async function GET(request: Request) {
  const v = await apiViewer({ team: "allow" });
  if (!v) return json(null, 401);
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (v.switchedInto || !validDraftKey(key)) return json(null);
  const row = await db.query.formDrafts.findFirst({ where: and(eq(schema.formDrafts.userId, v.user.id), eq(schema.formDrafts.key, key)) });
  if (!row) return json(null);
  const at = Date.parse(row.updatedAt);
  if (draftExpired(at, Date.now())) {
    await db.delete(schema.formDrafts).where(and(eq(schema.formDrafts.id, row.id), eq(schema.formDrafts.userId, v.user.id)));
    return json(null);
  }
  return json({ data: row.data, sent: row.sent, at });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json(null, 403);
  const v = await apiViewer({ team: "allow" });
  if (!v) return json(null, 401);
  const body = (await request.json().catch(() => null)) as { key?: unknown; data?: unknown; sent?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  const data = typeof body?.data === "string" ? body.data : null;
  if (v.switchedInto || !validDraftKey(key) || data == null || data.length > DRAFT_MAX_BYTES) return json(null);
  const at = new Date().toISOString();
  const sent = body?.sent === true;
  await db
    .insert(schema.formDrafts)
    .values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, key, data, sent, updatedAt: at })
    .onConflictDoUpdate({ target: [schema.formDrafts.userId, schema.formDrafts.key], set: { data, sent, updatedAt: at, workspaceId: v.workspace.id } });
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json(null, 403);
  const v = await apiViewer({ team: "allow" });
  if (!v) return json(null, 401);
  const body = (await request.json().catch(() => null)) as { keys?: unknown } | null;
  const keys = (Array.isArray(body?.keys) ? body.keys : []).filter((k): k is string => typeof k === "string" && validDraftKey(k)).slice(0, 4);
  if (v.switchedInto || !keys.length) return json(null);
  await db.delete(schema.formDrafts).where(and(eq(schema.formDrafts.userId, v.user.id), inArray(schema.formDrafts.key, keys)));
  return json({ ok: true });
}
