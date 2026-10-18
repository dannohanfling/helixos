/**
 * Check connection (H-555, plan H-559): one plain line and a chip per agent on Coach → Agents, worked out from what HelixOS
 * records: the agent's live token (made, last used), the last tool its connection called, and calls that came in on one of
 * its revoked tokens. Pure, so the page and the tests read the same rules. Never a token, a prefix or an address.
 */

export type ConnState = "none" | "never" | "connected" | "failing" | "quiet";
export type ConnChip = "idle" | "waiting" | "done";

export type ConnInput = {
  agentName: string;
  /** The agent's live token, or null. */
  token: { createdAt: string; lastUsedAt: string | null } | null;
  /** The last tool its connection called (the tool's name only). */
  lastTool: string | null;
  /** Calls on one of its revoked tokens since the last good call: how many, and when the latest came. */
  failures: { count: number; lastAt: string } | null;
  now: Date;
  /** Formats a stored instant as a clock time in the coach's zone ("10:58 AM PDT"). */
  clock: (iso: string) => string;
};

/** "Connected" means a good call within this long; older reads as Quiet. */
export const CONNECTED_FOR_MS = 24 * 60 * 60 * 1000;

const CHIPS: Record<ConnState, ConnChip> = { none: "idle", never: "waiting", connected: "done", failing: "waiting", quiet: "idle" };

export function instant(stamp: string): number {
  const t = stamp.trim();
  return Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t) ? `${t.replace(" ", "T")}Z` : t);
}

/** "just now", "2 min ago", "3 h ago", "1 day ago", "3 days ago". */
export function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

export function connectionOf(i: ConnInput): { state: ConnState; chip: ConnChip; line: string } {
  const pick = (state: ConnState, line: string) => ({ state, chip: CHIPS[state], line });
  if (i.failures && i.failures.count > 0) {
    const n = i.failures.count;
    return pick("failing", `${n} ${n === 1 ? "call" : "calls"} at ${i.clock(i.failures.lastAt)} used an old or wrong token. Make a new token and update the environment variable.`);
  }
  if (!i.token) return pick("none", "No token yet. Make one to connect.");
  if (!i.token.lastUsedAt) return pick("never", `Token made ${i.clock(i.token.createdAt)}. ${i.agentName} hasn't connected yet.`);
  const since = i.now.getTime() - instant(i.token.lastUsedAt);
  if (since <= CONNECTED_FOR_MS) return pick("connected", `Connected. Last call ${ago(since)}${i.lastTool ? ` (${i.lastTool})` : ""}.`);
  return pick("quiet", `Connected before. Last call ${ago(since)}.`);
}

/**
 * Only failures in a minute after the last good call's minute count: a fixed agent stops showing as failing. Failures are
 * counted per minute, so within the same minute the order can't be told; the good call wins.
 */
export function failuresSince(rows: { minute: string; count: number }[], lastGood: string | null): { count: number; lastAt: string } | null {
  const after = lastGood ? Math.floor(instant(lastGood) / 60000) * 60000 : -Infinity;
  const live = rows.filter((r) => instant(r.minute) > after);
  if (!live.length) return null;
  const lastAt = live.map((r) => r.minute).sort().at(-1)!;
  return { count: live.reduce((s, r) => s + r.count, 0), lastAt };
}

/** The ping: an ordinary inbox message from the owner, answered by the agent's handoff_ack. */
export const PING_TITLE = "Connection check from Danno. Reply with handoff_ack.";

export function pingLine(p: { sentAt: string; ackedAt: string | null } | null, clock: (iso: string) => string): string | null {
  if (!p) return null;
  return p.ackedAt ? `Ping answered ${clock(p.ackedAt)}` : `Ping sent ${clock(p.sentAt)}`;
}

/** The environment variable an agent's token goes in: Viator → HELIXOS_TOKEN_VIATOR. */
export function envVarFor(name: string): string {
  return `HELIXOS_TOKEN_${name.toUpperCase().replace(/[^A-Z0-9_]/g, "")}`;
}

/** The minute a failure is counted in, so one row a minute holds the count. */
export function minuteOf(d: Date): string {
  return `${d.toISOString().slice(0, 16)}:00Z`;
}

/** The line to send the agent from Setup help. */
export const CHECK_LINE = "Run forum_report now and tell me any error.";
