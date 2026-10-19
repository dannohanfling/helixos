import { tierFor, TIERS } from "@/lib/engine/tiers";

/**
 * The points sync and the invitations on the coach's own program (H-867 parts 3 and 4, H-890, H-898): the pure rules.
 * HelixOS points are the one currency. eLoyalty sets the rank on the pass from its points (H-890), so the sync never
 * writes Tier: it sends point moves, the member's Level, and each invitation once.
 */

export type SyncMode = "off" | "own" | "all";
export type InviteKey = "academy" | "elite" | "lux";
export const INVITE_KEYS: readonly InviteKey[] = ["academy", "elite", "lux"];

/** Whether a mode reaches this member: "own" is the coach's own pass only (the first test), "all" is everyone with a pass. */
export function modeReaches(mode: SyncMode, isCoach: boolean): boolean {
  return mode === "all" || (mode === "own" && isCoach);
}

/** The Level on the back of the pass: the member's program, or "Coach" for the coach's own pass. */
export function levelFor(role: string, programTier: string): string {
  return role === "coach" ? "Coach" : programTier.trim() || "Academy";
}

const PROGRAMS = ["Accelerator", "Academy", "Elite", "Luxe"] as const;
const programRank = (p: string) => {
  const i = PROGRAMS.indexOf(p as (typeof PROGRAMS)[number]);
  return i === -1 ? 1 : i; // an unknown program reads as Academy, the house default
};
const levelOf = (name: string) => TIERS.find((t) => t.name === name)?.level ?? Infinity;

/** Each rung (H-865): who it is for, the rank that opens it, and the words on the pass. */
export const INVITES: Record<InviteKey, { below: (typeof PROGRAMS)[number]; rank: string; text: string }> = {
  academy: { below: "Academy", rank: "Sentinel", text: "You've earned a call about Academy" },
  elite: { below: "Elite", rank: "Centurion", text: "You've earned a call about Elite" },
  lux: { below: "Luxe", rank: "Olympian", text: "Your Lux Partnership Conversation" },
};

/**
 * The invitation this member has earned now and not yet been sent, or null. A member already on that program or above never
 * gets it, and each goes once. The highest one earned wins, so a member who jumped two rungs gets the higher one only.
 */
export function inviteDue(input: { role: string; programTier: string; points: number; sent: readonly string[] }): InviteKey | null {
  if (input.role !== "client" && input.role !== "coach") return null;
  const rank = tierFor(input.points).level;
  const prog = programRank(input.programTier);
  for (const key of [...INVITE_KEYS].reverse()) {
    const rung = INVITES[key];
    if (rank < levelOf(rung.rank)) continue;
    if (prog >= programRank(rung.below)) continue;
    return input.sent.includes(key) ? null : key;
  }
  return null;
}

/** A booking link to keep: https only, at most 500 characters, or blank. Anything else is refused. */
export function readInviteLink(input: string): { ok: true; value: string | null } | { ok: false } {
  const v = input.trim();
  if (!v) return { ok: true, value: null };
  if (v.length > 500) return { ok: false };
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? { ok: true, value: u.toString() } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** The reason line on a synced move (kept short; eLoyalty shows it in the member's history). */
export function syncReason(kind: "opening" | "row", type?: string): string {
  return kind === "opening" ? "HelixOS points so far" : `HelixOS ${type ?? "points"}`;
}
