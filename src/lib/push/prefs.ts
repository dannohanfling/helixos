import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { shouldAsk } from "@/lib/engine/push";

/** A member's push_prefs row, made with the defaults the first time it's needed. */
export async function ensurePrefs(m: { id: string; workspaceId: string; userId: string }) {
  const row = await db.query.pushPrefs.findFirst({ where: eq(schema.pushPrefs.membershipId, m.id) });
  if (row) return row;
  await db.insert(schema.pushPrefs).values({ id: newId(), membershipId: m.id, workspaceId: m.workspaceId, userId: m.userId }).onConflictDoNothing();
  return (await db.query.pushPrefs.findFirst({ where: eq(schema.pushPrefs.membershipId, m.id) }))!;
}

/** How many days this member has closed (H-767: the card asks after the first close, and once more after the 7th). */
export async function closesCount(userId: string, workspaceId: string): Promise<number> {
  const rows = await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, userId), eq(schema.dailyLogs.workspaceId, workspaceId), isNotNull(schema.dailyLogs.eveningDoneAt)), columns: { id: true } });
  return rows.length;
}

export async function askState(m: { id: string; workspaceId: string; userId: string; role: "coach" | "client" }): Promise<{ ask: boolean }> {
  // At launch, pushes are for clients (H-654, answer 8).
  if (m.role !== "client") return { ask: false };
  const prefs = await db.query.pushPrefs.findFirst({ where: eq(schema.pushPrefs.membershipId, m.id) });
  return { ask: shouldAsk({ closes: await closesCount(m.userId, m.workspaceId), askedCount: prefs?.askedCount ?? 0, answer: prefs?.answer ?? null }) };
}

export async function recordAnswer(m: { id: string; workspaceId: string; userId: string }, answer: "yes" | "not_now"): Promise<void> {
  const row = await ensurePrefs(m);
  await db.update(schema.pushPrefs).set({ answer, askedCount: row.askedCount + 1, askedAt: nowIso(), updatedAt: nowIso(), ...(answer === "yes" ? { enabled: true } : {}) }).where(eq(schema.pushPrefs.id, row.id));
}
