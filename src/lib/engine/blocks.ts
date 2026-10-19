/**
 * Block a member and report a win (H-735, plan H-745; App Store guideline 1.2): the rules with no database. Members see each
 * other in three places: the Colosseum's wins, its arena and standings, and the Rewards page's weekly leaderboard. One set,
 * `BlockSet`, read once per page by blockedFor (src/lib/blocks.ts), is applied to each of them here, so the rule lives in one
 * place: a blocked member's wins are gone, their seat stays but reads "A member" with no photo, and a win the viewer reported
 * is gone for them at once. A win the coach hid is gone for everyone. Covered by src/lib/engine/__tests__/blocks.test.ts.
 */
import type { ReportSeverity } from "@/db/schema";

export const A_MEMBER = "A member";

/** What one viewer doesn't see: the members they blocked (by membership and by user) and the wins they reported. */
export type BlockSet = { memberships: ReadonlySet<string>; users: ReadonlySet<string>; wins: ReadonlySet<string> };
export const NO_BLOCKS: BlockSet = { memberships: new Set(), users: new Set(), wins: new Set() };

/** "Leo T.": the first name and the last initial, the shape every list of members uses. "A member" stays as it is. */
export function shortName(name: string): string {
  if (name === A_MEMBER) return A_MEMBER;
  const w = name.trim().split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : (w[0] ?? "Member");
}

/** A seat or a standing, as the viewer sees it: a blocked member keeps the seat (so the counts add up), not the name or photo. */
export function veil<T extends { userId: string; name: string; photo: boolean }>(row: T, b: BlockSet): T & { veiled: boolean } {
  return b.users.has(row.userId) ? { ...row, name: A_MEMBER, photo: false, veiled: true } : { ...row, veiled: false };
}

/** The wins one viewer reads: never one the coach hid, one by a member they blocked, or one they reported. */
export function visibleWins<T extends { id: string; userId: string; hiddenAt?: string | null }>(wins: T[], b: BlockSet): T[] {
  return wins.filter((w) => !w.hiddenAt && !b.users.has(w.userId) && !b.wins.has(w.id));
}

/** One line of the Rewards leaderboard: "First L.", or "A member" with the default emoji for someone the viewer blocked. */
export function boardName(u: { name: string; avatarEmoji: string } | undefined, userId: string, b: BlockSet): { name: string; emoji: string } {
  if (b.users.has(userId)) return { name: A_MEMBER, emoji: "🧭" };
  return { name: shortName(u?.name ?? "Member"), emoji: u?.avatarEmoji ?? "🧭" };
}

export type BlockTarget = { membershipId: string; userId: string; role: "coach" | "client"; removed?: boolean };
export const CANT_BLOCK_COACH = "Your coach can't be blocked. If something isn't right, contact Support.";

/** Whether this viewer may block this member: someone else in the workspace, never a coach. */
export function canBlock(viewer: { membershipId: string }, target: BlockTarget | null): { ok: true } | { ok: false; error: string } {
  if (!target || target.removed) return { ok: false, error: "That member isn't here any more." };
  if (target.membershipId === viewer.membershipId) return { ok: false, error: "That's you." };
  if (target.role === "coach") return { ok: false, error: CANT_BLOCK_COACH };
  return { ok: true };
}

/** The reasons a member picks from, each kept as the report's colour so the coach's inbox sorts them the same way. */
export const CONTENT_REASONS = ["spam", "harassment", "other"] as const;
export type ContentReason = (typeof CONTENT_REASONS)[number];
export const REASON_LABEL: Record<ContentReason, string> = { spam: "Spam", harassment: "Harassment or hurtful", other: "Something else" };
export const REASON_SEVERITY: Record<ContentReason, ReportSeverity> = { harassment: "red", spam: "orange", other: "green" };
export const reasonOf = (severity: ReportSeverity): ContentReason => (Object.keys(REASON_SEVERITY) as ContentReason[]).find((r) => REASON_SEVERITY[r] === severity) ?? "other";
export const NOTE_MAX = 1000;
export const REPORTED = "Thanks. Your coach will look at this.";

export type ContentReportValue = { targetKind: "win" | "member"; targetId: string; reason: ContentReason; severity: ReportSeverity; note: string };

/** A Content report, read from the form: what (a win or a member, by id), why (one of the three), and an optional note. */
export function readContentReport(raw: { targetKind: string; targetId: string; reason: string; note: string }): { value: ContentReportValue } | { error: string } {
  const targetKind = raw.targetKind === "win" || raw.targetKind === "member" ? raw.targetKind : null;
  const targetId = raw.targetId.trim();
  if (!targetKind || !targetId || targetId.length > 64) return { error: "That couldn't be reported. Refresh the page and try again." };
  const reason = CONTENT_REASONS.find((r) => r === raw.reason);
  if (!reason) return { error: "Pick a reason: spam, harassment or hurtful, or something else." };
  const note = raw.note.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim();
  if (note.length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX} characters.` };
  return { value: { targetKind, targetId, reason, severity: REASON_SEVERITY[reason], note } };
}

/** What the reporter reads under Settings → Your reports: handled once the coach acted on it or marked it done. */
export function reportStatus(r: { kind: string; seenAt: string | null; doneAt: string | null; handledAt?: string | null }): "Handled" | "Done" | "Seen" | "Sent" {
  if (r.kind === "content") return r.handledAt || r.doneAt ? "Handled" : "Sent";
  return r.doneAt ? "Done" : r.seenAt ? "Seen" : "Sent";
}
