/**
 * The Aqueduct's data (rev 711): the member's eight stage counts over a period and the period before, read from what HelixOS
 * already holds (the daily log's counters, the engagements typed on posted content, client records), never invented; then the
 * engine's reading: the leak, the picture, the words.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { aqueductLook, boardQuestion, leakOf, missingLine, PERIODS, pictureFor, slipped, STAGES, STEP_LABELS, STEP_TOOLS, stepRate, windows, type Counts, type Leak, type PeriodDays } from "@/lib/engine/aqueduct";
import type { SceneLook } from "@/lib/engine/board-view";

type Member = { workspaceId: string; userId: string };

/** The counts over one window (inclusive dates): posts, comments, DMs, conversations, calls booked, calls held, offers, clients. */
export async function countsFor(m: Member, from: string, to: string): Promise<Counts> {
  const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));
  const [logs, posted, everPosted, clients] = await Promise.all([
    db.query.dailyLogs.findMany({ where: and(mine(schema.dailyLogs), gte(schema.dailyLogs.date, from), lte(schema.dailyLogs.date, to)), columns: { posts: true, dmsStarted: true, conversations: true, callsBooked: true, callsHeld: true, offersMade: true, outreachMessages: true } }),
    db.query.contentItems.findMany({ where: and(mine(schema.contentItems), eq(schema.contentItems.status, "posted")), columns: { postedAt: true, postAt: true, engagements: true } }),
    db.query.contentItems.findFirst({ where: and(mine(schema.contentItems), eq(schema.contentItems.status, "posted")), columns: { id: true } }),
    db.query.clientRecords.findMany({ where: mine(schema.clientRecords), columns: { createdAt: true } }),
  ]);
  const sum = (k: "posts" | "dmsStarted" | "conversations" | "callsBooked" | "callsHeld" | "offersMade" | "outreachMessages") => logs.reduce((n, l) => n + (l[k] ?? 0), 0);
  const day = (s: string | null | undefined) => (s ?? "").slice(0, 10);
  const inWindow = (s: string | null | undefined) => day(s) >= from && day(s) <= to;
  // Comments: the engagements typed on posts that went out in the window; no posted content ever means no count yet.
  const comments = everPosted ? posted.filter((p) => inWindow(p.postedAt ?? p.postAt)).reduce((n, p) => n + (p.engagements ?? 0), 0) : null;
  // Docket #9 (H-195): outreach messages from the close (any app) count as DMs started.
  return [sum("posts"), comments, sum("dmsStarted") + sum("outreachMessages"), sum("conversations"), sum("callsBooked"), sum("callsHeld"), sum("offersMade"), clients.filter((c) => inWindow(c.createdAt)).length];
}

export type AqueductRow = { stage: string; now: number | null; before: number | null; rate: number | null; wasRate: number | null; step: number | null; leak: boolean };
export type Aqueduct = {
  period: PeriodDays;
  windows: ReturnType<typeof windows>;
  now: Counts;
  before: Counts;
  leak: Leak | null;
  look: SceneLook;
  picture: string;
  paused: boolean;
  rows: AqueductRow[];
  missing: string | null;
  panel: { from: string; to: string; n: number; expected: number; made: number; of: number; nowPct: number; wasPct: number; tool: { name: string; href: string }; question: string } | null;
  stepRates: { step: number; label: string; rate: number | null; leak: boolean }[];
};

/** Everything the page shows for one viewer. */
export async function aqueductFor(v: { workspace: { id: string }; user: { id: string }; membership: { aqueductPaused: boolean; aqueductPeriod: number; sceneLook: "auto" | "day" | "night" }; today: string; hour: number }): Promise<Aqueduct> {
  const period = (PERIODS as readonly number[]).includes(v.membership.aqueductPeriod) ? (v.membership.aqueductPeriod as PeriodDays) : 30;
  const w = windows(v.today, period);
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  const [now, before] = await Promise.all([countsFor(m, ...w.now), countsFor(m, ...w.before)]);
  const leak = leakOf(now, before);
  const look = aqueductLook(v.membership.sceneLook, v.hour);
  const rows: AqueductRow[] = STAGES.map((stage, i) => {
    const step = i >= 2 ? i - 2 : null;
    return { stage, now: now[i] ?? null, before: before[i] ?? null, rate: step === null ? null : stepRate(now, step), wasRate: step === null ? null : stepRate(before, step), step, leak: leak !== null && step === leak.step };
  });
  const panel = leak
    ? (() => {
        const { n, expected } = slipped(now, leak);
        return { from: STAGES[leak.step + 1], to: STAGES[leak.step + 2], n, expected, made: now[leak.step + 2] ?? 0, of: now[leak.step + 1] ?? 0, nowPct: Math.round(leak.nowRate * 100), wasPct: Math.round(leak.wasRate * 100), tool: STEP_TOOLS[leak.step], question: boardQuestion(leak) };
      })()
    : null;
  return {
    period,
    windows: w,
    now,
    before,
    leak,
    look,
    picture: pictureFor(look, leak),
    paused: v.membership.aqueductPaused,
    rows,
    missing: missingLine(now) ?? missingLine(before),
    panel,
    stepRates: STEP_LABELS.map((label, b) => ({ step: b, label, rate: stepRate(now, b), leak: leak?.step === b })),
  };
}
