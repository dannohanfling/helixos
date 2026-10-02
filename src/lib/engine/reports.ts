/**
 * "I have an issue or a suggestion" (rev 432, items 2 to 4), the rules with no database in them: what a report must carry, the
 * words for its kinds and colours, which screenshot bytes are an image, and what counts as new monthly feedback for a coach.
 * Covered by src/lib/engine/__tests__/reports.test.ts.
 */
import { MEMBER_REPORT_KINDS, REPORT_SEVERITIES, type MemberReportKind, type ReportSeverity } from "@/db/schema";

export const KIND_LABEL: Record<MemberReportKind, string> = { issue: "Something isn't working", suggestion: "An idea or a suggestion", ask_danno: "An Ask Danno answer was wrong" };
export const KIND_SHORT: Record<MemberReportKind, string> = { issue: "Issue", suggestion: "Suggestion", ask_danno: "Ask Danno answer" };
export const SEVERITY_LABEL: Record<ReportSeverity, string> = { red: "Blocking me", orange: "Annoying", green: "An idea" };
/** The longest a description, a question or an answer may be. */
export const TEXT_MAX = 4000;
/** A screenshot, after the browser has shrunk it: comfortably under the 1 MB a form may send. */
export const SCREENSHOT_MAX_BYTES = 950_000;

export type ReportInput = { kind: string; severity: string; description: string; page: string; question: string; answer: string; talkToCoach: boolean };
export type ReportValue = { kind: MemberReportKind; severity: ReportSeverity; description: string; page: string | null; question: string | null; answer: string | null; talkToCoach: boolean };

/** The page, as a path inside the app: no query (it can carry a token), no other site. */
export function pagePath(raw: string): string | null {
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  const path = s.split(/[?#]/)[0].slice(0, 300);
  return /^\/[\w\-./[\]%@~]*$/.test(path) ? path : null;
}

/**
 * What a report needs: a kind and a colour from the lists; a description, except for an Ask Danno answer, which needs the
 * question and the answer instead (its description is optional). Talking to the coach is offered only on an Ask Danno answer.
 */
export function readReport(raw: ReportInput): { value: ReportValue } | { error: string; field?: string } {
  const kind = MEMBER_REPORT_KINDS.find((k) => k === raw.kind);
  if (!kind) return { error: "Pick what this is: something not working, an idea, or an Ask Danno answer.", field: "kind" };
  const severity = REPORT_SEVERITIES.find((s) => s === raw.severity) ?? (kind === "suggestion" ? "green" : null);
  if (!severity) return { error: "Pick how much it gets in your way.", field: "severity" };
  const description = raw.description.trim().slice(0, TEXT_MAX);
  const question = raw.question.trim().slice(0, TEXT_MAX);
  const answer = raw.answer.trim().slice(0, TEXT_MAX);
  if (kind === "ask_danno") {
    if (!question) return { error: "Paste the question you asked Ask Danno.", field: "question" };
    if (!answer) return { error: "Paste the answer it gave you.", field: "answer" };
  } else if (!description) {
    return { error: kind === "issue" ? "Say what happened, in a sentence or two." : "Say what you'd like, in a sentence or two.", field: "description" };
  }
  return { value: { kind, severity, description, page: pagePath(raw.page), question: kind === "ask_danno" ? question : null, answer: kind === "ask_danno" ? answer : null, talkToCoach: kind === "ask_danno" && raw.talkToCoach } };
}

/** An image, by its first bytes, never by the name or the browser's word: PNG, JPEG, WebP or GIF. */
export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 12 && String.fromCharCode(b(0), b(1), b(2), b(3)) === "RIFF" && String.fromCharCode(b(8), b(9), b(10), b(11)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (bytes.length >= 6 && String.fromCharCode(b(0), b(1), b(2), b(3), b(4)) === "GIF89" || (bytes.length >= 6 && String.fromCharCode(b(0), b(1), b(2), b(3), b(4)) === "GIF87")) return { mime: "image/gif", ext: "gif" };
  return null;
}

/** Where a report's screenshot lives in the private store: its own tree, outside proofs/ and deck/, which their sweeps reconcile. */
export const reportScreenshotKey = (workspaceId: string, reportId: string, ext: string) => `reports/${workspaceId}/${reportId}.${ext}`;

/** A stored time as milliseconds, whichever way it was written ("2026-10-03 14:00:00" by SQLite, or an ISO string). */
export function timeOf(stamp: string | null | undefined): number {
  if (!stamp) return 0;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp) ? `${stamp.replace(" ", "T")}Z` : stamp);
  return Number.isFinite(t) ? t : 0;
}

/** Monthly feedback sent or changed since the coach last opened the page: everything, the first time. */
export function newFeedbackCount(rows: { createdAt: string; updatedAt: string }[], seenAt: string | null | undefined): number {
  const since = timeOf(seenAt);
  return rows.filter((r) => Math.max(timeOf(r.createdAt), timeOf(r.updatedAt)) > since).length;
}
