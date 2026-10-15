/**
 * A coach's preview kept a day (H-142): the page the engine wrote for a made-up prospect, by a 256-bit code, so "Open as their
 * page" shows it in the gold design at /mf/p/<code>. Never a sign-up: no email, no contact, no counts, the form inert. Rows
 * past their day go when the next preview is saved. Nothing here logs a name or a page.
 */
import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { PAGE_CODE_BYTES } from "@/lib/engine/bot-mcp";
import { isPageCode } from "@/lib/hermes/rules";
import { previewPath, type MfPitch, type MfSection, type SectionSource } from "@/lib/engine/magic-funnel";

type Member = { workspaceId: string; userId: string };
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export { previewPath };

/** Saves one preview and returns its code; sweeps this member's expired ones first. */
export async function savePreview(m: Member, o: { webinarId: string; firstName: string; pitch: MfPitch; sources: Record<MfSection, SectionSource>; now?: Date }): Promise<string> {
  const now = o.now ?? new Date();
  await db.delete(schema.mfPreviews).where(and(eq(schema.mfPreviews.workspaceId, m.workspaceId), eq(schema.mfPreviews.userId, m.userId), lt(schema.mfPreviews.expiresAt, now.toISOString())));
  const code = randomBytes(PAGE_CODE_BYTES).toString("base64url");
  await db.insert(schema.mfPreviews).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, webinarId: o.webinarId, code, firstName: o.firstName, pitch: o.pitch, sources: o.sources, createdAt: nowIso(), expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString() });
  return code;
}

/** The preview behind a code while it lasts; null for an unknown, malformed or expired code. */
export async function previewByCode(code: string, now = new Date()): Promise<schema.MfPreview | null> {
  if (!isPageCode(code)) return null;
  const row = await db.query.mfPreviews.findFirst({ where: eq(schema.mfPreviews.code, code) });
  return row && row.expiresAt > now.toISOString() ? row : null;
}
