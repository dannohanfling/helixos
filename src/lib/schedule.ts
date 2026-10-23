/**
 * The Forum's Schedule board (H-1838, plan H-1843): the jobs an owner's agents run on a schedule, as the agents report them.
 * The rules (states, "missed", what counts on What needs you) are in src/lib/engine/schedule.ts.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { allow } from "@/lib/rate-limit";
import { parseScheduleReport, scheduleNeedsOwner, scheduleState, type ScheduleState } from "@/lib/engine/schedule";

type Owner = { workspaceId: string; userId: string };
const mine = (o: Owner) => and(eq(schema.scheduleJobs.workspaceId, o.workspaceId), eq(schema.scheduleJobs.userId, o.userId));

/** schedule_report: the calling agent's job, made on its first report and updated on each one after. */
export async function reportSchedule(o: Owner, agent: schema.ForumAgent, raw: Record<string, unknown>, via: string | null = null): Promise<{ job: schema.ScheduleJob; created: boolean; removed: number }> {
  if (!(await allow(`schedule:report:${agent.id}`, 60, 60_000))) throw new Error("At most 60 schedule reports a minute per agent. Wait a minute and send again.");
  const parsed = parseScheduleReport(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const r = parsed.report;
  const now = nowIso();
  const found = await db.query.scheduleJobs.findFirst({ where: and(mine(o), eq(schema.scheduleJobs.agentId, agent.id), eq(schema.scheduleJobs.jobKey, r.jobKey)) });
  const set = { name: r.job, lastStatus: r.status, lastReason: r.reason, lastAt: now, needsYou: r.needsYou && (r.status === "failed" || r.status === "skipped"), via, updatedAt: now, ...(r.when !== null ? { whenText: r.when } : {}), ...(r.nextAt !== null ? { nextAt: r.nextAt } : {}) };
  if (found) {
    await db.update(schema.scheduleJobs).set(set).where(eq(schema.scheduleJobs.id, found.id));
    return { job: (await db.query.scheduleJobs.findFirst({ where: eq(schema.scheduleJobs.id, found.id) }))!, created: false, removed: r.removed };
  }
  const id = newId();
  await db.insert(schema.scheduleJobs).values({ id, ...o, agentId: agent.id, jobKey: r.jobKey, whenText: r.when ?? "", nextAt: r.nextAt, ...set }).onConflictDoNothing();
  return { job: (await db.query.scheduleJobs.findFirst({ where: and(mine(o), eq(schema.scheduleJobs.agentId, agent.id), eq(schema.scheduleJobs.jobKey, r.jobKey)) }))!, created: true, removed: r.removed };
}

export type ScheduleRow = { id: string; name: string; agent: string; when: string; state: ScheduleState; lastAt: string | null; reason: string | null; nextAt: string | null; needsOwner: boolean; hidden: boolean; via: string | null };

/** The board, one read: each job with its agent's name and where it stands now. Hidden rows only when asked for. */
export async function scheduleBoard(o: Owner, opts: { hidden?: boolean; nowMs?: number } = {}): Promise<ScheduleRow[]> {
  const now = opts.nowMs ?? Date.now();
  const rows = await db
    .select({ j: schema.scheduleJobs, agent: schema.forumAgents.name })
    .from(schema.scheduleJobs)
    .innerJoin(schema.forumAgents, eq(schema.forumAgents.id, schema.scheduleJobs.agentId))
    .where(opts.hidden ? mine(o) : and(mine(o), isNull(schema.scheduleJobs.hiddenAt)))
    .orderBy(asc(schema.forumAgents.name), asc(schema.scheduleJobs.name));
  return rows.map(({ j, agent }) => ({
    id: j.id,
    name: j.name,
    agent,
    when: j.whenText,
    state: scheduleState(j, now),
    lastAt: j.lastAt,
    reason: j.lastReason,
    nextAt: j.nextAt,
    needsOwner: !j.hiddenAt && scheduleNeedsOwner(j, now),
    hidden: Boolean(j.hiddenAt),
    via: j.via,
  }));
}

/** Hide a row from the board, or bring it back. The owner's own; nothing is sent to the agent. */
export async function setScheduleHidden(o: Owner, id: string, hidden: boolean): Promise<void> {
  await db.update(schema.scheduleJobs).set({ hiddenAt: hidden ? nowIso() : null }).where(and(mine(o), eq(schema.scheduleJobs.id, id)));
}
