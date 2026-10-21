/**
 * Block a member, report a win or a member, and the coach's Hide this win (H-735, plan H-745). blockedFor is the one read every
 * feed uses (the Colosseum's wins, arena and standings, the Rewards leaderboard, the photo route); the rules it feeds are in
 * src/lib/engine/blocks.ts. A coach switched into a member sees the member's view without the member's blocks, and can't block
 * or report as them (the actions refuse); a team member never reaches the Colosseum or Rewards. Nothing here logs a name or a word.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { canBlock, NO_BLOCKS, readContentReport, type BlockSet } from "@/lib/engine/blocks";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

type Who = Pick<Viewer, "workspace" | "user" | "membership" | "switchedInto" | "team">;

/**
 * Who and what this viewer doesn't see: the members they blocked (never a coach, whatever the row says) and the wins they
 * reported. Empty while a coach is switched in, and for a team member.
 */
export async function blockedFor(v: Who): Promise<BlockSet> {
  if (v.switchedInto || v.team) return NO_BLOCKS;
  const [blocks, reported] = await Promise.all([
    db.query.memberBlocks.findMany({ where: and(eq(schema.memberBlocks.workspaceId, v.workspace.id), eq(schema.memberBlocks.blockerMembershipId, v.membership.id)), columns: { blockedMembershipId: true } }),
    db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, v.workspace.id), eq(schema.memberReports.userId, v.user.id), eq(schema.memberReports.kind, "content"), eq(schema.memberReports.targetKind, "win")), columns: { targetId: true } }),
  ]);
  const ids = blocks.map((b) => b.blockedMembershipId);
  const members = ids.length ? await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), inArray(schema.memberships.id, ids)), columns: { id: true, userId: true, role: true } }) : [];
  const blocked = members.filter((m) => m.role !== "coach");
  return { memberships: new Set(blocked.map((m) => m.id)), users: new Set(blocked.map((m) => m.userId)), wins: new Set(reported.map((r) => r.targetId).filter((x): x is string => Boolean(x))) };
}

async function memberIn(workspaceId: string, membershipId: string) {
  if (!membershipId || membershipId.length > 64) return null;
  return (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, workspaceId)), columns: { id: true, userId: true, role: true, removedAt: true } })) ?? null;
}

/** Block a member of the same workspace, once; never yourself, never a coach. The blocked member is never told. */
export async function blockMember(v: Who, membershipId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await memberIn(v.workspace.id, membershipId);
  const can = canBlock({ membershipId: v.membership.id }, m ? { membershipId: m.id, userId: m.userId, role: m.role, removed: Boolean(m.removedAt) } : null);
  if (!can.ok) return can;
  await db.insert(schema.memberBlocks).values({ id: newId(), workspaceId: v.workspace.id, blockerMembershipId: v.membership.id, blockedMembershipId: m!.id }).onConflictDoNothing();
  return { ok: true };
}

/** Unblock: the viewer's own block only. */
export async function unblockMember(v: Who, membershipId: string): Promise<void> {
  await db.delete(schema.memberBlocks).where(and(eq(schema.memberBlocks.workspaceId, v.workspace.id), eq(schema.memberBlocks.blockerMembershipId, v.membership.id), eq(schema.memberBlocks.blockedMembershipId, membershipId)));
}

/** The members this viewer blocked, newest first, for Settings → Blocked members: "Leo T." and the membership id to unblock. */
export async function blockedList(v: Who): Promise<{ membershipId: string; name: string; at: string }[]> {
  const rows = await db.query.memberBlocks.findMany({ where: and(eq(schema.memberBlocks.workspaceId, v.workspace.id), eq(schema.memberBlocks.blockerMembershipId, v.membership.id)), orderBy: desc(schema.memberBlocks.createdAt) });
  if (!rows.length) return [];
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), inArray(schema.memberships.id, rows.map((r) => r.blockedMembershipId))), columns: { id: true, userId: true } });
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)), columns: { id: true, name: true } }) : [];
  const userOf = new Map(members.map((m) => [m.id, m.userId]));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ membershipId: r.blockedMembershipId, name: nameOf.get(userOf.get(r.blockedMembershipId) ?? "") ?? "Member", at: r.createdAt }));
}

export type ContentReportResult = { ok: true } | { ok: false; error: string; support?: true };

/**
 * A Content report into the coach's Issues and ideas: a win (by its id) or a member (by membership id), of this workspace, not
 * the reporter's own. A report about the coach goes to Support instead: refused here with `support`, the form shows the contact.
 */
export async function reportContent(v: Who, raw: { targetKind: string; targetId: string; reason: string; note: string }): Promise<ContentReportResult> {
  const read = readContentReport(raw);
  if ("error" in read) return { ok: false, error: read.error };
  const { targetKind, targetId, severity, note } = read.value;
  let authorUserId: string;
  if (targetKind === "win") {
    const w = await db.query.colosseumWins.findFirst({ where: and(eq(schema.colosseumWins.id, targetId), eq(schema.colosseumWins.workspaceId, v.workspace.id)), columns: { id: true, userId: true } });
    if (!w) return { ok: false, error: "That win isn't here any more." };
    authorUserId = w.userId;
  } else {
    const m = await memberIn(v.workspace.id, targetId);
    if (!m || m.removedAt) return { ok: false, error: "That member isn't here any more." };
    authorUserId = m.userId;
  }
  if (authorUserId === v.user.id) return { ok: false, error: "That's your own." };
  const author = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, authorUserId)), columns: { role: true } });
  if (author?.role === "coach") return { ok: false, error: "Reports about your coach go to Support.", support: true };
  await db.insert(schema.memberReports).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, kind: "content", severity, description: note, page: "/rewards", targetKind, targetId, targetUserId: authorUserId });
  return { ok: true };
}

/**
 * The coach's Hide this win, from a Content report: hidden for everyone, every report of it handled. Undo shows it again and
 * clears Handled on reports not marked done. Only a win of the coach's own workspace. The author isn't told.
 */
export async function setWinHidden(coach: { workspaceId: string; userId: string }, winId: string, hidden: boolean): Promise<boolean> {
  const w = await db.query.colosseumWins.findFirst({ where: and(eq(schema.colosseumWins.id, winId), eq(schema.colosseumWins.workspaceId, coach.workspaceId)), columns: { id: true } });
  if (!w) return false;
  const at = nowIso();
  await db.update(schema.colosseumWins).set(hidden ? { hiddenAt: at, hiddenBy: coach.userId } : { hiddenAt: null, hiddenBy: null }).where(and(eq(schema.colosseumWins.id, w.id), eq(schema.colosseumWins.workspaceId, coach.workspaceId)));
  const about = and(eq(schema.memberReports.workspaceId, coach.workspaceId), eq(schema.memberReports.kind, "content"), eq(schema.memberReports.targetKind, "win"), eq(schema.memberReports.targetId, w.id));
  if (hidden) await db.update(schema.memberReports).set({ handledAt: at }).where(and(about, isNull(schema.memberReports.handledAt)));
  else await db.update(schema.memberReports).set({ handledAt: null }).where(and(about, isNull(schema.memberReports.doneAt)));
  return true;
}

/** The viewer's own reports, newest first, for Settings → Your reports. */
export async function myReports(v: Who) {
  return db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, v.workspace.id), eq(schema.memberReports.userId, v.user.id)), orderBy: desc(schema.memberReports.createdAt), limit: 30, columns: { id: true, kind: true, severity: true, targetKind: true, seenAt: true, doneAt: true, handledAt: true, createdAt: true } });
}
