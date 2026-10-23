/**
 * Moving a program's members to its new pass (H-1859, plan H-1861 approved in H-1868). The pure parts: what HelixOS reads from
 * a member's old record, the words on the member's page and on Coach, and the counts. Nothing here calls anything.
 *
 * A new template makes a new member record that starts at 0 (the service files each member under one template), so the old
 * balance is carried with one add. An add raises lifetime too, so the new pass's lifetime starts at the carried balance; the
 * old pass keeps its own history.
 */
import { readBalance } from "@/lib/engine/points-outbox";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export type OldMember = { firstName: string; lastName: string; email: string; level: string; memberId: string; balance: number | null };

/**
 * The member's old record as the service answers it (GET one customer): names, email, tier as the level, the id their member
 * area knows (MEMBER_ID, or the service's own id when the record carries none) and the available balance.
 */
export function readOldMember(json: unknown, customerId: string): OldMember {
  const j = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const c = (j.data && typeof j.data === "object" && !Array.isArray(j.data) ? j.data : j.customer && typeof j.customer === "object" ? j.customer : j) as Record<string, unknown>;
  const b = readBalance(json);
  return {
    firstName: str(c.first_name ?? c.firstName),
    lastName: str(c.last_name ?? c.lastName),
    email: str(c.email),
    level: str(c.membership_tier ?? c.membershipTier ?? c.tier ?? c.level),
    memberId: str(c.member_id ?? c.memberId ?? c.MEMBER_ID ?? c.external_id ?? c.externalId) || customerId,
    balance: b ? Math.max(0, Math.round(b.balance)) : null,
  };
}

/** Whether an email from the coach matches a member's email: trimmed, case-insensitive, whole address only. */
export const sameEmail = (a: string, b: unknown) => {
  const x = a.trim().toLowerCase();
  return Boolean(x) && x === str(b).toLowerCase();
};

export type SwitchCode = "made" | "busy" | "notready" | "noemail" | "refused" | "noanswer" | "invalid" | "making";

/** The words on the member's page for an outcome, or null for anything unknown. No provider name, no price. */
export function switchWords(code: string | undefined): { good: boolean; text: string } | null {
  if (code === "made") return { good: true, text: "Your new pass is ready. Add it to your wallet below; your points come with it." };
  if (code === "busy") return { good: false, text: "The pass service is busy. Nothing was made; try again in a minute." };
  if (code === "making") return { good: false, text: "Your pass is being made. Give it a minute and open this page again." };
  if (code === "notready") return { good: false, text: "The new pass isn't open yet. Try again later." };
  if (code === "noemail") return { good: false, text: "Your old pass has no email on it, so the new one can't be made from here. Your program can help." };
  if (code === "refused") return { good: false, text: "The pass service refused to make the pass. Nothing was changed; your program has been told." };
  if (code === "noanswer") return { good: false, text: "The pass service didn't answer. Nothing was changed; try again in a minute." };
  if (code === "invalid") return { good: false, text: "This link isn't valid. Ask your program for a new one." };
  return null;
}

/** The coach's words for making a test link. */
export function linkWords(code: string | undefined): { good: boolean; text: string } | null {
  if (code === "made") return { good: true, text: "Link made. Open it on the test member's phone." };
  if (code === "nomember") return { good: false, text: "No member on the old pass has that email." };
  if (code === "notready") return { good: false, text: "Needs the program's key, a passed check, a passed points check and the new template as the 2nd template." };
  if (code === "busy") return { good: false, text: "The pass service is busy. Try again in a minute." };
  if (code === "noanswer") return { good: false, text: "The pass service didn't answer. Try again in a minute." };
  return null;
}

/** A make that has sat in "making" this long is taken to have died, and may be tried again. */
export const STUCK_MS = 10 * 60_000;
export const isStuck = (updatedAt: string, now = new Date()) => now.getTime() - Date.parse(updatedAt.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(updatedAt) ? "" : "Z")) > STUCK_MS;

export type MoveCounts = { links: number; made: number; carried: number; waiting: number; failed: number; mismatched: number };

/**
 * The counts on Coach: links made, passes made, carries sent, waiting and failed, and the no-points-lost check: a sent carry
 * whose new balance isn't exactly the carried amount (the new record starts at 0, so they must match).
 */
export function moveCounts(rows: { status: string; carryPoints: number | null; carryMoveId: string | null }[], moves: Map<string, { status: string; newBalance: number | null }>): MoveCounts {
  const out: MoveCounts = { links: rows.length, made: 0, carried: 0, waiting: 0, failed: 0, mismatched: 0 };
  for (const r of rows) {
    if (r.status !== "made") continue;
    out.made++;
    if (!r.carryMoveId) continue;
    const m = moves.get(r.carryMoveId);
    if (!m || m.status === "pending") out.waiting++;
    else if (m.status === "failed") out.failed++;
    else {
      out.carried++;
      if (m.newBalance !== null && m.newBalance !== r.carryPoints) out.mismatched++;
    }
  }
  return out;
}
