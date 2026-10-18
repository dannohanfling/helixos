/**
 * Voice pack 2 (rev 642), the pure parts: finding a person, a script or a call by the words a member says, the DMs page's stage
 * words, a day said aloud, the proof as saved (the member's words and numbers kept exactly), the 30-second call sheet, and the
 * Office Hours read-back. Nothing here reads the database.
 */
import { CONTACT_STAGES, CONTENT_TYPES } from "@/db/schema";
import { addDays, formatDate, weekday } from "@/lib/dates";
import type { CallSheet } from "@/lib/engine/socrates";

type Stage = (typeof CONTACT_STAGES)[number];
const norm = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();

export type Found<T> = { one: T } | { several: T[] } | { none: true };
/**
 * A person (or a script) by what was said. An exact name wins outright; else every row whose name holds all the words said
 * (as word starts); one is found, several are read back, none is none. Never a guess between two.
 */
export function findByName<T extends { name: string }>(rows: readonly T[], said: string): Found<T> {
  const want = norm(said);
  if (!want) return { none: true };
  const exact = rows.filter((r) => norm(r.name) === want);
  if (exact.length === 1) return { one: exact[0] };
  if (exact.length > 1) return { several: exact };
  const words = want.split(" ");
  const hits = rows.filter((r) => {
    const name = norm(r.name).split(" ");
    return words.every((w) => name.some((n) => n.startsWith(w)));
  });
  if (hits.length === 1) return { one: hits[0] };
  if (hits.length > 1) return { several: hits };
  return { none: true };
}

/** The DMs page's own stage names, and the ways a member says them. */
export const STAGE_WORDS: Record<Stage, string> = { new: "Reached out", replied: "Replied", conversation: "In conversation", call_booked: "Call booked", no_show: "No-show", client: "Client", cold: "Cold" };
const STAGE_SAID: [RegExp, Stage][] = [
  [/^(reached out|new|messaged|sent)$/, "new"],
  [/^(replied|reply|answered)$/, "replied"],
  [/^(in conversation|conversation|talking|chatting)$/, "conversation"],
  [/^(call booked|booked|booked a call|call)$/, "call_booked"],
  [/^(no show|no-show|noshow|didn't show|did not show|missed the call)$/, "no_show"],
  [/^(client|signed|closed|won)$/, "client"],
  [/^(cold|lost|not interested|dead)$/, "cold"],
];
export function stageFrom(said: string | null | undefined): Stage | null {
  const s = norm(said ?? "").replace(/_/g, " ");
  if (!s) return null;
  return STAGE_SAID.find(([re]) => re.test(s))?.[1] ?? null;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/**
 * A day as said: YYYY-MM-DD, today, tomorrow, a weekday (the next one after today), or "in N days". Null when it can't be read,
 * so the tool asks rather than guesses.
 */
export function dayFrom(said: string | null | undefined, today: string): string | null {
  const s = norm(said ?? "");
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test((said ?? "").trim())) return (said ?? "").trim();
  if (s === "today") return today;
  if (s === "tomorrow") return addDays(today, 1);
  const inDays = s.match(/^in (\d{1,3}) days?$/);
  if (inDays) return addDays(today, Number(inDays[1]));
  if (s === "next week") return addDays(today, 7);
  const day = DAYS.findIndex((d) => s === d || s === `next ${d}` || s === `on ${d}` || s === d.slice(0, 3));
  if (day >= 0) return addDays(today, ((day - weekday(today) + 6) % 7) + 1);
  return null;
}

/** "Thursday, Oct 15" for a day within the week, else "Oct 15"; today and tomorrow by name. */
export function dayWords(d: string, today: string): string {
  if (d === today) return "today";
  if (d === addDays(today, 1)) return "tomorrow";
  const name = DAYS[weekday(d)];
  return d > today && d <= addDays(today, 6) ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : formatDate(d);
}

/** "Friday the 17th"; the day is the session's (H-457: Friday unless the coach moves it). */
export function fridayWords(d: string, day = "Friday"): string {
  const n = Number(d.slice(8, 10));
  const th = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${day} the ${n}${th}`;
}

/**
 * One of the next sessions by what was said: a date, "the 17th", "this Friday", "next Friday"; blank is the first. `names`
 * are the day names that count ("thursday" for the host, "friday" for a member in Sydney); `localDate` gives a session's
 * date in the member's own calendar, so "the 30th" finds the session they see on the 30th.
 */
export function fridayFrom(said: string | null | undefined, fridays: readonly string[], names: readonly string[] = ["friday"], localDate: (f: string) => string = (f) => f): string | null {
  const raw = (said ?? "").trim();
  const s = norm(raw);
  const named = (x: string) => names.some((n) => x === n || x === `this ${n}` || x === `next ${n}`);
  if (!s || s === "next" || s === "the next one" || named(s)) return fridays[0] ?? null;
  if (fridays.includes(raw)) return raw;
  const local = fridays.find((f) => localDate(f) === raw);
  if (local) return local;
  const day = s.match(/(\d{1,2})(st|nd|rd|th)?\b/);
  if (day) return fridays.find((f) => Number(localDate(f).slice(8, 10)) === Number(day[1])) ?? fridays.find((f) => Number(f.slice(8, 10)) === Number(day[1])) ?? null;
  return null;
}

/** What a format hint maps to on the Content board, else a plain CTA post. */
export function contentTypeFrom(hint: string | null | undefined): (typeof CONTENT_TYPES)[number] {
  const s = norm(hint ?? "");
  if (!s) return "CTA Post";
  const exact = CONTENT_TYPES.find((t) => norm(t) === s);
  if (exact) return exact;
  const rules: [RegExp, (typeof CONTENT_TYPES)[number]][] = [
    [/ladder/, "Comment Ladder"],
    [/win|testimonial|result/, "Client Win"],
    [/story/, "Story Post"],
    [/belief|myth/, "Belief Shifting Post"],
    [/tip|quick win|how to/, "Quick Win / Pro-Tip"],
    [/question|poll/, "Question Post"],
    [/hype/, "Hype Post"],
    [/live/, "LIVE Video"],
    [/email|newsletter/, "Email"],
    [/reel|short|tiktok/, "Short Form Video"],
    [/video|youtube/, "Long Form Video"],
  ];
  return rules.find(([re]) => re.test(s))?.[1] ?? "CTA Post";
}

export type ProofSaid = { who?: string | null; result: string; numbers?: string | null; date?: string | null; source?: string | null };
/**
 * The proof as saved: the result and the numbers word for word (the numbers added after the result only when the result doesn't
 * already carry them), the date and where it came from as tags. Nothing is tidied, rounded or summarised.
 */
export function proofFrom(p: ProofSaid): { name: string; who: string | null; resultAfter: string; tags: string[] } {
  const result = p.result.trim();
  const numbers = (p.numbers ?? "").trim();
  const resultAfter = numbers && !result.includes(numbers) ? `${result} (${numbers})` : result;
  const who = (p.who ?? "").trim() || null;
  const short = result.length > 60 ? `${result.slice(0, 57).trimEnd()}...` : result;
  const tags = [(p.date ?? "").trim(), (p.source ?? "").trim().toLowerCase()].filter(Boolean);
  return { name: who ? `${who}: ${short}` : short, who, resultAfter, tags: [...new Set(tags)] };
}

const firstLine = (text: string) => text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
/** The 30-second version: the first line of the first five beats, and up to three things to listen for. */
export function quickSheet(sheet: CallSheet): { lines: string[]; listenFors: string[] } {
  const lines = sheet.beats.slice(0, 5).flatMap((b) => (b.you[0] ? [`${b.name}: ${firstLine(b.you[0])}`] : []));
  const listenFors = sheet.beats.flatMap((b) => (b.listenFor ? [firstLine(b.listenFor)] : [])).slice(0, 3);
  return { lines, listenFors };
}

/** The full sheet for reading aloud, beat by beat in the order it's used: no rules, no writing space. */
export function sheetForVoice(sheet: CallSheet): string {
  const out: string[] = [];
  for (const b of sheet.beats) {
    const part = [`${b.n}. ${b.name}`, ...b.you.map((y) => `Say: ${y}`), ...b.followUps.map((f) => `Follow-up: ${f}`), ...b.reframes.map((r) => `Reframe (${r.name}): ${r.said}`)];
    if (b.listenFor) part.push(`Listen for: ${b.listenFor}`);
    for (const br of b.branches) part.push(`If ${br.condition.replace(/^if\s+/i, "")}: ${br.lines.map((l) => `${l.said} (${l.name})`).join(" / ")}`);
    out.push(part.join("\n"));
  }
  return out.join("\n\n");
}

/** `when` is the session as the member reads it ("Fri 30 Oct, 11:00 AM AEDT", H-457); without it, the host's date in words. */
export type OohSaid = { question: string; tried: string; outcome: string; category: string; friday: string; tools?: string | null; when?: string };
/** The read-back before an Office Hours request goes to the coach; the yes to it is the promise to attend. */
export function oohReadBack(r: OohSaid): string {
  const when = r.when ?? fridayWords(r.friday);
  return [`Your Office Hours request for ${when}, under ${r.category}:`, `The question: ${r.question}`, `What you've tried: ${r.tried}`, `The outcome you want: ${r.outcome}`, r.tools ? `Tools: ${r.tools}` : "", `It goes to your coach, and you'll be there on ${when}. Shall I send it?`].filter(Boolean).join("\n");
}

/** A recording by what was said: latest (or nothing), a date, or words from its title; the newest match. */
export function pickCall<T extends { startedAt: string | null; title: string; clearTitle: string | null; createdAt: string }>(rows: readonly T[], said: string | null | undefined, dayOf: (iso: string) => string): T | null {
  const s = norm(said ?? "");
  const newest = [...rows].sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt));
  if (!s || s === "latest" || s === "last" || s === "the last one" || s === "my last call") return newest[0] ?? null;
  const date = (said ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return newest.find((r) => r.startedAt && dayOf(r.startedAt) === date) ?? null;
  const words = s.split(" ").filter((w) => w.length > 1 && !["the", "call", "my", "last", "latest", "from", "on"].includes(w));
  if (!words.length) return newest[0] ?? null;
  return newest.find((r) => words.every((w) => norm(`${r.clearTitle ?? ""} ${r.title}`).includes(w))) ?? null;
}
