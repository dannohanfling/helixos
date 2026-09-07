"use client";

import { useOptimistic, useTransition } from "react";
import type { Task } from "@/db/schema";
import { deleteTaskAction, rescheduleTaskAction, setFocusAction, toggleTaskAction } from "@/lib/actions/tasks";
import { addDays, formatDate, relativeDay } from "@/lib/dates";
import { originLabel } from "@/lib/engine/notes";
import type { TaskOrigin } from "@/lib/queries/tasks";

const CATEGORY_ICON: Record<string, string> = { sales: "💬", content: "✍️", community: "👥", system: "⚙️", admin: "🗂️", fulfillment: "🤝" };

/**
 * One task. Ticking it, starring it, moving it and deleting it all answer on the tap: the row updates at once, every
 * control is disabled and marked busy until the server confirms, so a second tap can't fire the same action twice. On a
 * phone each control carries its word; the words hide only where a mouse can hover for the tooltip.
 */
export function TaskRow({ task, today, compact = false, origin }: { task: Task; today: string; compact?: boolean; origin?: TaskOrigin }) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic({ done: task.status === "done", focus: task.focusDate === today }, (state, next: Partial<{ done: boolean; focus: boolean }>) => ({ ...state, ...next }));
  const from = origin ? originLabel(origin.source, origin.date, (d) => formatDate(d)) : null;
  const overdue = !shown.done && task.dueDate !== null && task.dueDate < today;
  const fd = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set("id", task.id);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };
  const run = (optimistic: Partial<{ done: boolean; focus: boolean }>, action: () => Promise<void>) => {
    if (pending) return;
    start(async () => {
      setShown(optimistic);
      await action();
    });
  };

  return (
    <div className={`group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-2 ${shown.done ? "opacity-60" : ""}`} data-testid="task-row" data-pending={pending ? "1" : "0"}>
      <button
        type="button"
        aria-label={shown.done ? "Mark not done" : "Mark done"}
        aria-busy={pending}
        disabled={pending}
        onClick={() => run({ done: !shown.done }, () => toggleTaskAction(fd()))}
        className={`task-toggle grid place-items-center rounded-md border text-xs transition ${shown.done ? "border-good bg-good text-white" : "border-line bg-surface hover:border-ink"}`}
        data-testid="task-toggle"
      >
        {pending ? <span className="spinner" aria-hidden="true" /> : shown.done ? "✓" : ""}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${shown.done ? "line-through" : ""}`}>
          {shown.focus && !shown.done ? <span className="mr-1 text-accent">★</span> : null}
          {task.title}
        </div>
        {!compact && task.details ? <div className="mt-0.5 text-xs text-ink-2">{task.details}</div> : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
          <span>{CATEGORY_ICON[task.category] ?? "•"} {task.category}</span>
          {task.dueDate ? <span className={overdue ? "font-semibold text-danger" : ""}>· {relativeDay(task.dueDate, today)}</span> : null}
          {task.repeatEveryDays ? <span>· repeats every {task.repeatEveryDays === 1 ? "day" : `${task.repeatEveryDays} days`}</span> : null}
          <span>· +{task.points} pts</span>
          {from ? (
            <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-accent-ink" data-testid="task-origin">
              📞 {from}
            </span>
          ) : null}
        </div>
      </div>
      {!shown.done ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition group-hover:opacity-100 focus-within:opacity-100" data-testid="task-controls">
          <button className="btn btn-ghost btn-xs task-control" type="button" disabled={pending} aria-busy={pending} title={shown.focus ? "Remove from top 3" : "Make it a top 3"} aria-label={shown.focus ? "Remove from top 3" : "Make it a top 3"} onClick={() => run({ focus: !shown.focus }, () => setFocusAction(fd({ on: shown.focus ? "0" : "1" })))}>
            {shown.focus ? "☆" : "★"}
            <span className="task-control-label">{shown.focus ? "Unstar" : "Top 3"}</span>
          </button>
          <button className="btn btn-ghost btn-xs task-control" type="button" disabled={pending} aria-busy={pending} title="Move to tomorrow" aria-label="Move to tomorrow" onClick={() => run({}, () => rescheduleTaskAction(fd({ dueDate: addDays(today, 1) })))}>
            ↷<span className="task-control-label">Tomorrow</span>
          </button>
          <button
            className="btn btn-ghost btn-xs task-control"
            type="button"
            disabled={pending}
            aria-busy={pending}
            title="Delete"
            aria-label="Delete"
            onClick={() => {
              if (window.confirm(`Delete "${task.title}"? This can't be undone.`)) run({}, () => deleteTaskAction(fd()));
            }}
          >
            ✕<span className="task-control-label">Delete</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
