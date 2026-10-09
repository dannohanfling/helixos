import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { setMemberHeadshot, storeHeadshot } from "@/lib/headshots";

/**
 * The member's own photo (client headshots, rule 5): a multipart POST with one image, stored as the original and the 512
 * square, set as their own upload, which no import ever overwrites. Their own only: never while a coach is switched in,
 * never a team member. A refusal says why in one sentence.
 */
export async function POST(request: Request) {
  const say = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "cache-control": "private, no-store" } });
  const v = await apiViewer();
  if (!v) return say(401, "Sign in first.");
  if (v.switchedInto) return say(403, "This photo is the client's own: they add it themselves.");
  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("photo");
    file = f instanceof File ? f : null;
  } catch {
    return say(400, "That upload couldn't be read. Choose the photo again.");
  }
  if (!file || !file.size) return say(400, "Choose a photo first.");
  if (file.size > 4 * 1024 * 1024) return say(413, "Pick a photo under 4 MB.");
  const stored = await storeHeadshot(v.workspace.id, v.membership.id, Buffer.from(await file.arrayBuffer()));
  if ("error" in stored) return say(400, stored.error);
  const m = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id)) }))!;
  await setMemberHeadshot(m, stored, "upload", null);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
}
