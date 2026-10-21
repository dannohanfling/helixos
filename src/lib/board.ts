/**
 * My Board (rev 664) on the server: what the Board may read for one member (their own rows only, chosen by what the decision is
 * about), the ask itself on their own AI key with the server's checks, the decision log, and Danno's principles (the
 * coach's, seeded from the pack). Never read: HumanOS (its switch comes later, through Body's own read), the teaching library or
 * story bank, anything of another member's.
 */
import { and, asc, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { draft } from "@/lib/ai";
import { addDays, formatDate, nowIso, startOfWeek, dayOf } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { essenceBlockFor } from "@/lib/queries/essence";
import { logsBetween } from "@/lib/queries/daily";
import { monthProgress, monthOf } from "@/lib/engine/targets";
import { simplePath } from "@/lib/engine/pathway";
import { weekOf } from "@/lib/engine/intentions";
import { STAGE_WORDS } from "@/lib/engine/voice-pack";
import { boardTask, checkAnswer, operatorSeat, seatsUsed, type BoardAnswer, type Mode, type Preset, type Principle } from "@/lib/engine/board";
import { councilFor } from "@/lib/board-seats";
import { scoreboardFor } from "@/lib/scoreboard";
import { bodyAiContext } from "@/lib/queries/body";
import { principlesFor } from "@/lib/board-principles";
export { principlesFor };
import { buildProposals, SETUP_SHAPE } from "@/lib/engine/board-setup";
import { setupLook } from "@/lib/board-setup";
import { beforeFreshStart, canUndoFreshStart, dbStamp, discussionTags, inMemory, matchesSearch, MEMORY_SIZE, pageOf } from "@/lib/engine/board-memory";

export const FEATURE = "board";
type Member = { workspaceId: string; userId: string };
const memberOf = (v: Viewer): Member => ({ workspaceId: v.workspace.id, userId: v.user.id });

/* ───────────────────────── Danno's principles ───────────────────────── */

const asPrinciples = (rows: schema.BoardPrinciple[]): Principle[] => rows.map((r) => ({ title: r.title, body: r.body, goodFor: r.goodFor }));

/* ───────────────────────── What the Board can see ───────────────────────── */

export type Section = { key: string; label: string; href: string; text: string };
/** Which parts of the member's HelixOS a decision is about (rev 664 §3): the always-on few, then what its words point to. */
const TOPICS: { key: string; re: RegExp }[] = [
  { key: "offers", re: /offer|price|pricing|charge|package|program|promise|upsell|discount|sell|webinar|launch/i },
  { key: "avatars", re: /avatar|buyer|audience|client|niche|who (i|we) (serve|help)|ideal|offer|price|webinar|content|message/i },
  { key: "webinars", re: /webinar|event|workshop|masterclass|live|launch|challenge/i },
  { key: "dms", re: /dm|lead|prospect|follow.?up|outreach|conversation|call|sales|close|pipeline|webinar|book/i },
  { key: "content", re: /content|post|ladder|reel|video|instagram|facebook|calendar|idea|webinar|promote|audience/i },
  { key: "proofs", re: /proof|testimonial|win|case study|result|price|offer|pricing/i },
  { key: "recordings", re: /call|coaching|recording|action step|what did danno/i },
  { key: "officeHours", re: /office hours|friday|stuck|help/i },
];
/** A decision that touches the member's energy, health or time: the only kind the HumanOS summary is read for. */
const BODY_TOPIC = /\b(energy|tired|exhausted|burn ?out|sleep|health|stress|overwhelm|workout|training|gym|weight|food|eat|hours|time|schedule|capacity|rest)\b/i;
const ALWAYS = ["numbers", "tasks", "intentions", "pathway", "scoreboard", "decisions"];
/** The sections a question reads: the always-on few and every topic its words touch; a question that names none reads them all. */
export function sectionsFor(question: string, mode: Mode): string[] {
  const hit = TOPICS.filter((t) => t.re.test(question)).map((t) => t.key);
  const topics = hit.length ? hit : TOPICS.map((t) => t.key);
  // Check-ins and Leverage look at the whole week; a Quick Vote needs only what the options touch.
  const extra = mode === "checkin" || mode === "leverage" ? ["tasks", "content", "dms"] : [];
  return [...new Set([...ALWAYS, ...topics, ...extra])];
}

const money = (n: number, cur = "USD") => `${cur === "USD" ? "$" : `${cur} `}${Math.round(n).toLocaleString()}`;
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The context the Board reads, section by section, each with the page it came from, plus the gaps it should name. Every query
 * is the member's own (workspace and user together). Prospects are first names and counts only, unless the question names one.
 */
export async function boardContext(v: Viewer, question: string, mode: Mode): Promise<{ sections: Section[]; gaps: string[]; essence: boolean; body: boolean }> {
  const m = memberOf(v);
  const want = new Set(sectionsFor(question, mode));
  const today = v.today;
  const out: Section[] = [];
  const gaps: string[] = [];
  const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));

  // Hours and the big promise always come with the member.
  out.push({ key: "you", label: "Your settings", href: "/settings#you", text: [`Hours a week for the business: ${v.membership.boardHours ?? "not set"}.`, v.membership.businessName ? `Business: ${v.membership.businessName}.` : "", v.membership.bigPromise ? `Big promise: ${v.membership.bigPromise}` : "", v.membership.audience ? `Audience: ${v.membership.audience}` : ""].filter(Boolean).join("\n") });
  if (!v.membership.bigPromise) gaps.push("There's no big promise in Settings yet.");

  if (want.has("offers")) {
    const offers = await db.query.offers.findMany({ where: mine(schema.offers), orderBy: asc(schema.offers.createdAt) });
    const live = offers.filter((o) => o.status !== "retired");
    if (live.length) {
      out.push({ key: "offers", label: `Offers (${live.length})`, href: "/offers", text: live.map((o) => `- ${o.name} (${o.status}${o.price ? `, ${money(o.price, o.currency)}` : ", no price yet"})${o.promise ? `: ${o.promise}` : ""}`).join("\n") });
      for (const o of live) if (!o.price) gaps.push(`The offer "${o.name}" has no price yet.`);
    } else gaps.push("There's no offer in HelixOS yet.");
  }
  if (want.has("avatars")) {
    const rows = (await db.query.avatars.findMany({ where: mine(schema.avatars) })).filter((a) => !a.archivedAt);
    if (rows.length) out.push({ key: "avatars", label: `Avatars (${rows.length})`, href: "/avatars", text: rows.map((a) => `- ${a.primary ? "★ " : ""}${a.name}${a.who ? `: ${a.who}` : ""}${a.pains ? ` | pains: ${a.pains.replace(/\n/g, "; ")}` : ""}${a.wants ? ` | wants: ${a.wants.replace(/\n/g, "; ")}` : ""}${a.phrases ? ` | their words: ${a.phrases.replace(/\n/g, "; ")}` : ""}`).join("\n") });
    else gaps.push("There's no buyer avatar yet.");
  }
  if (want.has("webinars")) {
    const rows = (await db.query.webinars.findMany({ where: mine(schema.webinars), orderBy: desc(schema.webinars.createdAt), limit: 5 })).filter((w) => !w.isExample);
    if (rows.length) out.push({ key: "webinars", label: `Webinars (${rows.length})`, href: "/webinars", text: rows.map((w) => `- ${w.title} (${w.status}${w.scheduledAt ? `, ${formatDate(w.scheduledAt.slice(0, 10))}` : ", no date"})${w.promise ? `: ${w.promise}` : ""}${w.registered != null ? ` | registered ${w.registered}, showed ${w.showed ?? "?"}, sales ${w.sales ?? "?"}` : ""}`).join("\n") });
  }
  if (want.has("dms")) {
    const contacts = await db.query.contacts.findMany({ where: mine(schema.contacts) });
    if (contacts.length) {
      const byStage = Object.entries(STAGE_WORDS).map(([k, label]) => `${label} ${contacts.filter((c) => c.stage === k).length}`).join(", ");
      // Most overdue first: the names the Board sees are the ones waiting longest.
      const due = contacts.filter((c) => c.nextFollowUpAt && c.nextFollowUpAt <= today && c.stage !== "cold" && c.stage !== "client").sort((a, b) => a.nextFollowUpAt!.localeCompare(b.nextFollowUpAt!));
      const named = contacts.filter((c) => new RegExp(`\\b${first(c.name).replace(/[^\p{L}]/gu, "")}\\b`, "i").test(question) && first(c.name).length > 2);
      const lines = [`By stage: ${byStage}.`, `Follow-ups due: ${due.length}${due.length ? ` (${due.slice(0, 5).map((c) => first(c.name)).join(", ")})` : ""}.`];
      for (const c of named.slice(0, 2)) {
        const last = await db.query.messages.findFirst({ where: eq(schema.messages.contactId, c.id), orderBy: desc(schema.messages.sentAt) });
        lines.push(`${first(c.name)}: ${STAGE_WORDS[c.stage]}${last ? `, last note "${last.body.replace(/\s+/g, " ").slice(0, 160)}"` : ""}.`);
      }
      out.push({ key: "dms", label: "DMs", href: "/conversations", text: lines.join("\n") });
    } else gaps.push("No conversations are logged in DMs yet.");
  }
  if (want.has("numbers")) {
    const month = monthOf(today);
    const [logs, targetRows, recent] = await Promise.all([logsBetween(m.workspaceId, m.userId, `${month}-01`, today), db.query.targets.findMany({ where: and(mine(schema.targets), eq(schema.targets.month, month)) }), logsBetween(m.workspaceId, m.userId, addDays(startOfWeek(today), -21), today)]);
    const targets = Object.fromEntries(targetRows.map((t) => [t.metric, t.target]));
    const prog = monthProgress(logs as unknown as Record<string, number>[], targets, month, today).filter((p) => p.target > 0 || p.actual > 0);
    const weeks = [0, 1, 2, 3].map((i) => {
      const from = addDays(startOfWeek(today), -7 * (3 - i));
      const w = recent.filter((l) => l.date >= from && l.date <= addDays(from, 6));
      const sum = (k: "callsBooked" | "callsHeld" | "offersMade" | "cashCollected") => w.reduce((a, l) => a + Number(l[k] ?? 0), 0);
      return `week of ${from}: calls booked ${sum("callsBooked")}, held ${sum("callsHeld")}, offers made ${sum("offersMade")}, cash ${money(sum("cashCollected"))}`;
    });
    out.push({ key: "numbers", label: "Numbers", href: "/numbers", text: [prog.length ? `This month: ${prog.map((p) => `${p.label} ${p.money ? money(p.actual) : p.actual}${p.target ? ` of ${p.money ? money(p.target) : p.target} (${p.pace})` : ""}`).join("; ")}.` : "No numbers or targets this month.", `Last 4 weeks, from the closes: ${weeks.join("; ")}.`].join("\n") });
    if (!targetRows.length) gaps.push("There are no monthly targets set in Numbers.");
  }
  if (want.has("tasks")) {
    const tasks = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, m.userId), ne(schema.tasks.status, "done")), orderBy: asc(schema.tasks.dueDate), limit: 60 });
    const top = tasks.filter((t) => t.focusDate === today);
    const overdue = tasks.filter((t) => t.dueDate && t.dueDate < today);
    const upcoming = tasks.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 7));
    out.push({ key: "tasks", label: "Tasks", href: "/tasks", text: [`Top 3 today: ${top.map((t) => t.title).join("; ") || "none set"}.`, `Overdue: ${overdue.length}${overdue.length ? ` (${overdue.slice(0, 5).map((t) => t.title).join("; ")})` : ""}.`, `Due in the next 7 days: ${upcoming.length}.`].join("\n") });
  }
  if (want.has("intentions")) {
    const week = await db.query.weeklyIntentions.findFirst({ where: and(mine(schema.weeklyIntentions), eq(schema.weeklyIntentions.weekOf, weekOf(today))) });
    if (week) out.push({ key: "intentions", label: "This week's 3-1-3", href: "/intentions#week", text: `Word: ${week.word}. Key results: ${week.keyResults.map((k) => k.text).join("; ")}. Initiative: ${week.initiative}. Tasks: ${week.tasks.map((t) => t.title).join("; ")}.` });
    else gaps.push("This week's 3-1-3 isn't set.");
  }
  if (want.has("pathway")) {
    const [stages, library, progress] = await Promise.all([db.query.pathwayStages.findMany(), db.query.libraryTasks.findMany(), db.query.pathwayProgress.findMany({ where: eq(schema.pathwayProgress.userId, m.userId) })]);
    if (stages.length) {
      const p = simplePath(stages as never, library as never, progress as never);
      const stage = stages.find((s) => s.key === p.stageKey);
      out.push({ key: "pathway", label: "Pathway", href: "/pathway", text: p.allDone ? "Every Pathway step is done." : `Stage: ${stage?.name ?? p.stageKey}. Steps now: ${p.now.map((t) => t.name).join("; ") || "none"}. ${p.doneCount} of ${p.pathCount} done.` });
    }
  }
  if (want.has("proofs")) {
    const rows = await db.query.proofs.findMany({ where: mine(schema.proofs), orderBy: desc(schema.proofs.createdAt), limit: 40 });
    if (rows.length) out.push({ key: "proofs", label: `Proof Bank (${rows.length})`, href: "/proof", text: `${rows.filter((p) => p.status === "approved").length} approved, ${rows.filter((p) => p.status !== "approved" && p.permissionAt).length} with permission, ${rows.filter((p) => p.status !== "approved" && !p.permissionAt).length} drafts. Recent: ${rows.slice(0, 5).map((p) => `${p.name} (${p.status === "approved" ? "approved" : p.permissionAt ? "permission given" : "draft"})`).join("; ")}.` });
    else gaps.push("The Proof Bank is empty.");
  }
  if (want.has("content")) {
    const items = await db.query.contentItems.findMany({ where: mine(schema.contentItems), orderBy: desc(schema.contentItems.createdAt), limit: 80 });
    const ideas = items.filter((i) => i.status === "idea");
    const upcoming = items.filter((i) => i.postAt && i.postAt.slice(0, 10) >= today && i.postAt.slice(0, 10) <= addDays(today, 14));
    const posted = items.filter((i) => i.postedAt && dayOf(i.postedAt, v.tz) >= addDays(today, -14));
    const ladders = await db.query.ladders.findMany({ where: mine(schema.ladders), orderBy: desc(schema.ladders.createdAt), limit: 5 });
    out.push({ key: "content", label: "Content", href: "/content", text: [`Ideas: ${ideas.length}${ideas.length ? ` (${ideas.slice(0, 5).map((i) => i.title).join("; ")})` : ""}.`, `On the calendar, next 14 days: ${upcoming.length}.`, `Posted in the last 14 days: ${posted.length}.`, ladders.length ? `Recent ladders: ${ladders.map((l) => `${l.topic} (${l.shippedAt ? "shipped" : "draft"})`).join("; ")}.` : "No ladders yet."].join("\n") });
  }
  if (want.has("recordings")) {
    const steps = await db.query.recordingSteps.findMany({ where: and(eq(schema.recordingSteps.workspaceId, m.workspaceId), eq(schema.recordingSteps.userId, m.userId)) });
    const open = steps.filter((s) => s.state === "suggested");
    if (open.length) out.push({ key: "recordings", label: "Recordings", href: "/recordings", text: `Action steps from your calls not yet on your tasks: ${open.length} (${open.slice(0, 5).map((s) => s.text).join("; ")}).` });
  }
  if (want.has("officeHours")) {
    const rows = await db.query.officeHoursRequests.findMany({ where: and(mine(schema.officeHoursRequests), gte(schema.officeHoursRequests.friday, today), isNull(schema.officeHoursRequests.outcome)) });
    if (rows.length) out.push({ key: "officeHours", label: "Office Hours", href: "/office-hours#mine", text: rows.map((r) => `- ${r.friday}: ${r.description.replace(/\s+/g, " ").slice(0, 160)}`).join("\n") });
  }
  if (want.has("scoreboard")) {
    const s = await scoreboardFor(m, v.tz, today, "this");
    out.push({ key: "scoreboard", label: "This week's scoreboard", href: "/today", text: `So far this week: ${s.posts.total} posts, ${s.dms.started} DMs, ${s.calls} calls booked, ${s.closes} of ${s.days} days closed.` });
  }
  if (want.has("decisions")) {
    // The Board's memory (H-257): the last five remembered decisions made after a fresh start, never an example.
    const past = await db.query.boardDecisions.findMany({ where: and(mine(schema.boardDecisions), isNull(schema.boardDecisions.parentId)), orderBy: desc(schema.boardDecisions.createdAt), limit: 200, columns: { createdAt: true, answer: true, stepTasks: true, remembered: true, example: true } });
    const answered = past.filter((d) => d.answer && inMemory(d, v.membership.boardFreshStartAt)).slice(0, MEMORY_SIZE);
    if (answered.length) {
      const ids = answered.flatMap((d) => d.stepTasks.filter((x): x is string => Boolean(x)));
      const done = new Set(ids.length ? (await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, m.userId), inArray(schema.tasks.id, ids), eq(schema.tasks.status, "done")), columns: { id: true } })).map((t) => t.id) : []);
      out.push({ key: "decisions", label: `Past decisions (${answered.length})`, href: "/my-board#decisions", text: answered.map((d) => `- ${dayOf(d.createdAt, v.tz)}: ${d.answer!.decision} → ${d.answer!.recommendation} (${d.stepTasks.filter((x) => x && done.has(x)).length} of ${d.answer!.steps.length} steps done)`).join("\n") });
    }
  }
  // HumanOS (rev 664 §3): only with the member's own My Board switch on, only when the decision touches energy, health or time,
  // and only through Body's one gate for AI (bodyAiContext checks Body's own AI switch first). Off, nothing of HumanOS is read.
  let body = false;
  if (v.membership.bodyEnabled && v.membership.boardSeesBody && (BODY_TOPIC.test(question) || mode === "checkin" || mode === "leverage")) {
    const summary = await bodyAiContext(v);
    if (summary) {
      out.push({ key: "humanos", label: "HumanOS summary", href: "/body", text: summary });
      body = true;
    } else gaps.push("HumanOS isn't open to AI in its own settings, so the Board didn't read it.");
  }
  const essence = Boolean(await essenceBlockFor(m.workspaceId, m.userId));
  return { sections: out, gaps, essence, body };
}

/** The context as the AI reads it, after the member's own words. */
export function contextText(sections: Section[], gaps: string[]): string {
  return [`# What the Board can see\n\n${sections.map((s) => `## ${s.label}\n${s.text}`).join("\n\n")}`, gaps.length ? `# Gaps to name, never fill\n${gaps.map((g) => `- ${g}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
}

/* ───────────────────────── Asking ───────────────────────── */

export type AskResult = { ok: true; decision: schema.BoardDecision } | { ok: false; error: string; decision?: schema.BoardDecision };

/**
 * One question to the Board: the context read, the answer drafted on the member's own key (their Essence leads the system
 * message), the server's checks, one more try when an answer fails them, and the decision saved with what it used. A follow-up
 * (parentId) belongs to its decision: the first question hears all five, later ones the few who matter.
 */
export async function askBoard(v: Viewer, input: { question: string; mode: Mode; focus?: string | null; parentId?: string | null; need?: string[]; example?: boolean }): Promise<AskResult> {
  const question = input.question.trim().slice(0, 4000);
  if (question.length < 3) return { ok: false, error: "Say what you're deciding." };
  const hours = v.membership.boardHours;
  if (!hours) return { ok: false, error: "Set the hours you can give your business each week first." };
  const m = memberOf(v);
  const parent = input.parentId ? await db.query.boardDecisions.findFirst({ where: and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId), eq(schema.boardDecisions.id, input.parentId)) }) : null;
  if (input.parentId && !parent) return { ok: false, error: "That decision isn't yours or isn't there any more." };
  // An example (H-257): a coach's own demo, never a client's; a follow-up on an example is one too.
  const example = Boolean(parent?.example) || (Boolean(input.example) && v.role === "coach" && !v.switchedInto);
  // Edge Preset only ever for a coach's own Board.
  const preset: Preset = v.role === "coach" && !v.switchedInto && v.membership.boardPreset === "edge" ? "edge" : "standard";
  // The member's council (rev 756): Danno and their four chairs, paused expert seats already swapped for the archetypes.
  const seats = await councilFor(v);
  // Focus by key, or by name as said aloud ("Hormozi", "Jordan").
  const said = (input.focus ?? "").trim().toLowerCase();
  const focus = input.mode === "focus" && said ? (seats.find((s) => s.key === said) ?? seats.find((s) => s.name.toLowerCase().includes(said)))?.key ?? null : null;
  if (input.mode === "focus" && !focus) return { ok: false, error: "Pick the advisor to hear from." };
  const coachWs = v.workspace.id;
  const principles = asPrinciples(await principlesFor(coachWs));
  const { sections, gaps, essence } = await boardContext(v, question, input.mode);
  const firstQuestion = !parent;
  // The set-up shape rides with the server's prompt only (engine/board stays light for the Boardroom's client bundle).
  const task = `${boardTask({ mode: input.mode, focus, preset, seats, principles, hours, today: v.today, firstQuestion })}\n\n${SETUP_SHAPE}`;
  // A check-in needs the operator for a stuck step and Morgan for a dropped one (rev 664 §6): the council's operator stands in
  // for Jordan, and a council without Morgan leaves the kind question to whoever answers.
  const op = operatorSeat(seats);
  const need = (input.need ?? []).map((k) => (k === "jordan" ? (op?.key ?? null) : seats.some((s) => s.key === k) ? k : null)).filter((k): k is string => Boolean(k));
  const earlier = parent?.answer ? `# The decision so far\nQuestion: ${parent.question}\nRecommendation: ${parent.answer.recommendation}\nSteps: ${parent.answer.steps.map((s) => s.do).join("; ")}\n\n` : "";
  const user = `${earlier}# The member asks (${input.mode})\n${question}\n\n${contextText(sections, gaps)}`;
  const known = sections.map((s) => s.text).join("\n");
  let checked = null as ReturnType<typeof checkAnswer> | null;
  let setup: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await draft(task, user, 6000, { feature: FEATURE, viewer: v });
    if (reply === null) return { ok: false, error: "Your AI key didn't answer (no key, the day's limit, or the provider said no). Settings shows why." };
    let raw: unknown = null;
    try {
      raw = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? "null");
    } catch {
      raw = null;
    }
    checked = checkAnswer(raw, { mode: input.mode, focus, preset, seats, hours, today: v.today, firstQuestion, question, known, need });
    setup = raw && typeof raw === "object" ? (raw as Record<string, unknown>).setup : null;
    if (!checked.problem) break;
  }
  const used = [...(essence ? [{ label: "Essence", href: "/essence" }] : []), ...sections.map((s) => ({ label: s.label, href: s.href }))];
  const id = newId();
  // "Set it up for me" (rev 660): the proposals under a good answer, checked against the member's own rows; nothing applied yet.
  const built = checked && !checked.problem ? buildProposals(checked.answer, setup, await setupLook(v, parent?.id ?? id, question, known)) : { proposals: [], notes: [] };
  await db.insert(schema.boardDecisions).values({ id, ...m, parentId: parent?.id ?? null, question, mode: input.mode, focus, preset, example, answer: checked && !checked.problem ? checked.answer : null, seats: seatsUsed(seats), notes: checked ? [...(checked.problem ? [checked.problem] : []), ...checked.notes, ...built.notes] : [], used, proposals: built.proposals });
  const decision = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, id) }))!;
  if (checked?.problem) return { ok: false, error: `The Board's answer didn't pass its checks (${checked.problem}). Ask again; your question is kept.`, decision };
  if (parent) await db.update(schema.boardDecisions).set({ updatedAt: nowIso() }).where(eq(schema.boardDecisions.id, parent.id));
  return { ok: true, decision };
}

/** The member's decisions, newest first: each first question with its follow-ups. */
export async function decisionsFor(v: Viewer, limit = 30) {
  const m = memberOf(v);
  const rows = await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId)), orderBy: desc(schema.boardDecisions.createdAt), limit: limit * 4 });
  const tops = rows.filter((r) => !r.parentId).slice(0, limit);
  return tops.map((t) => ({ decision: t, followUps: rows.filter((r) => r.parentId === t.id).reverse() }));
}

/** One of the member's decisions, or null. */
export async function ownDecision(v: Viewer, id: string) {
  return (await db.query.boardDecisions.findFirst({ where: and(eq(schema.boardDecisions.workspaceId, v.workspace.id), eq(schema.boardDecisions.userId, v.user.id), eq(schema.boardDecisions.id, id)) })) ?? null;
}

/* ───────────────────────── Past discussions and the Board's memory (H-257) ───────────────────────── */

export type Discussion = Awaited<ReturnType<typeof decisionsFor>>[number] & { tags: ReturnType<typeof discussionTags>; before: boolean };

/**
 * Past discussions: the member's own, newest first, the search over question and recommendation, `show` rows (20 a page,
 * More adds a page), and the ones made before a fresh start marked so the list can group them.
 */
export async function discussionsFor(v: Viewer, q: string, show: number): Promise<{ rows: Discussion[]; more: boolean; found: number; canUndo: boolean }> {
  const fresh = v.membership.boardFreshStartAt;
  const all = (await decisionsFor(v, 500)).filter((x) => matchesSearch(x.decision, q)).map((x) => ({ ...x, tags: discussionTags(x.decision), before: beforeFreshStart(x.decision, fresh) }));
  const page = pageOf(all, show);
  return { rows: page.rows, more: page.more, found: all.length, canUndo: canUndoFreshStart(fresh, new Date()) };
}

/** "Start fresh": from now the Board reads only decisions made after this moment. Nothing is deleted. The member's own, never a coach's or a team member's. */
export async function startFresh(v: Viewer): Promise<boolean> {
  if (v.team || v.switchedInto) return false;
  await db.update(schema.memberships).set({ boardFreshStartAt: dbStamp(new Date()) }).where(eq(schema.memberships.id, v.membership.id));
  return true;
}

/** Undo the fresh start, within seven days: the earlier decisions are back in the Board's memory. */
export async function undoFreshStart(v: Viewer): Promise<boolean> {
  if (v.team || v.switchedInto || !canUndoFreshStart(v.membership.boardFreshStartAt, new Date())) return false;
  await db.update(schema.memberships).set({ boardFreshStartAt: null }).where(eq(schema.memberships.id, v.membership.id));
  return true;
}

/** "The Board remembers this": off keeps one decision out of future discussions; the decision stays. */
export async function setRemembered(v: Viewer, decisionId: string, on: boolean): Promise<boolean> {
  if (v.team || v.switchedInto) return false;
  const m = memberOf(v);
  const r = await db.update(schema.boardDecisions).set({ remembered: on }).where(and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId), eq(schema.boardDecisions.id, decisionId))).returning({ id: schema.boardDecisions.id });
  return r.length > 0;
}

/** The step status, read live from the tasks the steps became. */
export async function stepStatus(userId: string, d: schema.BoardDecision): Promise<("done" | "open" | "not set up")[]> {
  const ids = d.stepTasks.filter((x): x is string => Boolean(x));
  const rows = ids.length ? await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, userId), inArray(schema.tasks.id, ids)), columns: { id: true, status: true } }) : [];
  return (d.answer?.steps ?? []).map((_, i) => {
    const t = rows.find((r) => r.id === d.stepTasks[i]);
    return t ? (t.status === "done" ? "done" : "open") : "not set up";
  });
}
export type { BoardAnswer };
