/**
 * Past monthly feedback and Office Hours requests from the Omnichannel Airtable base, into Coach → Monthly feedback and each
 * member's Office Hours history (handoff rev 441, tables named by main in rev 460). Pure: the page reads the rows (GET only, the
 * token used for that run and kept nowhere) and what HelixOS already holds; this decides what each row becomes, or why it stays
 * out, and the dry run shows exactly that. The members' words go in as they wrote them: nothing here rewords them. A month the
 * member already has in HelixOS is theirs and is never overwritten; an Office Hours row is matched on its Airtable record id,
 * so a second run adds nothing.
 */
import { field, num, option, text, type AirtableRecord } from "@/lib/engine/airtable-import";
import { feedbackMonth } from "@/lib/engine/feedback";
import { OOH_CATEGORIES_DEFAULT } from "@/lib/engine/office-hours";

/** The tables read, by key: the two backfilled, and the members table for its email field alone. */
export const FEEDBACK_TABLE = "client feedback";
export const SUPPORT_TABLE = "client support";
/** `❤️ Fulfillment` and its email field, by id, so the people table gives the importer nothing but emails. */
export const MEMBERS_TABLE_ID = "tblxCBKthZ4EmmV6Y";
export const MEMBER_EMAIL_FIELD = "fld3PV6STUBAFyfeT";
/** The base the backfill was written for (rev 441); the form starts with it. */
export const OMNICHANNEL_BASE = "appw8wwbqmpZBt1ff";

export type Member = { userId: string; email: string; name: string };
export type BackfillSource = { feedback: AirtableRecord[]; support: AirtableRecord[]; emails: Map<string, string> };
export type BackfillExisting = { feedbackMonths: Set<string>; oohIds: Set<string> };
type Status = "new" | "already";

export type FeedbackRow = {
  recordId: string;
  userId: string;
  who: string;
  month: string;
  proud: string;
  love: string;
  less: string;
  more: string;
  wow: string;
  referralScore: number;
  referral: string | null;
  favorite: string | null;
  /** When it was sent, so old rows never light up the coach's "new" count. */
  createdAt: string;
  status: Status;
  /** ✨ Improve has no column: it stays in Airtable, and the dry run says so. */
  improveLeft: boolean;
};
export type OohRow = {
  recordId: string;
  userId: string;
  who: string;
  friday: string;
  description: string;
  triedSelf: string;
  tools: string | null;
  goal: string;
  category: string;
  responsible: string | null;
  outcome: "covered" | "no_show" | null;
  coachNotes: string | null;
  createdAt: string;
  status: Status;
};
export type Skipped = { table: "Monthly feedback" | "Office Hours"; recordId: string; who: string; why: string };
export type BackfillPlan = { feedback: FeedbackRow[]; ooh: OohRow[]; skipped: Skipped[] };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE = /^\d{4}-\d{2}-\d{2}/;
const lc = (s: string) => s.trim().toLowerCase();
/** "2026-09-04T10:22:00.000Z" → "2026-09-04 10:22:00", the form the app's own created_at takes. */
const stamp = (iso: string): string => iso.replace("T", " ").replace(/\.\d+Z?$|Z$/, "").slice(0, 19);
const dayOf = (r: AirtableRecord, ...keys: string[]): string | null => {
  const v = text(r, ...keys);
  return DATE.test(v) ? v.slice(0, 10) : null;
};

/**
 * The month a feedback row is about. The form's own 🗓 Month wins, in the year that puts it at or before the day it was sent (a
 * December answer sent on 3 January is last year's December); without it, the app's own window rule; mid-month, the month sent.
 */
export function feedbackMonthOf(sentOn: string, monthWord: string): string {
  const named = MONTHS.indexOf(lc(option(monthWord)));
  if (named >= 0) {
    const year = Number(sentOn.slice(0, 4));
    const sentMonth = Number(sentOn.slice(5, 7)) - 1;
    return `${named > sentMonth ? year - 1 : year}-${String(named + 1).padStart(2, "0")}`;
  }
  return feedbackMonth(sentOn) ?? sentOn.slice(0, 7);
}

/** "Funnels" lands on the form's own "Funnels"; anything else is kept as written. */
export function oohCategory(word: string): string {
  const w = option(word);
  return OOH_CATEGORIES_DEFAULT.find((c) => lc(c) === lc(w)) ?? (w || "Other");
}

/** Covered or no-show from the row's status words; anything else is left for the coach. */
export function oohOutcome(status: string): "covered" | "no_show" | null {
  const s = lc(status);
  if (/no.?show|didn.?t (show|attend)|missed/.test(s)) return "no_show";
  if (/resolved|complete|covered|done|attended|answered/.test(s)) return "covered";
  return null;
}

function memberFor(r: AirtableRecord, emails: Map<string, string>, byEmail: Map<string, Member>, emailKeys: string[], linkKeys: string[]): Member | null {
  for (const line of text(r, ...emailKeys).split("\n")) {
    const m = byEmail.get(lc(line));
    if (m) return m;
  }
  const links = field(r, ...linkKeys);
  for (const id of Array.isArray(links) ? links : []) {
    const m = typeof id === "string" ? byEmail.get(lc(emails.get(id) ?? "")) : undefined;
    if (m) return m;
  }
  return null;
}

export function buildBackfill(src: BackfillSource, members: Member[], existing: BackfillExisting): BackfillPlan {
  const byEmail = new Map(members.map((m) => [lc(m.email), m]));
  const skipped: Skipped[] = [];

  // Monthly feedback: one per member per month. Two Airtable rows for the same month keep the later one.
  const feedback = new Map<string, FeedbackRow>();
  for (const r of src.feedback) {
    const m = memberFor(r, src.emails, byEmail, ["email"], ["member card", "member"]);
    const who = m?.name ?? "someone not in HelixOS";
    if (!m) {
      skipped.push({ table: "Monthly feedback", recordId: r.id, who, why: "No HelixOS member has this row's email." });
      continue;
    }
    const answers = { proud: text(r, "proud"), love: text(r, "love"), less: text(r, "less"), more: text(r, "more"), wow: text(r, "wow") };
    if (!Object.values(answers).some(Boolean)) {
      skipped.push({ table: "Monthly feedback", recordId: r.id, who, why: "No answers in it." });
      continue;
    }
    const nps = num(r, "nps");
    if (nps == null || Math.round(nps) < 1 || Math.round(nps) > 10) {
      skipped.push({ table: "Monthly feedback", recordId: r.id, who, why: nps == null ? "No referral score (HelixOS needs 1 to 10)." : `Referral score ${nps} is outside 1 to 10.` });
      continue;
    }
    const sentOn = dayOf(r, "date") ?? r.createdTime.slice(0, 10);
    const month = feedbackMonthOf(sentOn, text(r, "month"));
    const row: FeedbackRow = {
      recordId: r.id,
      userId: m.userId,
      who,
      month,
      ...answers,
      referralScore: Math.round(nps),
      referral: text(r, "referrals") || null,
      favorite: text(r, "favorite") || null,
      createdAt: dayOf(r, "date") ? `${sentOn} 12:00:00` : stamp(r.createdTime),
      status: existing.feedbackMonths.has(`${m.userId}|${month}`) ? "already" : "new",
      improveLeft: Boolean(text(r, "improve")),
    };
    const key = `${m.userId}|${month}`;
    const before = feedback.get(key);
    if (before) {
      const [keep, drop] = before.createdAt >= row.createdAt ? [before, row] : [row, before];
      feedback.set(key, keep);
      skipped.push({ table: "Monthly feedback", recordId: drop.recordId, who, why: `A later answer for ${month} is the one kept.` });
    } else feedback.set(key, row);
  }

  const ooh: OohRow[] = [];
  for (const r of src.support) {
    const m = memberFor(r, src.emails, byEmail, ["email"], ["member"]);
    const who = m?.name ?? (text(r, "client") || "someone not in HelixOS");
    if (!m) {
      skipped.push({ table: "Office Hours", recordId: r.id, who, why: "No HelixOS member has this row's email." });
      continue;
    }
    // Two generations of the form: today's questions, and the older Core Question / Description / Solution Attempts.
    const obstacle = text(r, "please explain the obstacle at hand");
    const older = text(r, "description");
    const core = text(r, "core question");
    const anything = text(r, "anything else");
    const description = [obstacle || older || core, anything ? `Anything else: ${anything}` : ""].filter(Boolean).join("\n\n");
    const goal = text(r, "what is the solution we are trying to achieve on our call?") || (obstacle || older ? core : "");
    if (!description && !goal) {
      skipped.push({ table: "Office Hours", recordId: r.id, who, why: "No question in it." });
      continue;
    }
    const created = text(r, "time created");
    const notes = [text(r, "notes"), text(r, "loom") ? `Loom: ${text(r, "loom")}` : ""].filter(Boolean).join("\n\n");
    ooh.push({
      recordId: r.id,
      userId: m.userId,
      who,
      friday: dayOf(r, "workshop date") ?? (DATE.test(created) ? created.slice(0, 10) : r.createdTime.slice(0, 10)),
      description,
      triedSelf: text(r, "what have you done to try to solve the issue?") || text(r, "solution attempts"),
      tools: text(r, "what tools are necessary?") || null,
      goal,
      category: oohCategory(text(r, "category") || text(r, "type")),
      responsible: text(r, "responsible") || null,
      outcome: oohOutcome(text(r, "status")),
      coachNotes: notes || null,
      createdAt: stamp(DATE.test(created) ? created : r.createdTime),
      status: existing.oohIds.has(r.id) ? "already" : "new",
    });
  }
  return { feedback: [...feedback.values()].sort((a, b) => a.month.localeCompare(b.month) || a.who.localeCompare(b.who)), ooh: ooh.sort((a, b) => a.friday.localeCompare(b.friday) || a.who.localeCompare(b.who)), skipped };
}

export type BackfillSummary = { feedbackNew: number; feedbackAlready: number; oohNew: number; oohAlready: number; skipped: number; improveLeft: number; members: number };
export function backfillSummary(p: BackfillPlan): BackfillSummary {
  const fresh = [...p.feedback.filter((x) => x.status === "new"), ...p.ooh.filter((x) => x.status === "new")];
  return {
    feedbackNew: p.feedback.filter((x) => x.status === "new").length,
    feedbackAlready: p.feedback.filter((x) => x.status === "already").length,
    oohNew: p.ooh.filter((x) => x.status === "new").length,
    oohAlready: p.ooh.filter((x) => x.status === "already").length,
    skipped: p.skipped.length,
    improveLeft: p.feedback.filter((x) => x.status === "new" && x.improveLeft).length,
    members: new Set(fresh.map((x) => x.userId)).size,
  };
}
