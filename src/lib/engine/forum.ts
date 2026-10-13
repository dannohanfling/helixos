/**
 * The Forum (rev 765), the pure parts: the buildings on the photo map, the secret scrub, a report read from untrusted JSON
 * (capped, scrubbed, statuses checked), and the state the page draws, in the mockup's shape (updatedAt, headline, agents,
 * flows, queue, waiting, log). No database, no request. Times stay UTC here; the page shows them in the member's zone.
 */
import { FORUM_PLOTS, FORUM_STATUSES, type ForumMilestone } from "@/db/schema";

export type ForumPlot = (typeof FORUM_PLOTS)[number];
export type ForumStatus = (typeof FORUM_STATUSES)[number];

/**
 * The twelve plots of the forum photo (forum12-plots.json, Danno 13 Oct), in the order new agents take them: the lowest free
 * plot first. The member is the Rostra in the middle. Each plot's centre (x, y), its door onto the square (dx, dy), its glow
 * (rx, ry) and its name plate (px, py) are in the photo's own pixels, viewBox 1680 × 944, the same by day and by night.
 */
export const FORUM_BUILDINGS: Record<ForumPlot, { place: string; building: string }> = {
  p01: { place: "The Portico", building: "Long colonnade" },
  p02: { place: "The Temple", building: "Temple" },
  p03: { place: "The City Gate", building: "Triumphal arch" },
  p04: { place: "The Baths", building: "Domed rotunda" },
  p05: { place: "The Theatre", building: "Open-air theatre" },
  p06: { place: "The Workshop", building: "Workshop with chimney" },
  p07: { place: "The Villa", building: "Courtyard villa" },
  p08: { place: "The Post House", building: "Post house by the south road" },
  p09: { place: "The Library", building: "Round library" },
  p10: { place: "The Granary", building: "Granary and stables" },
  p11: { place: "The Archive", building: "Long hall" },
  p12: { place: "The Tabularium", building: "Small temple-house" },
};
export const FORUM_PLOT_XY: Record<ForumPlot, { x: number; y: number; dx: number; dy: number; rx: number; ry: number; px: number; py: number }> = {
  p01: { x: 540, y: 165, dx: 642, dy: 336, rx: 170, ry: 95, px: 474, py: 56 },
  p02: { x: 832, y: 135, dx: 833, dy: 283, rx: 95, ry: 110, px: 830, py: 30 },
  p03: { x: 1057, y: 145, dx: 997, dy: 314, rx: 85, ry: 90, px: 1105, py: 31 },
  p04: { x: 1250, y: 210, dx: 1078, dy: 369, rx: 100, ry: 95, px: 1340, py: 114 },
  p05: { x: 1385, y: 370, dx: 1116, dy: 434, rx: 130, ry: 95, px: 1505, py: 322 },
  p06: { x: 1385, y: 550, dx: 1117, dy: 493, rx: 165, ry: 105, px: 1505, py: 596 },
  p07: { x: 1225, y: 705, dx: 1078, dy: 561, rx: 165, ry: 120, px: 1310, py: 801 },
  p08: { x: 1015, y: 785, dx: 974, dy: 625, rx: 95, ry: 115, px: 1054, py: 904 },
  p09: { x: 625, y: 760, dx: 675, dy: 612, rx: 115, ry: 105, px: 578, py: 870 },
  p10: { x: 375, y: 680, dx: 586, dy: 541, rx: 165, ry: 110, px: 273, py: 766 },
  p11: { x: 275, y: 520, dx: 561, dy: 483, rx: 160, ry: 110, px: 151, py: 558 },
  p12: { x: 310, y: 320, dx: 570, dy: 417, rx: 135, ry: 95, px: 193, py: 258 },
};
export const ROSTRA = { place: "The Rostra", name: "You" } as const;
export const ROSTRA_XY = { x: 840, y: 465, dx: 840, dy: 465, rx: 130, ry: 95, px: 840, py: 590 } as const;
export const isForumPlot = (p: unknown): p is ForumPlot => typeof p === "string" && (FORUM_PLOTS as readonly string[]).includes(p);

/** A messenger's street: out of one door, across the square bending toward the Rostra, in at the other door. */
export function streetPath(from: ForumPlot | "rostra", to: ForumPlot | "rostra"): string {
  const A = from === "rostra" ? ROSTRA_XY : FORUM_PLOT_XY[from];
  const B = to === "rostra" ? ROSTRA_XY : FORUM_PLOT_XY[to];
  const mx = (A.dx + B.dx) / 2;
  const my = (A.dy + B.dy) / 2;
  const qx = mx + (ROSTRA_XY.x - mx) * 0.55;
  const qy = my + (ROSTRA_XY.y - my) * 0.55;
  return `M${A.x},${A.y} L${A.dx},${A.dy} Q${qx.toFixed(0)},${qy.toFixed(0)} ${B.dx},${B.dy} L${B.x},${B.y}`;
}

export const FORUM_PLATFORMS = ["Claude Code", "Claude Cowork", "Claude", "OpenAI Codex", "ChatGPT", "Gemini", "Cursor", "n8n", "Make", "Zapier", "GoHighLevel", "GitHub", "Vercel", "My booking bot"] as const;

/** The caps (rev 765 §4): now, last and next at 200 each; the rest sized to what a card or a plate can show. */
export const FORUM_MAX = { name: 40, line: 200, role: 80, platform: 40, link: 300, flowLabel: 40, what: 160, detail: 400, when: 60, headline: 200, milestone: 80, rev: 20, queue: 12 } as const;
export const FORUM_REPORTS_PER_MINUTE = 60;
export const FORUM_FLOW_MS = 30 * 60 * 1000;
/** Automatic lights (H-19): a building lit by calls alone goes back to its reported status after this long without a call. */
export const FORUM_AUTO_MS = 10 * 60 * 1000;
/** H-52: at most this many lights on the map at once, newest first. */
export const FORUM_FLOWS_SHOWN = 20;
export const FORUM_KEEP_DAYS = 90;
export const FORUM_NEWS = 12;

/**
 * Whether a value looks like a key or token (rev 765 §4): sk- and its cousins, GitHub's ghp_/gho_/github_pat_, Slack's xox,
 * HelixOS's own prefixes, a JWT, or a long unbroken run of hex or base64. Such a field is dropped whole, never trimmed, so no
 * part of a secret is ever saved.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/,
  /\bxox[abprsoe]-[A-Za-z0-9-]{8,}/,
  /\b(?:hxf|hxa|hxh|mcpa|mcpr|mcpx)_[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /\b[0-9a-fA-F]{32,}\b/,
  /[A-Za-z0-9+/_-]{40,}={0,2}/,
];
export function looksLikeSecret(value: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(value));
}

/** Plain text, one line or a few: control characters out, whitespace tidied, capped. Never HTML; the page renders text only. */
export function cleanLine(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** An agent's saved link: http(s) only, no credentials in it, or nothing. */
export function cleanLink(value: unknown): string | null {
  const s = cleanLine(value, FORUM_MAX.link);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    if (looksLikeSecret(u.search)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const forumNameKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

export type ForumReport = {
  agent: string;
  status: ForumStatus | null;
  now: string | null;
  last: string | null;
  next: string | null;
  /** Which of now/last/next the report carried at all, so "now": "" clears and a missing one keeps what was there. */
  has: { now: boolean; last: boolean; next: boolean };
  flow: { to: string; label: string | null } | null;
  needsYou: { what: string; detail: string | null; when: string | null } | null;
  /** True clears all of this agent's open items; a list clears those whose "what" matches. */
  needsCleared: true | string[] | null;
  queue: ForumMilestone[] | null;
  headline: string | null;
  /** The report's own time (UTC) when it sent a sensible one; otherwise null and the arrival time is used. */
  at: string | null;
};
export type ParsedReport = { ok: true; report: ForumReport; removed: string[] } | { ok: false; error: string };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * A report from the connector or the webhook, the same fields either way. Every text field is capped; any that looks like a
 * secret is dropped and named in `removed` (the log says "a value was removed", never which value). A report needs an agent
 * and at least one thing to say.
 */
export function parseForumReport(raw: unknown, now: Date = new Date()): ParsedReport {
  const r = obj(raw);
  if (!r) return { ok: false, error: "Send a JSON object with at least \"agent\" and one of status, now, last, next, flow, needs_you, queue or headline." };
  const removed: string[] = [];
  const text = (field: string, value: unknown, max: number): string | null => {
    const s = cleanLine(value, max);
    if (s && looksLikeSecret(s)) {
      removed.push(field);
      return null;
    }
    return s;
  };
  const agentRaw = cleanLine(r.agent, FORUM_MAX.name);
  if (!agentRaw) return { ok: false, error: "\"agent\" is required: the agent's name, as it shows on your Forum." };
  if (looksLikeSecret(agentRaw)) return { ok: false, error: "That agent name looks like a key, so nothing was saved. Use the agent's plain name." };
  let status: ForumStatus | null = null;
  if (r.status !== undefined && r.status !== null && r.status !== "") {
    const s = String(r.status).trim().toLowerCase();
    if (!(FORUM_STATUSES as readonly string[]).includes(s)) return { ok: false, error: "\"status\" must be working, waiting, idle or done." };
    status = s as ForumStatus;
  }
  const has = { now: "now" in r, last: "last" in r, next: "next" in r };
  const flowIn = obj(r.flow);
  const flowTo = flowIn ? text("flow.to", flowIn.to, FORUM_MAX.name) : null;
  const flow = flowTo ? { to: flowTo, label: text("flow.label", flowIn!.label, FORUM_MAX.flowLabel) } : null;
  const needIn = obj(r.needs_you);
  const needWhat = needIn ? text("needs_you.what", needIn.what, FORUM_MAX.what) : null;
  const needsYou = needWhat ? { what: needWhat, detail: text("needs_you.detail", needIn!.detail, FORUM_MAX.detail), when: text("needs_you.when", needIn!.when, FORUM_MAX.when) } : null;
  let needsCleared: true | string[] | null = null;
  if (r.needs_cleared === true) needsCleared = true;
  else if (Array.isArray(r.needs_cleared)) needsCleared = r.needs_cleared.map((w) => cleanLine(w, FORUM_MAX.what)).filter((w): w is string => !!w && !looksLikeSecret(w)).slice(0, 20);
  let queue: ForumMilestone[] | null = null;
  if (Array.isArray(r.queue)) {
    queue = [];
    for (const [i, q] of r.queue.slice(0, FORUM_MAX.queue).entries()) {
      const m = obj(q);
      const name = m ? text(`queue[${i}].name`, m.name, FORUM_MAX.milestone) : text(`queue[${i}]`, q, FORUM_MAX.milestone);
      if (!name) continue;
      const st = m && typeof m.state === "string" ? m.state.toLowerCase() : "queued";
      const rev = m ? text(`queue[${i}].rev`, m.rev, FORUM_MAX.rev) : null;
      queue.push({ name, state: st === "done" || st === "now" ? st : "queued", ...(rev ? { rev } : {}) });
    }
  }
  const report: ForumReport = {
    agent: agentRaw,
    status,
    now: has.now ? text("now", r.now, FORUM_MAX.line) : null,
    last: has.last ? text("last", r.last, FORUM_MAX.line) : null,
    next: has.next ? text("next", r.next, FORUM_MAX.line) : null,
    has,
    flow,
    needsYou,
    needsCleared,
    queue,
    headline: text("headline", r.headline, FORUM_MAX.headline),
    at: reportTime(r.at, now),
  };
  const says = report.status || has.now || has.last || has.next || flow || needsYou || needsCleared || queue || report.headline;
  if (!says && !removed.length) return { ok: false, error: "The report has an agent but nothing to say. Send at least one of status, now, last, next, flow, needs_you, queue or headline." };
  return { ok: true, report, removed };
}

/** A report's own time, when it's a real UTC instant from the last day and not from the future (five minutes' grace). */
export function reportTime(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const t = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(t)) return null;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms) || ms > now.getTime() + 5 * 60 * 1000 || ms < now.getTime() - 24 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

/** Where a new agent goes (Danno, 13 Oct): the lowest free plot, or the Outer districts when all twelve are taken. */
export function plotFor(taken: Iterable<string | null>): ForumPlot | null {
  const used = new Set([...taken].filter(Boolean));
  return FORUM_PLOTS.find((p) => !used.has(p)) ?? null;
}

/** The build team a coach's Forum starts with (rev 765 §5), each on the plot forum12-plots.json suggests; p09, p10, p12 stay free. */
export const FORUM_SEED: { name: string; plot: ForumPlot; platform: string; role: string }[] = [
  { name: "Acta", plot: "p01", platform: "Claude Docs", role: "the handoff doc" },
  { name: "Scriba", plot: "p02", platform: "Claude Cowork", role: "Cowork: design and briefs" },
  { name: "Porta", plot: "p03", platform: "Vercel", role: "Vercel: deploys" },
  { name: "Medicus", plot: "p04", platform: "Claude Code", role: "Body: HumanOS" },
  { name: "Orator", plot: "p05", platform: "Claude", role: "Slides: decks" },
  { name: "Architectus", plot: "p06", platform: "Claude Code", role: "main: the build" },
  { name: "Hospes", plot: "p07", platform: "Claude", role: "Lindsey: guest" },
  { name: "Hermes", plot: "p08", platform: "Claude Code", role: "Magic funnel pages" },
  { name: "Tabularium", plot: "p11", platform: "GitHub", role: "GitHub: the repo" },
];

// ---------------------------------------------------------------------------------------------------------------------------
// Built-in agents (rev 765 §2): read from what HelixOS already records, never tracked anew.

export const BUILT_INS = {
  booking: { name: "Booking bot", role: "conversations and booked calls" },
  ship: { name: "Ship", role: "posts and comments" },
  recordings: { name: "Recordings", role: "calls into action steps" },
  board: { name: "My Board", role: "decisions and steps" },
} as const;
export type BuiltInKey = keyof typeof BUILT_INS;
export const BUILT_IN_KEYS = Object.keys(BUILT_INS) as BuiltInKey[];
export const isBuiltIn = (k: unknown): k is BuiltInKey => typeof k === "string" && k in BUILT_INS;

/** One thing a built-in agent saw happen, newest first when handed over. */
export type BuiltInEvent = { at: string; text: string };

/** A built-in's card from its recent happenings: working within the half hour, done within the day, idle otherwise. */
export function builtInCard(key: BuiltInKey, events: BuiltInEvent[], now: Date = new Date()): { status: ForumStatus; now: string | null; last: string | null; lastAt: string | null } | null {
  if (!events.length) return null;
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  const newest = sorted[0];
  const age = now.getTime() - Date.parse(newest.at);
  const status: ForumStatus = age <= FORUM_FLOW_MS ? "working" : age <= 24 * 60 * 60 * 1000 ? "done" : "idle";
  const today = sorted.filter((e) => now.getTime() - Date.parse(e.at) <= 24 * 60 * 60 * 1000).length;
  const noun = BUILT_IN_NOUNS[key];
  return { status, now: status === "working" ? newest.text : today > 1 ? `${today} ${noun} today` : null, last: newest.text, lastAt: newest.at };
}
const BUILT_IN_NOUNS: Record<BuiltInKey, string> = { booking: "bot happenings", ship: "posts and comments", recordings: "calls with steps", board: "decisions" };

// ---------------------------------------------------------------------------------------------------------------------------
// The composed state.

export type ForumStateAgent = {
  id: string;
  /** The plot it stands on, or null for the Outer districts. */
  plot: ForumPlot | null;
  name: string;
  platform: string | null;
  role: string | null;
  link: string | null;
  status: ForumStatus;
  now: string | null;
  last: string | null;
  next: string | null;
  builtIn: BuiltInKey | null;
  isNew: boolean;
  reportedAt: string | null;
};
export type ForumState = {
  updatedAt: string | null;
  headline: string | null;
  agents: ForumStateAgent[];
  /** From and to are places ("rostra" for the member), so the map can walk the streets between them. */
  flows: { id: string; from: ForumPlot | "rostra"; to: ForumPlot | "rostra"; label: string; agentId: string; fromName: string; toName: string; at: string; reply: boolean }[];
  /** The road: each agent's milestones, in agent order. */
  queue: (ForumMilestone & { agentId: string; agent: string })[];
  waiting: { id: string; what: string; detail: string | null; when: string | null; agent: string | null; at: string }[];
  log: { at: string; who: string; text: string }[];
};

export type ComposeInput = {
  agents: { id: string; name: string; platform: string | null; role: string | null; link: string | null; plotId: string | null; builtIn: string | null; status: string; now: string | null; last: string | null; next: string | null; flowTo: string | null; flowLabel: string | null; flowAt: string | null; queue: ForumMilestone[]; confirmed: boolean; reportedAt: string | null; createdAt: string; lastCallAt?: string | null; restStatus?: string | null }[];
  builtIns: Partial<Record<BuiltInKey, BuiltInEvent[]>>;
  needs: { id: string; agentId: string | null; what: string; detail: string | null; when: string | null; createdAt: string }[];
  events: { agentId: string | null; kind: string; payload: Record<string, unknown>; at: string }[];
  /** H-52: the flow events of the last 30 minutes, newest first (the page reads up to FORUM_FLOWS_SHOWN); without them, each agent's own last flow. */
  flows?: { id: string; agentId: string | null; payload: Record<string, unknown>; at: string }[];
  headline: string | null;
  headlineAt: string | null;
  now?: Date;
};

const statusOf = (s: string): ForumStatus => ((FORUM_STATUSES as readonly string[]).includes(s) ? (s as ForumStatus) : "idle");
/** Lit by a call alone (restStatus set): working while calls keep coming, its own reported status after FORUM_AUTO_MS without one. */
export function liveStatus(a: { status: string; restStatus?: string | null; lastCallAt?: string | null }, now: Date): ForumStatus {
  if (a.restStatus && a.lastCallAt && now.getTime() - Date.parse(isoOf(a.lastCallAt)) > FORUM_AUTO_MS) return statusOf(a.restStatus);
  return statusOf(a.status);
}

/** A database stamp ("2026-10-12 05:35:00", UTC) or an ISO instant, as an ISO instant. */
export const isoOf = (stamp: string): string => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(stamp) ? `${stamp.replace(" ", "T")}Z` : stamp);

export function composeForum(input: ComposeInput): ForumState {
  const now = input.now ?? new Date();
  const rows = [...input.agents].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const agents: ForumStateAgent[] = rows.map((a) => {
    const builtIn = isBuiltIn(a.builtIn) ? a.builtIn : null;
    const live = builtIn ? builtInCard(builtIn, input.builtIns[builtIn] ?? [], now) : null;
    return {
      id: a.id,
      plot: isForumPlot(a.plotId) ? a.plotId : null,
      name: a.name,
      platform: a.platform,
      role: a.role,
      link: a.link,
      status: live ? live.status : liveStatus(a, now),
      now: live ? live.now : a.now,
      last: live ? live.last : a.last,
      next: builtIn ? null : a.next,
      builtIn,
      isNew: !a.confirmed,
      reportedAt: live?.lastAt ?? (a.reportedAt ? isoOf(a.reportedAt) : null),
    };
  });
  // Built-ins with something to show and no row yet take the lowest plots left, then the Outer districts.
  const taken = new Set(agents.map((a) => a.plot).filter(Boolean) as string[]);
  for (const key of BUILT_IN_KEYS) {
    if (rows.some((r) => r.builtIn === key)) continue;
    const live = builtInCard(key, input.builtIns[key] ?? [], now);
    if (!live) continue;
    const plot = plotFor(taken);
    if (plot) taken.add(plot);
    agents.push({ id: `builtin:${key}`, plot, name: BUILT_INS[key].name, platform: "HelixOS", role: BUILT_INS[key].role, link: null, status: live.status, now: live.now, last: live.last, next: null, builtIn: key, isNew: false, reportedAt: live.lastAt });
  }
  const byId = new Map(agents.map((a) => [a.id, a]));
  const byName = new Map(agents.map((a) => [forumNameKey(a.name), a]));

  const flows: ForumState["flows"] = [];
  const toPlace = (name: string): { place: ForumPlot | "rostra" | null; label: string } => {
    const key = forumNameKey(name);
    if (["you", "me", "rostra", "danno", "the member"].includes(key)) return { place: "rostra", label: "you" };
    const a = byName.get(key);
    return { place: a?.plot ?? null, label: a?.name ?? name };
  };
  if (input.flows) {
    // Every conversation of the last 30 minutes (H-52), newest first, each light its own.
    for (const e of [...input.flows].sort((a, b) => Date.parse(isoOf(b.at)) - Date.parse(isoOf(a.at)))) {
      if (flows.length >= FORUM_FLOWS_SHOWN) break;
      const age = now.getTime() - Date.parse(isoOf(e.at));
      if (!(age >= 0 && age <= FORUM_FLOW_MS)) continue;
      const from = e.agentId ? byId.get(e.agentId) : null;
      const to = toPlace(String(e.payload.to ?? ""));
      if (!from?.plot || !to.place || to.place === from.plot) continue;
      flows.push({ id: e.id, from: from.plot, to: to.place, label: String(e.payload.label ?? ""), agentId: from.id, fromName: from.name, toName: to.label, at: isoOf(e.at), reply: e.payload.reply === true });
    }
  } else {
    for (const a of rows) {
      if (!a.flowTo || !a.flowAt || now.getTime() - Date.parse(isoOf(a.flowAt)) > FORUM_FLOW_MS) continue;
      const from = byId.get(a.id);
      if (!from) continue;
      const to = toPlace(a.flowTo);
      if (!from.plot || !to.place || to.place === from.plot) continue;
      flows.push({ id: a.id, from: from.plot, to: to.place, label: a.flowLabel ?? "", agentId: a.id, fromName: from.name, toName: to.label, at: isoOf(a.flowAt), reply: false });
    }
  }

  const queue: ForumState["queue"] = [];
  for (const a of rows) for (const m of a.queue ?? []) queue.push({ ...m, agentId: a.id, agent: a.name });

  const waiting = [...input.needs]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((n) => ({ id: n.id, what: n.what, detail: n.detail, when: n.when, agent: n.agentId ? (byId.get(n.agentId)?.name ?? null) : null, at: isoOf(n.createdAt) }));

  const log: ForumState["log"] = [];
  for (const e of input.events) {
    const who = e.agentId ? (byId.get(e.agentId)?.name ?? "An agent") : "You";
    const text = newsLine(e.kind, e.payload);
    if (text) log.push({ at: isoOf(e.at), who, text });
  }
  for (const [key, evs] of Object.entries(input.builtIns) as [BuiltInKey, BuiltInEvent[]][]) {
    const name = agents.find((a) => a.builtIn === key)?.name ?? BUILT_INS[key].name;
    for (const e of evs ?? []) log.push({ at: isoOf(e.at), who: name, text: e.text });
  }
  log.sort((a, b) => b.at.localeCompare(a.at));

  const stamps = [log[0]?.at, input.headlineAt ? isoOf(input.headlineAt) : null, ...agents.map((a) => a.reportedAt)].filter(Boolean) as string[];
  return { updatedAt: stamps.sort().at(-1) ?? null, headline: input.headline, agents, flows, queue, waiting, log: log.slice(0, FORUM_NEWS) };
}

/** One event as a line of news, from what was saved. */
export function newsLine(kind: string, p: Record<string, unknown>): string | null {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  switch (kind) {
    case "status":
      return s("now") ?? s("last") ?? (s("status") ? `is ${s("status") === "waiting" ? "waiting on you" : s("status")}` : null);
    case "flow":
      return `sent ${s("label") ? `"${s("label")}"` : "something"} to ${s("to") ?? "another agent"}`;
    case "needs_you":
      return `needs you: ${s("what") ?? ""}`.trim();
    case "queue":
      return "updated its road";
    case "headline":
      return s("headline");
    case "removed":
      return "a value was removed because it looked like a key";
    case "member":
      return s("text");
    default:
      return null;
  }
}

/** How long ago, in the page's words: "just now", "4 min ago", "3 h ago", "2 days ago". */
export function forumAgo(iso: string, now: Date = new Date()): string {
  const m = Math.round((now.getTime() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return "";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
