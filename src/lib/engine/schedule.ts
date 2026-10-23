/**
 * The Forum's Schedule board and Cowork agents speaking as themselves (H-1838, plan H-1843): the rules, with no database.
 * A job is reported by the agent that runs it at the start and end of each run; "missed" is worked out when the board is read.
 */
import { cutText } from "@/lib/engine/cut";
import { scrubText } from "@/lib/engine/handoff";

export const SCHEDULE_STATUSES = ["started", "done", "failed", "skipped"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
/** A next run this long past with no report since is missed. */
export const MISSED_AFTER_MS = 60 * 60 * 1000;
export const SCHEDULE_MAX = { job: 100, when: 100, reason: 200 } as const;
/** "via Danno's connector": what a post or report made with `as` records (H-1843). */
export const viaOwnersConnector = (ownerFirst: string): string => `${ownerFirst}'s connector`;

export type ScheduleState = ScheduleStatus | "missed" | "new";

/** Where a job stands now: missed if its next run is over an hour past and nothing was reported since; else its last status. */
export function scheduleState(j: { lastStatus: ScheduleStatus | null; lastAt: string | null; nextAt: string | null }, nowMs: number): ScheduleState {
  const next = j.nextAt ? Date.parse(j.nextAt) : NaN;
  if (Number.isFinite(next) && next + MISSED_AFTER_MS < nowMs) {
    const last = j.lastAt ? Date.parse(j.lastAt) : NaN;
    if (!(Number.isFinite(last) && last >= next)) return "missed";
  }
  return j.lastStatus ?? "new";
}

/** A failed or missed job counts on What needs you only when its last report said it's the owner's to fix. */
export function scheduleNeedsOwner(j: { needsYou: boolean; lastStatus: ScheduleStatus | null; lastAt: string | null; nextAt: string | null }, nowMs: number): boolean {
  const s = scheduleState(j, nowMs);
  return j.needsYou && (s === "failed" || s === "missed");
}

export const STATE_WORDS: Record<ScheduleState, string> = { started: "Running", done: "Done", failed: "Failed", skipped: "Skipped", missed: "Missed", new: "Not run yet" };

export type ScheduleReport = { job: string; jobKey: string; when: string | null; status: ScheduleStatus; reason: string | null; nextAt: string | null; needsYou: boolean; removed: number };

/** schedule_report's input, checked: a job name, a status, and optional when, reason, next run (UTC) and needs_you. */
export function parseScheduleReport(raw: Record<string, unknown>): { ok: true; report: ScheduleReport } | { ok: false; error: string } {
  const job = cutText(String(raw.job ?? "").trim(), SCHEDULE_MAX.job);
  if (!job) return { ok: false, error: "Name the job, e.g. \"Daily triage\"." };
  const status = String(raw.status ?? "");
  if (!(SCHEDULE_STATUSES as readonly string[]).includes(status)) return { ok: false, error: `status is one of ${SCHEDULE_STATUSES.join(", ")}.` };
  const when = raw.when === undefined || raw.when === null ? null : cutText(String(raw.when).trim(), SCHEDULE_MAX.when) || null;
  let removed = 0;
  let reason: string | null = null;
  if (raw.reason !== undefined && raw.reason !== null && String(raw.reason).trim()) {
    const s = scrubText(cutText(String(raw.reason).trim(), SCHEDULE_MAX.reason));
    reason = s.text;
    removed += s.removed;
  }
  let nextAt: string | null = null;
  if (raw.next_at !== undefined && raw.next_at !== null && String(raw.next_at).trim()) {
    const t = Date.parse(String(raw.next_at));
    if (!Number.isFinite(t)) return { ok: false, error: "next_at is a UTC time, like 2026-10-24T19:50:00Z." };
    nextAt = new Date(t).toISOString();
  }
  return { ok: true, report: { job, jobKey: job.toLowerCase().replace(/\s+/g, " "), when, status: status as ScheduleStatus, reason, nextAt, needsYou: raw.needs_you === true, removed } };
}

/**
 * `as` on the connector (H-1843): only the owner's own connection, signed in as themselves, may speak as one of their Cowork
 * agents. Null when allowed; otherwise the reason, in words.
 */
export function asRefusal(c: { agentToken: boolean; role: string; switched: boolean; team: boolean }): string | null {
  if (c.agentToken) return "An agent token always speaks as its own agent, so it can't use as.";
  if (c.switched) return "as can't be used while switched into someone else's HelixOS.";
  if (c.team) return "as is the owner's own; a team member's connection can't use it.";
  if (c.role !== "coach") return "as is for the coach's own connector.";
  return null;
}

/** The agent `as` may name: one on the owner's Forum whose platform is Claude Cowork. */
export const COWORK_PLATFORM = "Claude Cowork";
export function asTargetRefusal(name: string, agent: { platform: string | null } | null): string | null {
  if (!agent) return `There's no agent called "${name}" on your Forum. Add it there first, with platform ${COWORK_PLATFORM}.`;
  if (agent.platform !== COWORK_PLATFORM) return `${name} isn't a ${COWORK_PLATFORM} agent, so as can't name it. Set its platform on the Forum if it is one.`;
  return null;
}
