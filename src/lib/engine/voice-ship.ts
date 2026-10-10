/**
 * Voice to Ship (rev 638), the pure parts: a ladder's fingerprint (what a preview token is bound to), the member's Images found
 * by words and by date, and the sentences the connector speaks. Responses are read aloud: one sentence first, everything
 * numbered so the member can say "use 2", and no ids in a sentence (ids stay in the structured data).
 */
import { createHash } from "node:crypto";
import type { Check } from "./ladder";

/** What a Ship would post, so a preview is void once any of it changes: headline, body, rungs, caption, the graphic. */
export function fingerprint(l: { headline: string; copy: string; rungs: { body: string }[]; igCaption: string; graphicImageId: string | null }): string {
  return createHash("sha256").update(JSON.stringify([l.headline, l.copy, l.rungs.map((r) => r.body), l.igCaption, l.graphicImageId ?? ""])).digest("base64url").slice(0, 22);
}

export const SHIP_TARGETS = ["page", "instagram"] as const;
export type ShipTarget = (typeof SHIP_TARGETS)[number];
/** The channels asked for, sorted and once each: what a token names, so "page, instagram" and "instagram, page" are one set. */
export const channelSet = (raw: readonly string[]): ShipTarget[] => SHIP_TARGETS.filter((t) => raw.includes(t));

export type ImageLike = { id: string; kind: string; caption: string | null; createdAt: string; source?: string };
const WORD = /[\p{L}\p{N}]+/gu;
const STOP = new Set(["the", "a", "an", "my", "of", "one", "photo", "picture", "pic", "image", "from", "with", "use", "that", "this", "in", "on", "at"]);
const dayOf = (iso: string) => (iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** "today", "yesterday", "this week", "last week", "last month": the dates they cover, in the member's own today. */
export function dateWindow(words: string, today: string): { from: string; to: string } | null {
  const w = words.toLowerCase();
  if (/\btoday\b/.test(w)) return { from: today, to: today };
  if (/\byesterday\b/.test(w)) return { from: addDays(today, -1), to: addDays(today, -1) };
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -dow);
  if (/\bthis week\b/.test(w)) return { from: monday, to: today };
  if (/\blast week\b/.test(w)) return { from: addDays(monday, -7), to: addDays(monday, -1) };
  if (/\bthis month\b/.test(w)) return { from: `${today.slice(0, 7)}-01`, to: today };
  if (/\blast month\b/.test(w)) {
    const first = `${today.slice(0, 7)}-01`;
    const prev = addDays(first, -1);
    return { from: `${prev.slice(0, 7)}-01`, to: prev };
  }
  return null;
}

/**
 * The member's Images that fit the words: each word found in the caption or the kind scores, newer breaks ties, a date phrase
 * keeps only that window. Up to five; the first is the suggestion. With no word but a date, the newest in the window.
 */
export function findImages<T extends ImageLike>(images: readonly T[], words: string, today: string, take = 5): T[] {
  const window = dateWindow(words, today);
  const stripped = words.toLowerCase().replace(/\b(today|yesterday|this week|last week|this month|last month)\b/g, " ");
  const terms = (stripped.match(WORD) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
  const pool = images.filter((i) => i.kind !== "logo" && (!window || (dayOf(i.createdAt) >= window.from && dayOf(i.createdAt) <= window.to)));
  const score = (i: T) => {
    const hay = `${i.caption ?? ""} ${i.kind}`.toLowerCase();
    return terms.filter((t) => hay.includes(t)).length;
  };
  const ranked = pool.map((i) => ({ i, s: score(i) })).filter((x) => !terms.length || x.s > 0);
  ranked.sort((a, b) => b.s - a.s || b.i.createdAt.localeCompare(a.i.createdAt));
  return ranked.slice(0, take).map((x) => x.i);
}

/** "3 checks to fix: …" or "checks passed", in plain words. Warnings are named but never block. */
export function checksLine(checks: Check[]): string {
  const fails = checks.filter((c) => !c.ok && c.level === "fail");
  const warns = checks.filter((c) => !c.ok && c.level === "warn");
  if (!fails.length) return warns.length ? `checks passed, ${warns.length} to look at: ${warns.map((w) => w.label).join("; ")}` : "checks passed";
  return `${fails.length} check${fails.length === 1 ? "" : "s"} to fix: ${fails.map((f) => `${f.label}${f.note ? ` (${f.note})` : ""}`).join("; ")}`;
}

/** The first two lines of a body, for a read-back. */
export const firstLines = (text: string, n = 2): string => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, n).join(" / ");

/** A numbered list, "1. … 2. …", for the member to answer "use 2". */
export const numbered = (items: readonly string[]): string => items.map((x, i) => `${i + 1}. ${x}`).join("\n");
