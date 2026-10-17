/**
 * The points outbox (H-404, H-493), the pure parts: how a Kindness Koins move is tagged, how eLoyalty's answer is read, when
 * a move is tried again, how a lost answer is settled from the customer's events, who may use the Points desk, what the desk
 * refuses, and the verdict of the one add-and-deduct check on a team test pass. Nothing here calls anything.
 *
 * The rules kept: a move is always a delta (add or deduct by customer id, src/lib/engine/eloyalty.ts), never a set; a
 * deduct never takes more than is available; lifetime is eLoyalty's own count of what was earned, which a deduct leaves
 * alone; a move whose answer was lost is never sent again until its tag has been looked for in the events.
 */
/** How many sends a move gets before it is left failed, for a person to look at. */
export const MAX_ATTEMPTS = 6;
/** The wait after a 429, as the rest of the leaderboard code does. */
export const RATE_LIMIT_WAIT_MS = 60_000;
/** The biggest single move the desk makes. */
export const MAX_MOVE = 100_000;

/** A move's own tag, appended to its reason, so its event can be found among the customer's events. */
export const tagFor = (moveId: string): string => `HX-${moveId.replace(/[^0-9a-z]/gi, "").slice(0, 10)}`;

/** The reason as sent: one line, at most 100 characters of the person's words, then the tag. */
export function taggedReason(reason: string, tag: string): string {
  const words = reason.replace(/\s+/g, " ").trim().slice(0, 100);
  return `${words} [${tag}]`;
}

export type Answer =
  | { kind: "sent"; eventId: string | null; newBalance: number | null }
  | { kind: "wait"; ms: number }
  | { kind: "unknown"; note: string }
  | { kind: "refused"; note: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null);

/**
 * eLoyalty's answer to an add or deduct, in one of four kinds. A 2xx that says success: false is a refusal. Only the status is
 * ever put into words: nothing eLoyalty wrote back reaches a note (it could echo the key or a member's details).
 */
export function readAnswer(status: number, json: unknown): Answer {
  const j = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const body = j.data && typeof j.data === "object" && !Array.isArray(j.data) ? { ...j, ...(j.data as Record<string, unknown>) } : j;
  if (status >= 200 && status < 300) {
    if (body.success === false) return { kind: "refused", note: "eLoyalty said no to it" };
    const eventId = typeof body.eventId === "string" ? body.eventId : typeof body.event_id === "string" ? body.event_id : null;
    return { kind: "sent", eventId, newBalance: num(body.newBalance ?? body.new_balance ?? body.points_balance) };
  }
  if (status === 429) return { kind: "wait", ms: RATE_LIMIT_WAIT_MS };
  if (status === 0 || status >= 500) return { kind: "unknown", note: status === 0 ? "no answer from eLoyalty" : `eLoyalty answered ${status}` };
  return { kind: "refused", note: status === 401 || status === 403 ? `eLoyalty refused the key (${status})` : status === 404 ? "eLoyalty does not know that customer (404)" : `eLoyalty refused it (${status})` };
}

/** Whether the customer's events hold this move's tag: then the move landed, whatever its lost answer said. */
export function eventsHaveTag(json: unknown, tag: string): boolean {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 6 || v === null || v === undefined || seen.has(v)) return false;
    if (typeof v === "string") return v.includes(tag);
    if (typeof v !== "object") return false;
    seen.add(v);
    return Array.isArray(v) ? v.some((x) => walk(x, depth + 1)) : Object.values(v as Record<string, unknown>).some((x) => walk(x, depth + 1));
  };
  return walk(json, 0);
}

export type MoveState = { status: "pending" | "sent" | "failed"; checkFirst: boolean; attempts: number; nextTryAt: string };
export type MovePatch = MoveState & { lastStatus: number | null; lastNote: string; eventId?: string | null; newBalance?: number | null; sentAt?: string };

/** What a move becomes after a send. An unknown outcome waits longer each time and is checked against the events next. */
export function afterSend(move: Pick<MoveState, "attempts">, status: number, answer: Answer, now: Date): MovePatch {
  const attempts = move.attempts + 1;
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  switch (answer.kind) {
    case "sent":
      return { status: "sent", checkFirst: false, attempts, nextTryAt: now.toISOString(), lastStatus: status, lastNote: "eLoyalty took it", eventId: answer.eventId, newBalance: answer.newBalance, sentAt: now.toISOString() };
    case "refused":
      return { status: "failed", checkFirst: false, attempts, nextTryAt: now.toISOString(), lastStatus: status, lastNote: answer.note };
    case "wait":
      return { status: "pending", checkFirst: false, attempts: move.attempts, nextTryAt: at(answer.ms), lastStatus: status, lastNote: "eLoyalty is busy; trying again in a minute" };
    default:
      if (attempts >= MAX_ATTEMPTS) return { status: "failed", checkFirst: true, attempts, nextTryAt: now.toISOString(), lastStatus: status, lastNote: `${answer.note}, ${attempts} times; read the member's events in eLoyalty before moving these points by hand` };
      return { status: "pending", checkFirst: true, attempts, nextTryAt: at(60_000 * 2 ** (attempts - 1)), lastStatus: status, lastNote: `${answer.note}; its events are read before it is sent again` };
  }
}

/** What a move becomes after its events were read: found means it landed; not found means send it now. */
export function afterEventsRead(found: boolean, now: Date): Pick<MovePatch, "status" | "checkFirst" | "lastNote"> & { sentAt?: string } {
  return found ? { status: "sent", checkFirst: false, lastNote: "found in eLoyalty's events: it had landed", sentAt: now.toISOString() } : { status: "pending", checkFirst: false, lastNote: "not in eLoyalty's events: sending it again" };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The Points desk.

/**
 * A member's reference in a form: a short hash of the feed and the customer id, so no id is ever written into a page. The
 * server finds the member again by hashing the held board's ids; unlike a position in a list, it never points at someone else
 * when the list changes.
 */
export function memberRef(feedId: string, customerId: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of `${feedId}:${customerId}`) {
    const c = ch.codePointAt(0)!;
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `m${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** The customer id a form's reference stands for, among the held board's rows, or null. */
export const customerForRef = (feedId: string, ref: string, ids: readonly string[]): string | null => ids.find((id) => memberRef(feedId, id) === ref) ?? null;

export type DeskAccess = { ok: true; as: "coach" | "team" } | { ok: false; why: string };

/**
 * Who may use the desk (H-429): the coach working in the client's HelixOS (not viewing), and a team member the coach has
 * ticked for it. The owner, a coach only viewing, and any other team member are kept out.
 */
export function deskAccess(v: { switchedMode: "view" | "work" | null; teamUserId: string | null }, deskUserIds: readonly string[]): DeskAccess {
  if (v.switchedMode === "work") return { ok: true, as: "coach" };
  if (v.switchedMode === "view") return { ok: false, why: "Switch to Work to move points." };
  if (v.teamUserId && deskUserIds.includes(v.teamUserId)) return { ok: true, as: "team" };
  return { ok: false, why: "The Points desk is kept to the people your coach has named for it." };
}

/** The desk's refusals, in words, before anything is queued. Null means the move may go. */
export function deskRefusal(m: { direction: string; amount: number; reason: string; available: number | null }): string | null {
  if (m.direction !== "add" && m.direction !== "deduct") return "Choose add or deduct.";
  if (!Number.isInteger(m.amount) || m.amount < 1) return "The amount is a whole number from 1.";
  if (m.amount > MAX_MOVE) return `One move is at most ${MAX_MOVE.toLocaleString("en-US")}.`;
  if (m.reason.replace(/\s+/g, " ").trim().length < 3) return "Say why, in a few words: it goes on the member's history in eLoyalty.";
  if (m.direction === "deduct") {
    if (m.available === null) return "Their available balance could not be read just now, so nothing was deducted. Try again in a minute.";
    if (m.amount > m.available) return `Only ${m.available.toLocaleString("en-US")} are available, so nothing was deducted. A deduct never goes below 0.`;
  }
  return null;
}

/** The held board after a move landed: available is eLoyalty's new balance; an add raises lifetime too, a deduct never lowers it. */
export function patchRows<T extends { id: string; lifetime: number; available: number }>(rows: readonly T[], customerId: string, delta: number, newBalance: number | null): T[] {
  return rows.map((r) => (r.id === customerId ? { ...r, available: newBalance ?? Math.max(0, r.available + delta), lifetime: r.lifetime + Math.max(0, delta) } : r));
}

// ---------------------------------------------------------------------------------------------------------------------------
// The one add-and-deduct check (H-493 step 4).

export type Balance = { balance: number; earned: number } | null;

/**
 * The verdict: 1 deducted, then 1 added back, on a team test pass. It passes when the deduct took exactly 1 from available
 * and left lifetime alone, and the add put available back. The add raises lifetime by 1, as any add does; that is expected.
 */
export function checkVerdict(before: Balance, deduct: { status: string; newBalance: number | null }, afterDeduct: Balance, add: { status: string; newBalance: number | null }, afterAdd: Balance): { ok: boolean; note: string } {
  const parts: string[] = [];
  if (deduct.status !== "sent") return { ok: false, note: `The deduct did not land (${deduct.status}). Nothing else was tried.` };
  const startBal = before?.balance ?? null;
  const dBal = afterDeduct?.balance ?? deduct.newBalance;
  const deductOk = startBal !== null && dBal === startBal - 1;
  const lifetimeOk = before && afterDeduct ? afterDeduct.earned === before.earned : null;
  parts.push(`deduct 1: available ${startBal ?? "?"} → ${dBal ?? "?"}${lifetimeOk === null ? ", lifetime not read" : lifetimeOk ? ", lifetime unchanged" : `, lifetime ${before!.earned} → ${afterDeduct!.earned}`}`);
  if (add.status !== "sent") return { ok: false, note: `${parts[0]}; the add back did not land (${add.status}): 1 is still owed to the test pass.` };
  const aBal = afterAdd?.balance ?? add.newBalance;
  const addOk = startBal !== null && aBal === startBal;
  parts.push(`add 1 back: available ${aBal ?? "?"}${afterAdd && before ? `, lifetime ${afterAdd.earned} (an add counts as earned)` : ""}`);
  const ok = deductOk && addOk && lifetimeOk !== false;
  return { ok, note: `${ok ? "Passed" : "Did not pass"}: ${parts.join("; ")}.` };
}

/** A customer's balance and lifetime from a GET of the customer, or null when the answer does not carry them. */
export function readBalance(json: unknown): Balance {
  const j = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const c = j.data && typeof j.data === "object" && !Array.isArray(j.data) ? (j.data as Record<string, unknown>) : j.customer && typeof j.customer === "object" ? (j.customer as Record<string, unknown>) : j;
  const balance = num(c.points_balance ?? c.pointsBalance ?? c.balance);
  const earned = num(c.points_earned ?? c.pointsEarned ?? c.lifetime_points);
  return balance === null || earned === null ? null : { balance, earned };
}
