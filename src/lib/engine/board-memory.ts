/**
 * My Board's memory (H-257): what the Board reads back from earlier decisions, and the Past discussions list.
 *
 * Nothing here deletes. "Start fresh" stamps a time on the membership and the Board then reads only decisions made after it;
 * Undo clears the stamp for seven days. "The Board remembers this" (off) and Example mark one decision. The decisions stay,
 * open, replay and share as before.
 */
import { instantOf } from "@/lib/dates";

export type MemoryRow = { createdAt: string; remembered: boolean; example: boolean };
export type TagRow = { sharedAt: string | null; remembered: boolean; example: boolean };

export const UNDO_DAYS = 7;
/** How many past decisions a new discussion reads. */
export const MEMORY_SIZE = 5;
/** Rows per page of Past discussions. */
export const PAGE = 20;

/** A database stamp ("2026-10-15 20:44:00", UTC), the shape created_at carries, so stamps compare as strings. */
export function dbStamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}

/** Whether the Board reads this decision in a new discussion: remembered, not an example, made after the fresh start. */
export function inMemory(d: MemoryRow, freshStartAt: string | null): boolean {
  return d.remembered && !d.example && !beforeFreshStart(d, freshStartAt);
}

/** Made before the fresh start: listed under "Before your fresh start (date)". */
export function beforeFreshStart(d: { createdAt: string }, freshStartAt: string | null): boolean {
  return Boolean(freshStartAt) && d.createdAt <= freshStartAt!;
}

/** Undo stays for seven days after Start fresh. */
export function canUndoFreshStart(freshStartAt: string | null, now: Date): boolean {
  if (!freshStartAt) return false;
  return now.getTime() - instantOf(freshStartAt).getTime() < UNDO_DAYS * 86_400_000;
}

export type DiscussionTag = "Shared with coach" | "Example" | "Not remembered";
/** The tags on a row of Past discussions, in the order they show. */
export function discussionTags(d: TagRow): DiscussionTag[] {
  const out: DiscussionTag[] = [];
  if (d.sharedAt) out.push("Shared with coach");
  if (d.example) out.push("Example");
  if (!d.remembered && !d.example) out.push("Not remembered");
  return out;
}

/** The search box: plain words over the question, the one-line decision and the recommendation; empty matches all. */
export function matchesSearch(d: { question: string; answer: { decision: string; recommendation: string } | null }, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${d.question}\n${d.answer?.decision ?? ""}\n${d.answer?.recommendation ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The first `show` rows and whether More has anything to add; `show` grows by a page each tap. */
export function pageOf<T>(rows: T[], show: number): { rows: T[]; more: boolean } {
  const n = Math.max(PAGE, Math.min(rows.length, Math.floor(show) || PAGE));
  return { rows: rows.slice(0, n), more: rows.length > n };
}
