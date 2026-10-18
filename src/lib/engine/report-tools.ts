/**
 * Issues and ideas on the connector (H-583, plan H-591): which reports a state lists, how many, and what one list row carries.
 * Pure, so the tools and the tests read the same rules. A row never carries a store key, a store address, an email or a phone:
 * the sender is their first name and their member id only.
 */
import { cutText } from "./cut";

export const REPORT_STATES = ["new", "open", "all"] as const;
export type ReportState = (typeof REPORT_STATES)[number];
export const LIST_DEFAULT = 20;
export const LIST_MAX = 50;
export const EXCERPT_CHARS = 200;

/** new: not Seen yet. open: not Done yet. all: every report. */
export function inState(r: { seenAt: string | null; doneAt: string | null }, state: ReportState): boolean {
  return state === "new" ? !r.seenAt : state === "open" ? !r.doneAt : true;
}

/** 1 to 50, 20 when left out. */
export function listLimit(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return LIST_DEFAULT;
  return Math.min(Math.max(Math.floor(n), 1), LIST_MAX);
}

/** The first 200 characters, never half an emoji, with "…" when cut. */
export function excerpt(text: string): string {
  const t = text.trim();
  return t.length <= EXCERPT_CHARS ? t : `${cutText(t, EXCERPT_CHARS)}…`;
}

export const firstName = (name: string | null | undefined): string => name?.trim().split(/\s+/)[0] || "A member";

export type ReportRowInput = {
  id: string;
  kind: string;
  severity: string;
  page: string | null;
  description: string;
  screenshotUrl: string | null;
  talkToCoach: boolean;
  seenAt: string | null;
  doneAt: string | null;
  createdAt: string;
};

export type ReportListRow = {
  id: string;
  kind: string;
  severity: string;
  page: string | null;
  excerpt: string;
  hasScreenshot: boolean;
  talkToCoach: boolean;
  seenAt: string | null;
  doneAt: string | null;
  /** In the sender's own zone, with the zone written ("Oct 17, 1:32 PM PDT"). */
  createdAt: string;
  createdAtUtc: string;
  sender: { firstName: string; memberId: string | null };
};

export function listRow(r: ReportRowInput, sender: { name: string | null; memberId: string | null }, when: string, utc: string): ReportListRow {
  return {
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    page: r.page,
    excerpt: excerpt(r.description),
    hasScreenshot: Boolean(r.screenshotUrl),
    talkToCoach: r.talkToCoach,
    seenAt: r.seenAt,
    doneAt: r.doneAt,
    createdAt: when,
    createdAtUtc: utc,
    sender: { firstName: firstName(sender.name), memberId: sender.memberId },
  };
}

/** The picture types an MCP image block carries as they are; anything else is turned into a JPEG first. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** About 1.5 MB of picture: over this, it's scaled down first. */
export const IMAGE_MAX_BYTES = 1_500_000;
