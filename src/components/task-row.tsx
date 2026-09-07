import type { Task } from "@/db/schema";
import { deleteTaskAction, rescheduleTaskAction, setFocusAction, toggleTaskAction } from "@/lib/actions/tasks";
import { addDays, formatDate, relativeDay } from "@/lib/dates";
import { originLabel } from "@/lib/engine/notes";
import type { TaskOrigin } from "@/lib/queries/tasks";
import { ConfirmButton } from "./confirm-button";

const CATEGORY_ICON: Record<string, string> = { sales: "💬", content: "✍️", community: "👥", system: "⚙️", admin: "🗂️", fulfillment: "🤝" };

export function TaskRow({ task, today, compact = false, origin }: { task: Task; today: string; compact?: boolean; origin?: TaskOrigin }) {
  const done = task.status === "done";
  const from = origin ? originLabel(origin.source, origin.date, (d) => formatDate(d)) : null;
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const isFocus = task.focusDate === today;
  return (
    <div className={`group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-2 ${done ? "opacity-60" : ""}`}>
      <form action={toggleTaskAction} className="pt-0.5">
        <input type="hidden" name="id" value={task.id} />
        <button
          type="submit"
          aria-label={done ? "Mark not done" : "Mark done"}
          className={`grid h-5 w-5 place-items-center rounded-md border text-xs transition ${done ? "border-good bg-good text-white" : "border-line bg-surface hover:border-ink"}`}
        >
          {done ? "✓" : ""}
        </button>
      </form>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${done ? "line-through" : ""}`}>
          {isFocus && !done ? <span className="mr-1 text-accent">★</span> : null}
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
      {!done ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition group-hover:opacity-100 focus-within:opacity-100" data-testid="task-controls">
          <form action={setFocusAction}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="on" value={isFocus ? "0" : "1"} />
            <button className="btn btn-ghost btn-xs task-control" type="submit" title={isFocus ? "Remove from top 3" : "Make it a top 3"} aria-label={isFocus ? "Remove from top 3" : "Make it a top 3"}>
              {isFocus ? "☆" : "★"}
            </button>
          </form>
          <form action={rescheduleTaskAction}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="dueDate" value={addDays(today, 1)} />
            <button className="btn btn-ghost btn-xs task-control" type="submit" title="Move to tomorrow" aria-label="Move to tomorrow">
              ↷
            </button>
          </form>
          <form action={deleteTaskAction}>
            <input type="hidden" name="id" value={task.id} />
            <ConfirmButton className="btn btn-ghost btn-xs task-control" title="Delete" message={`Delete "${task.title}"? This can't be undone.`}>
              ✕
            </ConfirmButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}
