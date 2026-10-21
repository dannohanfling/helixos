/**
 * Report statuses that tell the member (H-202, Danno's own words): the five statuses, a report's topic in 3 to 6 words, and the
 * four replies prefilled in Danno's voice. Pure; covered by src/lib/engine/__tests__/report-status.test.ts.
 */
import type { ReportStatus } from "@/db/schema";

export const STATUS_WORDS: Record<ReportStatus, string> = { new: "New", seen: "Seen", working: "Working on it", done: "Done", not_now: "Not now" };
/** The statuses a coach replies with, in order; New is only ever where a report starts (or returns to on a follow-up). */
export const REPLY_STATUSES = ["seen", "working", "done", "not_now"] as const satisfies readonly ReportStatus[];
export type ReplyStatus = (typeof REPLY_STATUSES)[number];
/** The two blanks a coach must fill before Done or Not now can go. */
export const HOW_BLANK = "[how it was fixed, one line]";
export const REASON_BLANK = "[the reason]";
/** The instant receipt on submit: on screen and on the report, never emailed. */
export const receiptLine = (coach: string): string => `Got it, ${coach} will see this soon.`;

/** A report's topic: the coach's own words when set, else the first 3 to 6 words of what the member wrote, without a trailing stop. */
export function topicOf(r: { topic: string | null; description: string; question: string | null }): string {
  if (r.topic?.trim()) return r.topic.trim();
  const words = (r.description || r.question || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return "your note";
  const cut = words.slice(0, 6).join(" ").replace(/[.,;:!?]+$/, "");
  return cut.length > 60 ? `${cut.slice(0, 57).trimEnd()}…` : cut;
}

/** Danno's four replies (H-202), prefilled and editable; Done and Not now carry a blank the coach fills. */
export function replyText(status: ReplyStatus, v: { first: string; topic: string }): string {
  switch (status) {
    case "seen":
      return `Thanks, ${v.first}. I've got your note about ${v.topic} and I'm on it.`;
    case "working":
      return `Quick update: we're fixing ${v.topic} now. I'll let you know when it's live.`;
    case "done":
      return `Done: ${v.topic} is fixed. ${HOW_BLANK}. Thanks for flagging it!`;
    case "not_now":
      return `Thanks for the idea about ${v.topic}. We're holding it for now because ${REASON_BLANK}.`;
  }
}

/** A reply as typed: trimmed, at most 2,000 characters; refused while empty or while a blank is still in it. */
export function readReply(status: ReplyStatus, raw: string): { text: string } | { error: string } {
  const text = raw.replace(/\r\n/g, "\n").trim().slice(0, 2000);
  if (!text) return { error: "Write the message first." };
  if (text.includes(HOW_BLANK)) return { error: "Say how it was fixed, in one line, in place of the brackets." };
  if (text.includes(REASON_BLANK) || (status === "not_now" && /because\s*\.?$/.test(text))) return { error: "Give the reason in place of the brackets: Not now always says why." };
  return { text };
}

/** The member's first name, for "Thanks, {first name}". */
export const firstName = (name: string | null | undefined): string => (name ?? "").trim().split(/\s+/)[0] || "there";
