"use client";

import { useState, type ReactNode } from "react";
import { TASK_NUDGE, moveToTasks, soundsLikeTask } from "@/lib/engine/intentions";

const KR_EXAMPLES = ["3 booked calls from my posts", "10 new leads from my lead magnet", "2 new paying clients"];
const TASK_EXAMPLES = ["Follow up with 10 leads", "Record 2 videos", "A third, if you have one"];

/**
 * The 3-1-3's key results and tasks (rev 158). A key result is a result you can count, that the tasks produce. One that starts
 * like a task ("Post 5 times") gets a nudge, never a block: "Move it to my tasks" puts it in the first free task slot and empties
 * the key result; "Keep it" leaves it as written (the save marks it for the coach). The initiative sits between the two lists.
 */
export function WeekLists({ keyResults, tasks, children }: { keyResults: string[]; tasks: string[]; children: ReactNode }) {
  const [kr, setKr] = useState<string[]>([0, 1, 2].map((i) => keyResults[i] ?? ""));
  const [ts, setTs] = useState<string[]>([0, 1, 2].map((i) => tasks[i] ?? ""));
  const [kept, setKept] = useState<boolean[]>([false, false, false]);
  const [note, setNote] = useState<string | null>(null);
  const setAt = (xs: string[], i: number, v: string) => xs.map((x, j) => (j === i ? v : x));

  return (
    <>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">THREE key results you can track</legend>
        <p className="text-xs text-ink-3" data-testid="week-kr-help">A result you can count, that your tasks will produce. Posting is a task; the calls it books are the result.</p>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <input
              className="field"
              name={`kr${i + 1}`}
              value={kr[i]}
              onChange={(e) => {
                setKr(setAt(kr, i, e.target.value));
                setKept(kept.map((k, j) => (j === i ? false : k)));
              }}
              placeholder={KR_EXAMPLES[i]}
              data-testid={`week-kr${i + 1}`}
            />
            {soundsLikeTask(kr[i]) && !kept[i] ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-2 py-1.5 text-sm" role="status" data-testid={`week-kr${i + 1}-nudge`}>
                <span>{TASK_NUDGE}</span>
                <button
                  type="button"
                  className="btn btn-soft btn-xs"
                  onClick={() => {
                    const moved = moveToTasks(kr, ts, i);
                    if (!moved) {
                      setNote("Your three tasks are full. Clear one to move this there, or keep it.");
                      return;
                    }
                    setKr(moved.keyResults);
                    setTs(moved.tasks);
                    setNote("Moved to your tasks. Now write the result you want from it.");
                  }}
                  data-testid={`week-kr${i + 1}-move`}
                >
                  Move it to my tasks
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setKept(kept.map((k, j) => (j === i ? true : k)))} data-testid={`week-kr${i + 1}-keep`}>
                  Keep it
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {note ? (
          <p className="text-xs text-ink-2" role="status" data-testid="week-kr-note">
            {note}
          </p>
        ) : null}
      </fieldset>
      {children}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">THREE tasks that move the needle</legend>
        {[0, 1, 2].map((i) => (
          <input key={i} className="field" name={`task${i + 1}`} value={ts[i]} onChange={(e) => setTs(setAt(ts, i, e.target.value))} placeholder={TASK_EXAMPLES[i]} data-testid={`week-task${i + 1}`} />
        ))}
        <p className="text-xs text-ink-3">These become this week&apos;s tasks, due Friday, so you tick them off where you already work.</p>
      </fieldset>
    </>
  );
}
