/**
 * My Board, "Set it up for me" (revs 660, 664 §5): the proposed changes under an answer, built and checked here, applied only
 * after the member ticks them. The steps always become tasks (step 1 in Top 3 on its day) and the last step's date gets a
 * "Board check-in" task; the model may suggest a few more from the list below, each checked against the member's own rows:
 * a person must already be in their DMs, a number must be one they gave, a date is a working day on or after today, an offer
 * or webinar is a draft, and anything that already exists shows before → after and is never ticked for them. At most seven.
 * Pure: the server looks the rows up and passes them in.
 */
import type { BoardProposal } from "@/db/schema";
import { TARGET_METRICS } from "@/lib/engine/targets";
import { findByName, fridayWords, oohReadBack } from "@/lib/engine/voice-pack";
import { takesWords, workingDay, type BoardAnswer } from "@/lib/engine/board";

export const MAX_PROPOSALS = 7;
export const SETUP_KINDS = ["task", "checkin", "intention", "target", "followup", "content", "webinar", "offer", "proof", "office_hours"] as const;
export type SetupKind = (typeof SETUP_KINDS)[number];
/** What the model may suggest beyond the steps and the check-in. */
const SUGGESTED: SetupKind[] = ["intention", "target", "followup", "content", "webinar", "offer", "proof", "office_hours"];

export const SETUP_SHAPE = `Optionally add "setup": a list of at most 3 changes in HelixOS that would set the member up to act on this decision, only those the decision calls for. Never the steps themselves (HelixOS adds those as tasks). Each is one of:
{"kind": "intention", "word": "...", "keyResults": ["...", "...", "..."], "initiative": "...", "tasks": ["...", "...", "..."]} (this week's 3-1-3)
{"kind": "target", "metric": "${TARGET_METRICS.map((m) => m.key).join("|")}", "value": 0} (this month's target; only a number the member gave)
{"kind": "followup", "name": "first name of someone already in their DMs", "by": "YYYY-MM-DD"}
{"kind": "content", "title": "...", "hook": "...", "date": "YYYY-MM-DD or null"} (an idea, or a draft dated on the calendar)
{"kind": "webinar", "title": "...", "promise": "...", "date": "YYYY-MM-DD or null", "offer": "the name of one of their offers, or null"}
{"kind": "offer", "name": "...", "promise": "...", "price": null} (a draft offer; a price only if the member gave it)
{"kind": "proof", "name": "first name of a client already in their DMs"} (a task to ask them for a testimonial)
{"kind": "office_hours", "question": "...", "tried": "...", "outcome": "...", "category": "..."} (send the decision to Friday's Office Hours)
Never invent people, numbers, prices or dates outside the member's working week.`;

export type SetupLook = {
  today: string;
  /** The decision's own page, linked from everything it creates. */
  link: string;
  question: string;
  /** Everything the member gave or the Board read, for the numbers check. */
  known: string;
  intention: { word: string; keyResults: string[]; initiative: string; tasks: string[] } | null;
  month: string;
  targets: Record<string, number>;
  contacts: { id: string; name: string; stage: string; nextFollowUpAt: string | null }[];
  offers: { id: string; name: string }[];
  oohCategories: string[];
  fridays: string[];
};

const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const first = (name: string) => name.trim().split(/\s+/)[0] || name.trim();
/** A date the member can act on: a real date on or after today, moved off a weekend; none given stays none. */
const actDay = (raw: unknown, today: string): string | null => {
  const d = s(raw, 10);
  if (!DATE.test(d)) return null;
  return workingDay(d < today ? today : d);
};
const dayWords = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** The task category a step reads as. */
export function categoryFor(text: string): "sales" | "content" | "community" | "admin" {
  if (/\b(post|content|reel|video|ladder|caption|carousel|story|stories|email|newsletter|webinar slides?)\b/i.test(text)) return "content";
  if (/\b(group|community|members?|event)\b/i.test(text)) return "community";
  if (/\b(dm|dms|message|messages|call|calls|follow.?up|outreach|reach out|offer|price|sell|sales|lead|prospect|book)\b/i.test(text)) return "sales";
  return "admin";
}
/** A number the member gave: its digits appear in their question or in what the Board read. */
const given = (n: number, known: string) => {
  const digits = String(n).replace(/\.0+$/, "");
  const all = known.replace(/(\d),(\d)/g, "$1$2");
  return new RegExp(`(^|[^\\d])${digits.replace(".", "\\.")}([^\\d]|$)`).test(all) || (n >= 1000 && n % 1000 === 0 && new RegExp(`(^|[^\\d])${n / 1000}\\s?k\\b`, "i").test(all));
};

/** Whether a proposal starts ticked: never one that changes something that exists, never one that goes to the coach. */
export const tickedByDefault = (p: BoardProposal) => !p.before && p.kind !== "office_hours";

export type Built = { proposals: BoardProposal[]; notes: string[] };

/** The proposals under one answer, in order: the steps, the check-in, then what the model suggested and the checks kept. */
export function buildProposals(a: BoardAnswer, setup: unknown, look: SetupLook): Built {
  const out: BoardProposal[] = [];
  const notes: string[] = [];
  const add = (p: Omit<BoardProposal, "id">) => out.push({ id: `p${out.length + 1}`, ...p });
  const from = `From My Board: ${look.link}`;

  a.steps.forEach((step, i) => {
    const details = [`Done when: ${step.doneWhen}`, `First 5 minutes: ${step.first5}`, from].join("\n");
    add({ kind: "task", title: step.do, detail: `${i === 0 ? "Top 3 on " : "Task on "}${dayWords(step.by)} · ${takesWords(step.takesMinutes)}`, payload: { step: i, title: step.do, details, urgency: i === 0 ? "top3" : "high", category: categoryFor(step.do), dueDate: step.by } });
  });
  if (a.steps.length) {
    const last = a.steps.reduce((d, x) => (x.by > d ? x.by : d), a.steps[0].by);
    add({ kind: "checkin", title: "Board check-in", detail: `A task on ${dayWords(last)} to say how the steps went`, payload: { title: `Board check-in: ${s(a.decision, 120)}`, details: from, dueDate: last } });
  }

  const list = Array.isArray(setup) ? setup : [];
  const seen = new Set<string>();
  for (const raw of list) {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = s(o.kind, 20) as SetupKind;
    if (!SUGGESTED.includes(kind)) continue;
    if (out.length >= MAX_PROPOSALS) {
      notes.push(`Jordan kept the set-up to ${MAX_PROPOSALS} changes, so "${s(o.title ?? o.name ?? o.kind, 80)}" was left out.`);
      continue;
    }
    if (kind === "intention") {
      if (seen.has("intention")) continue;
      const word = s(o.word, 40);
      const krs = (Array.isArray(o.keyResults) ? o.keyResults : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 3);
      const initiative = s(o.initiative, 300);
      const tasks = (Array.isArray(o.tasks) ? o.tasks : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 3);
      if (!word || krs.length !== 3 || !initiative || tasks.length !== 3) continue;
      seen.add("intention");
      const was = look.intention;
      add({ kind, title: "This week's 3-1-3", detail: `${word}: ${krs.join("; ")}`, before: was ? `${was.word}: ${was.keyResults.join("; ")}` : null, after: was ? `${word}: ${krs.join("; ")}` : null, payload: { word, keyResults: krs, initiative, tasks } });
    } else if (kind === "target") {
      const metric = TARGET_METRICS.find((m) => m.key === s(o.metric, 40));
      const value = Number(o.value);
      if (!metric || !(value > 0) || seen.has(`target:${metric.key}`)) continue;
      if (!given(value, `${look.question}\n${look.known}`)) {
        notes.push(`Left out a ${metric.label.toLowerCase()} target of ${value}: that number isn't one you gave.`);
        continue;
      }
      seen.add(`target:${metric.key}`);
      const was = look.targets[metric.key];
      const words = (n: number) => (metric.money ? `$${n.toLocaleString("en-US")}` : String(n));
      add({ kind, title: `${metric.label} target for this month`, detail: words(value), before: was ? `${metric.label}: ${words(was)}` : null, after: was ? `${metric.label}: ${words(value)}` : null, payload: { metric: metric.key, value, month: look.month } });
    } else if (kind === "followup" || kind === "proof") {
      const said = s(o.name, 80);
      const found = findByName(look.contacts, said);
      const c = "one" in found ? found.one : null;
      if (!c) {
        if (said) notes.push(`Left out ${kind === "proof" ? "a testimonial ask" : "a follow-up"} for "${said}": ${"several" in found ? "more than one person in your DMs has that name" : "they aren't in your DMs"}.`);
        continue;
      }
      if (seen.has(`${kind}:${c.id}`)) continue;
      seen.add(`${kind}:${c.id}`);
      if (kind === "followup") {
        if (c.stage === "cold" || c.stage === "client") continue;
        const by = actDay(o.by, look.today) ?? workingDay(look.today);
        add({ kind, title: `Follow up with ${first(c.name)}`, detail: `By ${dayWords(by)}, with a task in Sales`, before: c.nextFollowUpAt ? `Follow up ${dayWords(c.nextFollowUpAt)}` : null, after: c.nextFollowUpAt ? `Follow up ${dayWords(by)}` : null, payload: { contactId: c.id, by } });
      } else {
        const due = workingDay(look.today);
        add({ kind, title: `Ask ${first(c.name)} for a testimonial`, detail: `A task on ${dayWords(due)}; nothing goes in your Proof Bank until they give one`, payload: { contactId: c.id, title: `Ask ${c.name} for a testimonial`, details: from, dueDate: due } });
      }
    } else if (kind === "content") {
      const title = s(o.title, 200);
      if (!title) continue;
      const date = actDay(o.date, look.today);
      add({ kind, title: date ? `Draft post: ${title}` : `Content idea: ${title}`, detail: date ? `A draft on your calendar for ${dayWords(date)}, never posted` : "On your content board as an idea", payload: { title, hook: s(o.hook, 400) || null, date, notes: from } });
    } else if (kind === "webinar") {
      if (seen.has("webinar")) continue;
      const title = s(o.title, 200);
      if (!title) continue;
      seen.add("webinar");
      const date = actDay(o.date, look.today);
      const offerSaid = s(o.offer, 120);
      const offer = offerSaid ? (() => {
        const f = findByName(look.offers, offerSaid);
        return "one" in f ? f.one : null;
      })() : null;
      add({ kind, title: `Draft webinar: ${title}`, detail: [date ? `for ${dayWords(date)}` : "no date yet", offer ? `with ${offer.name}` : null, "a draft until you build it"].filter(Boolean).join(", "), payload: { title, promise: s(o.promise, 400) || null, date, offerId: offer?.id ?? null } });
    } else if (kind === "offer") {
      if (seen.has("offer")) continue;
      const name = s(o.name, 120);
      if (!name) continue;
      seen.add("offer");
      let price = o.price == null ? null : Number(o.price);
      if (price != null && !(price > 0 && given(price, `${look.question}\n${look.known}`))) {
        notes.push(`The draft offer "${name}" has no price: the Board never sets one you didn't give.`);
        price = null;
      }
      add({ kind, title: `Draft offer: ${name}`, detail: `Marked "Draft from Board"${price ? `, $${price.toLocaleString("en-US")}` : ", no price"}; not live, not on your bot`, payload: { name, promise: s(o.promise, 400) || null, price } });
    } else if (kind === "office_hours") {
      if (seen.has("office_hours") || !look.fridays.length || !look.oohCategories.length) continue;
      const question = s(o.question, 2000) || look.question;
      const tried = s(o.tried, 2000);
      const outcome = s(o.outcome, 1000);
      if (question.length < 3 || tried.length < 3 || outcome.length < 3) continue;
      seen.add("office_hours");
      // The category it named when it's one of the workspace's; else "Other" when there is one, never a guess at another.
      const category = look.oohCategories.find((c) => c.toLowerCase() === s(o.category, 80).toLowerCase()) ?? look.oohCategories.find((c) => c.toLowerCase() === "other") ?? look.oohCategories[0];
      const friday = look.fridays[0];
      add({ kind, title: `Ask at Office Hours, ${fridayWords(friday)}`, detail: oohReadBack({ question, tried, outcome, category, friday, tools: null }).split("\n").slice(0, -1).join("\n"), payload: { question, tried, outcome, category, friday } });
    }
  }
  return { proposals: out, notes };
}

/** What board_apply reads back before the member's yes. */
export function setupReadBack(ps: BoardProposal[]): string {
  return ps.map((p, i) => `${i + 1}. ${p.title}${p.before && p.after ? ` (${p.before} → ${p.after})` : p.detail ? `: ${p.detail.split("\n")[0]}` : ""}`).join("\n");
}
