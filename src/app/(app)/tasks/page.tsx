import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { settleOldFocus } from "@/lib/tasks-core";
import { NewTaskForm } from "@/components/new-task-form";
import { TaskRow } from "@/components/task-row";
import { taskOrigins } from "@/lib/queries/tasks";
import { Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { addDays, formatDate } from "@/lib/dates";
import { keepFutureImportedTasksAction, reviewImportedTaskAction } from "@/lib/actions/tasks";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const v = await requireViewer();
  const { filter = "open" } = await searchParams;
  const today = v.today;
  await settleOldFocus(v);
  const open = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, v.user.id), ne(schema.tasks.status, "done"), isNull(schema.tasks.reviewState)),
    orderBy: [asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)],
  });
  // Imported tasks waiting for review, and the ones let go (30 Sep): never in the lists above, never on Today.
  const waiting = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, v.user.id), ne(schema.tasks.status, "done")),
    orderBy: [asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)],
  });
  const toReview = waiting.filter((t) => t.reviewState === "to_review");
  const letGo = waiting.filter((t) => t.reviewState === "let_go");
  const future = toReview.filter((t) => t.dueDate && t.dueDate > today).length;
  const done = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, v.user.id), eq(schema.tasks.status, "done")),
    orderBy: desc(schema.tasks.completedAt),
    limit: 50,
  });
  const origins = await taskOrigins([...open, ...done]);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = open.filter((t) => t.dueDate === today);
  const focus = open.filter((t) => t.focusDate === today);
  const later = open.filter((t) => !t.dueDate || t.dueDate > today);

  const tabs = [
    { key: "open", label: "Open", href: "/tasks", count: open.length },
    { key: "overdue", label: "Overdue", href: "/tasks?filter=overdue", count: overdue.length },
    { key: "done", label: "Done", href: "/tasks?filter=done", count: done.length },
    ...(letGo.length ? [{ key: "letgo", label: "Let go", href: "/tasks?filter=letgo", count: letGo.length }] : []),
  ];

  const groups: { title: string; items: typeof open }[] = [];
  if (filter === "letgo") groups.push({ title: "Let go", items: [] });
  else if (filter === "overdue") groups.push({ title: "Overdue", items: overdue });
  else if (filter === "done") groups.push({ title: "Completed", items: done });
  else {
    if (focus.length) groups.push({ title: "★ Top 3 today", items: focus });
    if (overdue.length) groups.push({ title: "Overdue", items: overdue });
    groups.push({ title: "Due today", items: dueToday.filter((t) => t.focusDate !== today) });
    const byDay = new Map<string, typeof open>();
    for (const t of later) {
      const k = t.dueDate ?? "someday";
      byDay.set(k, [...(byDay.get(k) ?? []), t]);
    }
    for (const [k, items] of [...byDay.entries()].sort()) {
      groups.push({ title: k === "someday" ? "Someday" : k === addDays(today, 1) ? "Tomorrow" : formatDate(k, { weekday: "long", month: "short", day: "numeric" }), items });
    }
  }

  return (
    <>
      <PageHeader title="Tasks" subtitle="Three that matter, then everything else." action={<NewTaskForm today={today} />} />
      <Tabs items={tabs} current={filter} />
      <div className="space-y-4">
        {filter === "open" && toReview.length ? (
          <details className="rounded-xl border border-line bg-surface p-4" data-testid="tasks-review">
            <summary className="cursor-pointer text-sm font-semibold">From Airtable, to review ({toReview.length})</summary>
            <p className="mt-2 text-xs text-ink-3">Brought over from your Airtable base, with their dates as written there. They stay off Today until you keep them. Keep makes one yours, Done files it as history, Let go hides it (nothing is deleted).</p>
            {future ? (
              <form action={keepFutureImportedTasksAction} className="mt-2">
                <SubmitButton className="btn btn-soft btn-sm" pendingText="Keeping…" data-testid="tasks-keep-future">
                  Keep all dated after today ({future})
                </SubmitButton>
              </form>
            ) : null}
            <ul className="mt-3 divide-y text-sm">
              {toReview.map((t) => (
                <ReviewRow key={t.id} id={t.id} title={t.title} due={t.dueDate} today={today} choices={["keep", "done", "let_go"]} />
              ))}
            </ul>
          </details>
        ) : null}
        {filter === "letgo" ? (
          <Card title="Let go">
            <ul className="divide-y text-sm" data-testid="tasks-letgo">
              {letGo.map((t) => (
                <ReviewRow key={t.id} id={t.id} title={t.title} due={t.dueDate} today={today} choices={["keep"]} />
              ))}
            </ul>
          </Card>
        ) : null}
        {groups.filter((g) => g.title !== "Let go").map((g) => (
          <Card key={g.title} title={g.title}>
            {g.items.length ? (
              <div className="-mx-2 divide-y">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} origin={origins.get(t.id)} />
                ))}
              </div>
            ) : (
              <Empty icon="🎯" title={g.title === "Due today" ? "Nothing else due today" : "Nothing here"} hint={g.title === "Due today" ? "Add one thing that moves a conversation forward." : undefined} />
            )}
          </Card>
        ))}
        {filter === "done" && !done.length ? <Empty icon="✅" title="No completed tasks yet" hint="Check one off on Today and it lands here." /> : null}
      </div>
    </>
  );
}

const CHOICE_LABEL = { keep: "Keep", done: "Done", let_go: "Let go" } as const;

/** One imported task to decide on: its title, its date as written in the base, and the choices. */
function ReviewRow({ id, title, due, today, choices }: { id: string; title: string; due: string | null; today: string; choices: (keyof typeof CHOICE_LABEL)[] }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="tasks-review-row">
      <span className="min-w-0 flex-1">
        {title}
        <span className="text-xs text-ink-3"> · {due ? `${due < today ? "was due" : "due"} ${formatDate(due, { month: "short", day: "numeric", year: "numeric" })}` : "no date"}</span>
      </span>
      <form action={reviewImportedTaskAction} className="flex gap-1">
        <input type="hidden" name="id" value={id} />
        {choices.map((c) => (
          <SubmitButton key={c} name="choice" value={c} className="btn btn-ghost btn-sm" pendingText="…" data-testid={`tasks-review-${c}`}>
            {CHOICE_LABEL[c]}
          </SubmitButton>
        ))}
      </form>
    </li>
  );
}
