/**
 * Merging one exercise into another (rev 507): pure rules for the preview and for routines. The sets keep their dates and order,
 * so the PR afterwards is the best of both histories; a routine that holds both keeps one line, the kept exercise's.
 */
import type { BodyRoutineItem } from "@/db/schema";
import { bestSet, fmtSet, type SetLike, type WeightUnit } from "@/lib/engine/body-training";
import { formatDate } from "@/lib/dates";

type SetRow = SetLike;

/** A routine's items with the merged exercise turned into the kept one; null when it holds neither, or only the kept one. */
export function mergeRoutineItems(items: BodyRoutineItem[], mergedId: string, keptId: string): BodyRoutineItem[] | null {
  if (!items.some((i) => i.exerciseId === mergedId)) return null;
  const hasKept = items.some((i) => i.exerciseId === keptId);
  return items.flatMap((i) => (i.exerciseId !== mergedId ? [i] : hasKept ? [] : [{ ...i, exerciseId: keptId }]));
}

export type MergePreview = { sets: number; from: string | null; to: string | null; prBefore: string | null; prAfter: string | null; text: string };

/** "Move 9 sets (Mar 21 to Apr 12) into Seated Leg Curl; PR becomes 105 × 10". */
export function mergePreview(merged: SetRow[], kept: SetRow[], o: { mergedName: string; keptName: string; unit: WeightUnit; kind: "weight" | "bodyweight" }): MergePreview {
  const dates = merged.map((s) => s.date).sort();
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;
  const before = bestSet(kept, o.unit);
  const after = bestSet([...kept, ...merged], o.unit);
  const show = (s: SetRow | null) => (s ? fmtSet(s, o.unit, o.kind) : null);
  const span = from ? (from === to ? ` (${formatDate(from, { month: "short", day: "numeric" })})` : ` (${formatDate(from, { month: "short", day: "numeric" })} to ${formatDate(to!, { month: "short", day: "numeric" })})`) : "";
  const pr = show(after);
  const text = `Move ${merged.length} set${merged.length === 1 ? "" : "s"}${span} from ${o.mergedName} into ${o.keptName}${pr ? `; PR ${show(before) === pr ? "stays" : "becomes"} ${pr}` : ""}.`;
  return { sets: merged.length, from, to, prBefore: show(before), prAfter: pr, text };
}

/** An undo is open for 7 days from the merge. */
export const undoOpen = (mergedAt: string, now = Date.now()): boolean => now - Date.parse(mergedAt.replace(" ", "T") + (mergedAt.includes("Z") ? "" : "Z")) < 7 * 86_400_000;
