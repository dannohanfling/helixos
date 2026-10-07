/**
 * Team access (Danno, 6 Oct), the plain parts: what a team member is told when a write is closed to them, how long an invite
 * lives, and how an invite reads on the owner's list. Pure, for the tests. The server side is src/lib/team.ts.
 */
export const TEAM_INVITE_DAYS = 7;
export const TEAM_CAP_DEFAULT = 5;
export const TEAM_CAP_MAX = 50;
export const TEAM_REFUSAL = "That's outside what a team member can do here. Ask the owner of this HelixOS to do it.";

/** Where a team member lands after signing in: their work, not the owner's day. */
export const TEAM_HOME = "/today";

export type InviteState = "open" | "used" | "revoked" | "expired";
export function inviteState(i: { usedAt: string | null; revokedAt: string | null; expiresAt: string }, now: Date = new Date()): InviteState {
  if (i.usedAt) return "used";
  if (i.revokedAt) return "revoked";
  if (Date.parse(i.expiresAt) <= now.getTime()) return "expired";
  return "open";
}

/** An invite's expiry, a week from when it is made. */
export function inviteExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + TEAM_INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** A coach's new cap for a client: a whole number from 0 to the ceiling; anything else keeps the old one. */
export function readCap(raw: string, current: number): number {
  if (!raw.trim()) return current;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > TEAM_CAP_MAX) return current;
  return n;
}

/** "3 of 5 seats used (1 invite open)". */
export function seatsLine(s: { cap: number; members: number; invites: number }): string {
  const used = `${s.members} of ${s.cap} seat${s.cap === 1 ? "" : "s"} used`;
  return s.invites ? `${used} (${s.invites} invite${s.invites === 1 ? "" : "s"} open)` : used;
}

/** "Last active": today, yesterday, n days ago, or never. `now` and `at` are ISO instants. */
export function lastActiveWords(at: string | null, now: Date = new Date()): string {
  if (!at) return "never";
  const days = Math.floor((now.getTime() - Date.parse(at)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
