/**
 * The connector's Today tools (connector steps 2 and 3, rev 380; Danno's order at rev 418): read the lock-in, lock the day in,
 * and close it, through the same functions the Today page uses (src/lib/daily-core.ts). A redone lock-in says what it replaced;
 * a close says the points it scored and the month's cash against the goal. Nothing here deletes anything.
 */
import { z } from "zod";
import type { Viewer } from "@/lib/auth";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { CLOSE_NUMBERS, ENERGY_WORDS, closeDay, energyFrom, energyWord, lockIn, lockInState, monthCash, type Close } from "@/lib/daily-core";
import { openTasks, taskLists } from "@/lib/tasks-core";
import { taskData } from "./tasks";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const CLOSE_WORDS: Record<(typeof CLOSE_NUMBERS)[number], string> = { dmsStarted: "DMs started", conversations: "conversations", callsBooked: "calls booked", callsHeld: "calls held", posts: "posts", offersMade: "offers made", newLeads: "new leads", cashCollected: "cash collected" };

/** A title from the member's words to one of their open tasks: exact first, then the one task containing the words; else new. */
function resolveTitle(open: { id: string; title: string }[], said: string): { id: string } | { title: string } {
  const n = said.trim().toLowerCase();
  const exact = open.find((t) => t.title.toLowerCase() === n);
  if (exact) return { id: exact.id };
  const partial = open.filter((t) => t.title.toLowerCase().includes(n));
  if (partial.length === 1) return { id: partial[0].id };
  if (partial.length > 1) throw new Error(`"${said}" matches ${partial.length} open tasks: ${partial.slice(0, 10).map((t) => t.title).join("; ")}. Say which one, or use the full title.`);
  return { title: said.trim() };
}

async function lockInText(v: Viewer) {
  const [{ log, streak, points }, l] = await Promise.all([lockInState(v), taskLists(v)]);
  const locked = Boolean(log?.morningDoneAt);
  const lines = [
    locked ? `Locked in today (${v.today}): energy ${energyWord(log?.energy) ?? "not set"}${log?.intention ? `, committed to "${log.intention}"` : ""}.` : `Not locked in yet today (${v.today}).`,
    `Top 3: ${l.top3.length ? l.top3.map((t) => `${t.status === "done" ? "✓" : "○"} ${t.title}`).join("; ") : "none picked"}.`,
    `Also due today: ${l.dueToday.length ? l.dueToday.map((t) => t.title).join("; ") : "none"}. Overdue: ${l.overdue.length ? l.overdue.map((t) => t.title).join("; ") : "none"}.`,
    `${log?.eveningDoneAt ? "The day is closed." : "The day isn't closed yet."} Streak: ${streak} day${streak === 1 ? "" : "s"}. Points: ${points.toLocaleString("en-US")}.`,
  ];
  return {
    text: lines.join("\n"),
    data: { today: v.today, lockedIn: locked, energy: energyWord(log?.energy), commitment: log?.intention ?? null, top3: l.top3.map(taskData), dueToday: l.dueToday.map(taskData), overdue: l.overdue.map(taskData), closed: Boolean(log?.eveningDoneAt), streak, points },
  };
}

export const todayLockinRead = defineTool({
  name: "today_lockin",
  scope: "today",
  kind: "read",
  description: "Today's lock-in as the Today page shows it: whether the member has locked in, their energy and commitment line, the Top 3 with ticks, what else is due and overdue, whether the day is closed, the streak and the points.",
  input: {},
  handler: async (v): Promise<ToolResult> => lockInText(v),
});

export const todayLockIn = defineTool({
  name: "today_lock_in",
  scope: "today",
  kind: "write",
  description: `Locks in the member's day: up to three Top 3 tasks by title (an open task whose title matches is starred; a title that matches nothing becomes a new task for today), the energy (${ENERGY_WORDS.join(", ")}, or 1 to 5) and an optional commitment line. Doing it again redoes the lock-in and says what it replaced. Ten points the first time each day.`,
  input: {
    top3: z.array(z.string().min(1).max(200)).min(1).max(3).describe("One to three task titles, in the member's words"),
    energy: z.union([z.enum(ENERGY_WORDS), z.number().int().min(1).max(5)]).optional().describe(`${ENERGY_WORDS.join(", ")} or 1 to 5; Steady when left out`),
    commitment: z.string().max(300).optional().describe("The one line the member commits to today"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const said = (input.top3 as string[]).map((s) => String(s)).filter((s) => s.trim());
    if (!said.length) throw new Error("Name at least one task for the Top 3.");
    const energy = input.energy === undefined ? 3 : energyFrom(input.energy);
    if (energy === null) throw new Error(`Energy is one of ${ENERGY_WORDS.join(", ")}, or 1 to 5.`);
    const open = await openTasks(v);
    const focusIds: string[] = [];
    const newTitles: string[] = [];
    for (const s of said.slice(0, 3)) {
      const r = resolveTitle(open, s);
      if ("id" in r) {
        if (!focusIds.includes(r.id)) focusIds.push(r.id);
      } else if (!newTitles.some((t) => t.toLowerCase() === r.title.toLowerCase())) newTitles.push(r.title);
    }
    const r = await lockIn(v, { energy, intention: typeof input.commitment === "string" && input.commitment.trim() ? input.commitment.trim() : null, focusIds, newTitles });
    const lines = [`Locked in: energy ${energyWord(energy)}${typeof input.commitment === "string" && input.commitment.trim() ? `, committed to "${input.commitment.trim()}"` : ""}.`, `Top 3: ${r.top3.map((t) => `${t.status === "done" ? "✓" : "○"} ${t.title}`).join("; ")}.`];
    if (r.created.length) lines.push(`New task${r.created.length === 1 ? "" : "s"} for today: ${r.created.join("; ")}.`);
    if (r.replaced) lines.push(`This redid today's lock-in; it replaced energy ${r.replaced.energy ?? "not set"}${r.replaced.intention ? `, "${r.replaced.intention}"` : ""}, Top 3: ${r.replaced.top3.length ? r.replaced.top3.join("; ") : "none"}.`);
    lines.push(r.points ? `+${r.points} points.` : "No points this time: the lock-in scores once a day.");
    return { text: lines.join("\n"), data: { energy: energyWord(energy), commitment: input.commitment ?? null, top3: r.top3.map(taskData), created: r.created, replaced: r.replaced, points: r.points } };
  },
});

export const todayClose = defineTool({
  name: "today_close",
  scope: "today",
  kind: "write",
  description: "Closes the member's day with the evening numbers (any of: DMs started, conversations, calls booked, calls held, posts, offers made, new leads, cash collected), Start/Stop/Keep, the biggest win and what they're grateful for. A number or line left out keeps what's already there. Answers with the points scored and the month's cash against the goal. Closing again corrects the day.",
  input: {
    dms_started: z.number().int().min(0).max(10000).optional(),
    conversations: z.number().int().min(0).max(10000).optional(),
    calls_booked: z.number().int().min(0).max(1000).optional(),
    calls_held: z.number().int().min(0).max(1000).optional(),
    posts: z.number().int().min(0).max(1000).optional(),
    offers_made: z.number().int().min(0).max(1000).optional(),
    new_leads: z.number().int().min(0).max(10000).optional(),
    cash_collected: z.number().min(0).max(10_000_000).optional().describe("Dollars collected today"),
    start: z.string().max(500).optional().describe("Tomorrow I'll start…"),
    stop: z.string().max(500).optional().describe("I'll stop…"),
    keep: z.string().max(500).optional().describe("I'll keep…"),
    win: z.string().max(500).optional().describe("The biggest win today"),
    grateful_for: z.string().max(500).optional(),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const map: Record<string, keyof Close> = { dms_started: "dmsStarted", conversations: "conversations", calls_booked: "callsBooked", calls_held: "callsHeld", posts: "posts", offers_made: "offersMade", new_leads: "newLeads", cash_collected: "cashCollected", start: "start", stop: "stop", keep: "keep", win: "win", grateful_for: "gratitude" };
    const close: Close = {};
    for (const [arg, key] of Object.entries(map)) if (input[arg] !== undefined) (close as Record<string, unknown>)[key] = input[arg];
    const r = await closeDay(v, close);
    const m = await monthCash(v);
    const scored = r.points.close + r.points.streak;
    const lines = [
      `${r.firstClose ? "Closed" : "Updated"} ${v.today}: ${CLOSE_NUMBERS.map((k) => `${k === "cashCollected" ? money(r.log.cashCollected) : r.log[k]} ${CLOSE_WORDS[k]}`).join(", ")}.`,
      r.firstClose ? `+${r.points.close} for closing${r.points.streak ? `, +${r.points.streak} for streak day ${r.streakDay}` : ""}${r.points.activity ? `, and ${r.points.activity} for the day's activity (${r.activityLines.join(", ")})` : ""}.` : `The close was already scored; activity points now total ${r.points.activity} for the day.`,
      `${m.month}: ${money(m.cash)} collected${m.goal ? ` toward "${m.goal.title}", ${money(m.goal.actual)} of ${money(m.goal.target)}` : ""}.`,
    ];
    if (r.log.win) lines.push(`Win: ${r.log.win}.`);
    return { text: lines.join("\n"), data: { date: v.today, firstClose: r.firstClose, streakDay: r.streakDay, points: { ...r.points, scored }, numbers: Object.fromEntries(CLOSE_NUMBERS.map((k) => [k, r.log[k]])), start: r.log.start, stop: r.log.stop, keep: r.log.keep, win: r.log.win, gratefulFor: r.log.gratitude, month: m } };
  },
});
